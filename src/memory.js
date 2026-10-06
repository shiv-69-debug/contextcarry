// Shared, dependency-free domain logic. Model access and the UI live elsewhere.
export const KINDS = ['goal', 'constraint', 'preference', 'decision', 'task', 'fact'];
export const MODELS = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
export const LIMITS = { messages: 160, messageChars: 4000, entries: 24, history: 240 };

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function emptyMemory() {
  return { entries: [], history: [], generation: 0 };
}

export function validateMessages(messages) {
  invariant(Array.isArray(messages) && messages.length <= LIMITS.messages, 'Use at most 160 messages per experiment.');
  const ids = new Set();
  for (const message of messages) {
    invariant(message && /^m[1-9]\d{0,5}$/.test(message.id), 'A message has an invalid ID.');
    invariant(!ids.has(message.id), 'Message IDs must be unique.');
    invariant(['user', 'assistant'].includes(message.role), 'A message has an invalid role.');
    invariant(typeof message.text === 'string' && message.text.trim().length > 0 && message.text.length <= LIMITS.messageChars, 'Each message must contain 1–4,000 characters.');
    ids.add(message.id);
  }
  return messages;
}

function validateEntry(entry, messages) {
  invariant(entry && /^[a-z][a-z0-9_.-]{0,47}$/.test(entry.key), 'Memory keys must be short lowercase identifiers.');
  invariant(KINDS.includes(entry.kind), 'Memory has an unknown category.');
  invariant(typeof entry.text === 'string' && entry.text.trim().length > 0 && entry.text.length <= 180, 'Each memory must contain 1–180 characters.');
  invariant(Number.isInteger(entry.priority) && entry.priority >= 1 && entry.priority <= 3, 'Memory priority must be 1, 2, or 3.');
  validateEvidence(entry, messages);
}

function validateEvidence(item, messages) {
  const source = messages.find(message => message.id === item.sourceId && message.role === 'user');
  invariant(source, `No user-message source exists for ${item.key || 'this update'}.`);
  invariant(typeof item.quote === 'string' && item.quote.trim().length >= 3 && item.quote.length <= 500, 'Evidence must contain a short verbatim quote.');
  invariant(source.text.includes(item.quote), `The evidence quote for ${item.key || 'this update'} does not occur in its source message.`);
}

export function validateMemory(memory, messages) {
  invariant(memory && Array.isArray(memory.entries) && memory.entries.length <= LIMITS.entries, 'Invalid memory entries.');
  invariant(Array.isArray(memory.history) && memory.history.length <= LIMITS.history, 'Invalid memory history.');
  invariant(Number.isInteger(memory.generation) && memory.generation >= 0 && memory.generation < 1000, 'Invalid handover generation.');
  const keys = new Set();
  for (const entry of memory.entries) {
    validateEntry(entry, messages);
    invariant(!keys.has(entry.key), 'Duplicate active memory key.');
    keys.add(entry.key);
  }
  for (const event of memory.history) {
    invariant(event && ['added', 'updated', 'removed', 'evicted'].includes(event.action), 'Invalid memory history event.');
    validateEntry(event.entry, messages);
    if (event.previous) validateEntry(event.previous, messages);
    if (event.action === 'removed') validateEvidence({ key: event.entry.key, ...event.evidence }, messages);
    invariant(Number.isInteger(event.generation) && event.generation > 0 && event.generation <= memory.generation, 'Invalid history generation.');
  }
  return memory;
}

export function parseModelJson(text) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error('The model did not return valid JSON. Your previous memory is unchanged; try the handover again.');
  }
}

export function memoryText(memory) {
  return memory.entries.map(entry => `[${entry.key}|${entry.kind}|${entry.sourceId}] ${entry.text}`).join('\n');
}

export function transcriptText(messages) {
  return messages.map(message => `[${message.id} ${message.role}] ${message.text}`).join('\n');
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4); // A visual heuristic, not a model tokenizer.
}

