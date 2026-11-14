'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { createUpdateCredentials } = require('./update_credentials.cjs');

async function fixture(t) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-update-credentials-'));
  t.after(() => fs.rm(profile, { recursive: true, force: true }));
  const key = randomBytes(32);
  // Contract mock with actual ephemeral AES encryption; not an OS-keyring test.
  const safeStorage = { isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'kwallet6',
    async encryptStringAsync(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    async decryptStringAsync(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return { result: Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'), shouldReEncrypt: false };
    },
  };
  return { profile, safeStorage, store: createUpdateCredentials({ profile, safeStorage }) };
}

test('credentials are encrypted outside business files, serialized, and never returned by write/clear', async (t) => {
  const f = await fixture(t), token = 'github_pat_ephemeral_fixture_only';
  assert.equal(await f.store.getToken(), null);
  assert.equal(await f.store.setToken(token), undefined);
  assert.equal(await f.store.getToken(), token);
  assert.equal((await fs.readFile(path.join(f.profile, 'updates/github-access.enc'))).includes(Buffer.from(token)), false);
  await f.store.clear();
  assert.equal(await f.store.getToken(), null);
});

test('unavailable encryption, basic-text Linux backends and invalid tokens never create a credential file', async (t) => {
  const f = await fixture(t);
  f.safeStorage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(f.store.setToken('github_pat_ephemeral_fixture_only'), /CREDENTIALS_UNAVAILABLE/);
  await assert.rejects(f.store.setToken('line\nbreak'), /INVALID_TOKEN/);
  f.safeStorage.isAsyncEncryptionAvailable = async () => true;
  f.safeStorage.getSelectedStorageBackend = () => 'basic_text';
  const linux = createUpdateCredentials({ profile: f.profile, safeStorage: f.safeStorage, platform: 'linux' });
  await assert.rejects(linux.setToken('github_pat_ephemeral_fixture_only'), /CREDENTIALS_UNAVAILABLE/);
  await assert.rejects(fs.stat(path.join(f.profile, 'updates/github-access.enc')), { code: 'ENOENT' });
});

test('corrupted ciphertext is rejected with no secret details; key rotation refreshes encrypted storage', async (t) => {
  const f = await fixture(t), token = 'github_pat_ephemeral_fixture_only';
  await f.store.setToken(token);
  const original = f.safeStorage.decryptStringAsync;
  f.safeStorage.decryptStringAsync = async (bytes) => ({ ...await original(bytes), shouldReEncrypt: true });
  const before = await fs.readFile(path.join(f.profile, 'updates/github-access.enc'));
  assert.equal(await f.store.getToken(), token);
  assert.notDeepEqual(await fs.readFile(path.join(f.profile, 'updates/github-access.enc')), before);
  await fs.writeFile(path.join(f.profile, 'updates/github-access.enc'), 'corrupted');
  await assert.rejects(f.store.getToken(), /CREDENTIALS_UNAVAILABLE/);
});
