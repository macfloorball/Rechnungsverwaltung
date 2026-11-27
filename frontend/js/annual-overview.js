import { profileFetch } from './profiles.js';

export function initializeAnnualOverview() {
  const year = document.querySelector('#annual-year');
  const message = document.querySelector('#annual-message');
  const table = document.querySelector('#annual-table');
  const buttons = ['pdf', 'csv'].map(format => document.querySelector(`#annual-${format}`));
  const currentYear = new Date().getFullYear();
  year.add(new Option(String(currentYear), String(currentYear)));
  let revision = 0;
  const money = cents => `${(Math.floor(cents / 100)).toLocaleString('de-DE')},${String(cents % 100).padStart(2, '0')} €`;
  async function load() {
    const request = ++revision;
    buttons.forEach(button => { button.disabled = true; });
    table.hidden = true;
    message.textContent = 'Jahresübersicht wird geladen …';
    try {
      const response = await profileFetch(`/api/annual-overview/${year.value}`);
      if (!response.ok) throw Error('Jahresübersicht konnte nicht geladen werden. Bitte erneut versuchen.');
      const data = await response.json();
      if (request !== revision) return;
      const selected = year.value;
      year.replaceChildren(...[...new Set([currentYear, ...data.years])].sort((a,b) => b-a).map(value => new Option(String(value), String(value))));
      year.value = selected;
      document.querySelector('#annual-months').replaceChildren(...data.months.map(month => {
        const row = document.createElement('tr');
        const name = document.createElement('th'); name.scope = 'row'; name.textContent = month.name;
        const amount = document.createElement('td'); amount.textContent = money(month.amount_cents);
        row.append(name, amount); return row;
      }));
      document.querySelector('#annual-total').textContent = money(data.total_amount_cents);
      table.hidden = false;
      message.textContent = data.invoice_count ? `${data.profile_name} · ${data.invoice_count} ${data.invoice_count === 1 ? 'endgültige Rechnung' : 'endgültige Rechnungen'}` : 'Für dieses Jahr sind keine endgültigen Rechnungen gespeichert. Alle Monatsbeträge sind 0,00 €.';
      buttons.forEach(button => { button.disabled = false; });
    } catch (error) { if (request === revision) message.textContent = error.message; }
  }
  for (const [index, format] of ['pdf', 'csv'].entries()) {
    buttons[index].addEventListener('click', async () => {
      const request = revision;
      const selected = year.value;
      buttons[index].disabled = true;
      try {
        const response = await profileFetch(`/api/annual-overview/${selected}/${format}`);
        if (!response.ok) throw Error('Export fehlgeschlagen. Bitte erneut versuchen.');
        const blob = await response.blob();
        if (request !== revision) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `Jahresuebersicht-${selected}.${format}`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) { if (request === revision) message.textContent = error.message; }
      finally { if (request === revision) buttons[index].disabled = false; }
    });
  }
  year.addEventListener('change', load);
  document.querySelector('#annual-reload').addEventListener('click', load);
  document.querySelector('[data-view-link=annual]').addEventListener('click', load);
  document.addEventListener('invoice-created', load);
  document.addEventListener('invoice-numbering-changed', load);
  load();
}
