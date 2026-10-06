# Explain ContextCarry to the jury

## Opening: 20 seconds

“When a teammate leaves a project, the next person needs the goal, latest decisions, and unfinished work. AI has a similar problem when earlier conversation falls outside its context. ContextCarry creates a compact handover instead of making you explain everything again.”

## Demo: about 90 seconds

1. Open the app. Connect the key once with **Remember on this laptop** checked. On later visits, **Saved key ready** means you can proceed without entering it again.
2. Show the sample trip conversation or use a judge's own constraints.
3. Point to the old ₹2,000 budget and its explicit correction to ₹3,000.
4. Point to **Outside recent chat** labels. Explain: “We deliberately use a tiny simulated window so you can see the boundary now.”
5. Click **Save memory**. Show the details actually captured; if any are missing, say so.
6. Click **See original message** under the budget: “This is the exact message supporting the memory.”
7. Click **Compare answers**. Show both actual answers. Use **See AI input** to inspect what each model call received.
8. Review the checks rather than assuming a text match means success. If both lanes succeed, say so.
9. If there is time, add a new budget, click **Make the chat longer**, save memory again, and open **Changes**. Update the budget under **Choose the details to check** before comparing again.

## Close: 10 seconds

“Our contribution is an inspectable handover pipeline: source-linked memory, explicit decision updates, visible memory loss, and a fair, reproducible comparison. We make continuity something you can check.”

## Likely questions

### Is this just a summary?

A summary narrates what happened. This system maintains individually named memory items, replaces explicit corrected values, preserves source quotes and an audit log, and tests the resulting handover. Summarization is part of the idea, but not the whole implementation.

### Are you making the baseline fail?

No. The baseline receives the latest transcript that fits a publicly selected character ceiling. Both calls share the same model, question, system prompt, and generation settings. The difference is whether that limited space includes a handover. We show the exact inputs and count ties and failures honestly.

### Does Gemma really forget after 1,200 characters?

No. That is our simulated limit, chosen to demonstrate context boundaries quickly. It is not Gemma's native context length.

### Why not send the whole chat?

For short chats, that can work well. This prototype studies what happens when the available context is deliberately limited. A compact memory trades some conversation detail for continuity of selected facts. It has an extra extraction cost, which we record.

### How do you know the memory is right?

We verify that each evidence quote exists in the cited user message. That proves the source link, not the interpretation. Users and judges can inspect it. The model can still omit a fact or misunderstand a correction.

### What did you build yourself, and where did AI help?

Explain the modules in `docs/ARCHITECTURE.md`, describe the memory schema and experiment flow, and disclose OpenCode's implementation/documentation/test assistance. Do not claim that an AI-assisted implementation was entirely hand-written.

### Does it work without the internet?

The local UI, saved memory, and exported evidence can be inspected without inference access. Live Gemma calls require the internet and a valid API key.

## Before recording

- Connect the key in advance; do not expose it while screen sharing.
- Have a working network and sufficient API quota.
- Use a small, readable example and a fixed context ceiling.
- Record genuine calls, not Playwright fixture responses.
- Keep an exported successful live run as supporting evidence if venue connectivity fails; label it as a previous run.
- Check the organizers' actual demo duration and adjust this script.
