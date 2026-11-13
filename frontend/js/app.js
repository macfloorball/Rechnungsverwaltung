import { initializeCalendar } from "./calendar.js";
import { initializeInvoicePreview } from "./invoice.js";
import { initializeSettings } from "./settings.js";

initializeCalendar();
initializeInvoicePreview();
initializeSettings();

const backupButton = document.getElementById("create-backup");
backupButton.addEventListener("click", async () => {
  const message = document.getElementById("backup-message");
  backupButton.disabled = true;
  message.textContent = "Sicherung läuft …";
  try {
    const response = await fetch("/api/backups", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Sicherung fehlgeschlagen.");
    message.textContent = `Sicherung erstellt: ${result.path}`;
  } catch (error) {
    message.textContent = error.message || "Sicherung fehlgeschlagen.";
  } finally {
    backupButton.disabled = false;
  }
});
