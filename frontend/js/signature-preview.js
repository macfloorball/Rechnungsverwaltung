import { getDocument, GlobalWorkerOptions } from '../vendor/pdfjs/pdf.mjs';
import { signatureLayout, boundedLayout, gestureLayout, layoutControls, signatureRequest } from './signatures.js';
GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

// The editor renders the actual ReportLab PDF. CSS dimensions are mapped to A4
// millimetres; device pixels and preview zoom never enter persisted coordinates.
export class SignaturePreview {
  constructor(host, changed) {
    this.changed = changed;
    this.root = document.createElement('section'); this.root.className = 'signature-preview-editor';
    this.message = document.createElement('p'); this.message.setAttribute('role', 'status');
    this.controls = layoutControls(null, layout => this.update(layout));
    this.root.append(this.controls.root);
    const actions = document.createElement('div'); actions.className = 'signature-actions';
    const defaults = document.createElement('button'); defaults.type = 'button'; defaults.className = 'secondary-button'; defaults.textContent = 'Als Profilstandard speichern';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'secondary-button'; reset.textContent = 'Auf Profilstandard zurücksetzen';
    defaults.addEventListener('click', async () => {
      if (!this.signature) return;
      try { await signatureRequest('/api/organization/signature', 'PUT', signatureLayout(this.signature)); this.message.textContent = 'Position, Größe und Aktivierungsstatus als Profilstandard gespeichert.'; }
      catch (error) { this.message.textContent = error.message; }
    });
    reset.addEventListener('click', async () => {
      try {
        const standard = await signatureRequest('/api/organization/signature');
        if (standard && this.signature) this.update(signatureLayout(standard));
      } catch (error) { this.message.textContent = error.message; }
    });
    this.defaultsButton = defaults; this.resetButton = reset;
    const label = document.createElement('label'); label.textContent = 'Vorschauzoom';
    const zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = 50; zoom.max = 150; zoom.value = 100;
    zoom.addEventListener('input', () => { this.pages.style.width = `${zoom.value}%`; }); label.append(zoom);
    actions.append(defaults, reset, label); this.root.append(actions, this.message);
    const scroll = document.createElement('div'); scroll.className = 'signature-pages-scroll';
    this.pages = document.createElement('div'); this.pages.className = 'signature-pages'; scroll.append(this.pages); this.root.append(scroll); host.append(this.root);
    this.version = 0;
  }
  update(layout) {
    if (!this.signature) return;
    Object.assign(this.signature, boundedLayout(this.signature, layout));
    this.controls.set(this.signature); this.position(); this.changed(signatureLayout(this.signature));
  }
  position() {
    if (!this.overlay || !this.signature) return;
    const s = this.signature;
    this.overlay.hidden = !s.enabled;
    this.overlay.style.left = `${s.x_mm / 210 * 100}%`;
    this.overlay.style.top = `${s.y_mm / 297 * 100}%`;
    this.overlay.style.width = `${s.width_mm / 210 * 100}%`;
    this.overlay.style.height = `${(s.width_mm * s.image_height / s.image_width + 7) / 297 * 100}%`;
    const svg = this.overlay.querySelector('svg');
    if (svg) {
      const imageHeight = s.width_mm * s.image_height / s.image_width;
      svg.setAttribute('viewBox', `0 0 ${s.width_mm} ${imageHeight + 7}`);
      svg.querySelector('image').setAttribute('width', s.width_mm);
      svg.querySelector('image').setAttribute('height', imageHeight);
      svg.querySelector('text').setAttribute('x', s.width_mm / 2);
      svg.querySelector('text').setAttribute('y', imageHeight + 5);
    }
  }
  async render(data) {
    const version = ++this.version;
    this.signature = data.signature;
    this.defaultsButton.disabled = this.resetButton.disabled = !this.signature;
    this.controls.set(this.signature);
    this.message.textContent = data.layout.collision ? 'Warnung: Unterschrift oder Name überschneiden sich möglicherweise mit Rechnungsinhalten. Bitte Position ändern.' : `PDF-Vorschau: ${data.layout.pages} Seite(n). Unterschrift auf der letzten Seite.`;
    const bytes = Uint8Array.from(atob(data.pdf_base64), char => char.charCodeAt(0));
    const loadingTask = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false,
      standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href });
    const pdf = await loadingTask.promise;
    if (version !== this.version) { await loadingTask.destroy(); return; }
    this.pages.replaceChildren(); this.overlay = null;
    try {
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1.5 });
        const wrapper = document.createElement('div'); wrapper.className = 'signature-page';
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); canvas.setAttribute('aria-label', `Rechnung Seite ${number}`);
        wrapper.append(canvas); this.pages.append(wrapper);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (version !== this.version) return;
        if (number === pdf.numPages && this.signature) {
          const overlay = document.createElement('div'); overlay.className = 'signature-overlay'; overlay.tabIndex = 0;
          overlay.setAttribute('role', 'group'); overlay.setAttribute('aria-label', 'Unterschrift und Name verschieben. Pfeiltasten bewegen um einen Millimeter.');
          const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'signature-resize'; handle.setAttribute('aria-label', 'Unterschrift proportional vergrößern oder verkleinern');
          overlay.append(handle); wrapper.append(overlay); this.overlay = overlay; this.position();
          let background = null;
          if (data.background_pdf_base64) {
            const backgroundTask = getDocument({ data: Uint8Array.from(atob(data.background_pdf_base64), char => char.charCodeAt(0)),
              isEvalSupported: false, useSystemFonts: false,
              standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href });
            try {
              const backgroundPdf = await backgroundTask.promise;
              const backgroundPage = await backgroundPdf.getPage(backgroundPdf.numPages);
              background = document.createElement('canvas'); background.width = canvas.width; background.height = canvas.height;
              await backgroundPage.render({ canvasContext: background.getContext('2d'), viewport }).promise;
            } finally { await backgroundTask.destroy(); }
          }
          let drag = null;
          overlay.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault(); overlay.setPointerCapture(event.pointerId);
            if (background) canvas.getContext('2d').drawImage(background, 0, 0);
            overlay.classList.add('moving');
            drag = { x: event.clientX, y: event.clientY, rect: wrapper.getBoundingClientRect(), pointerId: event.pointerId, layout: signatureLayout(this.signature), resize: event.target === handle };
          });
          overlay.addEventListener('pointermove', event => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            Object.assign(this.signature, gestureLayout(this.signature, drag, event.clientX, event.clientY));
            this.controls.set(this.signature); this.position();
            this.message.textContent = 'Position geändert – PDF-Prüfung folgt nach dem Loslassen.';
          });
          const finish = () => { if (!drag) return; drag = null; this.changed(signatureLayout(this.signature)); };
          for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) overlay.addEventListener(name, finish);
          overlay.addEventListener('keydown', event => {
            const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const delta = directions[event.key]; if (!delta) return;
            event.preventDefault(); const layout = signatureLayout(this.signature);
            if (event.target === handle) layout.width_mm += delta[0] || delta[1];
            else { layout.x_mm += delta[0]; layout.y_mm += delta[1]; }
            this.update(layout);
          });
          // The PDF already contains the signature. This transparent interactive
          // image is visible only while moving, avoiding a duplicate at rest.
          const ns = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(ns, 'svg');
          const s = this.signature;
          const imageHeight = s.width_mm * s.image_height / s.image_width;
          svg.setAttribute('viewBox', `0 0 ${s.width_mm} ${imageHeight + 7}`);
          svg.setAttribute('aria-hidden', 'true');
          const image = document.createElementNS(ns, 'image');
          image.setAttribute('href', `data:image/png;base64,${s.data_base64}`);
          image.setAttribute('width', s.width_mm); image.setAttribute('height', imageHeight);
          const name = document.createElementNS(ns, 'text'); name.textContent = s.name;
          name.setAttribute('x', s.width_mm / 2); name.setAttribute('y', imageHeight + 5);
          name.setAttribute('text-anchor', 'middle'); name.setAttribute('font-size', 11 * 25.4 / 72);
          name.setAttribute('font-family', 'SignatureHelvetica, Arial, sans-serif');
          svg.append(image, name); overlay.prepend(svg);
        }
      }
    } finally { await loadingTask.destroy(); }
  }
}

