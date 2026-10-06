import test from 'node:test';
import assert from 'node:assert/strict';
import { handover, compare } from '../src/service.js';
import { emptyMemory } from '../src/memory.js';

const messages = [{ id: 'm1', role: 'user', text: 'My private project codename is ORCHID-72.' }];
const update = { key: 'project.codename', kind: 'fact', text: 'Project codename: ORCHID-72.', sourceId: 'm1', quote: 'My private project codename is ORCHID-72.', priority: 3 };
const input = () => ({ messages, memory: emptyMemory(), cursor: 0, budget: 1200, model: 'gemma-4-26b-a4b-it' });
const result = text => ({ text, model: input().model, latencyMs: 12, usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 } });
const extractor = async () => result(JSON.stringify({ updates: [update], removals: [] }));

test('handover returns an auditable snapshot and commits only validated model output', async () => {
  const saved = await handover(input(), 'test-key', extractor);
  assert.equal(saved.cursor, 1);
  assert.equal(saved.memory.entries[0].text, update.text);
  assert.equal(saved.stats.usage.inputTokens, 123);
  assert.ok(saved.trace.prompt.includes('ORCHID-72'));
  assert.ok(!JSON.stringify(saved).includes('test-key'));
});

test('successive extractions receive only previous active memory and new messages', async () => {
  const first = await handover(input(), 'key', extractor);
  const next = { ...input(), memory: first.memory, cursor: first.cursor, messages: [...messages, { id: 'm2', role: 'user', text: 'We still have to write the demo script.' }] };
  await handover(next, 'key', async options => {
    const prompt = JSON.parse(options.prompt);
    assert.deepEqual(prompt.NEW_MESSAGES, [next.messages[1]]);
    assert.equal(prompt.CURRENT_MEMORY[0].key, update.key);
    assert.equal(Object.hasOwn(prompt, 'ARCHIVE'), false);
    return result('{"updates":[],"removals":[]}');
  });
});

test('malformed model output cannot advance the handover cursor', async () => {
  const state = input();
  await assert.rejects(handover(state, 'key', async () => result('Not JSON')), /valid JSON/);
  assert.equal(state.cursor, 0);
  assert.equal(state.memory.generation, 0);
});

test('comparison holds settings constant and never leaks expected answers to either call', async () => {
  const saved = await handover(input(), 'key', extractor);
  const calls = [];
  const response = await compare({ ...input(), memory: saved.memory, cursor: 1, question: 'What is the codename?', checks: [{ expected: 'DO_NOT_SEND_EXPECTED' }] }, 'key', async options => { calls.push(options); return result('I do not know.'); });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].system, calls[1].system);
  assert.equal(calls[0].model, calls[1].model);
  assert.equal(calls[0].maxOutputTokens, calls[1].maxOutputTokens);
  assert.equal(JSON.parse(calls[0].prompt).QUESTION, JSON.parse(calls[1].prompt).QUESTION);
  assert.ok(!JSON.stringify(calls).includes('DO_NOT_SEND_EXPECTED'));
  assert.equal(response.baseline.context.budget, response.carry.context.budget);
});

test('one failed lane preserves the successful lane and is not given a fabricated answer', async () => {
  const saved = await handover(input(), 'key', extractor);
  let count = 0;
  const response = await compare({ ...input(), memory: saved.memory, cursor: 1, question: 'What is the codename?' }, 'key', async () => {
    if (count++ === 0) throw new Error('Quota reached');
    return result('ORCHID-72');
  });
  assert.equal(response.baseline.error, 'Quota reached');
  assert.equal(response.baseline.text, undefined);
  assert.equal(response.carry.text, 'ORCHID-72');
});

test('comparison refuses stale memory and calls no model', async () => {
  const saved = await handover(input(), 'key', extractor);
  const state = { ...input(), memory: saved.memory, cursor: 1, messages: [...messages, { id: 'm2', role: 'user', text: 'Change the codename to LILY.' }], question: 'What is the codename?' };
  await assert.rejects(compare(state, 'key', async () => { assert.fail('No model call expected'); }), /out of date/);
});

test('handover supports the entire advertised context-budget range', async () => {
  for (const budget of [600, 12000]) {
    const saved = await handover({ ...input(), budget }, 'key', extractor);
    assert.equal(saved.stats.memoryBudget, Math.floor(budget * 0.6));
    assert.equal(saved.memory.entries[0].key, update.key);
  }
});

test('an invalid missing-memory removal is repaired once without committing the bad batch', async () => {
  let calls = 0;
  const state = input();
  const saved = await handover(state, 'key', async options => {
    calls++;
    if (calls === 1) return result(JSON.stringify({ updates: [], removals: [{ key: 'missing.old_value', sourceId: 'm1', quote: messages[0].text }] }));
    assert.match(options.prompt, /The model tried to remove a missing memory/);
    assert.equal(state.memory.generation, 0);
    assert.equal(state.cursor, 0);
    return extractor();
  });
  assert.equal(calls, 2);
  assert.equal(saved.memory.generation, 1);
  assert.equal(saved.memory.entries[0].key, update.key);
  assert.equal(saved.stats.attempts, 2);
  assert.equal(saved.stats.usage.inputTokens, 246, 'both model calls count toward cost');
  assert.equal(saved.trace.attempts.length, 2);
  assert.match(saved.trace.attempts[0].validationError, /missing memory/);
});

test('failed schema repair stops after two calls and leaves the existing memory unchanged', async () => {
  let calls = 0;
  const state = input();
  await assert.rejects(handover(state, 'key', async () => { calls++; return result('not JSON'); }), /valid JSON/);
  assert.equal(calls, 2);
  assert.equal(state.memory.generation, 0);
  assert.equal(state.cursor, 0);
});
