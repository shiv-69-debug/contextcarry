import { buildContext, emptyMemory, estimateTokens, LIMITS, memoryText, MODELS, scoreAnswer, transcriptText, validateMemory, validateMessages } from '/core/memory.js';

const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'contextcarry.experiment.v1';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const formatNumber = number => new Intl.NumberFormat('en-IN').format(number);
const time = ms => `${(ms / 1000).toFixed(1)}s`;
let apiKey = ''; // Deliberately excluded from persisted/exported experiment state.
let serverConfigured = false;
let savedLocally = false;
let verifiedModel = '';
let busy = false;
let activeOperation = '';
let operationStartedAt = 0;
let memoryTab = 'active';
let selectedRun = -1;
let state = freshState();

function freshState() {
  return { version: 1, name: 'Untitled experiment', messages: [], memory: emptyMemory(), cursor: 0, checkpoints: [], runs: [], model: MODELS[0], budget: 1200, question: 'What are our latest decisions, constraints, and next unfinished tasks? If a detail is missing, say it is unknown.', checks: [], example: false };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('#save-status').textContent = 'Saved in this browser';
  } catch {
    $('#save-status').textContent = 'Storage full or unavailable — export your work';
  }
}

function restore() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored) return false;
    if (stored.version !== 1 || !Array.isArray(stored.runs) || !Array.isArray(stored.checkpoints) || !Array.isArray(stored.checks) || !MODELS.includes(stored.model) || ![900, 1200, 2000, 4000].includes(stored.budget)) throw new Error('Invalid saved experiment.');
    validateMessages(stored.messages);
    validateMemory(stored.memory, stored.messages);
    if (!Number.isInteger(stored.cursor) || stored.cursor < 0 || stored.cursor > stored.messages.length || stored.checks.length > 10) throw new Error('Invalid saved experiment.');
    state = stored;
    selectedRun = state.runs.length - 1;
    return true;
  } catch {
    notify('Saved data could not be loaded. A new experiment is ready.', 'error');
    return false;
  }
}

function syncInputs() {
  $('#question').value = state.question;
  $('#budget').value = String(state.budget);
  $('#model').value = state.model;
  renderCheckInputs();
}

function notify(message, kind = '') {
  const notice = $('#notice');
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
  const targets = activeOperation === 'handover' ? ['#handover-status', '#comparison-status'] : activeOperation === 'compare' ? ['#comparison-status'] : [];
  for (const target of targets) {
    const element = $(target);
    element.textContent = message;
    element.className = `notice inline-notice ${kind}`;
    element.hidden = false;
  }
}

