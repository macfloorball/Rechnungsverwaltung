import { bindTrainingEditor } from "./trainings.js";

const monthFormatter = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  timeZone: "UTC",
});

const weekdayLabels = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(Date.UTC(2024, 0, 1 + index));
  return weekdayFormatter.format(date);
});

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function createTraining(training) {
  const item = createElement("li", `training training--${training.status}`);
  const button = createElement("button", "training__button");
  button.type = "button";
  button.dataset.training = JSON.stringify(training);
  button.setAttribute(
    "aria-label",
    `${training.activity_name || "Tätigkeit"} am ${training.training_date} bearbeiten`,
  );
  const name = training.activity_name || "Tätigkeit";
  const statusLabels = {
    planned: "Geplant",
    completed: "Durchgeführt",
    cancelled: "Ausgefallen",
  };
  button.append(
    createElement("span", "training__name", name),
    createElement(
      "span",
      "training__details",
      `${training.hours === null ? "Pauschale" : `${training.hours} Std.`} · ${statusLabels[training.status] || training.status}`,
    ),
  );
  const completionLabel = createElement("label", "training__completion");
  const completionCheckbox = createElement("input");
  completionCheckbox.type = "checkbox";
  completionCheckbox.checked = training.status === "completed";
  completionCheckbox.disabled = training.status === "cancelled";
  completionCheckbox.dataset.trainingCompletion = JSON.stringify(training);
  completionCheckbox.setAttribute(
    "aria-label",
    `${name} am ${training.training_date} als durchgeführt markieren`,
  );
  completionLabel.append(completionCheckbox, document.createTextNode("Durchgeführt"));

  const notDoneButton = createElement("button", "training__not-done", "Nicht gemacht");
  notDoneButton.type = "button";
  notDoneButton.dataset.trainingCancelled = JSON.stringify(training);
  notDoneButton.disabled = training.status === "cancelled";
  notDoneButton.setAttribute(
    "aria-label",
    `${name} am ${training.training_date} als nicht durchgeführt markieren`,
  );
  const actions = createElement("div", "training__actions");
  actions.append(completionLabel, notDoneButton);
  item.append(button, actions);
  return item;
}

function renderCalendar(container, data) {
  const firstDay = new Date(Date.UTC(data.year, data.month - 1, 1));
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const grid = createElement("div", "calendar-grid");

  for (const label of weekdayLabels) {
    const weekday = createElement("div", "calendar-weekday", label);
    weekday.setAttribute("aria-hidden", "true");
    grid.append(weekday);
  }

  for (let index = 0; index < offset; index += 1) {
    const emptyCell = createElement("div", "calendar-day calendar-day--empty");
    emptyCell.setAttribute("aria-hidden", "true");
    grid.append(emptyCell);
  }

  for (const day of data.days) {
    const dayNumber = Number(day.date.slice(-2));
    const dayCell = createElement("article", "calendar-day");
    dayCell.setAttribute("aria-label", day.date);
    dayCell.append(createElement("h3", "calendar-day__number", String(dayNumber)));

    if (day.trainings.length > 0) {
      const list = createElement("ul", "training-list");
      for (const training of day.trainings) {
        list.append(createTraining(training));
      }
      dayCell.append(list);
    }

    const addButton = createElement("button", "add-training-button", "＋ Termin");
    addButton.type = "button";
    addButton.dataset.newDate = day.date;
    addButton.setAttribute("aria-label", `Termin am ${day.date} hinzufügen`);
    dayCell.append(addButton);

    grid.append(dayCell);
  }

  container.replaceChildren(grid);
}

export function initializeCalendar() {
  const monthLabel = document.querySelector("#calendar-month");
  const calendar = document.querySelector("#calendar");
  const errorMessage = document.querySelector("#calendar-error");
  const successMessage = document.querySelector("#calendar-success");
  const previousButton = document.querySelector("#previous-month");
  const nextButton = document.querySelector("#next-month");
  const completeMonthButton = document.querySelector("#complete-month");

  if (
    !monthLabel
    || !calendar
    || !errorMessage
    || !successMessage
    || !previousButton
    || !nextButton
    || !completeMonthButton
  ) {
    throw new Error("Kalender-Elemente fehlen im HTML-Grundgerüst.");
  }

  let visibleMonth = new Date();
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  let loading = false;
  let reloadPending = false;

  async function loadMonth(month) {
    if (loading) {
      reloadPending = true;
      return;
    }
    loading = true;
    calendar.setAttribute("aria-busy", "true");
    previousButton.disabled = true;
    nextButton.disabled = true;
    completeMonthButton.disabled = true;
    errorMessage.hidden = true;

    const year = month.getFullYear();
    const monthNumber = month.getMonth() + 1;
    try {
      const response = await fetch(`/api/calendar/${year}/${monthNumber}`);
      if (!response.ok) {
        throw new Error(`Kalender konnte nicht geladen werden (HTTP ${response.status}).`);
      }
      const data = await response.json();
      renderCalendar(calendar, data);
      visibleMonth = month;
      monthLabel.textContent = monthFormatter.format(month);
    } catch (error) {
      errorMessage.textContent = error instanceof Error
        ? error.message
        : "Kalender konnte nicht geladen werden.";
      errorMessage.hidden = false;
    } finally {
      loading = false;
      calendar.setAttribute("aria-busy", "false");
      previousButton.disabled = false;
      nextButton.disabled = false;
      completeMonthButton.disabled = false;
      if (reloadPending) {
        reloadPending = false;
        await loadMonth(visibleMonth);
      }
    }
  }

  bindTrainingEditor(calendar, () => loadMonth(visibleMonth));

  previousButton.addEventListener("click", () => {
    successMessage.hidden = true;
    loadMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1));
  });
  nextButton.addEventListener("click", () => {
    successMessage.hidden = true;
    loadMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1));
  });
  document.addEventListener("activities-updated", () => loadMonth(visibleMonth));
  document.addEventListener("weekly-plan-updated", () => {
    loadMonth(visibleMonth);
  });

  completeMonthButton.addEventListener("click", async () => {
    if (
      loading
      || !window.confirm(
        "Sollen alle geplanten Wochenplan-Termine dieses Monats als durchgeführt markiert werden?",
      )
    ) {
      return;
    }

    const month = visibleMonth;
    const year = month.getFullYear();
    const monthNumber = month.getMonth() + 1;
    completeMonthButton.disabled = true;
    previousButton.disabled = true;
    nextButton.disabled = true;
    errorMessage.hidden = true;
    successMessage.hidden = true;

    try {
      const response = await fetch(
        `/api/calendar/${year}/${monthNumber}/complete`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(
          `Termine konnten nicht aktualisiert werden (HTTP ${response.status}).`,
        );
      }
      const result = await response.json();
      if (!Number.isInteger(result.updated_count) || result.updated_count < 0) {
        throw new Error("Die Rückmeldung zur Monatsaktion ist ungültig.");
      }
      successMessage.textContent = result.updated_count === 1
        ? "1 Termin wurde als durchgeführt markiert."
        : `${result.updated_count} Termine wurden als durchgeführt markiert.`;
      successMessage.hidden = false;
      await loadMonth(month);
    } catch (error) {
      errorMessage.textContent = error instanceof Error
        ? error.message
        : "Termine konnten nicht aktualisiert werden.";
      errorMessage.hidden = false;
    } finally {
      completeMonthButton.disabled = false;
      previousButton.disabled = false;
      nextButton.disabled = false;
    }
  });

  loadMonth(visibleMonth);
}