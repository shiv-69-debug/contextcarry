# ContextCarry — Hacktoberfest demo

A source-linked memory notebook powered by Gemma 4. Save important conversation details, preserve explicit decision updates, and compare what a fresh model call remembers with and without memory.

## Demo assets

- **contextcarry-demo.mp4** — captioned screen recording of genuine Gemma requests. No API-key entry is shown.
- **recording-report.json** — recorded memory entries, model responses, comparison inputs, timings, and provider token usage.
- **captions.srt** — accessible text captions for the video.

The successful recording used `gemma-4-26b-a4b-it`, 3 generation calls, and 2,206 total tokens. Manual review: 4/5 requested details retained with memory versus 0/5 without memory. The unfinished task was missed. This is a small demonstration, not a broad benchmark. An earlier recording attempt hit a provider HTTP 500; provider reliability remains a limitation.

## Run locally

Requires Node.js 22.9+:

```sh
npm start
```

Open http://localhost:3000, connect your own Google AI Studio key once, and follow the next-step guide.

The README explains the problem, solution, Gemma usage, evaluation, and limitations. `docs/AI_USAGE.md` discloses Codex (author-reported) and OpenCode development assistance.

Original application code: MIT licence. No API keys, private conversation exports, or model weights are included.
