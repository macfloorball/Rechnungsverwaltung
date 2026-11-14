'use strict';
const { UpdateError } = require('./update_manifest.cjs');

async function readLimited(response, maximum) {
  if (!response.body || Number(response.headers.get('content-length')) > maximum) throw new UpdateError('INVALID_METADATA');
  const parts = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new UpdateError('INVALID_METADATA');
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

function createUpdateTransport({ config, token, signal, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${config.repository}`;
  const headers = (binary, authenticated = true) => ({
    Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
    'User-Agent': 'TTC-Desktop-Updater', 'X-GitHub-Api-Version': '2022-11-28',
    ...(token && authenticated ? { Authorization: `Bearer ${token}` } : {}),
  });
  function checkResponse(response) {
    if ([403, 429].includes(response.status) && (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0'
        || response.headers.has('retry-after'))) throw new UpdateError('RATE_LIMIT');
    if ([401, 403, 404].includes(response.status) && config.visibility === 'private') throw new UpdateError('AUTH_REQUIRED');
    if (!response.ok) throw new UpdateError('NETWORK');
  }
  async function json(url) {
    const response = await fetchImpl(url, { method: 'GET', headers: headers(false), signal, redirect: 'error', credentials: 'omit' });
    checkResponse(response);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimited(response, 5 * 1024 * 1024))); }
    catch (error) { if (error instanceof UpdateError || signal.aborted) throw error; throw new UpdateError('INVALID_METADATA'); }
  }
  async function repository() {
      const repo = await json(base);
      if (repo.id !== config.repositoryId || repo.full_name !== config.repository || repo.archived
          || repo.private !== (config.visibility === 'private')) throw new UpdateError('SOURCE_CHANGED');
  }
  async function assetResponse(id) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new UpdateError('INVALID_METADATA');
      let url = `${base}/releases/assets/${id}`, authenticated = true;
      for (let hop = 0; hop < 6; hop++) {
        const response = await fetchImpl(url, { method: 'GET', headers: { ...headers(true, authenticated), 'Accept-Encoding': 'identity' }, signal, redirect: 'manual', credentials: 'omit' });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          let next;
          try { next = new URL(response.headers.get('location'), url); } catch { throw new UpdateError('UNTRUSTED_SOURCE'); }
          if (next.protocol !== 'https:' || next.username || next.password || next.hash || next.port
              || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) throw new UpdateError('UNTRUSTED_SOURCE');
          url = next.href; authenticated = false;
          continue;
        }
        try { checkResponse(response); } catch (error) { await response.body?.cancel(); throw error; }
        return response;
      }
      throw new UpdateError('UNTRUSTED_SOURCE');
  }
  return {
    async release(id) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new UpdateError('INVALID_METADATA');
      await repository();
      const release = await json(`${base}/releases/${id}`);
      if (release.id !== id) throw new UpdateError('SOURCE_CHANGED');
      return release;
    },
    async releases() {
      await repository();
      const releases = [];
      for (let page = 1; page <= 10; page++) {
        const rows = await json(`${base}/releases?per_page=100&page=${page}`);
        if (!Array.isArray(rows) || rows.length > 100) throw new UpdateError('INVALID_METADATA');
        releases.push(...rows);
        if (rows.length < 100) return releases;
      }
      throw new UpdateError('TOO_MANY_RELEASES');
    },
    async asset(id, maximum) {
      return readLimited(await assetResponse(id), maximum);
    },
    async streamAsset(id, size, consume) {
      const response = await assetResponse(id);
      let reader;
      const abort = () => { void reader?.cancel(signal.reason).catch(() => {}); };
      try {
        const length = response.headers.get('content-length');
        if (!response.body || response.status !== 200 || response.headers.has('content-range')
            || (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')
            || (length !== null && (!/^\d+$/.test(length) || Number(length) !== size))) throw new UpdateError('DOWNLOAD_SIZE');
        let received = 0;
        reader = response.body.getReader();
        signal.addEventListener('abort', abort, { once: true });
        signal.throwIfAborted();
        while (true) {
          const { done, value: chunk } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          received += chunk.length;
          if (received > size) throw new UpdateError('DOWNLOAD_SIZE');
          await consume(Buffer.from(chunk));
        }
        if (received !== size) throw new UpdateError('DOWNLOAD_SIZE');
      } finally {
        signal.removeEventListener('abort', abort);
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        else await response.body?.cancel().catch(() => {});
      }
    },
  };
}
module.exports = { createUpdateTransport, readLimited };
