import { profileFetch as fetch } from './profiles.js';

export function initializeProfileArchive() {
  const list = document.querySelector('#archived-profiles-list');
  const invoices = document.querySelector('#archived-profile-invoices');
  const message = document.querySelector('#archived-profiles-message');
  const reload = document.querySelector('#reload-archived-profiles');
  let version = 0;
  async function read(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Archiv konnte nicht geladen werden.');
    return result;
  }
  async function show(profile) {
    const requestVersion = ++version;
    message.textContent = 'Rechnungen werden geladen …'; invoices.replaceChildren();
    try {
      const rows = await read(`/api/archived-profiles/${profile.id}/invoices`);
      if (requestVersion !== version) return;
      message.textContent = `${profile.name}: ${rows.length} archivierte Rechnung(en). Schreibgeschützt.`;
      for (const invoice of rows) {
        const row = document.createElement('p'); row.className = 'invoice-history-actions';
        const description = document.createElement('span');
        description.textContent = `${invoice.year}-${String(invoice.month).padStart(2, '0')} · ${invoice.invoice_number || 'ohne Nummer'} · ${new Intl.NumberFormat('de-DE', {style:'currency',currency:'EUR'}).format(invoice.total_amount_cents / 100)} `;
        row.append(description);
        if (invoice.pdf_path) {
          const url = `/api/archived-profiles/${profile.id}/invoices/${invoice.id}/pdf`;
          const open = document.createElement('a'); open.href = url; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Archivierte Rechnung öffnen';
          const download = document.createElement('a'); download.href = url; download.download = `Rechnung_${invoice.year}-${String(invoice.month).padStart(2,'0')}.pdf`; download.textContent = 'PDF herunterladen';
          row.append(open, download);
        } else {
          const missing = document.createElement('span'); missing.textContent = 'Kein gespeichertes PDF vorhanden.'; row.append(missing);
        }
        invoices.append(row);
      }
    } catch (error) { if (requestVersion === version) message.textContent = error.message; }
  }
  async function load() {
    const requestVersion = ++version;
    reload.disabled = true; message.textContent = 'Archiv wird geladen …';
    list.replaceChildren(); invoices.replaceChildren();
    try {
      const profiles = await read('/api/archived-profiles');
      if (requestVersion !== version) return;
      message.textContent = profiles.length ? 'Ein gelöschtes Profil auswählen.' : 'Keine gelöschten Profile im Archiv.';
      for (const profile of profiles) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
        button.textContent = `${profile.name} (${profile.invoices} Rechnung(en))`;
        button.addEventListener('click', () => show(profile)); list.append(button);
      }
    } catch (error) { if (requestVersion === version) message.textContent = error.message; }
    finally { reload.disabled = false; }
  }
  reload.addEventListener('click', load); load();
}
