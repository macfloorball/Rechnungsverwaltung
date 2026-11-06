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

function element(tagName, text) {
  const node = document.createElement(tagName);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = `Anfrage fehlgeschlagen (HTTP ${response.status}).`;
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

  const activitySelect = element("select");
  activitySelect.setAttribute("aria-label", "Tätigkeit");
  activitySelect.dataset.planActivity = "";
  for (const option of activityOptions(activities, entry.activity_type_id)) {
    activitySelect.append(option);
  }

  const hoursInput = element("input");
  hoursInput.type = "number";
  hoursInput.min = "0.01";
  hoursInput.max = "24";
  hoursInput.step = "0.01";
  hoursInput.value = entry.id === undefined ? "1" : String(entry.hours);
  hoursInput.setAttribute("aria-label", "Stunden");
  hoursInput.dataset.planHours = "";

  const activeLabel = element("label", "Aktiv");
  const activeInput = element("input");
  activeInput.type = "checkbox";
  activeInput.checked = entry.is_active !== false;
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
      actions.className = "invoice-history-actions";
      actions.append(openLink, downloadLink);
    } else {
      actions.textContent = "Kein gespeichertes PDF vorhanden";
    }
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
  ) {
    throw new Error("Einstellungen oder Rechnungsarchiv fehlen im HTML.");
  }

  let activities = [];
  let weeklyPlan = [];

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
        if (!activitySelect.value || !hoursInput.validity.valid || !Number.isFinite(hours)) {
          showMessage(weeklyPlanError, `Bitte prüfe Tätigkeit und Stunden im Eintrag für ${weekdays[weekday]}.`);
          return;
        }
        entries.push({
          weekday,
          activity_type_id: Number(activitySelect.value),
          hours,
          is_active: activeInput.checked,
        });
      }
    }

    savePlanButton.disabled = true;
    try {
      weeklyPlan = await requestJson("/api/weekly-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries),
      });
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

  reloadInvoicesButton.addEventListener("click", loadInvoices);

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