async function request(path, payload, key = apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  let response;
  try {
    response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(path === '/api/handover' ? 135000 : 75000) });
  } catch {
    throw new Error('The local server did not respond. Check that npm start is running and your connection is working.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function hasKey() {
  if (apiKey || serverConfigured) return true;
  $('#connect-dialog').showModal();
  $('#api-key').focus();
  return false;
}

async function perform(message, operation, scope = '') {
  if (busy) return;
  busy = true;
  activeOperation = scope;
  operationStartedAt = Date.now();
  document.body.classList.add('is-busy');
  notify(message);
  render();
  const timer = setInterval(renderOperationButtons, 1000);
  try { await operation(); } catch (error) { notify(error.message, 'error'); }
  finally {
    clearInterval(timer);
    busy = false;
    activeOperation = '';
    document.body.classList.remove('is-busy');
    render();
  }
}

function payload() {
  return { messages: state.messages, memory: state.memory, cursor: state.cursor, model: state.model, budget: state.budget };
}

function renderOperationButtons() {
  const elapsed = Math.floor((Date.now() - operationStartedAt) / 1000);
  $('#handover-button').innerHTML = busy && activeOperation === 'handover'
    ? `<span class="busy-indicator" aria-hidden="true"></span>Saving memory · ${elapsed}s`
    : state.memory.generation > 0 && state.cursor === state.messages.length ? `${icon('check')}Memory saved` : `${icon('book')}Save memory${icon('arrow')}`;
  $('#compare-button').innerHTML = busy && activeOperation === 'compare'
    ? `<span class="busy-indicator" aria-hidden="true"></span>Comparing · ${elapsed}s`
    : `${icon('spark')}Compare answers`;
}

function renderComparisonHelp() {
  $('#compare-help').textContent = busy
    ? 'A request is running. Please wait; its result or error appears here.'
    : state.memory.generation === 0 ? 'Complete step 2 first: click Save memory. This button becomes available when your saved details are ready.'
      : state.messages.length !== state.cursor ? 'You added new messages. Click Save memory again before comparing the answers.'
        : !state.question.trim() ? 'Enter a question above to enable comparison.'
          : 'Ready to compare. Both answers use Gemma 4; only one gets your saved memory.';
}

function renderNextStep() {
  const latest = state.runs.at(-1);
  const hasCurrentResult = latest && !latest.baseline.error && !latest.carry.error && latest.generation === state.memory.generation && latest.question === state.question.trim() && latest.budget === state.budget && latest.model === state.model;
  let step;
  if (!state.messages.length) {
    step = { number: 1, title: 'Start with a conversation', description: 'Try the ready-made example, or add your own details in step 1.', action: 'example', label: 'Use example' };
  } else if (!apiKey && !serverConfigured) {
    step = { number: 1, title: 'Connect Gemma once to get started', description: 'Add your API key and choose Remember on this laptop. You can then run the demo without entering it again.', action: 'connect-open', label: 'Connect Gemma' };
  } else if (!state.memory.generation || state.cursor !== state.messages.length) {
    step = { number: 2, title: state.memory.generation ? 'Update your saved memory' : 'Your conversation is ready. Save its key details.', description: 'Gemma will pick out the important information and show it in step 2.', action: 'handover', label: 'Save memory' };
  } else if (!state.question.trim()) {
    step = { number: 3, title: 'What would you like the AI to remember?', description: 'Write a question in step 3 without including the answers.', action: 'focus-question', label: 'Add a question' };
  } else if (hasCurrentResult) {
    step = { number: 3, title: 'Your answers are ready to compare', description: 'Read both answers. Check which details each remembered, then download your results.', action: 'view-results', label: 'View answers' };
  } else {
    step = { number: 3, title: 'Memory saved. Now test what the AI remembers.', description: 'Ask the same question with and without saved memory, and compare the results.', action: 'compare', label: 'Compare answers' };
  }
  for (let number = 1; number <= 3; number++) {
    const link = $(`#step-${number}`);
    if (number === step.number) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  }
  $('#next-step-title').textContent = busy ? activeOperation === 'handover' ? 'Saving your memory…' : activeOperation === 'compare' ? 'Getting both answers…' : 'Connecting to Gemma…' : step.title;
  $('#next-step-description').textContent = busy ? 'Please wait. Progress and any error will appear beside the action you started.' : step.description;
  const button = $('#next-action');
  button.dataset.action = step.action;
  button.innerHTML = `${busy ? 'Please wait' : escapeHtml(step.label)}${icon('arrow')}`;
  button.disabled = busy;
}

function render() {
  $('#session-name').textContent = state.name;
  const ready = Boolean(apiKey || serverConfigured);
  $('#connection-status').classList.toggle('connected', ready);
  $('#connection-status').innerHTML = `<i></i>${verifiedModel === state.model ? 'Gemma connected' : savedLocally && !apiKey ? 'Saved key ready' : ready ? 'API key ready' : 'Connect for live AI'}`;
  $('#connection-button').innerHTML = `${icon('key')}${ready ? 'Model settings' : 'Connect Gemma'}`;
  $('#server-key-note').textContent = savedLocally ? 'Your key is saved on this laptop. Leave this field empty to keep using it.' : serverConfigured ? 'A server key is configured. Leave this field empty to use it.' : 'Enter your key once and choose Remember below.';
  $('#forget-saved-key').hidden = !savedLocally;
  $('#generation').textContent = String(state.memory.generation).padStart(2, '0');
  $('#generation-note').textContent = state.memory.generation ? `${state.messages.length - state.cursor} new messages since the last save` : 'No memory saved yet';
  $('#memory-count').innerHTML = `${state.memory.entries.length}<span>items</span>`;
  const note = memoryText(state.memory);
  $('#memory-size').innerHTML = note ? `${formatNumber(note.length)}<span>chars</span>` : '—';
  const fullLength = transcriptText(state.messages).length;
  const change = fullLength ? Math.round((1 - note.length / fullLength) * 100) : 0;
  $('#memory-size-note').textContent = note ? `${change >= 0 ? `${change}% smaller than archive` : `${Math.abs(change)}% larger than archive`} · ~${estimateTokens(note)} tokens*` : 'A compact note, not the full history';
  $('#run-count').textContent = String(state.runs.filter(run => !run.baseline.error && !run.carry.error).length);
  $('#message-count').textContent = `${state.messages.length} messages`;
  $('#input-label').textContent = state.example ? 'EXAMPLE CONVERSATION' : 'YOUR CONVERSATION';
  $('#active-count').textContent = state.memory.entries.length;
  $('#history-count').textContent = state.memory.history.length;
  $('#check-count').textContent = `${state.checks.length} checks`;
  const baseline = buildContext(state.messages, state.memory, state.budget, false);
  renderMessages(baseline);
  $('#context-usage').textContent = `${formatNumber(fullLength)} / ${formatNumber(state.budget)} chars`;
  $('#context-progress').max = state.budget;
  $('#context-progress').value = Math.min(fullLength, state.budget);
  $('#context-hint').textContent = baseline.discardedIds.length
    ? `The AI without saved memory cannot see ${baseline.discardedIds.length} older messages. They're still shown here for you.`
    : 'This chat still fits in the recent-chat limit. Use Make the chat longer to test what happens to older details.';
  renderMemory();
  renderResults();
  document.querySelectorAll('[data-mutate]').forEach(element => { element.disabled = busy; });
  $('#handover-button').disabled = busy || state.messages.length === state.cursor;
  $('#compare-button').disabled = busy || state.memory.generation === 0 || state.messages.length !== state.cursor || !state.question.trim();
  renderOperationButtons();
  renderComparisonHelp();
  renderNextStep();
  $('#handover-note').textContent = state.messages.length !== state.cursor && state.memory.generation > 0
    ? 'You added new details. Save memory again to include them.'
    : state.memory.generation > 0 ? 'Your memory is up to date. Continue to step 3: Compare answers.' : 'Gemma will save important details here and link each one to the original message.';
}

function renderMessages(context) {
  const container = $('#messages');
  const scroll = container.scrollTop;
  const discarded = new Set(context.discardedIds);
  container.innerHTML = state.messages.length ? state.messages.map(message => `<article class="message ${message.role} ${discarded.has(message.id) ? 'outside' : ''}" id="message-${escapeHtml(message.id)}">
    <div class="message-head"><span class="avatar ${message.role}">${message.role === 'user' ? 'U' : 'A'}</span><strong>${message.role === 'user' ? 'You' : 'Earlier assistant reply'}</strong>${discarded.has(message.id) ? '<span class="outside-tag">Outside recent chat</span>' : context.partialIds.includes(message.id) ? '<span class="outside-tag">Only partly visible to AI</span>' : ''}<span class="message-id">${escapeHtml(message.id)}</span></div>
    <div class="message-text">${escapeHtml(message.text)}</div></article>`).join('') : `<div class="empty-state"><div class="empty-illustration">${icon('chat')}</div><h3>Start with something worth remembering.</h3><p>Add a goal, a constraint, or a decision below. Or load the Nashik trip example.</p></div>`;
  container.scrollTop = scroll;
}

function renderMemory() {
  for (const tab of ['active', 'history']) {
    $(`#${tab}-tab`).setAttribute('aria-selected', String(memoryTab === tab));
    $(`#${tab}-tab`).tabIndex = memoryTab === tab ? 0 : -1;
  }
  $('#memory-content').setAttribute('aria-labelledby', `${memoryTab}-tab`);
  if (memoryTab === 'history') {
    $('#memory-content').innerHTML = state.memory.history.length ? [...state.memory.history].reverse().map(event => `<div class="history-item"><div class="history-top"><strong class="${event.action}">${event.action === 'evicted' ? 'Dropped · budget limit' : event.action}</strong><span>Handover ${event.generation}</span></div><span>${escapeHtml(event.entry.key)}</span>${event.previous ? `<del>${escapeHtml(event.previous.text)}</del>` : ''}<p>${escapeHtml(event.entry.text)}</p><button class="source-link" data-action="source" data-source="${escapeHtml(event.evidence?.sourceId || event.entry.sourceId)}">${icon('link')}View ${escapeHtml(event.evidence?.sourceId || event.entry.sourceId)}</button></div>`).join('') : empty('clock', 'A story of changing decisions.', 'Updates, cancellations, and budget evictions will appear here after a handover.');
    return;
  }
  const kindNames = { goal: 'Goal', constraint: 'Must follow', preference: 'Preference', decision: 'Decision', task: 'Next step', fact: 'Detail' };
  $('#memory-content').innerHTML = state.memory.entries.length ? state.memory.entries.map(entry => `<article class="memory-card"><div class="memory-card-head"><span class="kind ${entry.kind}">${kindNames[entry.kind]}</span><span class="memory-key">${escapeHtml(entry.key)}</span></div><p>${escapeHtml(entry.text)}</p><button class="source-link" data-action="source" data-source="${escapeHtml(entry.sourceId)}" data-key="${escapeHtml(entry.key)}">${icon('link')}See original message (${escapeHtml(entry.sourceId)}) ${icon('arrow')}</button></article>`).join('') : empty('book', state.memory.generation ? 'No important details were found.' : 'Your saved details will appear here', state.memory.generation ? 'Add a clear goal, budget, preference, or next step. Then click Save memory again.' : 'Click Save memory above. Gemma will pick out the details the next conversation should remember.');
}

function formatAnswer(text) {
  // Escape first: model text can never introduce HTML, links, or scripts.
  return escapeHtml(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/^\s*[*-] /gm, '• ');
}

function empty(name, title, text) {
  return `<div class="empty-state"><div class="empty-illustration">${icon(name)}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

function renderCheckInputs() {
  $('#check-inputs').innerHTML = state.checks.map((check, index) => `<div class="check-row"><input aria-label="Check ${index + 1} label" placeholder="What should survive?" value="${escapeHtml(check.label)}" maxlength="80" data-check="${index}" data-field="label" data-mutate><input aria-label="Check ${index + 1} expected text" placeholder="Expected phrase or value" value="${escapeHtml(check.expected)}" maxlength="120" data-check="${index}" data-field="expected" data-mutate><button class="icon-button" aria-label="Remove check ${index + 1}" data-action="remove-check" data-index="${index}" data-mutate>${icon('close')}</button></div>`).join('');
  $('#check-count').textContent = `${state.checks.length} checks`;
}

function renderResults() {
  const run = state.runs[selectedRun];
  $('#results').innerHTML = ['baseline', 'carry'].map(lane => {
    const output = run?.[lane];
    const title = lane === 'baseline' ? 'Without saved memory' : 'With saved memory';
    const checks = output?.checks || [];
    const reviewed = checks.filter(check => check.reviewed !== null);
    return `<article class="result-card ${lane}"><div class="result-header"><div class="lane-title">${icon(lane === 'baseline' ? 'chat' : 'book')}${title}</div><span class="lane-tag">${lane === 'baseline' ? 'Gemma 4 · recent chat only' : 'Gemma 4 · saved details + recent chat'}</span></div>
      ${!output ? '<div class="result-body placeholder">The AI answer will appear here<br>after you click Compare answers.</div>' : output.error ? `<div class="result-body result-error">${escapeHtml(output.error)}<br>This answer failed to load. It is not scored.</div>` : `<div class="result-body">${formatAnswer(output.text)}</div>`}
      ${output && !output.error ? `<div class="review-checks"><div class="review-heading"><span>${reviewed.length === checks.length && checks.length ? 'Human-reviewed recall' : 'Suggested matches · review below'}</span><strong>${reviewed.filter(check => check.reviewed).length}/${checks.length} confirmed · ${reviewed.length}/${checks.length} reviewed</strong></div>${checks.map((check, index) => `<div class="review-row"><span>${escapeHtml(check.label)}<small>Expected: ${escapeHtml(check.expected)}</small></span><select aria-label="${escapeHtml(title)}: review ${escapeHtml(check.label)}" data-review="${index}" data-lane="${lane}" class="${check.reviewed === true ? 'pass' : ''}" data-mutate><option value="auto" ${check.reviewed === null ? 'selected' : ''}>${check.matched ? 'Text matched · review' : 'No match · review'}</option><option value="pass" ${check.reviewed === true ? 'selected' : ''}>Confirmed correct</option><option value="fail" ${check.reviewed === false ? 'selected' : ''}>Missing / incorrect</option></select></div>`).join('')}${!checks.length ? '<p class="fine-print">No recall checks were defined for this run. Inspect the answers directly.</p>' : ''}</div>` : ''}
      <div class="result-meta">${output ? `<details><summary>Timing & technical details</summary><p>${formatNumber(output.context.chars)} characters${!output.error ? ` · ${time(output.latencyMs)} · ${output.usage.inputTokens ?? '—'} input tokens` : ''}</p></details><button class="text-button" data-action="context" data-lane="${lane}">See AI input ${icon('arrow')}</button>` : '<span>Both answers use the same Gemma 4 model.</span>'}</div></article>`;
  }).join('');
  $('#run-history').innerHTML = state.runs.length ? `<div class="run-item"><strong>Viewing run ${selectedRun + 1}</strong><span>Handover ${run.generation} · ${escapeHtml(run.model)}</span><button class="text-button" data-action="export">Export all evidence ${icon('download')}</button></div>${state.runs.length > 1 ? state.runs.map((item, index) => `<div class="run-item"><span>Run ${index + 1} · Handover ${item.generation}</span><span>${!item.baseline.error && !item.carry.error ? 'Both responses received' : 'Contains a failed lane'}</span><button class="text-button" data-action="select-run" data-index="${index}">${index === selectedRun ? 'Viewing' : 'View results'} ${icon('arrow')}</button></div>`).reverse().join('') : ''}` : '';
}

function showDetail(title, html, kicker = 'UNDER THE HOOD') {
  $('#detail-title').textContent = title;
  $('#detail-kicker').textContent = kicker;
  $('#detail-content').innerHTML = html;
  $('#detail-dialog').showModal();
}

function inspectSource(sourceId, key) {
  const message = state.messages.find(item => item.id === sourceId);
  if (!message) return;
  const entry = state.memory.entries.find(item => item.key === key);
  showDetail(`Source ${message.id}`, `${entry ? `<h3>Stored memory</h3><p>${escapeHtml(entry.text)}</p><h3>Exact source quote</h3><blockquote>${escapeHtml(entry.quote)}</blockquote>` : ''}<h3>Original ${escapeHtml(message.role)} message</h3><blockquote>${escapeHtml(message.text)}</blockquote><p>A source link means the quote occurs in this message. It does not independently prove the model interpreted it correctly.</p>`, 'FOLLOW THE EVIDENCE');
}

async function loadExample(confirmReplace = true) {
  if (confirmReplace && state.messages.length && !window.confirm('Replace this experiment with the example? Export first if you want to keep the current experiment.')) return;
  const response = await fetch('/example.json');
  if (!response.ok) throw new Error('Could not load the example.');
  const example = await response.json();
  validateMessages(example.messages);
  state = { ...freshState(), name: example.name, messages: example.messages, question: example.question, checks: example.checks, example: true, model: state.model };
  selectedRun = -1;
  syncInputs();
  persist();
  render();
}

function appendMessage(text, role = 'user') {
  if (state.messages.length >= LIMITS.messages) throw new Error('This experiment has reached 160 messages. Export it and start a new experiment.');
  const nextId = state.messages.reduce((max, message) => Math.max(max, Number(message.id.slice(1))), 0) + 1;
  state.messages.push({ id: `m${nextId}`, role, text });
}

function exportExperiment() {
  const report = {
    ...state,
    exportedAt: new Date().toISOString(),
    methodology: 'Simulated character-limited context. Baseline: recent transcript. Carry: handover plus recent transcript under the same ceiling. Expected answers are local, never sent to the model. Text matches are heuristic; reviewed fields are user judgments. Full model prompts, responses, latencies, and provider token usage are included. Model stochasticity and extraction errors remain possible.',
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `contextcarry-experiment-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Experiment exported with all handovers, prompts, responses, and reviews. No API key is included.', 'success');
}

const actions = {
  'view-results': () => { selectedRun = state.runs.length - 1; renderResults(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'focus-question': () => { $('#question').focus(); },
  'connect-open': () => { $('#connect-error').hidden = true; $('#connect-dialog').showModal(); },
  'close-dialog': button => button.closest('dialog').close(),
  'forget-key': () => { apiKey = ''; verifiedModel = ''; $('#api-key').value = ''; $('#connect-dialog').close(); render(); notify(serverConfigured ? 'Tab key forgotten. A server-configured key is still available.' : 'Tab key forgotten. Reconnect when you want to run live AI.'); },
  'forget-saved-key': async () => {
    $('#connect-dialog').close();
    await perform('Removing the saved key from this laptop…', async () => {
      const result = await request('/api/credentials/clear', {});
      apiKey = '';
      verifiedModel = '';
      serverConfigured = result.configured;
      savedLocally = result.savedLocally;
      $('#api-key').value = '';
      notify(serverConfigured ? 'Saved copy removed. Your .env key is still available.' : 'Saved key removed from this laptop. Reconnect when you need live AI.', 'success');
    });
  },
  'example': () => loadExample(),
  'new': () => {
    if (state.messages.length && !window.confirm('Start a new experiment? Export first if you want to keep the current one.')) return;
    state = { ...freshState(), model: state.model };
    selectedRun = -1;
    syncInputs(); persist(); render();
    $('#message-input').focus();
  },
  'distraction': () => {
    if (state.messages.length > LIMITS.messages - 2) throw new Error('Not enough room for background messages. Export and start a new experiment.');
    appendMessage('Explain general planning principles as background. This does not change any of my existing goals, constraints, decisions, or tasks.');
    appendMessage('General background discussion: a useful plan separates decisions from possibilities. Compare available choices, consider the trade-offs, and leave time for uncertainty. A list of possibilities is not a commitment. Gather the information that matters, check assumptions directly, and keep the next action clear. When a conversation becomes lengthy, earlier details can slip outside the active context. More discussion does not automatically change previous requirements. This paragraph is deliberately general sample filler, not a new user preference. '.repeat(3), 'assistant');
    persist(); render();
    $('#messages').scrollTop = $('#messages').scrollHeight;
    notify('The chat is longer now. Click Save memory again, then compare the answers.');
  },
  'tab': button => { memoryTab = button.dataset.tab; renderMemory(); },
  'source': button => inspectSource(button.dataset.source, button.dataset.key),
  'copy-memory': async () => {
    const text = memoryText(state.memory);
    if (!text) return notify('Click Save memory before copying the saved details.');
    try { await navigator.clipboard.writeText(text); notify('Saved memory copied. Paste it into a new conversation to try it yourself.', 'success'); }
    catch { showDetail('Copy your handover', `<pre>${escapeHtml(text)}</pre>`); }
  },
  'add-check': () => { if (state.checks.length >= 10) return notify('Use up to 10 recall checks.'); state.checks.push({ label: '', expected: '' }); renderCheckInputs(); persist(); },
  'remove-check': button => { state.checks.splice(Number(button.dataset.index), 1); renderCheckInputs(); persist(); },
  'select-run': button => { selectedRun = Number(button.dataset.index); renderResults(); },
  'export': exportExperiment,
  'extraction': () => {
    const checkpoint = state.checkpoints.at(-1);
    if (!checkpoint) return notify('Create a handover to inspect its extraction trace.');
    showDetail(`Extraction · handover ${checkpoint.generation}`, `<p>Model: ${escapeHtml(checkpoint.trace.model)} · ${time(checkpoint.stats.latencyMs)} · ${checkpoint.stats.usage.inputTokens ?? 'unavailable'} input tokens. This call receives previous active memory and new messages only.</p><h3>Exact extraction input</h3><pre>${escapeHtml(checkpoint.trace.prompt)}</pre><h3>Model output before validation</h3><pre>${escapeHtml(checkpoint.trace.output)}</pre><h3>Extraction instructions</h3><pre>${escapeHtml(checkpoint.trace.system)}</pre>`, 'MEMORY HAS RECEIPTS');
  },
  'context': button => {
    const run = state.runs[selectedRun];
    const output = run[button.dataset.lane];
    showDetail(`${button.dataset.lane === 'carry' ? 'ContextCarry' : 'Baseline'} · run ${selectedRun + 1}`, `<p>Context: ${output.context.chars} / ${run.budget} characters. Expected answers were never included.</p><h3>Exact context supplied</h3><pre>${escapeHtml(output.context.text)}</pre><h3>Question</h3><pre>${escapeHtml(run.question)}</pre>${output.trace ? `<h3>Identical system instructions for both lanes</h3><pre>${escapeHtml(output.trace.system)}</pre>` : ''}<h3>Generation settings</h3><p>Model: ${escapeHtml(run.model)} · temperature: 0.1 · thinking: minimal · output limit: 1,200 tokens. Context limits use characters; system instructions and the question are outside the limit.</p>`);
  },
  'handover': async () => {
    if (!hasKey()) return;
    await perform('Gemma is saving the important details. This may take up to 2 minutes if its first response needs a correction.', async () => {
      const result = await request('/api/handover', payload());
      validateMemory(result.memory, state.messages);
      state.memory = result.memory;
      state.cursor = result.cursor;
      state.checkpoints.push({ generation: result.memory.generation, createdAt: new Date().toISOString(), cursor: result.cursor, stats: result.stats, events: result.events, memory: structuredClone(result.memory.entries), trace: result.trace });
      verifiedModel = state.model;
      memoryTab = 'active';
      persist();
      notify(`Memory saved: ${state.memory.entries.length} important details.${result.stats.attempts > 1 ? ' Gemma corrected its first response; both attempts are recorded.' : ''} ${result.dropped.length ? `${result.dropped.length} details did not fit; open Changes to inspect them.` : 'Next, click Compare answers.'}`, result.dropped.length ? '' : 'success');
    }, 'handover');
  },
  'compare': async () => {
    if (!hasKey()) return;
    if (state.checks.some(check => !check.label.trim() || !check.expected.trim())) return notify('Fill in or remove empty recall checks before running.', 'error');
    await perform('Getting two answers from Gemma: one with saved memory and one without it…', async () => {
      const run = await request('/api/compare', { ...payload(), question: state.question });
      for (const lane of ['baseline', 'carry']) {
        if (!run[lane].error) run[lane].checks = scoreAnswer(run[lane].text, state.checks);
      }
      state.runs.push(run);
      selectedRun = state.runs.length - 1;
      if (!run.baseline.error || !run.carry.error) verifiedModel = state.model;
      persist();
      notify(run.baseline.error || run.carry.error ? 'One or both calls failed. Successful output is preserved; failed lanes are not scored.' : 'Both responses are ready. Review the suggested matches, check for stale decisions, and inspect the exact inputs.', run.baseline.error || run.carry.error ? 'error' : 'success');
      $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 'compare');
  },
  'how': () => showDetail('A handover notebook for AI.', `<p>Imagine a new teammate taking over your work. You give them the goal, the latest decisions, and what to do next—not every conversation you ever had.</p><ol><li><strong>The problem:</strong> models see a limited context. Earlier constraints may disappear when old messages are removed.</li><li><strong>The handover:</strong> Gemma extracts durable facts and updates changed decisions. Each memory points back to an exact user quote.</li><li><strong>The experiment:</strong> one fresh call sees only the recent transcript. The other sees the handover plus recent messages, under the same character ceiling.</li><li><strong>The evidence:</strong> inspect both responses and their exact inputs, then review which facts survived. Ties and failures count too.</li></ol><h3>Try this with the jury</h3><p>Ask a judge for a budget and a food preference. Add them as messages, change the budget, and add background discussion. Save a handover, then ask both lanes to recall the latest constraints. Let the judge check the results.</p><h3>Not just a summary</h3><p>We maintain named memory items, replace explicit corrections under the same key, retain an audit log, validate source quotes, and make budget-related memory loss visible.</p><h3>Honest limits</h3><p>This is a simulated context boundary, not a test of Gemma’s full context length. Quote validation does not prove semantic correctness. Complex contradictions and missed extractions remain possible. Memory is persisted in this browser; model requests use Google’s API.</p>`, 'THE 30-SECOND EXPLANATION'),
};

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  if (busy && !['close-dialog', 'source', 'context', 'extraction', 'how', 'connect-open', 'tab'].includes(button.dataset.action)) return;
  try { await actions[button.dataset.action]?.(button); } catch (error) { notify(error.message, 'error'); }
});

$('#message-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  const text = $('#message-input').value.trim();
  if (!text) return;
  try {
    appendMessage(text);
    if (state.name === 'Untitled experiment') state.name = text.length > 26 ? `${text.slice(0, 26)}…` : text;
    $('#message-input').value = '';
    persist(); render();
    $('#messages').scrollTop = $('#messages').scrollHeight;
    $('#message-input').focus();
  } catch (error) { notify(error.message, 'error'); }
});

$('#message-input').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') $('#message-form').requestSubmit();
});

