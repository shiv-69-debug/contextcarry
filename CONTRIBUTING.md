# Contributing to ContextCarry

Thanks for helping make AI memory easier to inspect and measure.

## Start locally

1. Install Node.js 22.9 or newer.
2. Run `npm ci` for development dependencies.
3. Run `npm start` and open `http://localhost:3000`.
4. A key is needed only for live inference. Automated tests use explicit test fixtures.

## Before a pull request

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

- Describe the problem, your change, and how you verified it.
- Keep memory merging/context construction in `src/memory.js`, model requests in `src/gemma.js`, and UI behavior in `public/`.
- Preserve source validation, bounded context construction, and the separation of expected answers from model prompts.
- Include a focused regression test for meaningful behavior changes.
- Report live failures and ties honestly. Fixture tests demonstrate software behavior, not model accuracy.
- Never commit API keys, `.env`, `.contextcarry/`, or private conversation exports.
- Disclose AI assistance and credit reused code or assets.

## Useful contribution areas

- Better evaluations for lost tasks, changed decisions, and conditional preferences.
- More reliable extraction with evidence retained across handovers.
- Accessibility, clearer explanations, and multilingual examples.
- Additional providers behind an equally inspectable interface.

Contributions are covered by the project's MIT licence. Please keep discussions constructive and follow the linked event Code of Conduct when participating through the hackathon.
