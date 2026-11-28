import { currentProfileId } from './profiles.js';
export function initializeExportFolder() {
  const api = window.ttcDesktop;
  if (!api?.getInvoiceExportFolder) return;
  const section = document.querySelector('#invoice-export-folder');
  const message = document.querySelector('#invoice-export-path');
  const choose = document.querySelector('#choose-invoice-export');
  const clear = document.querySelector('#clear-invoice-export');
  section.hidden = false;
  async function run(method) {
    choose.disabled = clear.disabled = true;
    try {
      const result = await api[method](currentProfileId());
      if (!result.ok) throw new Error(result.error.message);
      message.textContent = result.value || 'Kein eigener Zielordner. Es gelten die normalen Download-Einstellungen.';
    } catch (error) { message.textContent = error.message || 'Zielordner konnte nicht gespeichert werden.'; }
    finally { choose.disabled = clear.disabled = false; }
  }
  choose.addEventListener('click', () => run('chooseInvoiceExportFolder'));
  clear.addEventListener('click', () => run('clearInvoiceExportFolder'));
  run('getInvoiceExportFolder');
}
