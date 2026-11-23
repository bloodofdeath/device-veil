const DEFAULT_SETTINGS = {
  enabled: true,
  maskNavigator: true,
  maskWebGL: true,
  disabledHosts: []
};

const extensionApi = globalThis.browser ?? globalThis.chrome;
const toggle = document.getElementById("enabled");
const maskNavigatorToggle = document.getElementById("mask-navigator");
const maskWebGLToggle = document.getElementById("mask-webgl");
const modulesSection = document.getElementById("modules-section");
const statusTitle = document.getElementById("status-title");
const statusCaption = document.getElementById("status-caption");
const indicator = document.getElementById("status-indicator");
const siteCard = document.getElementById("site-card");
const siteHostEl = document.getElementById("site-host");
const siteToggleBtn = document.getElementById("site-toggle");
const reloadBar = document.getElementById("reload-bar");
const reloadBtn = document.getElementById("reload-btn");

let currentSettings = { ...DEFAULT_SETTINGS };
let activeTabId = null;
let activeHost = "";

function normalizeHost(urlString) {
  if (!urlString) return "";
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.hostname.trim().toLowerCase();
  } catch {
    return "";
  }
}

function isHostDisabled() {
  return Boolean(activeHost) && currentSettings.disabledHosts.includes(activeHost);
}

function render() {
  const globalEnabled = currentSettings.enabled !== false;
  const hostDisabled = isHostDisabled();
  const effectiveEnabled = globalEnabled && !hostDisabled;

  toggle.checked = globalEnabled;
  maskNavigatorToggle.checked = currentSettings.maskNavigator !== false;
  maskWebGLToggle.checked = currentSettings.maskWebGL !== false;
  modulesSection.classList.toggle("disabled", !globalEnabled);

  indicator.classList.toggle("active", effectiveEnabled);
  indicator.classList.toggle("paused", globalEnabled && hostDisabled);

  if (!globalEnabled) {
    statusTitle.textContent = "Защита выключена";
    statusCaption.textContent = "Сведения доступны сайтам";
  } else if (hostDisabled) {
    statusTitle.textContent = "Пауза на этом сайте";
    statusCaption.textContent = "Глобальная защита активна";
  } else {
    statusTitle.textContent = "Защита включена";
    statusCaption.textContent = "Отпечаток устройства стандартизирован";
  }

  if (activeHost) {
    siteCard.classList.remove("hidden");
    siteHostEl.textContent = activeHost;
    siteToggleBtn.textContent = hostDisabled ? "Включить" : "Пауза";
    siteToggleBtn.classList.toggle("is-paused", hostDisabled);
    siteToggleBtn.disabled = !globalEnabled;
  } else {
    siteCard.classList.add("hidden");
  }
}

function showReloadPrompt() {
  if (activeTabId !== null && activeHost) {
    reloadBar.classList.remove("hidden");
  }
}

function saveSettings(partial) {
  const previous = { ...currentSettings };
  currentSettings = { ...currentSettings, ...partial };
  render();
  showReloadPrompt();

  extensionApi.storage.local
    .set(partial)
    .catch(() => {
      currentSettings = previous;
      render();
    });
}

async function init() {
  try {
    const [settings, tabs] = await Promise.all([
      extensionApi.storage.local.get(DEFAULT_SETTINGS),
      extensionApi.tabs?.query({ active: true, currentWindow: true }).catch(() => []) ?? []
    ]);

    currentSettings = {
      enabled: settings.enabled !== false,
      maskNavigator: settings.maskNavigator !== false,
      maskWebGL: settings.maskWebGL !== false,
      disabledHosts: Array.isArray(settings.disabledHosts) ? settings.disabledHosts : []
    };

    const currentTab = Array.isArray(tabs) ? tabs[0] : null;
    if (currentTab) {
      activeTabId = currentTab.id ?? null;
      activeHost = normalizeHost(currentTab.url);
    }
  } catch {
    currentSettings = { ...DEFAULT_SETTINGS };
  }

  render();
}

toggle.addEventListener("change", () => {
  saveSettings({ enabled: toggle.checked });
});

maskNavigatorToggle.addEventListener("change", () => {
  saveSettings({ maskNavigator: maskNavigatorToggle.checked });
});

maskWebGLToggle.addEventListener("change", () => {
  saveSettings({ maskWebGL: maskWebGLToggle.checked });
});

siteToggleBtn.addEventListener("click", () => {
  if (!activeHost) return;
  const nextHosts = isHostDisabled()
    ? currentSettings.disabledHosts.filter((h) => h !== activeHost)
    : [...currentSettings.disabledHosts, activeHost];
  saveSettings({ disabledHosts: nextHosts });
});

reloadBtn.addEventListener("click", () => {
  if (activeTabId !== null && extensionApi.tabs?.reload) {
    extensionApi.tabs.reload(activeTabId).then(() => window.close()).catch(() => {});
  }
});

init();
