import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCredentialStore } from '../src/credentials.js';

async function location(t) {
  const cache = join(process.cwd(), '.cache');
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, 'credential-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, path: join(directory, 'credentials.json') };
}

test('a saved credential survives a fresh store instance and updates without leftover temporary files', async t => {
  const { directory, path } = await location(t);
  const initial = { apiKey: 'first-synthetic-key', model: 'gemma-4-26b-a4b-it' };
  const replacement = { apiKey: 'second-synthetic-key', model: 'gemma-4-31b-it' };
  assert.equal(await createCredentialStore(path).load(), null);
  await createCredentialStore(path).save(initial);
  assert.deepEqual(await createCredentialStore(path).load(), initial);
  await createCredentialStore(path).save(replacement);
  assert.deepEqual(await createCredentialStore(path).load(), replacement);
  assert.deepEqual(await readdir(directory), ['credentials.json']);
});

test('invalid updates do not overwrite a working saved credential', async t => {
  const { path } = await location(t);
  const settings = { apiKey: 'synthetic-good-key', model: 'gemma-4-31b-it' };
  const store = createCredentialStore(path);
  await store.save(settings);
  await assert.rejects(store.save({ ...settings, apiKey: 'bad\nkey' }), /invalid/);
  assert.deepEqual(await store.load(), settings);
});

test('malformed local configuration never echoes secret content in an error', async t => {
  const { path } = await location(t);
  await writeFile(path, '{ malformed-synthetic-secret');
  await assert.rejects(createCredentialStore(path).load(), error => /Could not read saved credentials/.test(error.message) && !error.message.includes('synthetic-secret'));
});

test('removing a saved credential deletes only that file and is safe to repeat', async t => {
  const { directory, path } = await location(t);
  await writeFile(join(directory, 'unrelated.txt'), 'keep');
  const store = createCredentialStore(path);
  await store.save({ apiKey: 'synthetic-key', model: 'gemma-4-31b-it' });
  await store.clear();
  await store.clear();
  assert.equal(await store.load(), null);
  assert.equal(await readFile(join(directory, 'unrelated.txt'), 'utf8'), 'keep');
});