export function initializeSavedSignatures() {
  document.addEventListener('edit-invoice-signature', async event => {
    const dialog = document.createElement('dialog'); dialog.className = 'signature-dialog';
    const heading = document.createElement('h3'); heading.textContent = 'Gespeicherte Rechnungsunterschrift bearbeiten';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const save = document.createElement('button'); save.type = 'button'; save.className = 'primary-button'; save.textContent = 'PDF ausdrücklich neu erstellen'; save.disabled = true;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'secondary-button'; close.textContent = 'Abbrechen';
    dialog.append(heading, status); document.body.append(dialog);
    let current = null, expected = null, saving = false, version = 0;
    const id = event.detail;
    const editor = new SignaturePreview(dialog, async layout => {
      const requestVersion = ++version; save.disabled = true;
      try {
        const preview = await signatureRequest(`/api/invoices/${id}/signature/preview`, 'POST', layout);
        if (requestVersion !== version || !dialog.open) return;
        await editor.render(preview);
        if (requestVersion !== version) return;
        current = layout; save.disabled = false; status.textContent = '';
      } catch (error) { if (requestVersion === version) status.textContent = error.message; }
    });
    dialog.append(save, close); dialog.showModal();
    close.addEventListener('click', () => { if (!saving) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => { version++; dialog.remove(); });
    save.addEventListener('click', async () => {
      if (!current || saving || save.disabled) return;
      saving = true; save.disabled = close.disabled = true;
      try {
        await signatureRequest(`/api/invoices/${id}/signature`, 'PUT', { ...current, expected_pdf_path: expected });
        document.dispatchEvent(new Event('invoice-created')); dialog.close();
      } catch (error) { status.textContent = error.message; }
      finally { saving = false; save.disabled = close.disabled = false; }
    });
    try {
      const data = await signatureRequest(`/api/invoices/${id}/signature`);
      if (!dialog.open) return;
      if (!data.signature) throw new Error('Diese Bestandsrechnung besitzt keine gespeicherte Unterschrift. Das Original bleibt erhalten.');
      expected = data.pdf_path; current = signatureLayout(data.signature);
      const preview = await signatureRequest(`/api/invoices/${id}/signature/preview`, 'POST', current);
      if (!dialog.open) return;
      await editor.render(preview); save.disabled = false;
    } catch (error) { status.textContent = error.message; }
  });
}
