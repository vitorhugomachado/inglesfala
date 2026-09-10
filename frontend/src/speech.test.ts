import test from 'node:test';
import assert from 'node:assert/strict';
import { playSegments, selectVoice } from './speech';

test('Portuguese and English segments play sequentially before listening resumes', () => {
  const voices = [{ lang: 'en-US' }, { lang: 'pt-BR' }] as SpeechSynthesisVoice[];
  const spoken: SpeechSynthesisUtterance[] = [];
  let done = 0;
  const engine = { getVoices: () => voices, speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance), cancel: () => {} };
  const stop = playSegments([{ lang: 'pt-BR', text: 'Bom dia em inglês é:' }, { lang: 'en-US', text: 'Good morning.' }, { lang: 'pt-BR', text: 'Sua vez.' }], () => done++, () => assert.fail('Unexpected speech error'), engine, text => ({ text } as SpeechSynthesisUtterance));
  try {
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].lang, 'pt-BR');
    assert.equal(spoken[0].voice, voices[1]);
    spoken[0].onend?.call(spoken[0], {} as SpeechSynthesisEvent);
    assert.equal(done, 0);
    assert.equal(spoken[1].lang, 'en-US');
    assert.equal(spoken[1].voice, voices[0]);
    assert.equal(spoken[1].rate, 0.85);
    spoken[1].onend?.call(spoken[1], {} as SpeechSynthesisEvent);
    assert.equal(done, 0);
    spoken[2].onend?.call(spoken[2], {} as SpeechSynthesisEvent);
    assert.equal(done, 1);
  } finally { stop(); }
});

test('ending a session prevents subsequent segments and completion callbacks', () => {
  let current: SpeechSynthesisUtterance | undefined;
  let count = 0;
  const stop = playSegments([{ lang: 'pt-BR', text: 'Olá' }, { lang: 'en-US', text: 'Hello' }], () => assert.fail('Cancelled session resumed'), () => {}, {
    getVoices: () => [], speak: utterance => { current = utterance; count++; }, cancel: () => {},
  }, text => ({ text } as SpeechSynthesisUtterance));
  const staleEnd = current!.onend;
  stop();
  staleEnd?.call(current!, {} as SpeechSynthesisEvent);
  assert.equal(count, 1);
  assert.equal(selectVoice([{ lang: 'en-US' }] as SpeechSynthesisVoice[], 'pt-BR'), null);
});