export function applyExtraction(previous, extraction, newMessages, memoryBudget) {
  invariant(extraction && Array.isArray(extraction.updates) && Array.isArray(extraction.removals), 'The model must return updates and removals arrays.');
  invariant(extraction.updates.length <= LIMITS.entries && extraction.removals.length <= LIMITS.entries, 'The model returned too many memory operations.');
  invariant(Number.isInteger(memoryBudget) && memoryBudget >= 300 && memoryBudget <= 7200, 'Memory budget must be 300–7,200 characters.');
  const touched = new Set();
  // Validate the complete batch before applying anything: a bad citation cannot half-update memory.
  for (const update of extraction.updates) {
    validateEntry(update, newMessages);
    invariant(!touched.has(update.key), 'The model returned conflicting operations for the same key.');
    touched.add(update.key);
  }
  for (const removal of extraction.removals) {
    invariant(previous.entries.some(entry => entry.key === removal.key), 'The model tried to remove a missing memory.');
    validateEvidence(removal, newMessages);
    invariant(!touched.has(removal.key), 'The model returned conflicting operations for the same key.');
    touched.add(removal.key);
  }
  const generation = previous.generation + 1;
  const entries = new Map(previous.entries.map(entry => [entry.key, { ...entry }]));
  const events = [];
  for (const candidate of extraction.updates) {
    // Project onto our schema; do not carry arbitrary model-generated fields forward.
    const { key, kind, text, sourceId, quote, priority } = candidate;
    const update = { key, kind, text: text.trim(), sourceId, quote, priority };
    const old = entries.get(key);
    entries.set(key, update);
    if (!old || old.text !== update.text || old.sourceId !== sourceId) {
      events.push({ action: old ? 'updated' : 'added', entry: update, ...(old ? { previous: old } : {}), generation });
    }
  }
  for (const removal of extraction.removals) {
    events.push({ action: 'removed', entry: entries.get(removal.key), evidence: { sourceId: removal.sourceId, quote: removal.quote }, generation });
    entries.delete(removal.key);
  }
  // Prefer high-priority items, then explicitly updated items. Budget loss is visible in the audit log.
  const ranked = [...entries.values()].sort((a, b) => b.priority - a.priority || Number(touched.has(b.key)) - Number(touched.has(a.key)));
  const packed = [];
  const dropped = [];
  for (const entry of ranked) {
    if (packed.length < LIMITS.entries && memoryText({ entries: [...packed, entry] }).length <= memoryBudget) {
      packed.push(entry);
    } else {
      dropped.push(entry);
      events.push({ action: 'evicted', entry, generation });
    }
  }
  return {
    memory: { entries: packed, history: [...previous.history, ...events].slice(-LIMITS.history), generation },
    events,
    dropped,
  };
}

function recentContext(messages, budget) {
  const lines = [];
  const includedIds = [];
  const partialIds = [];
  let remaining = budget;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const line = transcriptText([message]);
    const separator = lines.length ? 1 : 0;
    if (line.length + separator <= remaining) {
      lines.unshift(line);
      includedIds.unshift(message.id);
      remaining -= line.length + separator;
    } else {
      // Preserve a suffix of one oversized boundary message, with an explicit truncation marker.
      const prefix = `[${message.id} ${message.role}, start omitted] `;
      const available = remaining - separator - prefix.length;
      if (available > 0) {
        lines.unshift(prefix + message.text.slice(-available));
        includedIds.unshift(message.id);
        partialIds.push(message.id);
      }
      break;
    }
  }
  return { text: lines.join('\n'), includedIds, partialIds, discardedIds: messages.filter(message => !includedIds.includes(message.id)).map(message => message.id) };
}

export function buildContext(messages, memory, budget, withMemory) {
  invariant(Number.isInteger(budget) && budget >= 600 && budget <= 12000, 'Context budget must be 600–12,000 characters.');
  const saved = withMemory ? memoryText(memory) : '';
  const header = saved ? `HANDOVER (earlier user facts; later messages can update them):\n${saved}\n\nRECENT MESSAGES:\n` : 'RECENT MESSAGES:\n';
  invariant(header.length <= budget, 'Memory is larger than the context budget. Increase the context budget.');
  const recent = recentContext(messages, budget - header.length);
  return { ...recent, text: header + recent.text, chars: header.length + recent.text.length, memoryChars: saved.length, budget };
}

function normalizeMatch(text) {
  return text.normalize('NFKC').toLowerCase().replace(/(?<=\d),(?=\d)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function scoreAnswer(answer, checks) {
  const normalized = ` ${normalizeMatch(answer)} `;
  return checks.map(check => {
    const expected = normalizeMatch(check.expected);
    // Whole normalized phrases avoid matching 3000 inside 13000. This is NOT semantic grading.
    return { ...check, matched: expected.length > 0 && normalized.includes(` ${expected} `), reviewed: null };
  });
}
