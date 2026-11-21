const weekdays = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
const maximumActivities = 10;
let activityRowSequence = 0;
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
const organizationFieldLabels = {
  email: "E-Mail-Adresse",
  recipient_email: "E-Mail-Adresse des Empfängers",
  iban: "IBAN",
  bic: "BIC",
  invoice_number_prefix: "Rechnungsnummern-Präfix",
  payment_due_days: "Zahlungsziel",
  logo_enabled: "Logo-Anzeige",
};

function element(tagName, text) {
  const node = document.createElement(tagName);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function formatRequestErrorDetail(detail) {
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
    const location = Array.isArray(error.loc) ? error.loc.at(-1) : null;
    const label = typeof location === "string"
      ? organizationFieldLabels[location] || location
      : "";
    return [`${label ? `${label}: ` : ""}${error.msg}`];
  });
  return messages.length > 0
    ? `Bitte prüfe deine Eingaben: ${messages.join("; ")}`
    : null;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = `Anfrage fehlgeschlagen (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      detail = formatRequestErrorDetail(body.detail) || detail;
    } catch {
      // Keep the HTTP error when the server response is not JSON.
    }
    throw new Error(detail);
  }
  return response.json();
}

function showMessage(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function buildActivityRow(activity) {
  const index = activityRowSequence++;
  const row = element("tr");
  if (activity.id !== undefined) {
    row.dataset.activityId = String(activity.id);
  }

  const nameCell = element("td");
  const nameLabel = element("label", `Tätigkeitsart ${index + 1}`);
  const nameInput = element("input");
  nameInput.type = "text";
  nameInput.id = `activity-name-${index + 1}`;
  nameInput.name = `activity-name-${index + 1}`;
  nameInput.required = true;
  nameInput.maxLength = 100;
  nameInput.value = activity.name || "";
  nameInput.autocomplete = "off";
  nameLabel.className = "visually-hidden";
  nameLabel.htmlFor = nameInput.id;
  nameCell.append(nameLabel, nameInput);

  const rateCell = element("td");
  const rateLabel = element("label", `Stundenpreis für Tätigkeitsart ${index + 1}`);
  const rateInput = element("input");
  rateInput.type = "number";
  rateInput.id = `activity-rate-${index + 1}`;
  rateInput.name = `activity-rate-${index + 1}`;
  rateInput.required = true;
  rateInput.min = "0";
  rateInput.max = "99999999.99";
  rateInput.step = "0.01";
  rateInput.inputMode = "decimal";
  rateInput.value = activity.id === undefined
    ? ""
    : (activity.hourly_rate_cents / 100).toFixed(2);
  rateLabel.className = "visually-hidden";
  rateLabel.htmlFor = rateInput.id;
  rateCell.append(rateLabel, rateInput);

  const activeCell = element("td");
  const activeLabel = element("label", "Aktiv");
  const activeInput = element("input");
  activeInput.type = "checkbox";
  activeInput.id = `activity-active-${index + 1}`;
  activeInput.name = `activity-active-${index + 1}`;
  activeInput.checked = activity.is_active === undefined ? true : Boolean(activity.is_active);
  activeLabel.className = "settings-checkbox-label";
  activeLabel.htmlFor = activeInput.id;
  activeCell.append(activeInput, activeLabel);
  const stateCell = element("td", activity.id === undefined ? "Neu – ungespeichert " : "Gespeichert");
  if (activity.id === undefined) {
    const discard = element("button", "Verwerfen");
    discard.type = "button";
    discard.addEventListener("click", () => {
      row.remove();
      updateActivityCapacity();
      document.querySelector("#add-activity").focus();
    });
    stateCell.append(discard);
  }
  row.append(nameCell, rateCell, activeCell, stateCell);
  return row;
}

function updateActivityCapacity() {
  const count = document.querySelector("#activity-settings-rows").rows.length;
  const button = document.querySelector("#add-activity");
  button.disabled = count >= maximumActivities;
  document.querySelector("#activity-capacity").textContent =
    `${count} von ${maximumActivities} Tätigkeiten${count >= maximumActivities ? " – Maximum erreicht, einschließlich deaktivierter Einträge." : ""}`;
  document.querySelector("#activity-empty").hidden = count !== 0;
}

function renderActivities(rows, activities) {
  rows.replaceChildren();
  for (const activity of activities) {
    rows.append(buildActivityRow(activity));
  }
  updateActivityCapacity();
}

// Parse decimal digits directly; no floating-point multiplication of euros.
function rateInCents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 9999999999 ? cents : null;
}

function activityOptions(activities, selectedId) {
  const options = activities.filter((activity) => activity.is_active || activity.id === selectedId).map((activity) => {
    const option = element(
      "option",
      activity.is_active ? activity.name : `${activity.name} (inaktiv)`,
    );
    option.value = String(activity.id);
    option.selected = activity.id === selectedId;
    return option;
  });
  return options;
}

function buildPlanRow(activities, entry = {}) {
  const row = element("div");
  row.className = "weekly-plan-row";
  if (entry.id !== undefined) {
    row.dataset.planId = String(entry.id);
  }

  const activitySelect = element("select");
  activitySelect.setAttribute("aria-label", "Tätigkeit");
  activitySelect.dataset.planActivity = "";
  for (const option of activityOptions(activities, entry.activity_type_id)) {
    activitySelect.append(option);
  }

  const hoursInput = element("input");
  hoursInput.type = "number";
  hoursInput.min = "1";
  hoursInput.max = "24";
  hoursInput.step = "1";
  hoursInput.value = entry.id === undefined ? "1" : String(entry.hours);
  hoursInput.setAttribute("aria-label", "Stunden");
  hoursInput.dataset.planHours = "";

  const activeLabel = element("label", "Aktiv");
  const activeInput = element("input");
  activeInput.type = "checkbox";
  activeInput.checked = entry.is_active === undefined ? true : Boolean(entry.is_active);
  activeInput.setAttribute("aria-label", "Planeintrag aktiv");
  activeInput.dataset.planActive = "";
  activeLabel.append(activeInput);

  const removeButton = element("button", "×");
  removeButton.type = "button";
  removeButton.className = "remove-plan-entry";
  removeButton.setAttribute("aria-label", "Planeintrag entfernen");
  removeButton.dataset.removePlanEntry = "";
  row.append(activitySelect, hoursInput, activeLabel, removeButton);
  return row;
}

function renderWeeklyPlan(container, activities, entries) {
  container.replaceChildren();
  for (const [weekday, label] of weekdays.entries()) {
    const day = element("section");
    day.className = "weekly-plan-day";
    day.dataset.weekday = String(weekday);
    day.append(element("h4", label));
    const dayEntries = entries.filter((entry) => entry.weekday === weekday);
    for (const entry of dayEntries) {
      day.append(buildPlanRow(activities, entry));
    }
    const addButton = element("button", "＋ Tätigkeit hinzufügen");
    addButton.type = "button";
    addButton.className = "secondary-button weekly-plan-add";
    addButton.dataset.addPlanEntry = "";
    addButton.disabled = !activities.some((activity) => activity.is_active);
    day.append(addButton);
    container.append(day);
  }
}

function renderInvoices(rows, emptyMessage, invoices) {
  rows.replaceChildren();
  emptyMessage.hidden = invoices.length > 0;

  for (const invoice of invoices) {
    const row = element("tr");
    const month = new Date(Date.UTC(invoice.year, invoice.month - 1, 1));
    row.append(
      element("td", monthFormatter.format(month)),
      element(
        "td",
        dateFormatter.format(new Date(`${invoice.invoice_date}T00:00:00Z`)),
      ),
      element("td", invoice.invoice_number || "–"),
      element("td", currencyFormatter.format(invoice.total_amount_cents / 100)),
    );

    const actions = element("td");
    actions.className = "invoice-history-actions";
    if (invoice.pdf_path) {
      const pdfUrl = `/api/invoices/${invoice.id}/pdf`;
      const openLink = element("a", "Rechnung öffnen");
      openLink.href = pdfUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener";
      const downloadLink = element("a", "PDF herunterladen");
      downloadLink.href = pdfUrl;
      downloadLink.download =
        `Rechnung_TTC_${String(invoice.year).padStart(4, "0")}-${String(invoice.month).padStart(2, "0")}.pdf`;
      actions.append(openLink, downloadLink);
    } else {
      actions.append(element("span", "Kein gespeichertes PDF vorhanden"));
    }
    const deleteButton = element("button", "Rechnung löschen");
    deleteButton.type = "button";
    deleteButton.className = "secondary-button";
    deleteButton.dataset.deleteInvoice = String(invoice.id);
    actions.append(deleteButton);
    row.append(actions);
    rows.append(row);
  }
}

export function initializeSettings() {
  const activityForm = document.querySelector("#activity-settings-form");
  const activityRows = document.querySelector("#activity-settings-rows");
  const activityError = document.querySelector("#activity-settings-error");
  const activitySuccess = document.querySelector("#activity-settings-success");
  const saveActivitiesButton = document.querySelector("#save-activity-settings");
  const weeklyPlanForm = document.querySelector("#weekly-plan-form");
  const weeklyPlanDays = document.querySelector("#weekly-plan-days");
  const weeklyPlanError = document.querySelector("#weekly-plan-error");
  const weeklyPlanSuccess = document.querySelector("#weekly-plan-success");
  const savePlanButton = document.querySelector("#save-weekly-plan");
  const invoiceRows = document.querySelector("#saved-invoices-rows");
  const invoiceEmpty = document.querySelector("#saved-invoices-empty");
  const invoiceError = document.querySelector("#saved-invoices-error");
  const reloadInvoicesButton = document.querySelector("#reload-invoices");
  const organizationForm = document.querySelector("#organization-settings-form");
  const organizationError = document.querySelector("#organization-settings-error");
  const organizationSuccess = document.querySelector("#organization-settings-success");
  const saveOrganizationButton = document.querySelector("#save-organization-settings");
  const logoFileInput = document.querySelector("#organization-logo-file");
  const uploadLogoButton = document.querySelector("#upload-organization-logo");
  const deleteLogoButton = document.querySelector("#delete-organization-logo");
  const logoEnabledInput = organizationForm.querySelector('input[name="logo_enabled"]');
  const logoHint = document.querySelector("#organization-logo-hint");
  const logoPreview = document.querySelector("#organization-logo-preview");

  if (
    !(activityForm instanceof HTMLFormElement)
    || !(activityRows instanceof HTMLTableSectionElement)
    || !(activityError instanceof HTMLElement)
    || !(activitySuccess instanceof HTMLElement)
    || !(saveActivitiesButton instanceof HTMLButtonElement)
    || !(weeklyPlanForm instanceof HTMLFormElement)
    || !(weeklyPlanDays instanceof HTMLElement)
    || !(weeklyPlanError instanceof HTMLElement)
    || !(weeklyPlanSuccess instanceof HTMLElement)
    || !(savePlanButton instanceof HTMLButtonElement)
    || !(invoiceRows instanceof HTMLTableSectionElement)
    || !(invoiceEmpty instanceof HTMLElement)
    || !(invoiceError instanceof HTMLElement)
    || !(reloadInvoicesButton instanceof HTMLButtonElement)
    || !(organizationForm instanceof HTMLFormElement)
    || !(organizationError instanceof HTMLElement)
    || !(organizationSuccess instanceof HTMLElement)
    || !(saveOrganizationButton instanceof HTMLButtonElement)
    || !(logoFileInput instanceof HTMLInputElement)
    || !(uploadLogoButton instanceof HTMLButtonElement)
    || !(deleteLogoButton instanceof HTMLButtonElement)
    || !(logoEnabledInput instanceof HTMLInputElement)
    || !(logoHint instanceof HTMLElement)
    || !(logoPreview instanceof HTMLImageElement)
  ) {
    throw new Error("Einstellungen oder Rechnungsarchiv fehlen im HTML.");
  }

  let activities = [];
  let weeklyPlan = [];

  function lockForm(form) {
    const controls = [...form.querySelectorAll("input, textarea, select, button")];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    form.setAttribute("aria-busy", "true");
    let locked = true;
    return () => {
      if (!locked) return;
      locked = false;
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      form.setAttribute("aria-busy", "false");
    };
  }

  function applyOrganizationSettings(settings, logoOnly = false) {
    for (const control of organizationForm.elements) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
        continue;
      }
      if (!control.name || control.type === "file" || (logoOnly && control.name !== "logo_enabled")) {
        continue;
      }
      if (control.type === "checkbox") {
        control.checked = settings[control.name] === true || settings[control.name] === 1;
      } else {
        control.value = settings[control.name] ?? "";
      }
    }

    const logoAvailable = settings.logo_available === true;
    deleteLogoButton.disabled = !logoAvailable;
    logoEnabledInput.disabled = !logoAvailable;
    logoHint.hidden = logoAvailable;
    if (!logoAvailable) {
      logoEnabledInput.checked = false;
    }
    logoPreview.hidden = !logoAvailable;
    if (logoAvailable) {
      logoPreview.src = `/api/organization/logo?updated=${Date.now()}`;
    } else {
      logoPreview.removeAttribute("src");
    }
  }

  async function loadOrganizationSettings() {
    organizationError.hidden = true;
    const unlock = unlockOrganizationLoad;
    try {
      const settings = await requestJson("/api/organization/settings");
      unlock();
      applyOrganizationSettings(settings);
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Rechnungseinstellungen konnten nicht geladen werden.",
      );
      // Keep unloaded fields locked: a partial form must never overwrite saved data.
      retryOrganization.hidden = false;
    }
  }

  organizationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    organizationError.hidden = true;
    organizationSuccess.hidden = true;
    if (!organizationForm.reportValidity()) {
      return;
    }

    const payload = {};
    for (const control of organizationForm.elements) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
        continue;
      }
      if (!control.name || control.type === "file") {
        continue;
      }
      if (control.type === "checkbox") {
        payload[control.name] = control.checked;
      } else if (control.type === "number") {
        payload[control.name] = Number(control.value);
      } else {
        payload[control.name] = control.value.trim();
      }
    }

    const unlock = lockForm(organizationForm);
    try {
      const settings = await requestJson("/api/organization/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      unlock();
      applyOrganizationSettings(settings);
      showMessage(organizationSuccess, "Rechnungseinstellungen wurden gespeichert.");
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Rechnungseinstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      unlock();
    }
  });

  uploadLogoButton.addEventListener("click", async () => {
    organizationError.hidden = true;
    organizationSuccess.hidden = true;
    const file = logoFileInput.files?.[0];
    if (!file) {
      showMessage(organizationError, "Bitte wähle zuerst eine PNG- oder JPEG-Datei aus.");
      return;
    }
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      showMessage(organizationError, "Bitte wähle eine PNG- oder JPEG-Datei aus.");
      return;
    }
    if (file.size === 0 || file.size > 2_000_000) {
      showMessage(organizationError, "Das Logo muss kleiner als 2 MB sein.");
      return;
    }

    const unlock = lockForm(organizationForm);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("Die Logo-Datei konnte nicht gelesen werden."));
          }
        });
        reader.addEventListener("error", () => {
          reject(new Error("Die Logo-Datei konnte nicht gelesen werden."));
        });
        reader.readAsDataURL(file);
      });
      const encodedData = dataUrl.split(",", 2)[1];
      const settings = await requestJson("/api/organization/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: file.type,
          data_base64: encodedData,
        }),
      });
      unlock();
      applyOrganizationSettings(settings, true);
      logoFileInput.value = "";
      showMessage(organizationSuccess, "Logo wurde hochgeladen und für neue Rechnungen aktiviert.");
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Logo konnte nicht hochgeladen werden.",
      );
    } finally {
      unlock();
    }
  });

  deleteLogoButton.addEventListener("click", async () => {
    organizationError.hidden = true;
    organizationSuccess.hidden = true;
    const unlock = lockForm(organizationForm);
    try {
      const settings = await requestJson("/api/organization/logo", {
        method: "DELETE",
      });
      unlock();
      applyOrganizationSettings(settings, true);
      showMessage(organizationSuccess, "Logo wurde entfernt. Bereits erstellte Rechnungen bleiben unverändert.");
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Logo konnte nicht entfernt werden.",
      );
    } finally {
      unlock();
    }
  });

  document.querySelector("#add-activity").addEventListener("click", () => {
    if (activityRows.rows.length >= maximumActivities) return;
    const row = buildActivityRow({});
    activityRows.append(row);
    updateActivityCapacity();
    activitySuccess.hidden = true;
    row.querySelector("input").focus();
  });

  activityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    activityError.hidden = true;
    activitySuccess.hidden = true;
    const payloadActivities = [];
    for (const row of activityRows.rows) {
      const nameInput = row.querySelector('input[type="text"]');
      const rateInput = row.querySelector('input[type="number"]');
      const activeInput = row.querySelector('input[type="checkbox"]');
      const name = nameInput.value.trim();
      const rateText = rateInput.value.trim();
      const id = row.dataset.activityId;

      if (!name || !rateText || !rateInput.validity.valid || rateInCents(rateText) === null) {
        showMessage(activityError, "Bitte fülle Bezeichnung und gültigen Stundenpreis je Tätigkeit aus.");
        return;
      }
      const activity = {
        name,
        hourly_rate_cents: rateInCents(rateText),
        is_active: activeInput.checked,
      };
      if (id) {
        activity.id = Number(id);
      }
      payloadActivities.push(activity);
    }

    if (payloadActivities.length > maximumActivities) {
      showMessage(activityError, "Es können höchstens zehn Tätigkeitsarten verwaltet werden.");
      return;
    }

    const activityFields = [...activityForm.querySelectorAll("input, button")];
    activityFields.forEach((field) => { field.disabled = true; });
    try {
      const result = await requestJson("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activities: payloadActivities }),
      });
      activities = result.activities;
      renderActivities(activityRows, activities);
      // Refresh choices in place; retain unsaved additions, removals, hours and activation.
      for (const select of weeklyPlanDays.querySelectorAll("[data-plan-activity]")) {
        const selected = Number(select.value);
        select.replaceChildren(...activityOptions(activities, selected));
      }
      for (const button of weeklyPlanDays.querySelectorAll("[data-add-plan-entry]")) {
        button.disabled = !activities.some((activity) => activity.is_active);
      }
      document.dispatchEvent(new Event("activities-updated"));
      showMessage(activitySuccess, "Tätigkeiten und Preise wurden gespeichert.");
    } catch (error) {
      showMessage(
        activityError,
        error instanceof Error ? error.message : "Einstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      activityFields.forEach((field) => { field.disabled = false; });
      updateActivityCapacity();
    }
  });

  weeklyPlanDays.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const day = target.closest(".weekly-plan-day");
    if (!(day instanceof HTMLElement)) {
      return;
    }
    if (target.closest("[data-add-plan-entry]")) {
      day.insertBefore(
        buildPlanRow(activities, {
          activity_type_id: activities.find((activity) => activity.is_active)?.id
            ?? activities[0]?.id,
          is_active: true,
        }),
        day.querySelector("[data-add-plan-entry]"),
      );
    } else if (target.closest("[data-remove-plan-entry]")) {
      target.closest(".weekly-plan-row")?.remove();
    }
  });

  weeklyPlanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    weeklyPlanError.hidden = true;
    weeklyPlanSuccess.hidden = true;
    const entries = [];
    for (const day of weeklyPlanDays.querySelectorAll(".weekly-plan-day")) {
      const weekday = Number(day.dataset.weekday);
      for (const row of day.querySelectorAll(".weekly-plan-row")) {
        const activitySelect = row.querySelector("[data-plan-activity]");
        const hoursInput = row.querySelector("[data-plan-hours]");
        const activeInput = row.querySelector("[data-plan-active]");
        const hours = Number(hoursInput.value);
        if (
          !activitySelect.value
          || !hoursInput.validity.valid
          || !Number.isInteger(hours)
        ) {
          showMessage(weeklyPlanError, `Bitte prüfe Tätigkeit und Stunden im Eintrag für ${weekdays[weekday]}.`);
          return;
        }
        const entry = {
          weekday,
          activity_type_id: Number(activitySelect.value),
          hours,
          is_active: activeInput.checked,
        };
        if (row.dataset.planId) {
          entry.id = Number(row.dataset.planId);
        }
        entries.push(entry);
      }
    }

    const unlock = lockForm(weeklyPlanForm);
    try {
      weeklyPlan = await requestJson("/api/weekly-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries),
      });
      unlock();
      renderWeeklyPlan(weeklyPlanDays, activities, weeklyPlan);
      document.dispatchEvent(new Event("weekly-plan-updated"));
      showMessage(weeklyPlanSuccess, "Der wöchentliche Trainingsplan wurde gespeichert.");
    } catch (error) {
      showMessage(
        weeklyPlanError,
        error instanceof Error ? error.message : "Trainingsplan konnte nicht gespeichert werden.",
      );
    } finally {
      unlock();
    }
  });

  let invoices = [];
  function showMonthInvoices() {
    const [year, month] = document.querySelector("#invoice-month").value.split("-").map(Number);
    renderInvoices(invoiceRows, invoiceEmpty, invoices.filter((invoice) => invoice.year === year && invoice.month === month));
  }
  document.addEventListener("calendar-month-changed", showMonthInvoices);
  let invoiceRequest = 0;
  async function loadInvoices() {
    const request = ++invoiceRequest;
    invoiceError.hidden = true;
    reloadInvoicesButton.disabled = true;
    try {
      const result = await requestJson("/api/invoices");
      if (request !== invoiceRequest) return;
      invoices = result;
      showMonthInvoices();
    } catch (error) {
      if (request !== invoiceRequest) return;
      showMessage(
        invoiceError,
        error instanceof Error ? error.message : "Rechnungen konnten nicht geladen werden.",
      );
    } finally {
      if (request === invoiceRequest) reloadInvoicesButton.disabled = false;
    }
  }

  invoiceRows.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const deleteButton = target.closest("[data-delete-invoice]");
    if (!(deleteButton instanceof HTMLButtonElement)) {
      return;
    }
    if (!window.confirm("Soll diese endgültige Rechnung einschließlich der PDF-Datei gelöscht werden?")) {
      return;
    }

    deleteButton.disabled = true;
    invoiceError.hidden = true;
    try {
      const response = await fetch(
        `/api/invoices/${deleteButton.dataset.deleteInvoice}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        let detail = `Rechnung konnte nicht gelöscht werden (HTTP ${response.status}).`;
        try {
          const body = await response.json();
          detail = formatRequestErrorDetail(body.detail) || detail;
        } catch {
          // Keep the HTTP error when the server response is not JSON.
        }
        throw new Error(detail);
      }
      await loadInvoices();
    } catch (error) {
      showMessage(
        invoiceError,
        error instanceof Error ? error.message : "Rechnung konnte nicht gelöscht werden.",
      );
    } finally {
      deleteButton.disabled = false;
    }
  });

  reloadInvoicesButton.addEventListener("click", loadInvoices);
  document.addEventListener("invoice-created", loadInvoices);
  function retryButton(after, label, action) {
    const button = element("button", label);
    button.type = "button";
    button.className = "secondary-button";
    button.hidden = true;
    after.after(button);
    button.addEventListener("click", () => { button.hidden = true; action(); });
    return button;
  }
  // Retry controls live outside locked forms and remain available after initial errors.
  const retryOrganization = retryButton(organizationForm, "Rechnungseinstellungen erneut laden", loadOrganizationSettings);
  const retryActivities = retryButton(activityForm, "Tätigkeiten und Wochenplan erneut laden", loadPlanSettings);
  const retryPlan = retryButton(weeklyPlanForm, "Tätigkeiten und Wochenplan erneut laden", loadPlanSettings);
  const unlockActivities = lockForm(activityForm);
  const unlockPlan = lockForm(weeklyPlanForm);
  async function loadPlanSettings() {
    retryActivities.hidden = true;
    retryPlan.hidden = true;
    activityError.hidden = true;
    weeklyPlanError.hidden = true;
    try {
      const [result, entries] = await Promise.all([
        requestJson("/api/settings"), requestJson("/api/weekly-plan"),
      ]);
      activities = result.activities;
      weeklyPlan = entries;
      unlockActivities();
      unlockPlan();
      renderActivities(activityRows, activities);
      renderWeeklyPlan(weeklyPlanDays, activities, weeklyPlan);
    } catch (error) {
      showMessage(activityError, error.message || "Einstellungen konnten nicht geladen werden.");
      showMessage(weeklyPlanError, error.message || "Wochenplan konnte nicht geladen werden.");
      retryActivities.hidden = false;
      retryPlan.hidden = false;
    }
  }
  const unlockOrganizationLoad = lockForm(organizationForm);
  loadOrganizationSettings();
  loadPlanSettings();

  loadInvoices();
}
