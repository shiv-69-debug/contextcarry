# AI tools and model usage disclosure

## Development assistance

- **OpenCode:** the recorded build session used OpenCode for ideation, scaffolding, implementation, debugging, UI refinement, tests, documentation, and repository preparation.
- **Codex:** the project author reports using Codex for development assistance. Its separate activity log and exact contribution breakdown are not available in this session, so no percentage or specific code ownership is claimed for it.
- **Human contribution:** the participant chose and refined the project direction, supplied requirements, tested the UI, reported problems with a screen recording, and is responsible for reviewing and presenting the work.

This is an AI-assisted project. It should not be presented as entirely hand-written or as a project in which model-generated code needed no human review.

## Where Gemma 4 is used at runtime

Default model: **`gemma-4-26b-a4b-it`**. The app also supports **`gemma-4-31b-it`**.

The models run through Google's **Gemini API**. The API's name does not mean the app is secretly using a Gemini model: the model ID in `src/gemma.js`'s request URL determines the actual model.

| Operation | What Gemma receives | What Gemma does | Calls |
| --- | --- | --- | --- |
| Test & connect | A small READY request | Confirms inference access | 1 |
| Save memory | Previous active memory and new messages | Extracts durable facts, decisions, tasks, and source quotes | 1, plus at most 1 validation-repair call |
| Compare: without memory | Recent transcript under the chosen limit | Answers the question | 1 |
| Compare: with memory | Saved memory plus recent transcript under the same limit | Answers the same question | 1 |

**Typical demo cost:** 3 generation calls after a key is already connected; 4 if the handover needs repair. First-time connection adds one small call. Re-running a comparison makes two more calls.

There is no fine-tuning, model training, model-weight redistribution, or autonomous tool execution. These are inference calls to an open-weight model hosted by Google.

## What ordinary code does

Gemma proposes and answers; JavaScript validates and manages the experiment:

- Validate the JSON shape and exact source quotes.
- Merge updates under stable keys and retain decision history.
- Pack memory into a fixed character allowance and expose dropped items.
- Construct the two bounded contexts without leaking expected answers.
- Keep credentials local and out of exports.
- Suggest text matches and record human-reviewed correctness.

## Source locations

- [`src/gemma.js`](../src/gemma.js): model endpoint, API request, generation settings, token usage, timeout/error handling.
- [`src/prompts.js`](../src/prompts.js): extraction instructions and the shared answering instructions.
- [`src/service.js`](../src/service.js): handover, one bounded repair, and parallel comparison calls.
- [`src/memory.js`](../src/memory.js): deterministic memory and evaluation mechanics.

## How usage is measured

Provider-reported `promptTokenCount`, `candidatesTokenCount`, and `totalTokenCount` are recorded per successful call. A repaired handover sums both attempts. Exported runs preserve prompts, outputs, model IDs, usage, and latency.

The app does **not** maintain a lifetime account-wide counter. Development diagnostics, failed provider calls, and earlier manual experiments are not a reliable project-wide total. Do not invent a percentage of “how much AI” was used or a token/dollar total for the entire project.

The published successful recording used **3 calls, 1,791 input tokens, 415 output tokens, and 2,206 total tokens**. It used an already-connected key and no repair attempt. This excludes earlier setup/debugging requests and an earlier recording attempt that hit a provider HTTP 500.

Measured examples and limitations are documented in [`examples/LIVE_RESULTS.md`](../examples/LIVE_RESULTS.md). The release includes `recording-report.json` with the recorded outputs, comparison prompts, and token usage. A character-budget comparison is not an equal-token-cost experiment.
