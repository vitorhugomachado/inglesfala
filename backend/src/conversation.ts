import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { introSegments, emptySegments, dialogueFormat, tutorInstruction, parseDialogue, spokenText } from './dialogue.js';
type Message = { role: 'user' | 'assistant'; content: string };
type Session = { messages: Message[]; touched: number; busy: boolean };
export function registerConversation(app: FastifyInstance, requestProvider: typeof fetch = fetch) {
  const sessions = new Map<string, Session>();
  const prune = () => { for (const [id, s] of sessions) if (Date.now() - s.touched > 1_800_000 && !s.busy) sessions.delete(id); };
  app.get('/api/conversation/status', async () => ({ ready: Boolean(process.env.GROQ_API_KEY?.trim()), pronunciationAssessment: false }));
  app.post('/api/conversation', async (_request, reply) => {
    if (!process.env.GROQ_API_KEY?.trim()) return reply.code(503).send({ message: 'Falta configurar a chave da Groq no backend para conversar com o tutor.' });
    prune();
    if (sessions.size >= 100) return reply.code(503).send({ message: 'Muitas sessões abertas. Tente mais tarde.' });
    const id = randomUUID();
    sessions.set(id, { messages: [{ role: 'assistant', content: JSON.stringify({ segments: introSegments }) }], touched: Date.now(), busy: false });
    return { id, reply: spokenText(introSegments), segments: introSegments };
  });
  app.delete<{ Params: { id: string } }>('/api/conversation/:id', async request => { sessions.delete(request.params.id); return { status: 'ended' }; });
  app.post<{ Params: { id: string } }>('/api/conversation/:id/turn', { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    prune();
    const session = sessions.get(request.params.id);
    if (!session) return reply.code(404).send({ message: 'A sessão expirou. Ligue o microfone para começar outra.' });
    if (session.busy) return reply.code(409).send({ message: 'O tutor ainda está respondendo.' });
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) return reply.code(503).send({ message: 'A chave da Groq não está configurada.' });
    const audio = request.body;
    const mime = request.headers['content-type']?.split(';')[0].trim();
    if (!mime || !['audio/webm', 'audio/mp4', 'audio/ogg'].includes(mime)) return reply.code(415).send({ message: 'Formato de áudio não suportado.' });
    if (!Buffer.isBuffer(audio) || audio.length < 16) return reply.code(400).send({ message: 'Não foi possível captar sua fala. Inicie novamente.' });
    session.busy = true;
    session.touched = Date.now();
    const signal = AbortSignal.timeout(30_000);
    const headers = { Authorization: `Bearer ${key}` };
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `speech.${mime === 'audio/mp4' ? 'm4a' : mime.split('/')[1]}`);
      form.append('model', 'whisper-large-v3-turbo');
      const transcription = await requestProvider('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers, body: form, signal });
      if (!transcription.ok) throw new Error(`provider:${transcription.status}`);
      const transcript = (await transcription.json() as { text?: string }).text?.trim();
      if (!transcript) return { transcript: '', reply: spokenText(emptySegments), segments: emptySegments };
      const messages: Message[] = [...session.messages, { role: 'user', content: transcript.slice(0, 4000) }];
      const completion = await requestProvider('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ model: 'openai/gpt-oss-20b', messages: [{ role: 'system', content: tutorInstruction }, ...messages], response_format: dialogueFormat, max_completion_tokens: 1800, reasoning_effort: 'low' }),
      });
      if (!completion.ok) throw new Error(`provider:${completion.status}`);
      const data = await completion.json() as { choices?: { message?: { content?: string } }[] };
      const answer = data.choices?.[0]?.message?.content?.trim();
      if (!answer) throw new Error('empty');
      const segments = parseDialogue(answer);
      session.messages = [...messages, { role: 'assistant' as const, content: JSON.stringify({ segments }) }].slice(-24);
      session.touched = Date.now();
      return { transcript, reply: spokenText(segments), segments };
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      return reply.code(502).send({ message: reason === 'provider:401' ? 'A chave da Groq foi recusada. Confira o backend.' : reason === 'provider:429' ? 'A Groq atingiu o limite de uso. Tente em instantes.' : 'A conexão com o tutor falhou. Inicie novamente.' });
    } finally { session.busy = false; }
  });
  app.addHook('onClose', async () => { sessions.clear(); });
}
