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
        new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(item.hours),
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
  const periodTitle = document.querySelector("#invoice-period-title");
  const items = document.querySelector("#invoice-items");
  const total = document.querySelector("#invoice-total");
  const empty = document.querySelector("#invoice-empty");

  if (
    !(form instanceof HTMLFormElement)
    || !(monthInput instanceof HTMLInputElement)
    || !(submitButton instanceof HTMLButtonElement)
    || !(preview instanceof HTMLElement)
    || !(errorMessage instanceof HTMLElement)
    || !(periodTitle instanceof HTMLElement)
    || !(items instanceof HTMLTableSectionElement)
    || !(total instanceof HTMLTableCellElement)
    || !(empty instanceof HTMLElement)
  ) {
    throw new Error("Elemente für die Rechnungsvorschau fehlen im HTML.");
  }

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

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
    submitButton.disabled = true;
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
          if (typeof body.detail === "string") {
            detail = body.detail;
          }
        } catch {
          // Keep the HTTP error when the server response is not JSON.
        }
        throw new Error(detail);
      }

      renderPreview(await response.json(), {
        preview,
        periodTitle,
        items,
        total,
        empty,
      });
    } catch (error) {
      errorMessage.textContent = error instanceof Error
        ? error.message
        : "Rechnungsvorschau konnte nicht geladen werden.";
      errorMessage.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });
}