import { initializeProfileArchive } from "./profile-archive.js";
import { initializeSavedSignatures } from "./signature-preview.js";
import { initializeSignatures } from "./signatures.js";
import { initializeProfiles } from "./profiles.js";
import { profileFetch as fetch, profileUrl } from "./profiles.js";
import { initializeNavigation } from "./navigation.js";
import { initializeCalendar } from "./calendar.js";
import { initializeInvoicePreview } from "./invoice.js";
import { initializeSettings } from "./settings.js";
import { initializeDesktopUpdates } from "./updates.js";

if (await initializeProfiles()) {
initializeNavigation();
initializeCalendar();
initializeInvoicePreview();
initializeSettings();
initializeSignatures();
initializeSavedSignatures();
initializeProfileArchive();
initializeDesktopUpdates();
}

const backupButton = document.getElementById("create-backup");
backupButton.addEventListener("click", async () => {
  const message = document.getElementById("backup-message");
  backupButton.disabled = true;
  message.textContent = "Sicherung läuft …";
  try {
    const response = await fetch("/api/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: document.getElementById("backup-directory").value.trim() || null }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Sicherung fehlgeschlagen.");
    message.textContent = `Sicherung erstellt: ${result.path}`;
  } catch (error) {
    message.textContent = error.message || "Sicherung fehlgeschlagen.";
  } finally {
    backupButton.disabled = false;
  }
});

const exportButton = document.getElementById("export-data");
exportButton.addEventListener("click", async () => {
  const message = document.getElementById("backup-message");
  exportButton.disabled = true;
  message.textContent = "Export läuft …";
  try {
    const response = await fetch("/api/exports/download");
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.detail || "Export fehlgeschlagen.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "ttc-datenexport.zip";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message.textContent = "Export zum Speichern übergeben. Download prüfen.";
  } catch (error) {
    message.textContent = error.message || "Export fehlgeschlagen.";
  } finally {
    exportButton.disabled = false;
  }
});