$('.tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  memoryTab = event.key === 'Home' ? 'active' : event.key === 'End' ? 'history' : memoryTab === 'active' ? 'history' : 'active';
  renderMemory();
  $(`#${memoryTab}-tab`).focus();
});

$('#question').addEventListener('input', event => { state.question = event.target.value; persist(); $('#compare-button').disabled = busy || !state.question.trim() || state.memory.generation === 0 || state.cursor !== state.messages.length; renderComparisonHelp(); renderNextStep(); });
$('#check-inputs').addEventListener('input', event => {
  if (!event.target.matches('input[data-check]')) return;
  state.checks[Number(event.target.dataset.check)][event.target.dataset.field] = event.target.value;
  persist();
});
$('#budget').addEventListener('change', event => {
  const budget = Number(event.target.value);
  try {
    if (memoryText(state.memory).length > Math.floor(budget * 0.6)) throw new Error('Memory exceeds the reserved budget.');
    buildContext(state.messages, state.memory, budget, true);
  }
  catch { event.target.value = String(state.budget); return notify('The saved memory does not fit that ceiling. Use a larger ceiling or start a new experiment.', 'error'); }
  state.budget = budget; persist(); render();
  notify('Context ceiling changed for the next run. Existing results retain their original settings.');
});
$('#results').addEventListener('change', event => {
  if (!event.target.matches('select[data-review]')) return;
  const check = state.runs[selectedRun][event.target.dataset.lane].checks[Number(event.target.dataset.review)];
  check.reviewed = event.target.value === 'auto' ? null : event.target.value === 'pass';
  persist(); renderResults();
});

