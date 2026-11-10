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
  const period = new Date(Date.UTC(data.year, data.month - 1, 1));
  elements.periodTitle.textContent =
    `Rechnung für die Übungsleitung im Zeitraum ${monthFormatter.format(period)}`;
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

  elements.total.textContent = currencyFormatter.format(data.total_amount_cents / 100);
  elements.empty.hidden = data.items.length > 0;
  elements.preview.hidden = false;
}

export function initializeInvoicePreview() {
  const form = document.querySelector("#invoice-preview-form");
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

  let previewPeriod = null;
  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  monthInput.addEventListener("input", () => {
    previewPeriod = null;
    errorMessage.hidden = true;
    preview.hidden = true;
    createButton.disabled = true;
    createError.hidden = true;
    openPdfLink.hidden = true;
    downloadPdfLink.hidden = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      return;
    }

    const match = monthInput.value.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      errorMessage.textContent = "Bitte wähle einen gültigen Abrechnungsmonat.";
      errorMessage.hidden = false;
      return;
    }

    errorMessage.hidden = true;
    createError.hidden = true;
    loadingMessage.hidden = false;
    preview.hidden = true;
    openPdfLink.hidden = true;
    downloadPdfLink.hidden = true;
    previewPeriod = null;
    submitButton.disabled = true;
    monthInput.disabled = true;
    createButton.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/invoices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: Number(match[1]),
          month: Number(match[2]),
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
      renderPreview(data, {
        preview,
        periodTitle,
        items,
        total,
        empty,
      });
      previewPeriod = {
        year: Number(match[1]),
        month: Number(match[2]),
      };
      createButton.disabled = data.items.length === 0;
      loadingMessage.hidden = true;
    } catch (error) {
      loadingMessage.hidden = true;
      errorMessage.textContent = error instanceof Error
        ? error.message
        : "Rechnungsvorschau konnte nicht geladen werden.";
      errorMessage.hidden = false;
    } finally {
      submitButton.disabled = false;
      monthInput.disabled = false;
      form.setAttribute("aria-busy", "false");
    }
  });

  createButton.addEventListener("click", async () => {
    if (!previewPeriod || createButton.disabled) {
      return;
    }

    createError.hidden = true;
    createButton.disabled = true;
    try {
      const today = new Date();
      const invoiceDate = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0"),
      ].join("-");
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...previewPeriod, invoice_date: invoiceDate }),
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
      const pdfUrl = `/api/invoices/${invoice.id}/pdf`;
      openPdfLink.href = pdfUrl;
      openPdfLink.hidden = false;
      downloadPdfLink.href = pdfUrl;
      const year = String(invoice.year).padStart(4, "0");
      const month = String(invoice.month).padStart(2, "0");
      downloadPdfLink.download = `Rechnung_TTC_${year}-${month}.pdf`;
      downloadPdfLink.hidden = false;
    } catch (error) {
      createError.textContent = error instanceof Error
        ? error.message
        : "Rechnung konnte nicht erstellt werden.";
      createError.hidden = false;
      createButton.disabled = false;
    }
  });
}