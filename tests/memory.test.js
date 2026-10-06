import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExtraction, buildContext, emptyMemory, memoryText, parseModelJson, scoreAnswer, validateMemory, validateMessages } from '../src/memory.js';

const messages = [
  { id: 'm1', role: 'user', text: 'My budget is ₹2,000. I eat vegetarian food only.' },
  { id: 'm2', role: 'user', text: 'Actually, increase my budget to ₹3,000.' },
];
const original = { key: 'trip.budget', kind: 'constraint', text: 'Budget: ₹2,000.', sourceId: 'm1', quote: 'My budget is ₹2,000.', priority: 3 };
const correction = { ...original, text: 'Budget: ₹3,000.', sourceId: 'm2', quote: 'increase my budget to ₹3,000' };
const extract = updates => ({ updates, removals: [] });

test('a correction replaces the active value and preserves both versions in the audit log', () => {
  const first = applyExtraction(emptyMemory(), extract([original]), messages.slice(0, 1), 600).memory;
  const second = applyExtraction(first, extract([correction]), messages.slice(1), 600).memory;
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].text, 'Budget: ₹3,000.');
  assert.equal(second.history[1].previous.text, 'Budget: ₹2,000.');
  assert.equal(second.history[1].action, 'updated');
  assert.equal(first.entries[0].text, 'Budget: ₹2,000.', 'previous snapshot must not mutate');
  assert.equal(second.generation, 2);
});

test('repeated handovers carry unchanged decisions without re-reading their source', () => {
  let memory = applyExtraction(emptyMemory(), extract([original]), messages.slice(0, 1), 600).memory;
  for (let index = 0; index < 3; index++) memory = applyExtraction(memory, extract([]), [], 600).memory;
  assert.equal(memory.entries[0].sourceId, 'm1');
  assert.equal(memory.generation, 4);
});

test('a fabricated quote rejects the complete update batch atomically', () => {
  const previous = applyExtraction(emptyMemory(), extract([original]), messages, 600).memory;
  assert.throws(() => applyExtraction(previous, extract([correction, { ...correction, key: 'other', quote: 'I never said this' }]), messages, 600), /does not occur/);
  assert.equal(previous.entries[0].text, original.text);
  assert.equal(previous.generation, 1);
});

test('only new user messages may provide evidence', () => {
  assert.throws(() => applyExtraction(emptyMemory(), extract([original]), messages.slice(1), 600), /No user-message source/);
  assert.throws(() => applyExtraction(emptyMemory(), extract([original]), [{ ...messages[0], role: 'assistant' }], 600), /No user-message source/);
});

test('duplicate operations on a key are rejected instead of arbitrarily winning', () => {
  assert.throws(() => applyExtraction(emptyMemory(), extract([original, correction]), messages, 600), /conflicting operations/);
});

test('explicit cancellation removes a memory with a source-linked history event', () => {
  const previous = applyExtraction(emptyMemory(), extract([original]), messages, 600).memory;
  const cancel = { id: 'm3', role: 'user', text: 'Cancel the budget constraint.' };
  const result = applyExtraction(previous, { updates: [], removals: [{ key: original.key, sourceId: 'm3', quote: cancel.text }] }, [cancel], 600);
  assert.equal(result.memory.entries.length, 0);
  assert.equal(result.events[0].action, 'removed');
  assert.equal(result.events[0].evidence.sourceId, 'm3');
});

test('packing respects a hard budget and records every dropped item', () => {
  const updates = Array.from({ length: 8 }, (_, i) => ({ ...original, key: `fact${i}`, text: `Item ${i}: ${'details '.repeat(15)}`, priority: i === 7 ? 3 : 1 }));
  const result = applyExtraction(emptyMemory(), extract(updates), messages, 300);
  assert.ok(memoryText(result.memory).length <= 300);
  assert.equal(result.memory.entries[0].key, 'fact7');
  assert.ok(result.dropped.length > 0);
  assert.equal(result.events.filter(event => event.action === 'evicted').length, result.dropped.length);
});

test('budget-evicted facts do not silently resurrect in a later handover', () => {
  const updates = Array.from({ length: 5 }, (_, i) => ({ ...original, key: `fact${i}`, text: 'x'.repeat(175) }));
  const first = applyExtraction(emptyMemory(), extract(updates), messages, 300);
  const second = applyExtraction(first.memory, extract([]), [], 1200);
  assert.deepEqual(second.memory.entries, first.memory.entries);
});

test('recent-history baseline excludes old facts; handover keeps them within the same ceiling', () => {
  const memory = applyExtraction(emptyMemory(), extract([original]), messages, 600).memory;
  const transcript = [...messages, { id: 'm3', role: 'assistant', text: 'Neutral background. '.repeat(100) }];
  const baseline = buildContext(transcript, memory, 900, false);
  const carry = buildContext(transcript, memory, 900, true);
  assert.ok(!baseline.text.includes('2,000'));
  assert.ok(carry.text.includes('2,000'));
  assert.ok(baseline.chars <= 900 && carry.chars <= 900);
  assert.ok(carry.includedIds.length < transcript.length);
  assert.ok(baseline.partialIds.includes('m3'));
  assert.ok(baseline.discardedIds.includes('m1'));
});

test('all context sizes honor the ceiling including headers, partial lines, and separators', () => {
  for (const length of [1, 599, 600, 1000, 3999]) {
    const transcript = [{ id: 'm1', role: 'user', text: 'x'.repeat(length) }];
    for (const budget of [600, 900, 1200]) {
      const context = buildContext(transcript, emptyMemory(), budget, true);
      assert.equal(context.chars, context.text.length);
      assert.ok(context.chars <= budget);
    }
  }
});

test('invalid persisted memories and duplicate transcript IDs fail validation', () => {
  assert.throws(() => validateMessages([messages[0], messages[0]]), /unique/);
  assert.throws(() => validateMemory({ entries: [original, original], history: [], generation: 0 }, messages), /Duplicate/);
  assert.throws(() => validateMemory({ ...emptyMemory(), entries: [{ ...original, quote: 'wrong quote' }] }, messages), /does not occur/);
});

test('JSON parsing supports a single fenced object but rejects partial JSON', () => {
  assert.deepEqual(parseModelJson('```json\n{"updates":[],"removals":[]}\n```'), extract([]));
  assert.throws(() => parseModelJson('{"updates":['), /valid JSON/);
});

test('local text matching normalizes currency and respects numeric boundaries', () => {
  const checks = [{ label: 'Budget', expected: '3000' }, { label: 'Food', expected: 'vegetarian' }];
  assert.deepEqual(scoreAnswer('₹3,000; vegetarian food.', checks).map(item => item.matched), [true, true]);
  assert.equal(scoreAnswer('₹13,000', checks)[0].matched, false);
  assert.equal(scoreAnswer('Anything', [{ label: 'Blank', expected: '' }])[0].matched, false);
  assert.equal(scoreAnswer('3000', checks)[0].reviewed, null, 'a string match is not a human-verified result');
});