$('#connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const key = $('#api-key').value.trim() || apiKey;
  if (!key && !serverConfigured) {
    $('#connect-error').textContent = 'Enter a Google AI Studio key first.';
    $('#connect-error').hidden = false;
    return;
  }
  const model = $('#model').value;
  const remember = $('#remember-key').checked;
  busy = true;
  $('#connect-error').hidden = true;
  render();
  $('#connect-submit').textContent = 'Testing connection…';
  try {
    const result = await request('/api/connect', { model, remember }, key);
    apiKey = result.remembered ? '' : key;
    serverConfigured = result.configured;
    savedLocally = result.savedLocally;
    state.model = model;
    verifiedModel = model;
    $('#api-key').value = '';
    $('#connect-dialog').close();
    persist();
    notify(result.remembered ? 'Key saved on this laptop. Refreshes and restarts will reuse it. Next, click Save memory, then Compare answers.' : 'Gemma is connected for this tab. Next, click Save memory, then Compare answers.', 'success');
  } catch (error) {
    $('#connect-error').textContent = error.message;
    $('#connect-error').hidden = false;
  } finally {
    busy = false;
    $('#connect-submit').innerHTML = `Test & connect ${icon('arrow')}`;
    render();
  }
});

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
}

async function init() {
  const restored = restore();
  if (!restored) {
    try { await loadExample(false); } catch (error) { notify(error.message, 'error'); }
  }
  syncInputs();
  render();
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Config unavailable');
    const config = await response.json();
    serverConfigured = config.configured;
    savedLocally = config.savedLocally === true;
    if (!restored && MODELS.includes(config.defaultModel)) state.model = config.defaultModel;
    $('#model').value = state.model;
    render();
  } catch { notify('Could not reach the local server. Start it with npm start and reload this page.', 'error'); }
}

init();
