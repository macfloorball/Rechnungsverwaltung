import { SignaturePreview } from "./signature-preview.js";
import { profileFetch as fetch, profileUrl } from "./profiles.js";
const monthFormatter = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

function createCell(tagName, text) {
  const cell = document.createElement(tagName);
  cell.textContent = text;
  return cell;
}

function formatRequestError(detail) {
  if (typeof detail === "string") {
    return detail;
  }
  if (!Array.isArray(detail)) {
    return null;
  }

  const messages = detail.flatMap((error) => {
    if (!error || typeof error.msg !== "string") {
      return [];
    }
    return [error.msg];
  });
  return messages.length > 0
    ? `Die Vorschau-Anfrage konnte nicht verarbeitet werden: ${messages.join("; ")}`
    : null;
}

function renderPreview(data, elements) {
  // Date.UTC interprets years below 100 as 1900–1999.
  const period = new Date(0);
  period.setUTCFullYear(data.year, data.month - 1, 1);
  elements.periodTitle.textContent =
    `Rechnung für die Übungsleitung im Zeitraum ${monthFormatter.format(period)}`;
  let details = document.querySelector("#invoice-preview-details");
  if (!details) {
    details = document.createElement("p");
    details.id = "invoice-preview-details";
    details.style.whiteSpace = "pre-line";
    details.style.overflowWrap = "anywhere";
    elements.periodTitle.after(details);
  }
  details.textContent = [
    data.numbering_mode === "manual" ? `Manuelle Rechnungsnummer: ${data.invoice_number}` :
      `Automatischer Vorschlag: ${data.invoice_number || "Vergabe gesperrt"} (Vergabe beim Speichern)`,
    data.numbering?.message || "",
    `Rechnungsdatum: ${data.invoice_date}`,
    data.tax_id ? `Steuer ID: ${data.tax_id}` : "",
    data.account_holder ? `Kontoinhaber: ${data.account_holder}` : "",
    data.iban ? `IBAN: ${data.iban}` : "",
    data.bic ? `BIC: ${data.bic}` : "",
    data.bank_name ? `Bank: ${data.bank_name}` : "",
  ].filter(Boolean).join("\n");
  elements.items.replaceChildren();

  for (const item of data.items) {
    const row = document.createElement("tr");
    row.append(
      createCell("th", item.description),
      createCell(
        "td",
        dateFormatter.format(new Date(`${item.training_date}T00:00:00Z`)),
      ),
      createCell(
        "td",
        item.hours === null
          ? "–"
          : new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(item.hours),
      ),
      createCell("td", currencyFormatter.format(item.amount_cents / 100)),
    );
    row.firstElementChild.scope = "row";
    elements.items.append(row);
  }

  const taxNotice = document.querySelector("#invoice-tax-notice");
  taxNotice.textContent = data.additional_tax_info || "";
  taxNotice.hidden = !taxNotice.textContent.trim();
  elements.total.textContent = currencyFormatter.format(data.total_amount_cents / 100);
  elements.empty.hidden = data.items.length > 0;
  elements.preview.hidden = false;
}

