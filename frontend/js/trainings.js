import { profileFetch as fetch, profileUrl } from "./profiles.js";
function showError(element, error) {
  element.textContent = error instanceof Error
    ? error.message
    : "Der Termin konnte nicht gespeichert werden.";
  element.hidden = false;
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

export function bindTrainingEditor(calendar, onSaved) {
  const dialog = document.querySelector("#training-dialog");
  const form = document.querySelector("#training-form");
  const dialogTitle = document.querySelector("#training-dialog-title");
  const dateLabel = document.querySelector("#training-dialog-date");
  const activitySelect = document.querySelector("#training-activity");
  const hoursInput = document.querySelector("#training-hours");
  const statusSelect = document.querySelector("#training-status");
  const noteInput = document.querySelector("#training-note");
  const errorMessage = document.querySelector("#training-error");
  const calendarErrorMessage = document.querySelector("#calendar-error");
  const saveButton = document.querySelector("#save-training-edit");
  const closeButton = document.querySelector("#close-training-dialog");
  const cancelButton = document.querySelector("#cancel-training-edit");

  if (
    !(dialog instanceof HTMLDialogElement)
    || !(form instanceof HTMLFormElement)
    || !(dialogTitle instanceof HTMLElement)
    || !(dateLabel instanceof HTMLElement)
    || !(activitySelect instanceof HTMLSelectElement)
    || !(hoursInput instanceof HTMLInputElement)
    || !(statusSelect instanceof HTMLSelectElement)
    || !(noteInput instanceof HTMLTextAreaElement)
    || !(errorMessage instanceof HTMLElement)
    || !(calendarErrorMessage instanceof HTMLElement)
    || !(saveButton instanceof HTMLButtonElement)
    || !(closeButton instanceof HTMLButtonElement)
    || !(cancelButton instanceof HTMLButtonElement)
  ) {
    throw new Error("Bearbeitungsdialog für Trainingstermine fehlt im HTML.");
  }

  let selectedTraining = null;
  let statusChanged = false;

  async function openEditor(training) {
    selectedTraining = training;
    statusChanged = false;
    const isNewTraining = training.id === null;
    dialogTitle.textContent = isNewTraining ? "Termin hinzufügen" : "Termin bearbeiten";
    errorMessage.hidden = true;
    dateLabel.textContent = new Intl.DateTimeFormat("de-DE", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${training.training_date}T00:00:00Z`));
    hoursInput.value = String(training.hours);
    statusSelect.value = training.status || "planned";
    noteInput.value = training.note || "";
    activitySelect.replaceChildren();
    saveButton.disabled = true;
    dialog.showModal();

    try {
      const settings = await requestJson("/api/settings");
      const activities = settings.activities.filter(
        (activity) => activity.is_active || activity.id === training.activity_type_id,
      );
      for (const activity of activities) {
        const option = document.createElement("option");
        option.value = String(activity.id);
        option.textContent = activity.name;
        activitySelect.append(option);
      }
      if (activities.length === 0) {
        throw new Error("Es sind keine Tätigkeitsarten eingerichtet.");
      }
      activitySelect.value = String(
        training.activity_type_id ?? activities[0].id,
      );
      saveButton.disabled = false;
      activitySelect.focus();
    } catch (error) {
      showError(errorMessage, error);
    }
  }

  calendar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const addButton = target.closest("[data-new-date]");
    if (addButton instanceof HTMLButtonElement) {
      openEditor({
        id: null,
        training_date: addButton.dataset.newDate,
        activity_type_id: null,
        hours: 1,
        status: "planned",
        note: null,
      });
      return;
    }
    const button = target.closest("[data-training]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const training = JSON.parse(button.dataset.training || "null");
    if (training) {
      openEditor(training);
    }
  });

  calendar.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-training-status]")) {
      return;
    }

    const training = JSON.parse(target.dataset.trainingStatus || "null");
    if (!training) {
      return;
    }

    const group = target.closest("fieldset");
    if (!group || group.disabled || target.value === training.status) return;
    group.disabled = true;
    calendarErrorMessage.hidden = true;
    try {
      await requestJson(`/api/trainings/${training.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target.value }),
      });
      await onSaved();
    } catch (error) {
      for (const input of group.querySelectorAll("input")) {
        input.checked = input.value === training.status;
      }
      showError(calendarErrorMessage, error);
    } finally {
      group.disabled = false;
    }
  });

  statusSelect.addEventListener("change", () => {
    statusChanged = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedTraining || !form.reportValidity()) {
      return;
    }
    errorMessage.hidden = true;
    saveButton.disabled = true;

    const payload = {
      activity_type_id: Number(activitySelect.value),
      hours: hoursInput.value.trim() ? Number(hoursInput.value) : null,
      note: noteInput.value.trim() || null,
    };
    if (statusChanged) {
      payload.status = statusSelect.value;
    }
    const isNewTraining = selectedTraining.id === null;
    const url = isNewTraining
      ? "/api/trainings"
      : `/api/trainings/${selectedTraining.id}`;
    const method = isNewTraining ? "POST" : "PUT";
    if (isNewTraining) {
      payload.training_date = selectedTraining.training_date;
    }

    try {
      await requestJson(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      dialog.close();
      await onSaved();
    } catch (error) {
      showError(errorMessage, error);
    } finally {
      saveButton.disabled = false;
    }
  });

  for (const button of [closeButton, cancelButton]) {
    button.addEventListener("click", () => dialog.close());
  }
}