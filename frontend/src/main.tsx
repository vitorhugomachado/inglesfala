import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { tutorFetch } from './api';
import { playSegments, speechSegments, type SpeechSegment } from './speech';
type Phase = 'idle' | 'starting' | 'listening' | 'thinking' | 'speaking';
const labels: Record<Phase, string> = { idle: 'Pronto para conversar', starting: 'Preparando sua sessão…', listening: 'Estou ouvindo você', thinking: 'Pensando na sua resposta…', speaking: 'Alex está falando' };
function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('Eu guio a prática, você só precisa falar.');
  const [ready, setReady] = useState<boolean | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const session = useRef('');
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const stopSpeech = useRef<(() => void) | null>(null);
  function cleanup() {
    active.current = false;
    generation.current++;
    cancelAnimationFrame(frame.current);
    clearTimeout(timer.current);
    controller.current?.abort();
    if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
    stopSpeech.current?.();
    stopSpeech.current = null;
    if (session.current) void fetch('/api/conversation/' + session.current, { method: 'DELETE', keepalive: true }).catch(() => {});
    session.current = '';
  }
  function fail(message: string) { cleanup(); setPhase('idle'); setError(message); }
  function end() { cleanup(); setPhase('idle'); setCaption('Até a próxima! Ligue o microfone quando quiser praticar novamente.'); }
  useEffect(() => {
    const abort = new AbortController();
    tutorFetch('/api/conversation/status', { signal: abort.signal }).then(async r => {
      if (!r.ok) return;
      const data = await r.json();
      if (!abort.signal.aborted) setReady(data.ready === true);
    }).catch(() => {});
    const hide = () => { if (document.hidden && active.current) { cleanup(); setPhase('idle'); setCaption('Sessão encerrada ao sair da tela. Ligue o microfone para retomar.'); } };
    document.addEventListener('visibilitychange', hide);
    return () => { abort.abort(); document.removeEventListener('visibilitychange', hide); cleanup(); };
  }, []);
  async function api(path: string, options: RequestInit) {
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 35_000);
    try {
      const response = await tutorFetch(path, { ...options, signal: abort.signal });
      if (response.status === 401) throw new Error('Não consegui renovar seu acesso. Atualize a página e tente novamente.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Não foi possível conversar com o tutor.');
      return data;
    } finally { clearTimeout(timeout); }
  }
  function speak(text: string, turn: number, segments: SpeechSegment[] = [{ lang: 'pt-BR', text }]) {
    if (!active.current || turn !== generation.current) return;
    setCaption(text);
    setPhase('speaking');
    stopSpeech.current?.();
    stopSpeech.current = playSegments(segments, () => {
      if (!active.current || turn !== generation.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => listen(turn), 350);
    }, () => { if (active.current && turn === generation.current) fail('Não consegui reproduzir a voz. Confira o áudio e inicie novamente.'); });
  }
  async function respond(blob: Blob, turn: number) {
    if (!active.current || turn !== generation.current) return;
    setPhase('thinking');
    try {
      const data = await api('/api/conversation/' + session.current + '/turn', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('O tutor retornou uma resposta vazia.');
      speak(data.reply, turn, speechSegments(data.segments, data.reply));
    } catch (cause) { if (active.current && turn === generation.current) fail(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'A resposta demorou demais. Inicie novamente.'); }
  }
  function listen(turn: number) {
    if (!active.current || turn !== generation.current || !stream.current || !analyser.current) return;
    setPhase('listening');
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) { fail('Este navegador não oferece áudio compatível. Tente Chrome ou Edge.'); return; }
    try {
      const recording = new MediaRecorder(stream.current, { mimeType });
      recorder.current = recording;
      const chunks: Blob[] = [];
      let bytes = 0, voiced = 0, lastVoice = 0, firstVoice = 0;
      let previous = performance.now();
      const started = previous;
      const samples = new Float32Array(analyser.current.fftSize);
      const finish = () => { cancelAnimationFrame(frame.current); clearTimeout(timer.current); if (recording.state === 'recording') recording.stop(); };
      recording.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
        if (bytes > 5 * 1024 * 1024 && active.current && turn === generation.current) fail('O áudio ficou longo demais. Inicie novamente com uma resposta mais curta.');
      };
      recording.onerror = () => { if (active.current && turn === generation.current) fail('O microfone parou de responder. Inicie novamente.'); };
      recording.onstop = () => {
        if (!active.current || turn !== generation.current) return;
        if (voiced < 220) { speak('Estou aqui, sem pressa. Pode responder com calma?', turn); return; }
        void respond(new Blob(chunks, { type: recording.mimeType }), turn);
      };
      recording.start(250);
      timer.current = setTimeout(finish, 45_000);
      const tick = () => {
        if (!active.current || turn !== generation.current || recording.state !== 'recording') return;
        const now = performance.now();
        analyser.current!.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        if (rms > 0.018) { voiced += Math.min(now - previous, 100); lastVoice = now; if (!firstVoice) firstVoice = now; }
        previous = now;
        if ((voiced >= 220 && now - lastVoice > 1400) || (firstVoice && now - firstVoice > 30_000) || (now - started > 25_000 && !firstVoice)) { finish(); return; }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch { fail('Não foi possível iniciar a escuta. Confira o microfone.'); }
  }
  async function start() {
    if (active.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext || !('speechSynthesis' in window)) {
      setError('Abra em Chrome ou Edge, em localhost ou HTTPS, com suporte a microfone e voz.'); return;
    }
    active.current = true;
    const turn = ++generation.current;
    setError('');
    setPhase('starting');
    try {
      const audioContext = new AudioContext();
      context.current = audioContext;
      await audioContext.resume();
      if (!active.current || turn !== generation.current) return;
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!active.current || turn !== generation.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      input.getAudioTracks()[0].onended = () => { if (active.current && turn === generation.current) fail('O microfone foi desconectado. Conecte-o e inicie novamente.'); };
      analyser.current = audioContext.createAnalyser();
      analyser.current.fftSize = 2048;
      audioContext.createMediaStreamSource(input).connect(analyser.current);
      const data = await api('/api/conversation', { method: 'POST' });
      if (!active.current || turn !== generation.current) { if (data.id) void fetch('/api/conversation/' + data.id, { method: 'DELETE' }).catch(() => {}); return; }
      if (typeof data.id !== 'string' || typeof data.reply !== 'string') throw new Error('Resposta inválida do servidor.');
      session.current = data.id;
      setReady(true);
      speak(data.reply, turn, speechSegments(data.segments, data.reply));
    } catch (cause) {
      if (active.current && turn === generation.current) fail(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Permita o microfone no navegador para começar.' : cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Não foi possível iniciar. Tente novamente.');
    }
  }
  return <main>
    <header><span className="brand">VOICE / ENGLISH</span><span className="tag">Prática por conversa</span></header>
    <section className="session" aria-labelledby="title">
      <p className="eyebrow">SEU TUTOR DE INGLÊS</p>
      <h1 id="title">Vamos conversar?</h1>
      <p className="intro">Explicações em português. Prática em inglês.</p>
      <div className={'voice-signal ' + phase} aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <span key={i} style={{ animationDelay: i * 120 + 'ms' }} />)}</div>
      <p className="phase" role="status">{labels[phase]}</p>
      <p className="caption">{caption}</p>
      <button onClick={phase === 'idle' ? start : end} className={phase === 'idle' ? '' : 'recording'}>{phase === 'idle' ? 'Ligar microfone' : 'Encerrar conversa'}</button>
      {error && <p role="alert" className="error">{error}</p>}
      {ready === false && <p className="setup">A conexão com a IA ainda precisa ser configurada para iniciar a conversa.</p>}
      <footer>Durante a sessão, sua fala é enviada automaticamente à Groq para o tutor responder. O app não salva o áudio. A avaliação de pronúncia ainda não está ativa.</footer>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
