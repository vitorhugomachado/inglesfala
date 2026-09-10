export type SpeechSegment = { lang: 'pt-BR' | 'en-US'; text: string };
export function speechSegments(value: unknown, fallback: string): SpeechSegment[] {
  if (Array.isArray(value) && value.length > 0 && value.length <= 7 && value.every(item => item && ['pt-BR', 'en-US'].includes(item.lang) && typeof item.text === 'string' && item.text.trim())) return value;
  return [{ lang: 'pt-BR', text: fallback }];
}
export function selectVoice(voices: SpeechSynthesisVoice[], lang: SpeechSegment['lang']) {
  return voices.find(voice => voice.lang.replace('_', '-').toLowerCase() === lang.toLowerCase())
    ?? voices.find(voice => voice.lang.toLowerCase().startsWith(lang.slice(0, 2))) ?? null;
}
export function playSegments(segments: SpeechSegment[], onDone: () => void, onError: () => void,
  engine: Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel'> = window.speechSynthesis,
  create: (text: string) => SpeechSynthesisUtterance = text => new SpeechSynthesisUtterance(text)) {
  let stopped = false;
  let current: SpeechSynthesisUtterance | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const next = (index: number) => {
    if (stopped) return;
    clearTimeout(watchdog);
    if (index === segments.length) { stopped = true; current = null; onDone(); return; }
    const segment = segments[index];
    current = create(segment.text);
    current.lang = segment.lang;
    current.rate = segment.lang === 'en-US' ? 0.85 : 1;
    current.voice = selectVoice(engine.getVoices(), segment.lang);
    current.onend = () => next(index + 1);
    current.onerror = () => { if (!stopped) { stopped = true; clearTimeout(watchdog); onError(); } };
    watchdog = setTimeout(() => { if (!stopped) { stopped = true; engine.cancel(); onError(); } }, 90_000);
    engine.speak(current);
  };
  next(0);
  return () => { stopped = true; clearTimeout(watchdog); if (current) { current.onend = null; current.onerror = null; } engine.cancel(); current = null; };
}
