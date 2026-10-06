import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { ApiError } from '../src/gemma.js';

async function server(t, config = {}) {
  const app = createApp({ apiKey: '', credentialStore: { load: async () => null, save: async () => {}, clear: async () => {} }, ...config });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  return `http://127.0.0.1:${app.address().port}`;
}

test('serves the application and exposes only whether a server key exists', async t => {
  const base = await server(t, { apiKey: 'never-return-this' });
  const html = await fetch(base);
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes('ContextCarry'));
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.configured, true);
  assert.ok(!JSON.stringify(config).includes('never-return-this'));
  assert.ok(html.headers.get('content-security-policy').includes("script-src 'self'"));
});

test('source files, .env, and arbitrary filesystem paths are not public', async t => {
  const base = await server(t);
  for (const path of ['/.env', '/.contextcarry/credentials.json', '/server.js', '/src/gemma.js', '/package.json', '/..%2f.env']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});

test('no-key API request returns 401 without making a provider call', async t => {
  const base = await server(t, { generateImpl: async () => assert.fail('No provider call expected') });
  const response = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"gemma-4-26b-a4b-it"}' });
  assert.equal(response.status, 401);
});

test('browser-supplied key is scoped to a request and never saved by the server', async t => {
  const base = await server(t, { generateImpl: async options => {
    assert.equal(options.apiKey, 'request-key');
    return { model: options.model, text: 'READY', latencyMs: 2 };
  } });
  const response = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'request-key' }, body: '{"model":"gemma-4-26b-a4b-it"}' });
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes('request-key'));
  assert.equal((await (await fetch(`${base}/api/config`)).json()).configured, false);
});

test('cross-origin browser requests and invalid JSON fail cleanly', async t => {
  const base = await server(t);
  const crossOrigin = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' });
  assert.equal(crossOrigin.status, 403);
  const invalid = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Invalid JSON/);
});

test('remembering a validated key makes it available after refresh and server recreation', async t => {
  let saved = null;
  const credentialStore = {
    load: async () => saved,
    save: async settings => { saved = settings; },
    clear: async () => { saved = null; },
  };
  const generateImpl = async options => {
    assert.equal(options.apiKey, 'persistent-test-key');
    return { model: options.model, text: 'READY', latencyMs: 2 };
  };
  const base = await server(t, { credentialStore, generateImpl });
  const response = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'persistent-test-key' }, body: JSON.stringify({ model: 'gemma-4-31b-it', remember: true }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).savedLocally, true);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).configured, true);
  const restarted = await server(t, { credentialStore, generateImpl });
  const config = await (await fetch(`${restarted}/api/config`)).json();
  assert.equal(config.configured, true);
  assert.equal(config.defaultModel, 'gemma-4-31b-it');
  assert.ok(!JSON.stringify(config).includes('persistent-test-key'));
  const reconnected = await fetch(`${restarted}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.defaultModel }) });
  assert.equal(reconnected.status, 200, 'no key header should be needed after restart');
});

test('rejected keys are never persisted', async t => {
  const base = await server(t, {
    credentialStore: { load: async () => null, save: async () => assert.fail('Rejected key must not be saved'), clear: async () => {} },
    generateImpl: async () => { throw new ApiError('Key rejected', 401); },
  });
  const response = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'synthetic-rejected-key' }, body: JSON.stringify({ model: 'gemma-4-31b-it', remember: true }) });
  assert.equal(response.status, 401);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).configured, false);
});

test('a storage failure does not pretend a key was saved', async t => {
  const base = await server(t, {
    credentialStore: { load: async () => null, save: async () => { throw new Error('Disk failed'); }, clear: async () => {} },
    generateImpl: async options => ({ model: options.model, text: 'READY', latencyMs: 2 }),
  });
  const response = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'synthetic-key' }, body: JSON.stringify({ model: 'gemma-4-31b-it', remember: true }) });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /saving it on this laptop failed/);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).savedLocally, false);
});

test('clearing the saved key returns the server to its environment configuration', async t => {
  let settings = { apiKey: 'synthetic-saved-key', model: 'gemma-4-31b-it' };
  const base = await server(t, {
    credentialStore: { load: async () => settings, save: async value => { settings = value; }, clear: async () => { settings = null; } },
  });
  assert.equal((await (await fetch(`${base}/api/config`)).json()).savedLocally, true);
  const response = await fetch(`${base}/api/credentials/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.deepEqual(await response.json(), { configured: false, savedLocally: false });
  assert.equal(settings, null);
  const noKey = await fetch(`${base}/api/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gemma-4-31b-it' }) });
  assert.equal(noKey.status, 401);
});
