import { profileFetch as fetch } from './profiles.js';

export async function signatureRequest(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unterschrift konnte nicht verarbeitet werden. Bitte Eingaben prüfen.');
  return data;
}

export function signatureLayout(signature) {
  return Object.fromEntries(['enabled', 'x_mm', 'y_mm', 'width_mm'].map(key => [key, signature[key]]));
}

export function boundedLayout(signature, proposed) {
  const ratio = signature.image_height / signature.image_width;
  const snap = value => Math.round(value * 10) / 10;
  const floor = value => Math.floor(value * 10) / 10;
  const width = Math.max(10, Math.min(150, floor((297 - 7) / ratio), snap(proposed.width_mm)));
  const height = width * ratio + 7;
  const nameWidth = signature.name_width_mm || 0;
  const inset = Math.max(0, (nameWidth - width) / 2);
  return { enabled: proposed.enabled, width_mm: width,
    x_mm: Math.max(Math.ceil(inset * 10) / 10, Math.min(floor(210 - width - inset), snap(proposed.x_mm))),
    y_mm: Math.max(0, Math.min(floor(297 - height), snap(proposed.y_mm))) };
}

export function gestureLayout(signature, start, clientX, clientY) {
  const dx = (clientX - start.x) * 210 / start.rect.width;
  const dy = (clientY - start.y) * 297 / start.rect.height;
  const next = { ...start.layout };
  if (start.resize) next.width_mm += dx;
  else { next.x_mm += dx; next.y_mm += dy; }
  return boundedLayout(signature, next);
}

export function layoutControls(signature, changed) {
  const root = document.createElement('fieldset');
  root.className = 'signature-fields';
  const legend = document.createElement('legend'); legend.textContent = 'Unterschriftenlayout'; root.append(legend);
  const inputs = {};
  for (const [key, label, type, min, max] of [
    ['enabled', 'Unterschrift einfügen', 'checkbox'],
    ['x_mm', 'X ab linkem Seitenrand (mm)', 'number', 0, 210],
    ['y_mm', 'Y ab oberem Seitenrand (mm)', 'number', 0, 297],
    ['width_mm', 'Breite (mm)', 'number', 10, 150],
  ]) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.type = type;
    if (type === 'number') { input.min = min; input.max = max; input.step = '0.1'; }
    wrapper.append(input); root.append(wrapper); inputs[key] = input;
    input.addEventListener('input', () => {
      if (Object.values(inputs).some(item => !item.checkValidity() || (item.type === 'number' && item.value === ''))) return;
      changed(Object.fromEntries(Object.entries(inputs).map(([key, item]) => [key, item.type === 'checkbox' ? item.checked : Number(item.value)])));
    });
  }
  function set(value) {
    root.disabled = !value;
    for (const [key, input] of Object.entries(inputs)) {
      if (input.type === 'checkbox') input.checked = value?.[key] ?? false;
      else input.value = value?.[key] ?? '';
    }
  }
  set(signature);
  return { root, set };
}

