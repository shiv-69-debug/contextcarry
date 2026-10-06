# Event brief

Source: [Hacktoberfest x MSC KBTCOE Nashik 2026](https://hacktoberfest-kbtcoe-2026.pages.dev/), read on 6 October 2026.

This document summarizes the organizer's page. Confirm any same-day changes with the organizers at the venue.

## Logistics

- Date: 6 October 2026.
- Location: MVP's KBTCOE, B Building, B409 Lab, Nashik.
- Format: solo only.
- Registration on the website: 27 September–5 October 2026.
- [MLH event page](https://events.mlh.com/events/15105-hacktoberfest-hack-day-nashik-x-msc-kbtcoe).
- Registration/check-in status for this participant: not verified by this workspace.

## Schedule — all times IST (Asia/Kolkata)

- 8:00 AM: kickoff and problem statements.
- 8:30 AM: brainstorming and guidance.
- 9:00 AM–12:00 PM: build window.
- 12:00 PM–1:00 PM: refreshments and break.
- 1:00 PM–3:00 PM: build window.
- **3:15 PM: submission deadline.**
- 3:15 PM–4:00 PM: judging.
- 4:00 PM onward: results and closing.

## Rules

- Work alone and start the project fresh in the build window.
- Libraries, open-source code, and AI tools are allowed. Disclose their use in the README.
- Plagiarism leads to disqualification.
- Follow the [MLH Code of Conduct](https://github.com/MLH/mlh-policies/blob/main/code-of-conduct.md).
- Bring your own idea or adapt one of the suggested problems.
- Difficulty labels do not affect scoring. A complete narrow project can outperform an incomplete advanced project.

## Track 1: Best Use of Gemma 4

Build a working project where Gemma 4 meaningfully performs an important part of the work. The organizers encourage text/image experiences, focused tools, interactive AI, and rapid prototypes.

The event page lists `gemma-4-31b-it` and `gemma-4-26b-a4b-it` through the Gemini API, with a Google AI Studio key. It states that these API models support text and image input, but not audio. These are organizer-provided details, not a verified API configuration for this workspace. Check current availability before implementation:

[Gemma on the Gemini API documentation](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)

Suggested problems:

1. **The Bug That Only Exists on Screen:** turn screenshots and descriptions into structured UI bug reports or compare visual changes.
2. **A Tutor That Won't Give You the Answer:** inspect learner work and give controlled Socratic hints.
3. **Many Tiny Judges:** reconcile independent model roles; compare against a single call on a small test set.
4. **The Conversation That Outlives Its Context:** generate compact handovers and measure fact retention across repeated context boundaries.
5. **Teaching a Model Your Rules Without Training It:** improve a narrow task with examples, retrieval, prompts, validation, and self-checks; measure each technique.
6. **Gemma as the Brain of a Game or Physical World:** make the model observe and act while handling latency and bad decisions.

## Track 2: Best Open-Source AI Project

Build an original working project where open-source or open-weight AI is central.

Requirements:

- Publish a public GitHub repository.
- Include an open-source licence; the page suggests MIT or Apache-2.0 as common choices.
- Document installation, running, and testing.
- Agent Skill submissions must follow the [Agent Skills specification](https://agentskills.io/specification).
- Model harness submissions must be original implementations or meaningful changes to existing open-source harnesses.

Suggested problems:

1. **The Unwritten Rules Nobody Documents:** package a real workflow as an Agent Skill.
2. **Skills Nobody Tested:** evaluate a skill with and without it; report improvements and regressions.
3. **AI That Works With the Internet Off:** run a useful small open-weight model locally and evaluate quality, latency, memory, and hardware trade-offs.
4. **AI for Knowledge Too Local for General Models:** answer from a narrow document collection, show source passages, and abstain when answers are missing.
5. **See Inside the Agent:** implement a small transparent harness with inspectable prompts, tool calls, traces, and replay/debugging.
6. **Make a Small Model a Reliable Agent:** improve an existing harness using validation, repair, retries, loop detection, or fallbacks, and compare task success rates.

## Judging

- Idea and originality.
- Technical depth.
- A working demo.
- Use of Gemma 4 or open-source quality.
- README and documentation.

A working project is required. Comparisons, test sets, and measured results are viewed favorably but do not replace a working build. The page does not publish numeric scoring weights.

## Submission

Submit on the linked event page before 3:15 PM IST with:

- A public GitHub repository.
- A README explaining the problem, approach, and setup.
- A demo link or short demo video.
- Track-specific requirements completed.

## Help at the venue

- Organizer email: kalpeshchavan675@gmail.com.
- Coordinators listed on the website: Kalpesh Chavan, Vinit Deore, and Dronav Dalvi.
- The event website also links the participant WhatsApp group.
