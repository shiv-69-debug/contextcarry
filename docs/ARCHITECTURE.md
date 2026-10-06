# How ContextCarry works

## Two paths, different purposes

**Extraction** uses the previous active memory plus all user/assistant messages added after a cursor. Gemma proposes updates/removals. The server validates their shape and exact source quotes, then applies the complete batch atomically.

**Recall** uses a deliberately small character budget. The baseline receives recent transcript only. ContextCarry receives a compact serialization of active memories and whatever recent transcript still fits. Both calls use identical instructions, question, model, temperature, thinking setting, and output limit.

The extraction call has its own prompt and cost. It is not constrained to the recall character budget. The export includes its prompt, latency, and token usage too; do not claim the handover is free.

## Memory state

An active entry contains:

```json
{
  "key": "trip.budget",
  "kind": "constraint",
  "text": "Budget: ₹3,000.",
  "sourceId": "m3",
  "quote": "increase my total budget to ₹3,000",
  "priority": 3
}
```

Keys identify stable concepts. The model must reuse a key when a later explicit statement corrects that concept. The merge layer keeps one active value per key and records the old version. It does not infer contradictions independently of the model.

Quote validation ensures that `quote` is literally contained in the referenced **new user message**. It does not establish that `text` follows logically from the quote. A model can still produce a bad interpretation with a valid citation.

History events record additions, updates, explicit removals, and budget evictions. The full history stays local and is exported, but only active memory is fed into the next extraction. History is bounded to the latest 240 events; each checkpoint separately records its own events.

## Bounded packing

At each handover, memory can occupy up to 60% of the selected recall character ceiling. Entries are ranked by priority, with touched entries breaking ties. Whole entries are selected until the budget or 24-entry limit would be exceeded. Every excluded entry creates an `evicted` audit event.

The formatted handover includes keys, categories, and source IDs. Full original quotes stay in the browser-side memory record for inspection, not in the recall serialization. Recall token counts depend on the provider tokenizer, so `characters / 4` is labelled only as an estimate.

## Simulated context boundary

The most recent transcript suffix is constructed deterministically. A message crossing the boundary may be represented by a suffix with an explicit `start omitted` marker. Headers and separators count against the character budget.

The archive is retained for viewing, source validation, and the baseline's bounded recent-history selection. It is never secretly appended to a recall prompt. No baseline instruction asks the model to forget or fail.

The shared system instruction and question are outside the character ceiling. Both lanes receive them unchanged. A configured ceiling is not necessarily fully consumed when the available transcript is short. This is not an equal-token-cost experiment; actual usage is reported per call.

## Repeated handovers

The cursor advances only after successful extraction and validation. The next extraction receives the previous active entries and `messages.slice(cursor)`. If a fact was omitted/evicted, an empty update does not recover it from the full archive. A new user statement is required to introduce it again.

If a user adds a correction, the UI prevents another comparison until that new message has been handed over. Older comparisons remain immutable snapshots with their original question, budget, prompts, model, outputs, and checks.

## API and failure behavior

- `GET /api/config`: supported models and whether a server key is configured/saved locally; never the key.
- `POST /api/connect`: one small live connection check; `remember: true` saves the key only after validation succeeds.
- `POST /api/credentials/clear`: removes the saved local key and restores the `.env` fallback, if configured.
- `POST /api/handover`: validate a model-generated memory batch and return the next snapshot.
- `POST /api/compare`: independent model calls with `Promise.allSettled`; preserve the other result if one call fails.

Provider calls have a 60-second timeout. Malformed JSON or a memory-validation error triggers at most one corrective model call with the original memory, new messages, rejected output, and exact validation error. Both attempts are recorded for a successful handover, and their token usage and latency are summed. A still-invalid second output fails without changing memory or advancing the cursor. Provider/network/quota errors are not automatically retried, and there is no production fake-response path.

The extraction prompt explicitly limits removals to existing active keys. When there is no previous memory, removals must be empty; corrections inside the new transcript must become a single latest-value update. The validator still rejects nonexistent removals and unsupported quotes rather than silently accepting them.

The browser allows up to 135 seconds for a handover containing one repair. Elapsed-time indicators show requests in progress, and handover errors appear both under the handover button and beside the comparison area. The comparison button explains when it is waiting for a successful handover.

Static files use an allowlist; `.env`, server source, and package files are not served. HTML uses escaped text and a same-origin content security policy. POST requests reject browser cross-origin origins, and request sizes/concurrency are bounded.

## Storage and deployment scope

The Node server does not persist conversations. The browser stores the archive, active memory, checkpoints, comparisons, and reviews in localStorage. This is a local, single-user prototype, not an authenticated hosted product.

When **Remember on this laptop** is selected, a successfully tested API key and chosen model are stored in `.contextcarry/credentials.json`, a Git-ignored local file. Atomic temporary-file replacement prevents a partial write from overwriting the previous saved key. Node requests owner-only permissions when creating the file; actual permission enforcement depends on the operating system. This file is not an encrypted credential vault.

Saved credentials take precedence over the environment fallback and are loaded by a fresh server instance. Removing the saved file through the app restores that fallback; it does not revoke the provider key. UI credential changes are accepted only for loopback requests to localhost/loopback hostnames, in addition to the existing origin checks.

If Remember is unchecked, the supplied tab key lives only in a JavaScript variable and a transient request header. An optional `.env` key also stays server-side. No credential is included in exports or application logs. Live conversation excerpts are sent to Google when the user invokes a model operation.

## Evaluation

Expected-answer phrases stay local. Matching normalizes case, punctuation, and digit-grouping commas and uses whole normalized phrase boundaries. It does not understand negation, paraphrases, contradictory answers, or whether a value is actually current. A reviewer must mark each check correct or missing/incorrect before using it as a recall result.

For measured results:

1. Choose examples and ground truth before calling the model.
2. Keep the model, character budget, and questions fixed across trials.
3. Run several handovers, including a correction and an unsupported question.
4. Review the actual outputs, including stale values and missing evidence.
5. Export every run, including errors, ties, and regressions.
6. Report the sample size and extraction/inference cost as well as reviewed recall.

Automated tests use injected provider responses to verify software behavior. They do not measure real Gemma extraction quality or a retention improvement.
