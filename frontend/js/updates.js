const instances = new WeakMap();
const unavailable = "Die Update-Funktion ist gerade nicht verfügbar. Bitte später erneut versuchen.";
const validVersion = (value) => typeof value === "string" && value.length <= 17 && value.trim() === value
  && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  && value.split(".").every((part) => Number(part) <= 65535);

export function initializeDesktopUpdates({ document: doc = document, api = globalThis.window?.ttcDesktop } = {}) {
  if (instances.has(doc)) return instances.get(doc);
  const methods = ["getUpdateStatus", "checkForUpdates", "acknowledgeUpdate", "deferUpdate", "requestUpdate",
    "installUpdate", "cancelUpdateDownload", "setUpdateAccessToken", "clearUpdateAccessToken", "onUpdateStatus"];
  const section = doc.getElementById("desktop-updates");
  if (!section || api?.apiVersion !== 1 || !methods.every((name) => typeof api[name] === "function")) return () => {};
  const get = (id) => doc.getElementById(id);
  const dialog = get("desktop-update-dialog"), token = get("desktop-update-token");
  const checkButton = get("check-desktop-updates"), showButton = get("show-desktop-update");
  const cancelButton = get("desktop-update-cancel"), backgroundCancel = get("cancel-desktop-download");
  const installButton = get("install-desktop-update");
  const nowButton = get("desktop-update-now"), laterButton = get("desktop-update-later");
  const saveButton = get("save-desktop-update-access"), clearButton = get("clear-desktop-update-access");
  const abort = new AbortController(), shown = new Set();
  let status = null, dialogVersion = null, busy = false, accessBusy = false, installBusy = false, closed = false, lastRevision = -1;
  let unsubscribe = () => {};
  const listen = (node, event, callback, options = {}) => node.addEventListener(event, callback, { ...options, signal: abort.signal });
  function message(node, text) { node.textContent = text || ""; node.hidden = !text; }
  function controlledFailure(text) { return { userMessage: text || unavailable }; }
  async function invoke(method, ...args) {
    try {
      const result = await api[method](...args);
      if (!result?.ok) throw controlledFailure(typeof result?.error?.message === "string" ? result.error.message.slice(0, 600) : unavailable);
      return result.value;
    } catch (error) { throw controlledFailure(error?.userMessage); }
  }
  function problem(error, target = get("desktop-update-error")) { message(target, error?.userMessage || unavailable); }
  function eligible() { return status?.state === "available" && validVersion(status.availableVersion); }
  function blockedByWork() { return Boolean(doc.querySelector("dialog[open]") || doc.querySelector('[aria-busy="true"]')); }
  function renderProgress() {
    const active = status?.state === "downloading";
    get("desktop-update-progress").hidden = !active;
    const progress = get("desktop-update-progress-bar");
    if (!active) { progress.removeAttribute("value"); return; }
    if (status.download?.phase === "verifying") {
      progress.removeAttribute("value");
      get("desktop-update-progress-text").textContent = "Download wird geprüft …";
      return;
    }
    const received = status.download?.receivedBytes, total = status.download?.totalBytes;
    if (Number.isFinite(received) && Number.isFinite(total) && received >= 0 && total > 0 && received <= total) {
      const percent = Math.floor(received / total * 100);
      progress.value = percent;
      get("desktop-update-progress-text").textContent = `${percent} % heruntergeladen`;
    } else {
      progress.removeAttribute("value");
      get("desktop-update-progress-text").textContent = "Update wird heruntergeladen …";
    }
  }
  function maybePrompt() {
    if (closed || busy || accessBusy || status?.actionBusy || !eligible() || status.promptVersion !== status.availableVersion
        || shown.has(status.availableVersion) || blockedByWork()) return;
    openDialog();
  }
  function render(next) {
    if (closed) return;
    if (!next || typeof next !== "object" || !["disabled", "idle", "checking", "available", "up_to_date", "authentication_required", "error", "downloading", "downloaded", "preparing_install", "install_handoff", "cancelled"].includes(next.state)) {
      problem(controlledFailure()); return;
    }
    if (Number.isSafeInteger(next.revision)) {
      if (next.revision < lastRevision) return;
      lastRevision = next.revision;
    }
    status = next;
    get("desktop-current-version").textContent = validVersion(next.currentVersion) ? next.currentVersion : "–";
    const labels = {
      disabled: next.reason === "development" ? "Diese App-Version prüft nicht automatisch auf Updates." : "Automatische Updates sind noch nicht eingerichtet.",
      idle: "Updates können manuell geprüft werden.", checking: "Updates werden geprüft …",
      available: validVersion(next.availableVersion) ? `Version ${next.availableVersion} ist verfügbar.` : "Keine gültige Update-Freigabe verfügbar.",
      up_to_date: "Deine App ist auf dem aktuellen Stand.", authentication_required: "Für private Updates ist ein eigener GitHub-Zugang erforderlich.",
      error: "Die Update-Prüfung konnte nicht abgeschlossen werden.", downloading: "Das Update wird heruntergeladen …",
      downloaded: "Das Update wurde heruntergeladen und geprüft. Die automatische Installation ist noch nicht verfügbar.",
    };
    labels.cancelled = "Der Download wurde abgebrochen. Die App bleibt lokal nutzbar.";
    labels.preparing_install = "Die Installation wird vorbereitet …";
    labels.install_handoff = "Die App wird für die Installation beendet …";
    if (next.state === "downloaded" && next.installationHint) labels.downloaded = next.installationHint;
    if (next.state === "downloaded" && next.canInstall) labels.downloaded = "Das Update ist geprüft und zur Installation bereit.";
    let label = labels[next.state];
    if (next.state === "downloading" && next.download?.phase === "verifying") label = "Das heruntergeladene Paket wird geprüft …";
    else if (next.state === "downloading" && Number.isFinite(next.download?.receivedBytes)
        && Number.isFinite(next.download?.totalBytes) && next.download.totalBytes > 0
        && next.download.receivedBytes >= 0 && next.download.receivedBytes <= next.download.totalBytes) {
      label = `Das Update wird heruntergeladen: ${Math.floor(next.download.receivedBytes / next.download.totalBytes * 100)} %`;
    }
    get("desktop-update-status").textContent = label;
    message(get("desktop-update-error"), next.state === "error" && typeof next.error?.message === "string" ? next.error.message.slice(0, 600) : "");
    checkButton.disabled = Boolean(next.actionBusy) || busy || accessBusy || ["disabled", "checking", "downloading"].includes(next.state);
    checkButton.setAttribute("aria-busy", String(busy || next.state === "checking"));
    for (const button of [cancelButton, backgroundCancel]) { button.hidden = next.state !== "downloading"; button.disabled = Boolean(next.actionBusy); }
    installButton.hidden = !next.canInstall; installButton.disabled = installBusy;
    showButton.hidden = !eligible(); showButton.disabled = Boolean(next.actionBusy) || busy || accessBusy;
    saveButton.disabled = Boolean(next.actionBusy) || accessBusy || !next.requiresAuthentication;
    clearButton.disabled = Boolean(next.actionBusy) || accessBusy;
    token.disabled = Boolean(next.actionBusy) || accessBusy || !next.requiresAuthentication;
    get("desktop-update-repository").textContent = typeof next.repository === "string" ? next.repository : "das Release-Repository";
    get("desktop-update-access-hint").textContent = next.requiresAuthentication
      ? "Der Token wird nur für diese Update-Quelle verwendet. Du kannst den gespeicherten Zugang jederzeit entfernen."
      : "Für diese App-Version wird derzeit kein neuer GitHub-Zugang benötigt.";
    nowButton.disabled = installBusy || busy || (!(eligible() && next.canDownload === true) && !next.canInstall) || (dialog.open && dialogVersion !== next.availableVersion);
    const installHint = typeof next.installationHint === "string" ? next.installationHint.slice(0, 600) : "";
    get("desktop-update-unavailable").textContent = installHint || "Automatisches Aktualisieren ist derzeit nicht verfügbar. Bitte verwende einen geprüften Installer oder verschiebe das Update.";
    get("desktop-update-unavailable").hidden = !installHint && (next.canDownload === true || ["downloading", "downloaded"].includes(next.state));
    nowButton.textContent = next.state === "downloading" ? "Wird heruntergeladen …"
      : next.canInstall ? "Jetzt installieren" : next.state === "downloaded" ? "Download geprüft" : installHint ? "Update herunterladen" : "Jetzt aktualisieren";
    laterButton.textContent = next.state === "downloading" ? "Im Hintergrund weiterladen" : "Später";
    if (dialog.open && dialogVersion !== next.availableVersion && !["downloading", "downloaded"].includes(next.state)) {
      message(get("desktop-update-dialog-error"), "Diese Update-Freigabe ist nicht mehr aktuell. Bitte erneut prüfen.");
    }
    if (dialog.open && next.state === "error" && typeof next.error?.message === "string") {
      message(get("desktop-update-dialog-error"), next.error.message.slice(0, 600));
    }
    if (dialog.open && next.state === "downloaded") {
      message(get("desktop-update-dialog-error"), next.canInstall ? "Das Paket ist geprüft. Zur Installation wird die App nach erneuter Bestätigung beendet." : (next.installationHint || "Das Paket wurde geprüft. Die automatische Installation ist noch nicht verfügbar."));
      laterButton.textContent = "Schließen";
    }
    message(get("desktop-update-action-status"), next.state === "cancelled" ? "Der Download wurde abgebrochen. Du kannst die App weiterverwenden und später erneut prüfen." : "");
    if (next.state === "cancelled") laterButton.textContent = "Schließen";
    renderProgress();
    maybePrompt();
  }
  function openDialog() {
    if (!eligible() || dialog.open || blockedByWork()) return;
    dialogVersion = status.availableVersion;
    shown.add(dialogVersion);
    get("desktop-update-dialog-title").textContent = `Update verfügbar – Version ${dialogVersion}`;
    get("desktop-update-versions").textContent = `Installiert: ${status.currentVersion} · Neue Version: ${dialogVersion}`;
    get("desktop-update-notes").textContent = typeof status.releaseNotes === "string" && status.releaseNotes
      ? status.releaseNotes.slice(0, 12000) : "Für diese Version sind keine weiteren Hinweise vorhanden.";
    get("desktop-update-notes").closest("details").open = false;
    message(get("desktop-update-dialog-error"), "");
    nowButton.disabled = status.canDownload !== true;
    dialog.showModal();
    void invoke("acknowledgeUpdate", dialogVersion).then(render).catch((error) => {
      if (!closed && dialog.open) { nowButton.disabled = true; problem(error, get("desktop-update-dialog-error")); }
    });
  }
  async function later() {
    const version = dialogVersion;
    dialog.close();
    if (!validVersion(version) || status?.state !== "available") return;
    try { render(await invoke("deferUpdate", version)); } catch (error) { if (!closed) problem(error); }
  }
  async function check() {
    if (closed || busy || accessBusy) return;
    busy = true; if (status) render(status);
    try {
      render(await invoke("checkForUpdates"));
      if (status?.state === "authentication_required") {
        get("desktop-update-access").open = true;
        if (!doc.querySelector("dialog[open]")) token.focus();
      }
    } catch (error) {
      if (!closed) {
        if (status) status = { ...status, state: "error", availableVersion: null, promptVersion: null,
          error: { code: "IPC_UNAVAILABLE", message: error.userMessage || unavailable } };
        problem(error);
      }
    } finally { busy = false; if (status) render(status); }
  }
  listen(checkButton, "click", () => { void check(); });
  listen(showButton, "click", openDialog);
  listen(laterButton, "click", () => { void later(); });
  listen(dialog, "cancel", (event) => { event.preventDefault(); void later(); });
  async function cancelDownload() {
    const version = status?.availableVersion;
    if (cancelButton.disabled || status?.state !== "downloading" || !validVersion(version)) return;
    cancelButton.disabled = true; backgroundCancel.disabled = true;
    try { render(await invoke("cancelUpdateDownload", version)); }
    catch (error) { if (!closed) problem(error, dialog.open ? get("desktop-update-dialog-error") : get("desktop-update-error")); }
    finally { if (!closed) for (const button of [cancelButton, backgroundCancel]) button.disabled = Boolean(status?.actionBusy); }
  }
  listen(cancelButton, "click", () => { void cancelDownload(); });
  listen(backgroundCancel, "click", () => { void cancelDownload(); });
  async function install(version) {
    if (closed || installBusy || !status?.canInstall || !validVersion(version)) return;
    installBusy = true; installButton.disabled = true; nowButton.disabled = true;
    try { render(await invoke("installUpdate", version)); }
    catch (error) { if (!closed) problem(error, dialog.open ? get("desktop-update-dialog-error") : get("desktop-update-error")); }
    finally { installBusy = false; if (status) render(status); }
  }
  listen(installButton, "click", () => { void install(status?.availableVersion); });
  listen(nowButton, "click", async () => {
    if (status?.canInstall) { await install(dialogVersion); return; }
    if (busy || nowButton.disabled || !validVersion(dialogVersion)) return;
    busy = true; nowButton.disabled = true;
    try { render(await invoke("requestUpdate", dialogVersion)); }
    catch (error) { if (!closed) problem(error, get("desktop-update-dialog-error")); }
    finally { busy = false; if (status) render(status); }
  });
  listen(get("desktop-update-access-form"), "submit", async (event) => {
    event.preventDefault();
    if (accessBusy || !status?.requiresAuthentication) return;
    let secret = token.value;
    token.value = "";
    if (typeof secret !== "string" || secret.length < 20 || secret.length > 512 || !/^[\x21-\x7e]+$/.test(secret)) {
      problem(controlledFailure("Bitte einen gültigen persönlichen GitHub-Token eingeben."), get("desktop-update-access-message")); return;
    }
    accessBusy = true; render(status);
    let stored = false;
    message(get("desktop-update-access-message"), "Zugang wird geschützt gespeichert …");
    try {
      const work = invoke("setUpdateAccessToken", secret); secret = "";
      render(await work);
      stored = true;
      message(get("desktop-update-access-message"), "Zugang wurde geschützt gespeichert.");
    } catch (error) { if (!closed) problem(error, get("desktop-update-access-message")); }
    finally { secret = ""; accessBusy = false; token.value = ""; if (status) render(status); }
    if (stored && !closed && status?.state === "idle") {
      await check();
      if (status?.state === "authentication_required") message(get("desktop-update-access-message"), "Der Zugang wurde gespeichert, GitHub hat den Lesezugriff aber nicht bestätigt. Bitte Repository-Auswahl und Rechte prüfen.");
    }
  });
  listen(clearButton, "click", async () => {
    if (accessBusy) return;
    accessBusy = true; token.value = ""; if (status) render(status);
    try {
      render(await invoke("clearUpdateAccessToken"));
      message(get("desktop-update-access-message"), "Gespeicherter GitHub-Zugang wurde entfernt.");
    } catch (error) { if (!closed) problem(error, get("desktop-update-access-message")); }
    finally { accessBusy = false; if (status) render(status); }
  });
  listen(doc, "close", maybePrompt, { capture: true });
  const observer = typeof MutationObserver === "function" ? new MutationObserver(maybePrompt) : null;
  observer?.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ["open", "aria-busy"] });
  function dispose() {
    if (closed) return;
    closed = true; token.value = "";
    if (typeof unsubscribe === "function") unsubscribe();
    abort.abort(); observer?.disconnect();
    if (dialog.open) dialog.close();
    instances.delete(doc);
  }
  instances.set(doc, dispose);
  doc.defaultView?.addEventListener("pagehide", dispose, { once: true });
  section.hidden = false;
  try { unsubscribe = api.onUpdateStatus(render); }
  catch { problem(controlledFailure()); }
  dispose.ready = invoke("getUpdateStatus").then(render).catch((error) => {
    if (!closed) { get("desktop-update-status").textContent = "Der Update-Status ist gerade nicht verfügbar."; problem(error); }
  });
  return dispose;
}
