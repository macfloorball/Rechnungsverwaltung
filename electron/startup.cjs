'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function waitForFrontend(config, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  let buildId;
  if (config.mode === 'production') {
    try {
      await fs.access(path.join(config.buildDirectory, 'index.html'));
      ({ buildId } = JSON.parse(await fs.readFile(path.join(config.buildDirectory, 'desktop-build.json'), 'utf8')));
      if (!/^[a-f0-9]{64}$/.test(buildId)) throw Error();
    } catch {
      throw new Error('Frontend-Build fehlt oder ist ungültig. Bitte npm run frontend:build ausführen.');
    }
  }
  const deadline = Date.now() + timeoutMs;
  async function request(relative) {
    const response = await fetch(new URL(relative, config.url), {
      redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now()))),
    });
    if (!response.ok) throw Error();
    return response;
  }
  while (Date.now() < deadline) {
    try {
      const health = await (await request('/api/health')).json();
      if (health.status !== 'ok') throw Error();
      const html = await (await request('/')).text();
      if (!html.includes('js/app.js')) throw Error();
      await (await request('/js/app.js')).arrayBuffer();
      await (await request('/css/style.css')).arrayBuffer();
      if (buildId && (await (await request('/desktop-build.json')).json()).buildId !== buildId) throw Error();
      return;
    } catch {
      await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
  }
  throw new Error(config.mode === 'production'
    ? 'Lokaler Anwendungsserver oder Frontend-Build nicht erreichbar. Server ohne --reload mit TTC_FRONTEND_DIRECTORY=dist/frontend starten und Adresse prüfen.'
    : 'Entwicklungsserver oder API nicht erreichbar. Bitte den lokalen Uvicorn-Server starten und TTC_DESKTOP_URL prüfen.');
}
module.exports = { waitForFrontend };
