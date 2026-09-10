import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tutorFetch } from './api';

test('renews stale browser access and retries the original audio once', async t => {
  const body = new Blob(['audio']);
  const calls: Array<[unknown, RequestInit | undefined]> = [];
  t.mock.method(globalThis, 'fetch', async (path: unknown, options?: RequestInit) => {
    calls.push([path, options]);
    return new Response('{}', { status: calls.length === 1 ? 401 : 200 });
  });
  const response = await tutorFetch('/api/conversation/id/turn', { method: 'POST', body });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(c => c[0]), ['/api/conversation/id/turn', '/', '/api/conversation/id/turn']);
  assert.equal(calls[1][1]?.cache, 'no-store');
  assert.equal(calls[2][1]?.body, body);
});

test('does not retry provider failures or repeatedly retry denied access', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}', { status: 503 }); });
  assert.equal((await tutorFetch('/api/conversation')).status, 503);
  assert.equal(calls, 1);
  t.mock.restoreAll();
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('{}', { status: calls === 2 ? 200 : 401 });
  });
  assert.equal((await tutorFetch('/api/conversation')).status, 401);
  assert.equal(calls, 3);
});