export async function initializeSignatures() {
  const section = document.createElement('section');
  section.className = 'organization-settings-group';
  section.innerHTML = `<h3>Unterschrift</h3><p>Für dieses Profil lokal gespeichert. Die Unterschrift ist eine visuelle Darstellung im PDF.</p>
    <img class="signature-thumbnail" alt="Hinterlegte Unterschrift" hidden>
    <label>PNG hochladen oder ersetzen (maximal 2 MB)<input type="file" accept="image/png,.png"></label>
    <div class="signature-actions"><button type="button" class="secondary-button" data-draw>Neu zeichnen</button><button type="button" class="secondary-button" data-delete>Unterschrift löschen</button></div>
    <p role="status" class="signature-message"></p>`;
  document.querySelector('#organization-settings-form').before(section);
  const message = section.querySelector('.signature-message');
  const image = section.querySelector('img');
  let signature = null;
  let busy = false;
  const controls = layoutControls(null, layout => {
    if (!signature) return;
    signature = { ...signature, ...layout };
    message.textContent = 'Layout geändert. Bitte Profilstandard speichern.';
  });
  const saveDefaults = document.createElement('button'); saveDefaults.type = 'button';
  saveDefaults.className = 'primary-button'; saveDefaults.textContent = 'Profilstandard speichern';
  saveDefaults.addEventListener('click', () => action(async () => {
    if (signature) signature = await signatureRequest('/api/organization/signature', 'PUT', signatureLayout(signature));
  }));
  section.insertBefore(controls.root, message);
  section.insertBefore(saveDefaults, message);
  function display() {
    image.hidden = !signature;
    if (signature) image.src = `data:image/png;base64,${signature.data_base64}`;
    else image.removeAttribute('src');
    controls.set(signature);
    section.querySelector('[data-delete]').disabled = !signature;
    saveDefaults.disabled = !signature;
    document.dispatchEvent(new Event('signature-profile-updated'));
  }
  async function action(callback) {
    if (busy) return;
    busy = true; section.setAttribute('aria-busy', 'true');
    try { await callback(); display(); message.textContent = 'Unterschrift gespeichert.'; return true; }
    catch (error) { message.textContent = error.message; controls.set(signature); return false; }
    finally { busy = false; section.removeAttribute('aria-busy'); }
  }
  async function save(encoded) {
    return await action(async () => { signature = await signatureRequest('/api/organization/signature', 'POST', { data_base64: encoded }); });
  }
  section.querySelector('input[type=file]').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2_000_000 || !/\.png$/i.test(file.name)) { message.textContent = 'Bitte eine PNG-Datei mit höchstens 2 MB wählen.'; return; }
    const reader = new FileReader();
    reader.onload = () => save(reader.result.split(',')[1]);
    reader.onerror = () => { message.textContent = 'Die Datei konnte nicht gelesen werden.'; };
    reader.readAsDataURL(file); event.target.value = '';
  });
  section.querySelector('[data-delete]').addEventListener('click', () => action(async () => {
    await signatureRequest('/api/organization/signature', 'DELETE'); signature = null;
  }));
  const dialog = document.createElement('dialog'); dialog.className = 'signature-dialog';
  dialog.innerHTML = `<h3>Unterschrift zeichnen</h3><p>Mit Maus, Touchpad, Touchscreen oder Stift zeichnen.</p>
    <canvas width="1200" height="400" aria-label="Zeichenfläche für die Unterschrift"></canvas>
    <div class="signature-actions"><button type="button" class="secondary-button" data-undo>Rückgängig</button><button type="button" class="secondary-button" data-clear>Leeren</button><button type="button" class="secondary-button" data-cancel>Abbrechen</button><button type="button" class="secondary-button" data-save>Unterschrift speichern</button></div><p role="status"></p>`;
  document.body.append(dialog);
  const canvas = dialog.querySelector('canvas'); const ctx = canvas.getContext('2d');
  let strokes = [], stroke = null, activePointer = null;
  function paint() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 4; ctx.lineCap = ctx.lineJoin = 'round';
    for (const points of strokes) {
      ctx.beginPath(); ctx.moveTo(...points[0]);
      if (points.length === 1) { ctx.arc(...points[0], 2, 0, Math.PI * 2); ctx.fill(); }
      else { for (const point of points.slice(1)) ctx.lineTo(...point); ctx.stroke(); }
    }
  }
  function point(event) { const box = canvas.getBoundingClientRect(); return [(event.clientX - box.left) * canvas.width / box.width, (event.clientY - box.top) * canvas.height / box.height]; }
  canvas.addEventListener('pointerdown', event => { if (busy || stroke || (event.pointerType === 'mouse' && event.button !== 0)) return; event.preventDefault(); canvas.setPointerCapture(event.pointerId); activePointer = event.pointerId; stroke = [point(event)]; strokes.push(stroke); paint(); });
  canvas.addEventListener('pointermove', event => { if (!stroke || activePointer !== event.pointerId) return; stroke.push(point(event)); paint(); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => { if (event.pointerId === activePointer) { stroke = null; activePointer = null; } });
  section.querySelector('[data-draw]').addEventListener('click', () => { if (busy) return; strokes = []; stroke = null; paint(); dialog.querySelector('p[role=status]').textContent = ''; dialog.showModal(); });
  dialog.querySelector('[data-undo]').addEventListener('click', () => { strokes.pop(); paint(); });
  dialog.querySelector('[data-clear]').addEventListener('click', () => { strokes = []; paint(); });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.querySelector('[data-save]').addEventListener('click', async () => {
    if (!strokes.length || busy) { dialog.querySelector('p[role=status]').textContent = 'Bitte zuerst eine Unterschrift zeichnen.'; return; }
    const points = strokes.flat();
    const minX = points.reduce((v,p) => Math.min(v,p[0]), Infinity), maxX = points.reduce((v,p) => Math.max(v,p[0]), 0);
    const minY = points.reduce((v,p) => Math.min(v,p[1]), Infinity), maxY = points.reduce((v,p) => Math.max(v,p[1]), 0);
    const left = Math.max(0, Math.floor(minX - 5)), top = Math.max(0, Math.floor(minY - 5));
    const cropped = document.createElement('canvas');
    cropped.width = Math.min(canvas.width - left, Math.ceil(maxX - left + 5));
    cropped.height = Math.min(canvas.height - top, Math.ceil(maxY - top + 5));
    cropped.getContext('2d').drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    const saved = await save(cropped.toDataURL('image/png').split(',')[1]);
    if (saved) dialog.close();
    else dialog.querySelector('p[role=status]').textContent = message.textContent;
  });
  try { signature = await signatureRequest('/api/organization/signature'); display(); }
  catch (error) { message.textContent = error.message; }
}
