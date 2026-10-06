# ContextCarry — build specification and progress

## Project

- **Name:** ContextCarry.
- **Primary track:** Best Use of Gemma 4.
- **Target user:** Someone continuing a long AI-assisted project across fresh sessions.
- **Problem:** Earlier goals, constraints, corrected decisions, and unfinished work can disappear when conversation context is dropped.
- **Pitch:** A compact, source-linked handover helps a fresh session continue; an inspectable experiment measures what survives.
- **AI contribution:** Gemma selects durable information and maps explicit corrections to existing memory keys. Ordinary code validates its output, merges it, and constructs the two contexts.

## Agreed narrow demo

1. Add user-supplied instructions and an explicit correction.
2. Add background discussion to put the initial facts outside a deliberately small context window.
3. Generate a compact handover, with source references and decision history.
4. Compare a recent-history baseline and a memory-assisted call using the same model, context ceiling, question, and generation settings.
5. Inspect each call's real inputs and outputs; review which facts survived.
6. Repeat a handover and export evidence.

The reset is a deliberate simulation, not a claim about Gemma's actual context length. Both lanes may succeed or fail. Never force a baseline failure or fabricate a memory win.

## Technical choices

- Node.js 22.9+ with built-in HTTP server and fetch.
- Plain HTML, CSS, and JavaScript; no runtime package installation or build step.
- Gemma 4 through Google's REST `generateContent` API.
- Browser-local experiment persistence; API keys never enter localStorage or exports.
- MIT licence for original application code.
- Local demo first. A real video can accompany a public GitHub repository.

## Requirements

- Exact source quotes must refer to new user messages; reject a malformed extraction atomically.
- Explicit updates replace the existing memory key, preserving the previous value in history.
- Existing unchanged memory carries forward. Later model extractions do not receive the entire archive.
- Memory packing must stay within its budget and record dropped items.
- Both recall contexts must respect the same character ceiling; memory consumes part of that ceiling.
- Expected answers must never be sent to the models.
- Preserve a successful lane when its peer fails. Never score a failed call as a recall result.
- Display automatic text matches as suggestions and let the presenter record human review.
- Export all handover and comparison traces with actual provider usage when supplied.

## Progress

- [x] Confirm event tracks and Google API details.
- [x] Implement the pure memory pipeline and local API.
- [x] Build conversation, memory, source inspection, comparison, and review interface.
- [x] Implement persistence and export.
- [x] Add automated tests with explicit test-only model responses.
- [x] Verify live Gemma access with the participant's own key (first manually reviewed result in `examples/LIVE_RESULTS.md`).
- [ ] Run repeated live trials and review the outputs.
- [ ] Record a real demo and publish the GitHub repository.
- [ ] Submit before 3:15 PM IST.

## Out of scope today

Multi-user accounts, a cloud database, production agent-framework integrations, model training, vector search, autonomous tool execution, and claims of perfect or unlimited memory.
