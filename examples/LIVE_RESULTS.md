# First live verification — 6 October 2026

This is a manually reviewed live run using the saved API key through the local server. It is separate from the injected provider responses in automated tests. No credentials are included here.

## Setup

- Input: `examples/trip.json`.
- Model: `gemma-4-26b-a4b-it`.
- Context ceiling: 1,200 characters for both lanes.
- Memory allowance: 720 characters.
- Handover: 4 active entries, 207 characters; one model attempt.
- Handover latency: about 5.4 seconds; provider usage: 923 input tokens and 181 output tokens.
- Comparison latency: about 4.4 seconds for the parallel calls.
- Recall input usage: baseline 416 tokens, ContextCarry 452 tokens. Equal character ceilings do not mean equal token cost.

## What originally failed

The live extraction returned a removal for a nonexistent memory. The validator rejected the entire batch with “The model tried to remove a missing memory.” Because no handover was committed, Run comparison stayed disabled. The page placed the error far above the comparison area, making the failure hard to see in the user's recording.

A separate diagnostic call also encountered a provider HTTP 500. Such provider failures remain possible and are surfaced explicitly.

## Fix verified

The extraction prompt now lists allowed removal keys and explicitly requires an empty removal list when no memory exists. Invalid model JSON/operations get at most one corrective attempt, still subject to the same strict validation. Errors are visible beside the controls and elapsed request time is shown. The successful live run below needed no repair.

## Manual recall review

| Detail | Expected | Baseline | ContextCarry |
| --- | --- | --- | --- |
| Latest budget | ₹3,000 | Unknown | Correct |
| Food preference | Vegetarian | Unknown | Correct |
| Return deadline | Before 6 PM | Unknown | Correct |
| Destination | Nashik | Unknown | Correct |
| Next unfinished task | Choose transport | Unknown | Unknown — missing |

**Reviewed result: baseline 0/5; ContextCarry 4/5. Sample size: one comparison.**

The ContextCarry answer included:

> Budget: ₹3,000
>
> Food Preference: Vegetarian only
>
> Return Deadline: Home before 6 PM
>
> Destination: Nashik (one-day trip)
>
> Next Unfinished Planning Task: Unknown

The answer later mentioned “transport” incidentally, even though it explicitly marked the next task unknown. A simple text match could therefore suggest the task was retained. The human-reviewed check must be **Missing / incorrect**, illustrating why text-match suggestions are not scores by themselves.

## Limits of this evidence

This is not proof of universal retention or superiority to another product's memory system. One task was lost, and the baseline is deliberately truncated recent history. Repeat with judge-supplied facts, corrections, and different budgets; keep errors, ties, and regressions in the record. Save full traces through Export experiment for future runs.
