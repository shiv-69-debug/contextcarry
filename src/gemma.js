import { MODELS, invariant } from './memory.js';

export class ApiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export async function generate({ apiKey, model, system, prompt, maxOutputTokens = 1600, fetchImpl = fetch }) {
  invariant(MODELS.includes(model), 'Choose one of the supported Gemma 4 models.');
  if (!apiKey) throw new ApiError('Connect a Google AI Studio key to run Gemma. No model call has been made.', 401);
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens, thinkingConfig: { thinkingLevel: 'minimal' } },
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new ApiError('Gemma took longer than 60 seconds. Your work is saved; try again.', 504);
    throw new ApiError('Could not reach the Gemini API. Check the internet connection and try again.');
  }
  if (!response.ok) {
    // Avoid echoing provider messages that can contain credentials or arbitrary request content.
    const reasons = {
      400: 'Gemini rejected this request. Check your API key and whether this model is enabled for your project.',
      401: 'The API key was not accepted. Check it in Google AI Studio.',
      403: 'This key or region cannot access the model. Check your Google AI Studio project permissions.',
      404: 'This Gemma model is not available for your API project. Try the other listed Gemma 4 model.',
      429: 'Gemini rate limit or quota reached. Wait before retrying, or check your AI Studio quota.',
    };
    throw new ApiError(reasons[response.status] || `Gemini returned HTTP ${response.status}. Try again shortly.`, response.status === 429 ? 429 : 502);
  }
  let data;
  try { data = await response.json(); } catch { throw new ApiError('Gemini returned an unreadable response.'); }
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') throw new ApiError('The model output was cut short. Use fewer new messages and try again.');
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new ApiError(`Gemma did not complete this response (${candidate.finishReason}). Try a different input.`);
  const text = candidate?.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('').trim();
  if (!text) throw new ApiError('Gemma returned no text. Try a different input or model.');
  return {
    text,
    model,
    latencyMs: Math.round(performance.now() - started),
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      totalTokens: data.usageMetadata?.totalTokenCount ?? null,
    },
  };
}
