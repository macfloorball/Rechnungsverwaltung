// The profile is fixed for this document's lifetime. A switch replaces the
// document, which also discards dialogs, caches and late response callbacks.
let activeId = 1;
let pendingWrites = 0;
let switching = false;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* session remains usable */ } },
};

export function profileUrl(url) {
  const result = new URL(url, location.href);
  result.searchParams.set('profile_id', String(activeId));
  return result.pathname + result.search;
}

export async function profileFetch(url, options = {}) {
  if (switching) throw new Error('Profilwechsel läuft. Bitte warten.');
  const method = (options.method || 'GET').toUpperCase();
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (writing) pendingWrites++;
  try {
    const headers = new Headers(options.headers);
    headers.set('X-Profile-ID', String(activeId));
    return await window.fetch(url, { ...options, method, headers });
  } finally {
    if (writing) pendingWrites--;
  }
}

export async function initializeProfiles() {
  const select = document.querySelector('#active-profile');
  const message = document.querySelector('#profile-message');
  const createButton = document.querySelector('#create-profile');
  const renameButton = document.querySelector('#rename-profile');
  const main = document.querySelector('#main-content');
  const navigation = document.querySelector('.app-navigation');
  select.disabled = createButton.disabled = renameButton.disabled = true;
  main.hidden = navigation.hidden = true;
  try {
    const response = await window.fetch('/api/profiles', { cache: 'no-store' });
    if (!response.ok) throw new Error('Profile konnten nicht geladen werden. Bitte App neu laden.');
    const profiles = await response.json();
    if (!profiles.length) throw new Error('Keine Profile vorhanden. Datenbank prüfen.');
    const remembered = Number(storage.get('ttc.activeProfile'));
    activeId = profiles.some(profile => profile.id === remembered) ? remembered : profiles[0].id;
    storage.set('ttc.activeProfile', activeId);
    select.replaceChildren(...profiles.map(profile => new Option(profile.name, String(profile.id))));
    select.value = String(activeId);
    message.textContent = '';
    select.disabled = createButton.disabled = renameButton.disabled = false;
    main.hidden = navigation.hidden = false;
  } catch (error) {
    message.textContent = 'Profile konnten nicht geladen werden. Bitte App neu laden.';
    return false;
  }

  select.addEventListener('change', () => {
    const requested = select.value;
    select.value = String(activeId);
    if (editing || pendingWrites) {
      message.textContent = 'Speicherung läuft. Bitte vor dem Profilwechsel warten.';
      select.focus();
      return;
    }
    if (!window.confirm('Profil wechseln? Ungespeicherte Eingaben und offene Dialoge werden verworfen. Gespeicherte Daten bleiben erhalten.')) return;
    switching = true;
    select.disabled = createButton.disabled = renameButton.disabled = true;
    storage.set('ttc.activeProfile', requested);
    // Reload is an isolation boundary: no callback from the old document can
    // update the new profile. Already started requests retain their profile ID.
    location.reload();
  });

  const dialog = document.querySelector('#profile-name-dialog');
  const form = document.querySelector('#profile-name-form');
  const input = document.querySelector('#profile-name');
  const title = document.querySelector('#profile-name-title');
  const errorMessage = document.querySelector('#profile-name-error');
  const save = document.querySelector('#save-profile-name');
  const cancel = document.querySelector('#cancel-profile-name');
  let editing = null;
  let saving = false;

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = !message;
  }
  function lock(locked) {
    createButton.disabled = renameButton.disabled = select.disabled = locked;
  }
  function editProfile(create, trigger) {
    if (editing || switching || saving) return;
    try {
      editing = { create, id: Number(select.value), trigger };
      form.reset();
      showError('');
      title.textContent = create ? 'Neues Profil' : 'Profil umbenennen';
      save.textContent = create ? 'Profil anlegen' : 'Speichern';
      input.value = create ? '' : select.selectedOptions[0].textContent;
      lock(true);
      dialog.showModal();
      input.focus();
      if (!create) input.select();
    } catch (error) {
      editing = null;
      lock(false);
      message.textContent = 'Profildialog konnte nicht geöffnet werden. Bitte erneut versuchen.';
    }
  }
  dialog.addEventListener('cancel', event => {
    if (saving) event.preventDefault();
  });
  cancel.addEventListener('click', () => { if (!saving) dialog.close(); });
  dialog.addEventListener('close', () => {
    const trigger = editing?.trigger;
    editing = null;
    form.reset();
    showError('');
    lock(false);
    trigger?.focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!editing || saving) return;
    const name = input.value.trim();
    if (!name || name.length > 100) {
      showError('Bitte einen Profilnamen mit 1 bis 100 Zeichen eingeben.');
      input.focus();
      return;
    }
    const target = editing;
    saving = true;
    save.disabled = cancel.disabled = input.disabled = true;
    form.setAttribute('aria-busy', 'true');
    showError('');
    try {
      const response = await profileFetch(target.create ? '/api/profiles' : `/api/profiles/${target.id}`, {
        method: target.create ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('Profil konnte nicht gespeichert werden. Bitte erneut versuchen.');
      const profile = await response.json();
      if (target.create) select.add(new Option(profile.name, String(profile.id)));
      else {
        const option = Array.from(select.options).find(option => Number(option.value) === target.id);
        if (option) option.textContent = profile.name;
      }
      message.textContent = target.create ? 'Leeres Profil angelegt. Zum Wechseln oben auswählen.' : 'Profil umbenannt.';
      dialog.close();
    } catch (error) {
      showError('Profil konnte nicht gespeichert werden. Bitte erneut versuchen.');
    } finally {
      saving = false;
      save.disabled = cancel.disabled = input.disabled = false;
      form.removeAttribute('aria-busy');
      if (dialog.open) input.focus();
    }
  });
  createButton.addEventListener('click', () => editProfile(true, createButton));
  renameButton.addEventListener('click', () => editProfile(false, renameButton));
  return true;
}
