import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/gemma.js';

const options = { apiKey: 'secret-test-key', model: 'gemma-4-26b-a4b-it', system: 'System', prompt: 'Prompt' };

test('REST integration sends credentials in a header, never the URL or response', async () => {
  const response = await generate({ ...options, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent');
    assert.equal(request.headers['x-goog-api-key'], options.apiKey);
    const body = JSON.parse(request.body);
    assert.equal(body.systemInstruction.parts[0].text, 'System');
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'not output' }, { text: 'Hello' }] } }], usageMetadata: { promptTokenCount: 19, candidatesTokenCount: 3, totalTokenCount: 22 } });
  } });
  assert.equal(response.text, 'Hello');
  assert.equal(response.usage.inputTokens, 19);
  assert.ok(!JSON.stringify(response).includes(options.apiKey));
});

test('quota errors are actionable and do not echo provider bodies', async () => {
  await assert.rejects(generate({ ...options, fetchImpl: async () => Response.json({ error: { message: options.apiKey } }, { status: 429 }) }), error => error.status === 429 && /quota/.test(error.message) && !error.message.includes(options.apiKey));
});

test('truncated output fails instead of being treated as a complete memory', async () => {
  await assert.rejects(generate({ ...options, fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"updates":[' }] } }] }) }), /cut short/);
});

test('network and empty output failures are explicit', async () => {
  await assert.rejects(generate({ ...options, fetchImpl: async () => { throw new TypeError('network detail'); } }), /Could not reach/);
  await assert.rejects(generate({ ...options, fetchImpl: async () => Response.json({ candidates: [] }) }), /no text/);
});

test('missing credentials and unknown models are rejected before fetching', async () => {
  const fetchImpl = () => assert.fail('Fetch must not run');
  await assert.rejects(generate({ ...options, apiKey: '', fetchImpl }), /Connect/);
  await assert.rejects(generate({ ...options, model: 'unrelated-model', fetchImpl }), /supported/);
});
