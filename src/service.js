import { applyExtraction, buildContext, invariant, memoryText, MODELS, parseModelJson, validateMemory, validateMessages } from './memory.js';
import { ANSWER_SYSTEM, EXTRACT_SYSTEM, answerPrompt, extractionPrompt } from './prompts.js';
import { ApiError, generate } from './gemma.js';

function validateInput(input) {
  invariant(input && typeof input === 'object', 'Expected a JSON object.');
  validateMessages(input.messages);
  validateMemory(input.memory, input.messages);
  invariant(MODELS.includes(input.model), 'Choose a supported Gemma 4 model.');
  invariant(Number.isInteger(input.cursor) && input.cursor >= 0 && input.cursor <= input.messages.length, 'Invalid handover cursor.');
  invariant(Number.isInteger(input.budget) && input.budget >= 600 && input.budget <= 12000, 'Context budget must be 600–12,000 characters.');
}

export async function handover(input, apiKey, generateImpl = generate) {
  validateInput(input);
  const newMessages = input.messages.slice(input.cursor);
  invariant(newMessages.length > 0, 'Add a new message before creating another handover.');
  const memoryBudget = Math.floor(input.budget * 0.6);
  const initialPrompt = extractionPrompt(input.memory, newMessages);
  let prompt = initialPrompt;
  let applied;
  const attempts = [];
  for (let index = 0; index < 2; index++) {
    // Only invalid model output gets one repair. Provider/network/quota errors propagate immediately.
    const result = await generateImpl({ apiKey, model: input.model, system: EXTRACT_SYSTEM, prompt, maxOutputTokens: 4096 });
    const attempt = { system: EXTRACT_SYSTEM, prompt, output: result.text, latencyMs: result.latencyMs, usage: result.usage };
    attempts.push(attempt);
    try {
      applied = applyExtraction(input.memory, parseModelJson(result.text), newMessages, memoryBudget);
      break;
    } catch (error) {
      attempt.validationError = error.message;
      if (index === 1) throw new ApiError(`Gemma's handover was still invalid after one repair: ${error.message}`, 502);
      prompt = JSON.stringify({
        ...JSON.parse(initialPrompt),
        REPAIR_INSTRUCTIONS: 'Fix the rejected output and return only the complete updates/removals JSON. The original state has NOT changed. Use only the allowed removal keys; removals must be empty when there is no current memory. Keep valid source-linked facts; do not invent quotes.',
        VALIDATION_ERROR: error.message,
        PREVIOUS_INVALID_OUTPUT: result.text,
      });
    }
  }
  const usage = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens'].map(field => [field,
    attempts.every(attempt => Number.isFinite(attempt.usage?.[field])) ? attempts.reduce((sum, attempt) => sum + attempt.usage[field], 0) : null,
  ]));
  return {
    ...applied,
    cursor: input.messages.length,
    stats: { memoryChars: memoryText(applied.memory).length, memoryBudget, newMessages: newMessages.length, latencyMs: attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0), usage, attempts: attempts.length },
    trace: { operation: 'handover', model: input.model, system: EXTRACT_SYSTEM, prompt, output: attempts.at(-1).output, attempts },
  };
}

export async function compare(input, apiKey, generateImpl = generate) {
  validateInput(input);
  invariant(input.memory.generation > 0, 'Create a handover before comparing recall.');
  invariant(input.cursor === input.messages.length, 'Your handover is out of date. Save the new messages first.');
  invariant(typeof input.question === 'string' && input.question.trim().length > 0 && input.question.length <= 1200, 'Enter a question of 1–1,200 characters.');
  const contexts = {
    baseline: buildContext(input.messages, input.memory, input.budget, false),
    carry: buildContext(input.messages, input.memory, input.budget, true),
  };
  // Same model, question, system instructions, sampling, output limit, and context character ceiling.
  // Only the context construction differs. Expected answers never reach the provider.
  const settled = await Promise.allSettled(Object.entries(contexts).map(async ([lane, context]) => {
    const prompt = answerPrompt(context, input.question);
    const result = await generateImpl({ apiKey, model: input.model, system: ANSWER_SYSTEM, prompt, maxOutputTokens: 1200 });
    return [lane, { ...result, context, trace: { system: ANSWER_SYSTEM, prompt } }];
  }));
  const lanes = {};
  settled.forEach((outcome, index) => {
    const lane = Object.keys(contexts)[index];
    if (outcome.status === 'fulfilled') lanes[lane] = outcome.value[1];
    else lanes[lane] = { error: outcome.reason.message, context: contexts[lane] };
  });
  return { ...lanes, model: input.model, question: input.question.trim(), budget: input.budget, generation: input.memory.generation, createdAt: new Date().toISOString() };
}