export function initializeInvoicePreview() {
  const form = document.querySelector("#invoice-preview-form");
  const dateInput = document.querySelector("#invoice-date");
  const manualNumber = document.querySelector("#manual-invoice-number");
  manualNumber.addEventListener("input", () => {
    document.querySelector("#invoice-number-mode").textContent = manualNumber.value.trim()
      ? "Manuelle Vergabe: Dein Wert hat Vorrang und wird im Backend geprüft."
      : "Automatische Vergabe: Das Backend bestimmt die nächste zulässige Nummer beim Speichern.";
    invalidatePreview();
  });
  const monthInput = document.querySelector("#invoice-month");
  const submitButton = document.querySelector("#load-invoice-preview");
  const preview = document.querySelector("#invoice-preview");
  const errorMessage = document.querySelector("#invoice-preview-error");
  const loadingMessage = document.querySelector("#invoice-preview-status");
  const periodTitle = document.querySelector("#invoice-period-title");
  const items = document.querySelector("#invoice-items");
  const total = document.querySelector("#invoice-total");
  const empty = document.querySelector("#invoice-empty");
  const createButton = document.querySelector("#create-invoice");
  const createError = document.querySelector("#invoice-create-error");
  const openPdfLink = document.querySelector("#open-invoice-pdf");
  const downloadPdfLink = document.querySelector("#download-invoice-pdf");

  if (
    !(form instanceof HTMLFormElement)
    || !(dateInput instanceof HTMLInputElement)
    || !(monthInput instanceof HTMLInputElement)
    || !(submitButton instanceof HTMLButtonElement)
    || !(preview instanceof HTMLElement)
    || !(errorMessage instanceof HTMLElement)
    || !(loadingMessage instanceof HTMLElement)
    || !(periodTitle instanceof HTMLElement)
    || !(items instanceof HTMLTableSectionElement)
    || !(total instanceof HTMLTableCellElement)
    || !(empty instanceof HTMLElement)
    || !(createButton instanceof HTMLButtonElement)
    || !(createError instanceof HTMLElement)
    || !(openPdfLink instanceof HTMLAnchorElement)
    || !(downloadPdfLink instanceof HTMLAnchorElement)
  ) {
    throw new Error("Elemente für die Rechnungsvorschau fehlen im HTML.");
  }

  let signatureOverride = null;
  let signatureTimer;
  let latestPayload = null;
  let signatureVersion = 0;
  const signatureEditor = new SignaturePreview(preview, layout => {
    signatureOverride = layout;
    clearTimeout(signatureTimer);
    createButton.disabled = true;
    const version = ++signatureVersion;
    signatureTimer = setTimeout(async () => {
      if (!latestPayload) return;
      try {
        const response = await fetch('/api/invoices/preview', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...latestPayload, signature: layout }) });
        const data = await response.json();
        if (version !== signatureVersion) return;
        if (!response.ok) throw new Error(formatRequestError(data.detail) || 'Unterschriftenlayout konnte nicht geprüft werden.');
        await signatureEditor.render(data);
        if (version !== signatureVersion) return;
        if (previewPeriod) previewPeriod.signature = layout;
        createError.hidden = true;
        createButton.disabled = !previewPeriod || !data.items.length || !data.invoice_number;
      } catch (error) { createError.textContent = error.message; createError.hidden = false; }
    }, 180);
  });
  document.addEventListener('signature-profile-updated', () => { signatureOverride = null; invalidatePreview(); });
  let requestVersion = 0;
  let previewPeriod = null;
  let creating = false;
  const createButtonLabel = createButton.textContent.trim();
  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  function invalidatePreview() {
    requestVersion += 1;
    signatureVersion += 1;
    clearTimeout(signatureTimer);
    latestPayload = null;
    loadingMessage.hidden = true;
    previewPeriod = null;
    errorMessage.hidden = true;
    preview.hidden = true;
    createButton.disabled = true;
    createButton.textContent = createButtonLabel;
    createError.hidden = true;
    openPdfLink.hidden = true;
    downloadPdfLink.hidden = true;
  }
  monthInput.addEventListener("input", invalidatePreview);
  dateInput.addEventListener("input", invalidatePreview);
  document.addEventListener("activities-updated", invalidatePreview);
  document.addEventListener("invoice-numbering-changed", invalidatePreview);
  document.addEventListener("calendar-month-changed", (event) => {
    const { year, month } = event.detail;
    monthInput.value = `${year}-${String(month).padStart(2, "0")}`;
    invalidatePreview();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (creating || !form.reportValidity()) {
      return;
    }

    const match = monthInput.value.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      errorMessage.textContent = "Bitte wähle einen gültigen Abrechnungsmonat.";
      errorMessage.hidden = false;
      return;
    }

    const version = ++requestVersion;
    errorMessage.hidden = true;
    createError.hidden = true;
    loadingMessage.hidden = false;
    preview.hidden = true;
    openPdfLink.hidden = true;
    downloadPdfLink.hidden = true;
    previewPeriod = null;
    submitButton.disabled = true;
    monthInput.disabled = true;
    dateInput.disabled = true;
    manualNumber.disabled = true;
    createButton.disabled = true;
    createButton.textContent = createButtonLabel;
    form.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/invoices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          render_pdf: true,
          signature: signatureOverride,
          year: Number(match[1]),
          month: Number(match[2]),
          invoice_date: dateInput.value,
          invoice_number: manualNumber.value.trim() || null,
        }),
      });
      if (!response.ok) {
        let detail = `Vorschau konnte nicht geladen werden (HTTP ${response.status}).`;
        try {
          const body = await response.json();
          detail = formatRequestError(body.detail) || detail;
        } catch {
          // Keep the HTTP error when the server response is not JSON.
        }
        throw new Error(detail);
      }

      const data = await response.json();
      if (version !== requestVersion) return;
      signatureEditor.root.inert = false;
      await signatureEditor.render(data);
      if (version !== requestVersion) return;
      renderPreview(data, {
        preview,
        periodTitle,
        items,
        total,
        empty,
      });
      previewPeriod = {
        signature: data.signature ? { enabled: data.signature.enabled, x_mm: data.signature.x_mm, y_mm: data.signature.y_mm, width_mm: data.signature.width_mm } : null,
        year: Number(match[1]),
        month: Number(match[2]),
        invoice_date: data.invoice_date,
        invoice_number: manualNumber.value.trim() || null,
      };
      latestPayload = { ...previewPeriod, render_pdf: true };
      createButton.disabled = data.items.length === 0 || !data.invoice_number;
      loadingMessage.hidden = true;
    } catch (error) {
      if (version !== requestVersion) return;
      loadingMessage.hidden = true;
      errorMessage.textContent = error instanceof Error
        ? error.message
        : "Rechnungsvorschau konnte nicht geladen werden.";
      errorMessage.hidden = false;
    } finally {
      submitButton.disabled = false;
      monthInput.disabled = false;
      dateInput.disabled = false;
      manualNumber.disabled = false;
      form.setAttribute("aria-busy", "false");
    }
  });

  createButton.addEventListener("click", async () => {
    if (creating || !previewPeriod || createButton.disabled) {
      return;
    }

    createError.hidden = true;
    creating = true;
    createButton.disabled = true;
    createButton.setAttribute("aria-busy", "true");
    createButton.textContent = "Rechnung wird gespeichert …";
    monthInput.disabled = true;
    dateInput.disabled = true;
    manualNumber.disabled = true;
    submitButton.disabled = true;
    const version = requestVersion;
    const period = { ...previewPeriod };
    let saved = false;
    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(period),
      });
      if (!response.ok) {
        let detail = `Rechnung konnte nicht erstellt werden (HTTP ${response.status}).`;
        try {
          const body = await response.json();
          if (typeof body.detail === "string") {
            detail = body.detail;
          }
        } catch {
          // Keep the HTTP error when the server response is not JSON.
        }
        throw new Error(detail);
      }

      const invoice = await response.json();
      document.dispatchEvent(new Event("invoice-created"));
      if (version !== requestVersion) return;
      const pdfUrl = profileUrl(`/api/invoices/${invoice.id}/pdf`);
      openPdfLink.href = pdfUrl;
      openPdfLink.hidden = false;
      downloadPdfLink.href = pdfUrl;
      const year = String(invoice.year).padStart(4, "0");
      const month = String(invoice.month).padStart(2, "0");
      downloadPdfLink.download = `Rechnung_TTC_${year}-${month}.pdf`;
      downloadPdfLink.hidden = false;
      const details = document.querySelector("#invoice-preview-details");
      if (details) details.textContent = `Gespeicherte Rechnungsnummer: ${invoice.invoice_number}\nRechnungsdatum: ${invoice.invoice_date}`;
      saved = true;
      signatureEditor.root.inert = true;
    } catch (error) {
      if (version !== requestVersion) return;
      createError.textContent = error instanceof Error
        ? error.message
        : "Rechnung konnte nicht erstellt werden.";
      createError.hidden = false;
    } finally {
      creating = false;
      createButton.setAttribute("aria-busy", "false");
      createButton.textContent = saved ? "Rechnung gespeichert" : createButtonLabel;
      // A saved preview cannot be finalized twice. A fresh preview still uses
      // the backend's existing duplicate check for an already invoiced month.
      createButton.disabled = saved || !previewPeriod;
      monthInput.disabled = false;
      dateInput.disabled = false;
      manualNumber.disabled = false;
      submitButton.disabled = false;
    }
  });
}
