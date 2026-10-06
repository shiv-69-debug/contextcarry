import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MODELS } from './src/memory.js';
import { ApiError, generate } from './src/gemma.js';
import { compare, handover } from './src/service.js';
import { createCredentialStore } from './src/credentials.js';

const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/core/memory.js', ['src/memory.js', 'text/javascript; charset=utf-8']],
  ['/example.json', ['examples/trip.json', 'application/json; charset=utf-8']],
]);

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError('Send application/json.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1500000) throw new ApiError('This experiment is too large. Export it and start a new one.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError('Invalid JSON request.', 400); }
}

export function createApp({ apiKey = process.env.GEMINI_API_KEY || '', defaultModel = process.env.GEMMA_MODEL || MODELS[0], generateImpl = generate, credentialStore = createCredentialStore() } = {}) {
  let inFlight = 0;
  const environmentKey = apiKey;
  const environmentModel = defaultModel;
  let savedLocally = false;
  let settingsReady;
  function ensureSettings() {
    return settingsReady ??= credentialStore.load().then(saved => {
      if (saved) {
        apiKey = saved.apiKey;
        defaultModel = saved.model;
        savedLocally = true;
      }
    }).catch(error => { settingsReady = undefined; throw error; });
  }
  return createServer(async (request, response) => {
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let occupied = false;
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/api/config') {
        await ensureSettings();
        return json(200, { configured: Boolean(apiKey), savedLocally, models: MODELS, defaultModel: MODELS.includes(defaultModel) ? defaultModel : MODELS[0] });
      }
      if (request.method === 'GET' && files.has(url.pathname)) {
        const [path, type] = files.get(url.pathname);
        const data = await readFile(new URL(path, import.meta.url));
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return response.end(data);
      }
      if (request.method !== 'POST' || !['/api/connect', '/api/credentials/clear', '/api/handover', '/api/compare'].includes(url.pathname)) return json(404, { error: 'Not found.' });
      const origin = request.headers.origin;
      if ((origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) || request.headers['sec-fetch-site'] === 'cross-site') {
        throw new ApiError('Cross-origin requests are not accepted.', 403);
      }
      if (inFlight >= 4) throw new ApiError('Another operation is still running. Wait a moment.', 429);
      inFlight++;
      occupied = true;
      const input = await readJson(request);
      if (!input || typeof input !== 'object') throw new ApiError('Expected a JSON object.', 400);
      const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
      if ((input.remember === true || url.pathname === '/api/credentials/clear') && !isLocal) throw new ApiError('Manage saved keys from localhost on this laptop.', 403);
      await ensureSettings();
      if (url.pathname === '/api/credentials/clear') {
        try { await credentialStore.clear(); } catch { throw new ApiError('Could not remove the saved key. Check permissions on the local .contextcarry folder.', 500); }
        apiKey = environmentKey;
        defaultModel = environmentModel;
        savedLocally = false;
        return json(200, { configured: Boolean(apiKey), savedLocally });
      }
      const suppliedKey = request.headers['x-api-key'];
      const key = typeof suppliedKey === 'string' && suppliedKey.trim() ? suppliedKey.trim() : apiKey;
      if (!key) throw new ApiError('Connect your Google AI Studio key first. No model request was sent.', 401);
      if (key.length > 256 || /[\r\n]/.test(key)) throw new ApiError('Invalid key format.', 400);
      if (url.pathname === '/api/connect') {
        const result = await generateImpl({ apiKey: key, model: input.model, system: 'Respond with the word READY.', prompt: 'Connection check.', maxOutputTokens: 32 });
        if (input.remember === true) {
          try { await credentialStore.save({ apiKey: key, model: input.model }); }
          catch { throw new ApiError('Gemma accepted the key, but saving it on this laptop failed. Check folder permissions or uncheck Remember on this laptop.', 500); }
          apiKey = key;
          defaultModel = input.model;
          savedLocally = true;
        }
        return json(200, { connected: true, model: result.model, latencyMs: result.latencyMs, configured: Boolean(apiKey), savedLocally, remembered: input.remember === true });
      }
      const result = url.pathname === '/api/handover' ? await handover(input, key, generateImpl) : await compare(input, key, generateImpl);
      json(200, result);
    } catch (error) {
      json(error instanceof ApiError ? error.status : 400, { error: error.message || 'The request could not be completed.' });
    } finally {
      if (occupied) inFlight--;
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  app.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT in .env to another port.` : error.message);
    process.exitCode = 1;
  });
  app.listen(port, host, () => console.log(`ContextCarry is ready at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
}
