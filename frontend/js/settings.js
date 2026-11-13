const weekdays = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
const maximumActivities = 4;
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

function buildActivityRow(activity, index) {
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
  activeInput.checked = activity.is_active !== false;
  activeLabel.className = "settings-checkbox-label";
  activeLabel.htmlFor = activeInput.id;
  activeCell.append(activeInput, activeLabel);
  row.append(nameCell, rateCell, activeCell);
  return row;
}

function renderActivities(rows, activities) {
  if (activities.length > maximumActivities) {
    throw new Error(
      "Es sind mehr als vier Tätigkeitsarten gespeichert. Bitte prüfe die Datenbank.",
    );
  }
  rows.replaceChildren();
  for (let index = 0; index < maximumActivities; index += 1) {
    rows.append(buildActivityRow(activities[index] || {}, index));
  }
}

function activityOptions(activities, selectedId) {
  const options = activities.map((activity) => {
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
    addButton.disabled = activities.length === 0;
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

  function applyOrganizationSettings(settings) {
    for (const control of organizationForm.elements) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
        continue;
      }
      if (!control.name || control.type === "file") {
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
    try {
      const settings = await requestJson("/api/organization/settings");
      applyOrganizationSettings(settings);
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Rechnungseinstellungen konnten nicht geladen werden.",
      );
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

    saveOrganizationButton.disabled = true;
    try {
      const settings = await requestJson("/api/organization/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      applyOrganizationSettings(settings);
      showMessage(organizationSuccess, "Rechnungseinstellungen wurden gespeichert.");
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Rechnungseinstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      saveOrganizationButton.disabled = false;
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

    uploadLogoButton.disabled = true;
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
      applyOrganizationSettings(settings);
      logoFileInput.value = "";
      showMessage(organizationSuccess, "Logo wurde hochgeladen und für neue Rechnungen aktiviert.");
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Logo konnte nicht hochgeladen werden.",
      );
    } finally {
      uploadLogoButton.disabled = false;
    }
  });

  deleteLogoButton.addEventListener("click", async () => {
    organizationError.hidden = true;
    organizationSuccess.hidden = true;
    deleteLogoButton.disabled = true;
    try {
      const settings = await requestJson("/api/organization/logo", {
        method: "DELETE",
      });
      applyOrganizationSettings(settings);
      showMessage(organizationSuccess, "Logo wurde entfernt. Bereits erstellte Rechnungen bleiben unverändert.");
    } catch (error) {
      showMessage(
        organizationError,
        error instanceof Error ? error.message : "Logo konnte nicht entfernt werden.",
      );
      deleteLogoButton.disabled = false;
    }
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

      if (!name && !rateText && !id) {
        continue;
      }
      if (!name || !rateText || !rateInput.validity.valid) {
        showMessage(activityError, "Bitte fülle Bezeichnung und gültigen Stundenpreis je Tätigkeit aus.");
        return;
      }
      const activity = {
        name,
        hourly_rate_cents: Math.round(Number(rateText) * 100),
        is_active: activeInput.checked,
      };
      if (id) {
        activity.id = Number(id);
      }
      payloadActivities.push(activity);
    }

    if (payloadActivities.length > maximumActivities) {
      showMessage(activityError, "Es können höchstens vier Tätigkeitsarten verwaltet werden.");
      return;
    }

    saveActivitiesButton.disabled = true;
    try {
      const result = await requestJson("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activities: payloadActivities }),
      });
      activities = result.activities;
      renderActivities(activityRows, activities);
      renderWeeklyPlan(weeklyPlanDays, activities, weeklyPlan);
      showMessage(activitySuccess, "Tätigkeiten und Preise wurden gespeichert.");
    } catch (error) {
      showMessage(
        activityError,
        error instanceof Error ? error.message : "Einstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      saveActivitiesButton.disabled = false;
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

    savePlanButton.disabled = true;
    try {
      weeklyPlan = await requestJson("/api/weekly-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries),
      });
      renderWeeklyPlan(weeklyPlanDays, activities, weeklyPlan);
      document.dispatchEvent(new Event("weekly-plan-updated"));
      showMessage(weeklyPlanSuccess, "Der wöchentliche Trainingsplan wurde gespeichert.");
    } catch (error) {
      showMessage(
        weeklyPlanError,
        error instanceof Error ? error.message : "Trainingsplan konnte nicht gespeichert werden.",
      );
    } finally {
      savePlanButton.disabled = false;
    }
  });

  async function loadInvoices() {
    invoiceError.hidden = true;
    reloadInvoicesButton.disabled = true;
    try {
      const invoices = await requestJson("/api/invoices");
      renderInvoices(invoiceRows, invoiceEmpty, invoices);
    } catch (error) {
      showMessage(
        invoiceError,
        error instanceof Error ? error.message : "Rechnungen konnten nicht geladen werden.",
      );
    } finally {
      reloadInvoicesButton.disabled = false;
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
  loadOrganizationSettings();

  requestJson("/api/settings")
    .then((result) => {
      activities = result.activities;
      renderActivities(activityRows, activities);
      renderWeeklyPlan(weeklyPlanDays, activities, weeklyPlan);
    })
    .catch((error) => {
      showMessage(
        activityError,
        error instanceof Error ? error.message : "Tätigkeiten konnten nicht geladen werden.",
      );
      showMessage(
        weeklyPlanError,
        "Der Trainingsplan kann erst geladen werden, wenn Tätigkeiten verfügbar sind.",
      );
    });

  requestJson("/api/weekly-plan")
    .then((entries) => {
      weeklyPlan = entries;
      if (activities.length > 0) {
        renderWeeklyPlan(weeklyPlanDays, activities, weeklyPlan);
      }
    })
    .catch((error) => {
      showMessage(
        weeklyPlanError,
        error instanceof Error ? error.message : "Trainingsplan konnte nicht geladen werden.",
      );
    });

  loadInvoices();
}
