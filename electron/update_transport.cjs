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
  return {
    async releases() {
      const repo = await json(base);
      if (repo.id !== config.repositoryId || repo.full_name !== config.repository || repo.archived
          || repo.private !== (config.visibility === 'private')) throw new UpdateError('SOURCE_CHANGED');
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
      if (!Number.isSafeInteger(id) || id <= 0) throw new UpdateError('INVALID_METADATA');
      let url = `${base}/releases/assets/${id}`, authenticated = true;
      for (let hop = 0; hop < 6; hop++) {
        const response = await fetchImpl(url, { method: 'GET', headers: headers(true, authenticated), signal, redirect: 'manual', credentials: 'omit' });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = new URL(response.headers.get('location'), url);
          if (next.protocol !== 'https:' || next.username || next.password || next.hash || next.port
              || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) throw new UpdateError('UNTRUSTED_SOURCE');
          await response.body?.cancel();
          url = next.href; authenticated = false;
          continue;
        }
        checkResponse(response);
        return readLimited(response, maximum);
      }
      throw new UpdateError('UNTRUSTED_SOURCE');
    },
  };
}
module.exports = { createUpdateTransport, readLimited };
