import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from './app.js';
import { parseDialogue } from './dialogue.js';

test('bilingual replies reject invalid or English-only instruction segments', () => {
  assert.deepEqual(parseDialogue(JSON.stringify({ segments: [{ lang: 'pt-BR', text: 'Repita:' }, { lang: 'en-US', text: 'Good morning.' }] })).map(s => s.lang), ['pt-BR', 'en-US']);
  for (const value of [{ segments: [] }, { segments: [{ lang: 'en-US', text: 'Explain in English.' }] }, { segments: [{ lang: 'pt-BR', text: '' }] }, { segments: [{ lang: 'fr-FR', text: 'Bonjour' }] }]) {
    assert.throws(() => parseDialogue(JSON.stringify(value)));
  }
});

test('published page gives a protected browser session without exposing server secrets', async () => {
  const previous = { mode: process.env.NODE_ENV, token: process.env.BACKEND_ACCESS_TOKEN, origin: process.env.PUBLIC_APP_ORIGIN, groq: process.env.GROQ_API_KEY };
  process.env.NODE_ENV = 'production';
  process.env.BACKEND_ACCESS_TOKEN = 'private-server-token';
  process.env.GROQ_API_KEY = 'test-key';
  process.env.PUBLIC_APP_ORIGIN = 'https://tutor.example';
  const app = buildApp();
  try {
    const page = await app.inject('/');
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<div id="root">/);
    assert.ok(!page.body.includes('private-server-token'));
    const setCookie = String(page.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly; SameSite=Strict/);
    assert.match(setCookie, /Secure/);
    const cookie = setCookie.split(';')[0];
    const headers = { cookie, origin: 'https://tutor.example' };
    assert.equal((await app.inject('/api/conversation/status')).statusCode, 401);
    const stale = '__Host-tutor=expired-before-deployment';
    assert.equal((await app.inject({ url: '/api/conversation/status', headers: { cookie: stale } })).statusCode, 401);
    const renewed = await app.inject({ url: '/', headers: { cookie: stale } });
    const renewedCookie = String(renewed.headers['set-cookie']).split(';')[0];
    assert.equal((await app.inject({ url: '/api/conversation/status', headers: { cookie: renewedCookie } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/conversation/status', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/conversation', headers: { cookie, origin: 'https://another.example' } })).statusCode, 403);
    const start = await app.inject({ method: 'POST', url: '/api/conversation', headers });
    assert.equal(start.statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/conversation/${start.json().id}`, headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/recordings', headers })).statusCode, 401);
    assert.ok([403, 404].includes((await app.inject('/.env')).statusCode));
    assert.ok([403, 404].includes((await app.inject('/backend/.env')).statusCode));
    for (let index = 0; index < 9; index++) assert.equal((await app.inject({ method: 'POST', url: '/api/conversation', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/conversation', headers })).statusCode, 429);
  } finally {
    for (const [name, value] of Object.entries({ NODE_ENV: previous.mode, BACKEND_ACCESS_TOKEN: previous.token, PUBLIC_APP_ORIGIN: previous.origin, GROQ_API_KEY: previous.groq })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await app.close();
  }
});

test('production API requires server credential but healthcheck stays public', async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalToken = process.env.BACKEND_ACCESS_TOKEN;
  process.env.NODE_ENV = 'production';
  process.env.BACKEND_ACCESS_TOKEN = 'only-for-tests';
  const app = buildApp();
  try {
    assert.equal((await app.inject('/health')).statusCode, 200);
    assert.equal((await app.inject('/api/conversation/status')).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/conversation/status', headers: { 'x-backend-token': 'wrong-token' } })).statusCode, 401);
    const allowed = await app.inject({ url: '/api/conversation/status', headers: { 'x-backend-token': 'only-for-tests' } });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.headers['cache-control'], 'no-store');
    delete process.env.BACKEND_ACCESS_TOKEN;
    assert.equal((await app.inject('/api/conversation/status')).statusCode, 401);
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
    if (originalToken === undefined) delete process.env.BACKEND_ACCESS_TOKEN; else process.env.BACKEND_ACCESS_TOKEN = originalToken;
    await app.close();
  }
});

test('conversation configuration, contextual turns, provider failure and ending', async () => {
  const original = process.env.GROQ_API_KEY;
  let calls = 0;
  let rejectProvider = false;
  const mockFetch: typeof fetch = async (url, options) => {
    calls++;
    if (rejectProvider) return new Response('{}', { status: 401 });
    if (String(url).endsWith('/audio/transcriptions')) {
      assert.ok(options?.body instanceof FormData);
      assert.equal(options.body.get('model'), 'whisper-large-v3-turbo');
      return Response.json({ text: 'My name is Vitor.' });
    }
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'openai/gpt-oss-20b');
    assert.equal(body.messages.at(-1).content, 'My name is Vitor.');
    assert.ok(body.messages.some((m: { content: string }) => m.content.includes('Eu sou o Alex')));
    assert.equal(body.response_format.json_schema.strict, true);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ segments: [{ lang: 'pt-BR', text: 'Prazer, Vitor. Para dizer bom dia, repita:' }, { lang: 'en-US', text: 'Good morning.' }, { lang: 'pt-BR', text: 'Agora é sua vez.' }] }) } }] });
  };
  const app = buildApp(mockFetch);
  try {
    delete process.env.GROQ_API_KEY;
    assert.equal((await app.inject({ method: 'POST', url: '/api/conversation' })).statusCode, 503);
    assert.equal(calls, 0);
    process.env.GROQ_API_KEY = 'test-key-not-real';
    const start = await app.inject({ method: 'POST', url: '/api/conversation' });
    assert.equal(start.statusCode, 200);
    const { id } = start.json();
    const turn = () => app.inject({ method: 'POST', url: `/api/conversation/${id}/turn`, headers: { 'content-type': 'audio/webm' }, payload: Buffer.alloc(32) });
    const response = await turn();
    assert.equal(response.statusCode, 200);
    assert.match(response.json().reply, /Vitor/);
    assert.deepEqual(response.json().segments.map((s: { lang: string }) => s.lang), ['pt-BR', 'en-US', 'pt-BR']);
    assert.equal(calls, 2);
    rejectProvider = true;
    const failed = await turn();
    assert.equal(failed.statusCode, 502);
    assert.ok(!failed.body.includes('test-key-not-real'));
    rejectProvider = false;
    assert.equal((await turn()).statusCode, 200);
    await app.inject({ method: 'DELETE', url: `/api/conversation/${id}` });
    assert.equal((await turn()).statusCode, 404);
  } finally {
    if (original === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = original;
    await app.close();
  }
});

test('recording upload accepts supported containers and rejects invalid requests', async () => {
  const app = buildApp();
  try {
    const cases = [
      { type: 'audio/webm;codecs=opus', payload: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]), expected: 200 },
      { type: 'audio/ogg', payload: Buffer.from('OggSfixture'), expected: 200 },
      { type: 'audio/mp4', payload: Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 77, 52, 65, 32]), expected: 200 },
      { type: 'audio/webm', payload: Buffer.alloc(0), expected: 400 },
      { type: 'audio/webm', payload: Buffer.from('not audio'), expected: 400 },
      { type: 'application/json', payload: Buffer.from('{}'), expected: 415 },
      { type: 'audio/wav', payload: Buffer.from('RIFF'), expected: 415 },
      { type: 'audio/webm', payload: Buffer.alloc(5 * 1024 * 1024 + 1), expected: 413 },
    ];
    for (const entry of cases) {
      const response = await app.inject({ method: 'POST', url: '/api/recordings', headers: { 'content-type': entry.type }, payload: entry.payload });
      assert.equal(response.statusCode, entry.expected, `${entry.type} / ${entry.payload.length} bytes`);
      if (entry.expected === 200) assert.deepEqual(response.json(), {
        status: 'received', bytes: entry.payload.length, mimeType: entry.type.split(';')[0], assessment: null,
      });
    }
  } finally { await app.close(); }
});

test('GET /health returns a successful JSON healthcheck', async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /application\/json/);
    assert.deepEqual(response.json(), { status: 'ok' });
  } finally { await app.close(); }
});
