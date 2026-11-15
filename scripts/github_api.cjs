'use strict';
const { createHash } = require('node:crypto');

class GitHubError extends Error {
  constructor(status) { super(`GitHub-Anfrage fehlgeschlagen (HTTP ${status}).`); this.status = status; }
}

function githubAPI(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token.trim()) throw Error('GitHub-Token fehlt.');
  async function request(method, route, { body, upload = false } = {}) {
    if (!route.startsWith('/repos/') || route.includes('\n') || route.startsWith('//')) throw Error('Ungültige GitHub-API-Route.');
    const response = await fetchImpl(`https://${upload ? 'uploads' : 'api'}.github.com${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(upload ? 180000 : 30000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': upload ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
    });
    if (!response.ok) throw new GitHubError(response.status);
    const raw = await response.text();
    if (raw.length > 10000000) throw Error('GitHub-Antwort ist zu groß.');
    return raw ? JSON.parse(raw) : null;
  }
  async function pages(route, field = null) {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const data = await request('GET', `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = field ? data[field] : data;
      if (!Array.isArray(items)) throw Error('Ungültige GitHub-Liste.');
      all.push(...items);
      if (items.length < 100) return all;
    }
    throw Error('GitHub-Liste überschreitet das sichere Seitenlimit.');
  }
  async function verifyAsset(repository, asset, expected) {
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0) throw Error('Ungültige Asset-ID.');
    let url = `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`;
    let authorization = true;
    for (let hop = 0; hop < 6; hop++) {
      const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(180000),
        headers: authorization ? { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' } : {} });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location'), url);
        if (next.protocol !== 'https:' || next.username || next.password || next.hash
            || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) {
          throw Error('Nicht erlaubte GitHub-Downloadumleitung.');
        }
        // API credentials never follow redirects onto the asset CDN.
        authorization = false;
        url = next.href;
        await response.body?.cancel();
        continue;
      }
      if (!response.ok || !response.body) throw new GitHubError(response.status);
      let size = 0;
      const digest = createHash('sha256');
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > expected.size) throw Error('Uploadprüfung: Asset ist größer als erwartet.');
        digest.update(chunk);
      }
      if (size !== expected.size || digest.digest('hex') !== expected.sha256) throw Error('Uploadprüfung: Asset-Prüfsumme stimmt nicht überein.');
      return;
    }
    throw Error('Zu viele GitHub-Downloadumleitungen.');
  }
  return { request, pages, verifyAsset };
}
module.exports = { GitHubError, githubAPI };
