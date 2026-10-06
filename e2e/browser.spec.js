// Test-only provider responses. The production application has no fake-response mode.
import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { createCredentialStore } from '../src/credentials.js';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

let app;
let base;
const modelCalls = [];
const fixtureKey = 'e2e-secret-never-render-or-export';
const response = text => ({ text, model: 'gemma-4-26b-a4b-it', latencyMs: 43, usage: { inputTokens: 222, outputTokens: 70, totalTokens: 292 } });

async function testProvider(options) {
  modelCalls.push(options);
  if (options.prompt === 'Connection check.') return response('READY');
  const data = JSON.parse(options.prompt);
  if (data.NEW_MESSAGES) {
    const updates = [];
    const first = data.NEW_MESSAGES.find(message => message.id === 'm1');
    const correction = data.NEW_MESSAGES.find(message => message.id === 'm3');
    if (first) {
      updates.push(
        { key: 'trip.destination', kind: 'goal', text: 'Plan a one-day trip to Nashik.', sourceId: 'm1', quote: 'Help me plan a one-day trip to Nashik.', priority: 3 },
        { key: 'trip.food', kind: 'preference', text: 'Vegetarian food only.', sourceId: 'm1', quote: 'I eat vegetarian food only', priority: 3 },
        { key: 'trip.deadline', kind: 'constraint', text: 'Be home before 6 PM.', sourceId: 'm1', quote: 'I must be home before 6 PM.', priority: 3 },
      );
    }
    if (correction) updates.push(
      { key: 'trip.budget', kind: 'constraint', text: 'Total budget: ₹3,000.', sourceId: 'm3', quote: 'increase my total budget to ₹3,000', priority: 3 },
      { key: 'trip.next', kind: 'task', text: 'Choose transport next.', sourceId: 'm3', quote: 'Next, we need to choose transport.', priority: 2 },
    );
    const next = data.NEW_MESSAGES.find(message => message.text === 'Actually my budget is now ₹4,100.');
    if (next) updates.push({ key: 'trip.budget', kind: 'constraint', text: 'Total budget: ₹4,100.', sourceId: next.id, quote: next.text, priority: 3 });
    return response(JSON.stringify({ updates, removals: [] }));
  }
  return response(data.CONTEXT.includes('HANDOVER') ? 'Your budget is ₹3,000, you prefer vegetarian food, you must return before 6 PM, and the destination is Nashik. Next, choose transport.' : 'The budget, food preference, return deadline, destination, and next task are unknown in the available context. Could you remind me?');
}

