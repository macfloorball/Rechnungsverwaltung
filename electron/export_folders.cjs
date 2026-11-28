'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { invoicePDFURL } = require('./browser-links.cjs');

function createExportFolders({ directory, dialog, getWindow }) {
  const file = path.join(directory, 'invoice-export-folders.json');
  const read = () => {
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data?.formatVersion === 1 && data.profiles && typeof data.profiles === 'object' ? data.profiles : {}; }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const validProfile = (id) => Number.isSafeInteger(id) && id > 0;
  function get(id) {
    if (!validProfile(id)) throw Error('Invalid profile');
    return read()[id] || '';
  }
  function save(id, value) {
    if (!validProfile(id)) throw Error('Invalid profile');
    const profiles = read();
    if (value) profiles[id] = value; else delete profiles[id];
    fs.mkdirSync(directory, { recursive: true });
    const temp = file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify({ formatVersion: 1, profiles }), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
    finally { fs.rmSync(temp, { force: true }); }
    return value;
  }
  async function choose(id) {
    const previous = get(id);
    const result = await dialog.showOpenDialog(getWindow(), { title: 'PDF-Zielordner für dieses Profil', defaultPath: previous || undefined, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths.length) return previous;
    const folder = result.filePaths[0];
    if (!path.isAbsolute(folder) || !fs.statSync(folder).isDirectory()) throw Error('Invalid directory');
    fs.accessSync(folder, fs.constants.W_OK);
    return save(id, folder);
  }
  function attach(window, frontendURL) {
    const session = window.webContents.session;
    const handler = (event, item, contents) => {
      if (contents !== window.webContents) return;
      const validated = invoicePDFURL(item.getURL(), frontendURL);
      if (!validated) return;
      const id = Number(new URL(validated).searchParams.get('profile_id'));
      if (!validProfile(id)) return;
      try {
        const folder = get(id);
        if (!folder) return;
        if (!fs.statSync(folder).isDirectory()) throw Error('Missing directory');
        fs.accessSync(folder, fs.constants.W_OK);
        const name = path.basename(item.getFilename()).replace(/[^\p{L}\p{N}_. -]/gu, '_');
        const stem = name.replace(/\.pdf$/i, '') || 'Rechnung';
        // Every export is a new copy; never overwrite an earlier invoice.
        const target = path.join(folder, `${stem}-${randomUUID()}.pdf`);
        item.setSavePath(target);
        item.once('done', (_event, state) => {
          if (state !== 'completed' && !window.isDestroyed()) dialog.showMessageBox(window, { type: 'error', message: 'PDF konnte nicht vollständig im Zielordner gespeichert werden. Bitte den Download erneut versuchen.' }).catch(() => {});
        });
      } catch {
        event.preventDefault();
        dialog.showMessageBox(window, { type: 'error', message: 'PDF-Zielordner nicht verfügbar. Bitte unter Rechnung konfigurieren einen erreichbaren Ordner wählen oder den Zielordner zurücksetzen.' }).catch(() => {});
      }
    };
    session.on('will-download', handler);
    window.once('closed', () => session.removeListener('will-download', handler));
  }
  return { get, choose, clear: (id) => save(id, ''), attach };
}
module.exports = { createExportFolders };
