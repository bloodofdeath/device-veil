(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    maskNavigator: true,
    maskWebGL: true,
    disabledHosts: []
  };
  const MESSAGE_SOURCE = "device-veil-settings";
  const extensionApi = globalThis.browser ?? globalThis.chrome;

  function normalizeHost(hostname) {
    return typeof hostname === "string" ? hostname.trim().toLowerCase() : "";
  }

  function resolveSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    const host = normalizeHost(window.location.hostname);
    const disabledHosts = Array.isArray(merged.disabledHosts) ? merged.disabledHosts : [];
    const hostDisabled = Boolean(host) && disabledHosts.includes(host);

    return {
      enabled: merged.enabled !== false && !hostDisabled,
      maskNavigator: merged.maskNavigator !== false,
      maskWebGL: merged.maskWebGL !== false
    };
  }

  function sendSettings(raw) {
    const targetOrigin =
      window.location.origin && window.location.origin !== "null"
        ? window.location.origin
        : "*";
    window.postMessage(
      { source: MESSAGE_SOURCE, settings: resolveSettings(raw) },
      targetOrigin
    );
  }

  if (!extensionApi?.storage?.local) return;

  function syncFromStorage() {
    extensionApi.storage.local
      .get(DEFAULT_SETTINGS)
      .then((settings) => sendSettings(settings))
      .catch(() => sendSettings(DEFAULT_SETTINGS));
  }

  syncFromStorage();

  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (
      changes.enabled ||
      changes.maskNavigator ||
      changes.maskWebGL ||
      changes.disabledHosts
    ) {
      syncFromStorage();
    }
  });
})();
