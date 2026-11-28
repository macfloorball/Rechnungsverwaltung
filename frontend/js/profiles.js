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
  const deleteButton = document.querySelector('#delete-profile');
  const main = document.querySelector('#main-content');
  const navigation = document.querySelector('.app-navigation');
  select.disabled = createButton.disabled = renameButton.disabled = deleteButton.disabled = true;
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
    select.disabled = createButton.disabled = renameButton.disabled = deleteButton.disabled = false;
    main.hidden = navigation.hidden = false;
  } catch (error) {
    message.textContent = 'Profile konnten nicht geladen werden. Bitte App neu laden.';
    return false;
  }

  const switchDialog = document.querySelector('#profile-switch-dialog');
  const switchForm = document.querySelector('#profile-switch-form');
  const switchCancel = document.querySelector('#cancel-profile-switch');
  let requestedProfile = null;
  select.addEventListener('change', () => {
    const requested = select.value;
    select.value = String(activeId);
    if (requested === String(activeId) || switchDialog.open || switching) return;
    if (editing || deletion || pendingWrites) {
      message.textContent = 'Speicherung läuft. Bitte vor dem Profilwechsel warten.';
      select.focus();
      return;
    }
    requestedProfile = requested;
    message.textContent = '';
    switchDialog.showModal();
    switchCancel.focus();
  });
  switchCancel.addEventListener('click', () => switchDialog.close());
  switchDialog.addEventListener('close', () => {
    requestedProfile = null;
    if (!switching) select.focus();
  });
  switchForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!switchDialog.open || !requestedProfile || switching) return;
    // A write may have started after the confirmation was opened.
    if (editing || deletion || pendingWrites) {
      switchDialog.close();
      message.textContent = 'Speicherung läuft. Bitte vor dem Profilwechsel warten.';
      return;
    }
    switching = true;
    select.disabled = createButton.disabled = renameButton.disabled = deleteButton.disabled = true;
    storage.set('ttc.activeProfile', requestedProfile);
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
    createButton.disabled = renameButton.disabled = deleteButton.disabled = select.disabled = locked;
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
  const deleteDialog = document.querySelector('#profile-delete-dialog');
  const deleteError = document.querySelector('#profile-delete-error');
  const confirmDelete = document.querySelector('#confirm-profile-delete');
  const cancelDelete = document.querySelector('#cancel-profile-delete');
  let deletion = null;
  let deleting = false;
  deleteButton.addEventListener('click', async () => {
    if (editing || pendingWrites || switching || deletion) return;
    lock(true);
    deletion = { loading: true };
    try {
      const response = await profileFetch(`/api/profiles/${activeId}/deletion`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Löschübersicht konnte nicht geladen werden.');
      deletion = data;
      const c = data.counts;
      document.querySelector('#profile-delete-summary').textContent = `Profil „${data.name}“ aus der aktiven Auswahl entfernen: ${c.trainings} Termine, ${c.weekly_plan} Wochenplaneinträge und ${c.activity_types} Tätigkeiten sowie die Profilunterschrift werden gelöscht. Bereits fertiggestellte Rechnungen einschließlich Positionen, Unterschriftenständen und PDFs bleiben im schreibgeschützten Archiv unter Verwaltung / App-Einstellungen → Gelöschte Profile erhalten. Rechnungsvorschauen werden verworfen.`;
      deleteError.textContent = data.last_profile ? 'Das letzte Profil kann nicht gelöscht werden. Lege zuerst ein weiteres Profil an.' : '';
      confirmDelete.disabled = data.last_profile;
      deleteDialog.showModal();
      cancelDelete.focus();
    } catch (error) {
      deletion = null;
      lock(false);
      message.textContent = error.message;
    }
  });
  deleteDialog.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
  cancelDelete.addEventListener('click', () => { if (!deleting) deleteDialog.close(); });
  deleteDialog.addEventListener('close', () => { deletion = null; lock(false); deleteButton.focus(); });
  document.querySelector('#profile-delete-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!deletion || deletion.last_profile || deleting) return;
    deleting = true;
    confirmDelete.disabled = cancelDelete.disabled = true;
    try {
      const response = await profileFetch(`/api/profiles/${deletion.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deletion),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Profil konnte nicht gelöscht werden.');
      storage.set('ttc.activeProfile', result.profiles[0].id);
      if (result.retained_documents) storage.set('ttc.profileDeletionNotice', `${result.retained_documents} Dokumente konnten nicht sicher entfernt werden und bleiben in der Ablage erhalten.`);
      switching = true;
      location.reload();
    } catch (error) {
      deleteError.textContent = error.message;
      confirmDelete.disabled = cancelDelete.disabled = false;
    } finally { deleting = false; }
  });
  const notice = storage.get('ttc.profileDeletionNotice');
  if (notice) { message.textContent = notice; storage.set('ttc.profileDeletionNotice', ''); }
  return true;
}
