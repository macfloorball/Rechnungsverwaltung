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
    if (pendingWrites) {
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

  async function editProfile(create) {
    const name = window.prompt(create ? 'Name des neuen Profils' : 'Neuer Profilname', create ? '' : select.selectedOptions[0].textContent);
    if (name === null) return;
    if (!name.trim() || name.trim().length > 100) {
      message.textContent = 'Bitte einen Profilnamen mit 1 bis 100 Zeichen eingeben.';
      return;
    }
    createButton.disabled = renameButton.disabled = select.disabled = true;
    try {
      const response = await profileFetch(create ? '/api/profiles' : `/api/profiles/${activeId}`, {
        method: create ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) throw new Error('Profil konnte nicht gespeichert werden. Bitte erneut versuchen.');
      const profile = await response.json();
      if (create) select.add(new Option(profile.name, String(profile.id)));
      else select.selectedOptions[0].textContent = profile.name;
      message.textContent = create ? 'Leeres Profil angelegt. Zum Wechseln oben auswählen.' : 'Profil umbenannt.';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      createButton.disabled = renameButton.disabled = select.disabled = false;
      select.focus();
    }
  }
  createButton.addEventListener('click', () => editProfile(true));
  renameButton.addEventListener('click', () => editProfile(false));
  return true;
}
