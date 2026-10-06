// Records genuine calls through a running local app. No credentials are read or recorded here.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:3000' }, output: { type: 'string', default: '.cache/demo-recording' } } });
const base = values.url;
const output = resolve(values.output);
const config = await (await fetch(`${base}/api/config`)).json();
if (!config.configured) throw new Error('Connect and remember your key in the app before recording.');
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output, size: { width: 1440, height: 1000 } }, reducedMotion: 'reduce' });
const page = await context.newPage();
const video = page.video();
const started = Date.now();
const captions = [];
const pause = ms => page.waitForTimeout(ms);
const caption = text => captions.push({ start: (Date.now() - started) / 1000, text });
let report;

try {
  caption('ContextCarry: a small handover notebook for AI.\nSave important details, then test what survives a limited context.');
  await page.goto(base);
  await expect(page.locator('#message-input')).toBeVisible();
  await expect(page.locator('#connection-status')).toHaveText(/Saved key ready|API key ready/);
  await pause(5000);

  caption('The example changes a trip budget from INR 2,000 to INR 3,000.\nOlder messages are outside the recent-chat window.');
  await page.locator('#conversation-heading').scrollIntoViewIfNeeded();
  await page.locator('#messages').evaluate(element => { element.scrollTop = 100; });
  await pause(6000);

  caption('Save memory makes a real Gemma 4 call.\nThe app checks source quotes before accepting the handover.');
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/handover') && response.request().method() === 'POST', { timeout: 140000 });
  await page.locator('#handover-button').click();
  const savedHttp = await savedResponse;
  const saved = await savedHttp.json();
  if (!savedHttp.ok()) throw new Error(saved.error || 'Handover failed');
  await expect(page.locator('#next-action')).toHaveText('Compare answers', { timeout: 10000 });
  await page.locator('#memory-content').evaluate(element => { element.scrollTop = 0; });
  await pause(5000);

  const budget = saved.memory.entries.find(entry => /3[, ]?000/.test(entry.text));
  if (budget) {
    caption('Every memory links to an original user message.\nA quote proves its source; the interpretation can still be wrong.');
    await page.locator(`[data-key="${budget.key}"]`).click();
    await expect(page.locator('#detail-dialog')).toBeVisible();
    await pause(6000);
    await page.locator('#detail-dialog [data-action="close-dialog"]').click();
  }

  caption('Now ask the same question twice, using the same Gemma 4 model.\nOnly one call gets the saved memory.');
  await page.locator('#comparison-heading').scrollIntoViewIfNeeded();
  await pause(4000);
  const compareResponse = page.waitForResponse(response => response.url().endsWith('/api/compare') && response.request().method() === 'POST', { timeout: 80000 });
  await page.locator('#compare-button').click();
  const comparedHttp = await compareResponse;
  const compared = await comparedHttp.json();
  if (!comparedHttp.ok() || compared.baseline?.error || compared.carry?.error) throw new Error(compared.error || compared.baseline?.error || compared.carry?.error || 'Comparison failed');
  await expect(page.locator('.result-body.placeholder')).toHaveCount(0);

  caption('These are real model responses, not prerecorded answers.\nReview the details yourself; a matching word is not proof of recall.');
  await page.locator('#results').scrollIntoViewIfNeeded();
  await pause(14000);
  await page.locator('#results').screenshot({ path: resolve(output, 'demo-preview.png') });

  caption('Inspect the exact input for either call.\nThe same character ceiling applies; memory uses part of that space.');
  await page.locator('.carry [data-action="context"]').click();
  await pause(7000);
  await page.locator('#detail-dialog [data-action="close-dialog"]').click();

  caption('Source-linked memory. Explicit decision updates. Inspectable results.\nOpen-source code, setup instructions, and limitations are in the repository.');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await pause(6000);

  report = {
    recordedAt: new Date().toISOString(),
    model: config.defaultModel,
    contextCharacters: compared.budget,
    handover: { entries: saved.memory.entries, stats: saved.stats },
    comparison: compared,
    generatedCallCount: saved.stats.attempts + 2,
    note: 'Genuine model requests. No connection-check call is included because the server already had a saved key. Reviewer judgments are not auto-generated.',
  };
  await writeFile(resolve(output, 'recording-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ model: report.model, generatedCallCount: report.generatedCallCount, extraction: saved.stats, baseline: { text: compared.baseline.text, usage: compared.baseline.usage, latencyMs: compared.baseline.latencyMs }, carry: { text: compared.carry.text, usage: compared.carry.usage, latencyMs: compared.carry.latencyMs } }, null, 2));
} finally {
  const end = (Date.now() - started) / 1000;
  await context.close();
  await video.saveAs(resolve(output, 'demo.webm'));
  await browser.close();
  if (report) {
    const stamp = seconds => {
      const milliseconds = Math.max(0, Math.round(seconds * 1000));
      const hours = Math.floor(milliseconds / 3600000);
      const minutes = Math.floor(milliseconds / 60000) % 60;
      const secs = Math.floor(milliseconds / 1000) % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
    };
    const subtitles = captions.map((item, index) => `${index + 1}\n${stamp(item.start)} --> ${stamp((captions[index + 1]?.start ?? end) - 0.05)}\n${item.text}\n`).join('\n');
    await writeFile(resolve(output, 'captions.srt'), subtitles);
    console.log(`Demo video and captions saved in ${output}`);
  }
}