test.beforeAll(async () => {
  app = createApp({ apiKey: fixtureKey, generateImpl: testProvider, credentialStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  base = `http://127.0.0.1:${app.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }); });

test('initial workspace has sample inputs but no fabricated results; key gate works', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { configured: false, models: ['gemma-4-26b-a4b-it'], defaultModel: 'gemma-4-26b-a4b-it' } }));
  await page.goto(base);
  await expect(page.locator('#message-count')).toHaveText('8 messages');
  await expect(page.locator('#generation')).toHaveText('00');
  await expect(page.locator('.result-body.placeholder')).toHaveCount(2);
  await expect(page.locator('#compare-button')).toBeDisabled();
  await page.locator('#handover-button').click();
  await expect(page.locator('#connect-dialog')).toBeVisible();
  await page.locator('#api-key').fill('tab-key-used-only-for-tests');
  await page.locator('#remember-key').uncheck();
  await page.locator('#connect-submit').click();
  await expect(page.locator('#connect-dialog')).not.toBeVisible();
  await expect(page.locator('#connection-status')).toHaveText('Gemma connected');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('tab-key-used-only-for-tests');
});

test('handover, provenance, comparison, review, export, and a corrected second generation', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator('#connection-status')).toHaveText('API key ready');
  await page.locator('#handover-button').click();
  await expect(page.locator('#generation')).toHaveText('01');
  await expect(page.locator('.memory-card')).toHaveCount(5);
  await page.locator('[data-key="trip.budget"]').click();
  await expect(page.locator('#detail-content')).toContainText('increase my total budget to ₹3,000');
  await page.locator('#detail-dialog [data-action="close-dialog"]').click();
  await page.locator('#compare-button').click();
  await expect(page.locator('.result-card.carry .result-body')).toContainText('₹3,000');
  await expect(page.locator('.result-card.baseline .result-body')).toContainText('unknown');
  await expect(page.locator('.result-card.carry .review-row')).toHaveCount(5);
  await page.getByLabel('With saved memory: review Latest budget').selectOption('pass');
  await expect(page.locator('.carry .review-heading')).toContainText('1/5 confirmed');
  await page.locator('.baseline [data-action="context"]').click();
  await expect(page.locator('#detail-content pre').first()).not.toContainText('₹3,000');
  await page.locator('#detail-dialog [data-action="close-dialog"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.footer [data-action="export"]').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let exported = '';
  for await (const chunk of stream) exported += chunk.toString();
  expect(exported).not.toContain(fixtureKey);
  expect(JSON.parse(exported).runs[0].carry.checks[0].reviewed).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('contextcarry-desktop.png'), fullPage: true });
  await page.locator('#message-input').fill('Actually my budget is now ₹4,100.');
  await page.getByRole('button', { name: 'Add message', exact: true }).click();
  await expect(page.locator('#compare-button')).toBeDisabled();
  await page.locator('#handover-button').click();
  await expect(page.locator('#generation')).toHaveText('02');
  await expect(page.locator('#memory-content')).toContainText('₹4,100');
  await page.locator('#history-tab').click();
  await expect(page.locator('#memory-content')).toContainText('updated');
  await expect(page.locator('#memory-content del')).toContainText('₹3,000');
  const extraction = modelCalls.filter(call => call.prompt.startsWith('{') && JSON.parse(call.prompt).NEW_MESSAGES).at(-1);
  expect(JSON.parse(extraction.prompt).NEW_MESSAGES).toHaveLength(1);
  await page.reload();
  await expect(page.locator('#generation')).toHaveText('02');
  await expect(page.locator('#memory-content')).toContainText('₹4,100');
  expect(errors).toEqual([]);
});

test('failed handover preserves prior state; HTML in user text is displayed literally', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('#connection-status')).toHaveText('API key ready');
  await page.locator('#handover-button').click();
  await expect(page.locator('#generation')).toHaveText('01');
  await page.locator('#message-input').fill('<img src=x onerror="window.injected=true"> Keep this as literal text.');
  await page.getByRole('button', { name: 'Add message', exact: true }).click();
  await expect(page.locator('#messages')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.route('**/api/handover', route => route.fulfill({ status: 502, json: { error: 'Test provider is unavailable.' } }));
  await page.locator('#handover-button').click();
  await expect(page.locator('#notice')).toHaveText('Test provider is unavailable.');
  await expect(page.locator('#comparison-status')).toHaveText('Test provider is unavailable.');
  await expect(page.locator('#handover-status')).toHaveText('Test provider is unavailable.');
  await expect(page.locator('#generation')).toHaveText('01');
  await expect(page.locator('.memory-card')).toHaveCount(5);
  await expect(page.locator('#handover-button')).toBeEnabled();
});

test('mobile workspace fits the viewport and supports the complete demo controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await expect(page.locator('#message-count')).toHaveText('8 messages');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#handover-button').click();
  await expect(page.locator('#generation')).toHaveText('01');
  await page.locator('#compare-button').click();
  await expect(page.locator('.carry .review-row')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('contextcarry-mobile.png'), fullPage: true });
});

test('a remembered key survives refresh, stays out of browser storage, and can be removed', async ({ page }) => {
  const cache = join(process.cwd(), '.cache');
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, 'browser-credentials-'));
  const credentialStore = createCredentialStore(join(directory, 'credentials.json'));
  const localApp = createApp({ apiKey: '', credentialStore, generateImpl: testProvider });
  localApp.listen(0, '127.0.0.1');
  await once(localApp, 'listening');
  const url = `http://127.0.0.1:${localApp.address().port}`;
  try {
    await page.goto(url);
    await expect(page.locator('#connection-status')).toHaveText('Connect for live AI');
    await page.locator('#connection-button').click();
    await page.locator('#api-key').fill('synthetic-browser-persisted-key');
    await expect(page.locator('#remember-key')).toBeChecked();
    await page.locator('#connect-submit').click();
    await expect(page.locator('#notice')).toContainText('Key saved on this laptop');
    await page.reload();
    await expect(page.locator('#connection-status')).toHaveText('Saved key ready');
    await expect(page.locator('#connection-button')).toHaveText('Model settings');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('synthetic-browser-persisted-key');
    expect(await page.content()).not.toContain('synthetic-browser-persisted-key');
    await page.locator('#handover-button').click();
    await expect(page.locator('#generation')).toHaveText('01');
    await expect(page.locator('#connect-dialog')).not.toBeVisible();
    await page.locator('#connection-button').click();
    await expect(page.locator('#api-key')).toHaveValue('');
    await page.locator('#forget-saved-key').click();
    await expect(page.locator('#connection-status')).toHaveText('Connect for live AI');
    await page.reload();
    await expect(page.locator('#connection-status')).toHaveText('Connect for live AI');
    expect(await credentialStore.load()).toBeNull();
  } finally {
    await new Promise(resolve => { localApp.close(resolve); localApp.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  }
});

test('the next-step guide moves from saving memory to comparing and viewing answers', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('#connection-status')).toHaveText('API key ready');
  await expect(page.locator('#next-action')).toHaveText('Save memory');
  await expect(page.locator('#step-2')).toHaveAttribute('aria-current', 'step');
  await page.locator('#next-action').click();
  await expect(page.locator('.memory-card')).toHaveCount(5);
  await expect(page.locator('#next-action')).toHaveText('Compare answers');
  await expect(page.locator('#step-3')).toHaveAttribute('aria-current', 'step');
  await page.locator('#next-action').click();
  await expect(page.locator('.carry .result-body')).toContainText('₹3,000');
  await expect(page.locator('#next-action')).toHaveText('View answers');
  await page.locator('#next-action').click();
  await expect(page.locator('.carry .review-row')).toHaveCount(5);
});
