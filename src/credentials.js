import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MODELS } from './memory.js';

const defaultPath = fileURLToPath(new URL('../.contextcarry/credentials.json', import.meta.url));

function validate(settings) {
  if (!settings || typeof settings.apiKey !== 'string' || !settings.apiKey.trim() || settings.apiKey.length > 256 || /[\r\n]/.test(settings.apiKey) || !MODELS.includes(settings.model)) {
    throw new Error('The local credential file is invalid. Remove it and connect your key again.');
  }
  return { apiKey: settings.apiKey.trim(), model: settings.model };
}

// This store is local to the Node server. The browser never receives its contents.
export function createCredentialStore(path = defaultPath) {
  return {
    async load() {
      try {
        return validate(JSON.parse(await readFile(path, 'utf8')));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error('Could not read saved credentials. Check the local .contextcarry folder or remove its credentials.json file and reconnect.');
      }
    },
    async save(settings) {
      const validated = validate(settings);
      const directory = dirname(path);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(validated), { mode: 0o600, flag: 'wx' });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}
