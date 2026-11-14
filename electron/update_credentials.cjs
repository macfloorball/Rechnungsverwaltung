'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UpdateError } = require('./update_manifest.cjs');

function validToken(token) {
  return typeof token === 'string' && token.length >= 20 && token.length <= 512 && /^[\x21-\x7e]+$/.test(token);
}

function createUpdateCredentials({ safeStorage, profile, platform = process.platform }) {
  const directory = path.join(profile, 'updates');
  const file = path.join(directory, 'github-access.enc');
  let queue = Promise.resolve();
  const serialize = (fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  async function secureDirectory(create = false) {
    if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (platform === 'linux' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) {
      throw new UpdateError('CREDENTIALS_UNAVAILABLE');
    }
  }
  async function secureStorage() {
    if (!safeStorage || !await safeStorage.isAsyncEncryptionAvailable()) throw new UpdateError('CREDENTIALS_UNAVAILABLE');
    if (platform === 'linux' && !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())) {
      throw new UpdateError('CREDENTIALS_UNAVAILABLE');
    }
  }
  async function save(token) {
    await secureStorage();
    const bytes = await safeStorage.encryptStringAsync(token);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 65536) throw new UpdateError('CREDENTIALS_UNAVAILABLE');
    await secureDirectory(true);
    try { if (!(await fs.lstat(file)).isFile()) throw new UpdateError('CREDENTIALS_UNAVAILABLE'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(directory, `${randomUUID()}.enc`);
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  return {
    getToken() {
      return serialize(async () => {
        try {
          await secureDirectory();
          const stat = await fs.lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536
              || (platform === 'linux' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw new UpdateError('CREDENTIALS_UNAVAILABLE');
          await secureStorage();
          const decrypted = await safeStorage.decryptStringAsync(await fs.readFile(file));
          if (!validToken(decrypted.result)) throw new UpdateError('CREDENTIALS_UNAVAILABLE');
          if (decrypted.shouldReEncrypt) await save(decrypted.result);
          return decrypted.result;
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw new UpdateError('CREDENTIALS_UNAVAILABLE');
        }
      });
    },
    setToken(token) {
      return serialize(async () => {
        if (!validToken(token)) throw new UpdateError('INVALID_TOKEN');
        try { await save(token); } catch { throw new UpdateError('CREDENTIALS_UNAVAILABLE'); }
      });
    },
    clear() {
      return serialize(async () => {
        try { await secureDirectory(); await fs.unlink(file); }
        catch (error) { if (error.code !== 'ENOENT') throw new UpdateError('CREDENTIALS_UNAVAILABLE'); }
      });
    },
  };
}
module.exports = { validToken, createUpdateCredentials };
