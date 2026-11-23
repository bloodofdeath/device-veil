(() => {
  const MESSAGE_SOURCE = "device-veil-settings";
  const state = {
    enabled: true,
    maskNavigator: true,
    maskWebGL: true
  };

  const HIGH_ENTROPY_DEFAULTS = {
    platform: "Windows",
    platformVersion: "10.0.0",
    model: "",
    architecture: "x86",
    bitness: "64",
    wow64: false
  };

  const WEBGL_VENDOR_PARAMS = new Set([0x1F00, 0x9245]); // VENDOR, UNMASKED_VENDOR_WEBGL
  const WEBGL_RENDERER_PARAMS = new Set([0x1F01, 0x9246]); // RENDERER, UNMASKED_RENDERER_WEBGL

  function replaceGetter(target, property, isActive, replacement) {
    if (!target) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (!descriptor || !descriptor.configurable || typeof descriptor.get !== "function") return;

    const originalGetter = descriptor.get;
    const wrappedGetter = function () {
      return isActive() ? replacement.call(this, originalGetter) : originalGetter.call(this);
    };

    try {
      Object.defineProperty(wrappedGetter, "name", {
        value: originalGetter.name || `get ${property}`,
        configurable: true
      });
    } catch {
      // Ignore if function name cannot be redefined.
    }

    Object.defineProperty(target, property, {
      ...descriptor,
      get: wrappedGetter
    });
  }

  function installNavigatorMask() {
    const isNavigatorActive = () => state.enabled && state.maskNavigator;
    const navigatorPrototype = Object.getPrototypeOf(navigator);

    replaceGetter(navigatorPrototype, "platform", isNavigatorActive, () => "Win32");
    replaceGetter(navigatorPrototype, "hardwareConcurrency", isNavigatorActive, () => 4);
    replaceGetter(navigatorPrototype, "deviceMemory", isNavigatorActive, () => 8);
    replaceGetter(navigatorPrototype, "maxTouchPoints", isNavigatorActive, () => 0);

    if (typeof window.screen === "object" && window.screen !== null) {
      const screenPrototype = Object.getPrototypeOf(window.screen);
      replaceGetter(screenPrototype, "colorDepth", isNavigatorActive, () => 24);
      replaceGetter(screenPrototype, "pixelDepth", isNavigatorActive, () => 24);
    }

    const userAgentData = navigator.userAgentData;
    if (!userAgentData) return;

    const dataPrototype = Object.getPrototypeOf(userAgentData);
    replaceGetter(dataPrototype, "platform", isNavigatorActive, () => "Windows");
    replaceGetter(dataPrototype, "model", isNavigatorActive, () => "");

    if (typeof dataPrototype.getHighEntropyValues === "function") {
      const original = dataPrototype.getHighEntropyValues;
      const wrapped = function (hints) {
        return original.call(this, hints).then((values) => {
          if (!isNavigatorActive() || !values || typeof values !== "object") return values;

          const requested = Array.isArray(hints) ? new Set(hints) : null;
          const masked = { ...values };
          for (const [key, fallbackValue] of Object.entries(HIGH_ENTROPY_DEFAULTS)) {
            if (Object.prototype.hasOwnProperty.call(masked, key) || (requested && requested.has(key))) {
              masked[key] = fallbackValue;
            }
          }
          return masked;
        });
      };

      try {
        Object.defineProperty(wrapped, "name", {
          value: "getHighEntropyValues",
          configurable: true
        });
      } catch {
        // Ignore if function name cannot be redefined.
      }

      dataPrototype.getHighEntropyValues = wrapped;
    }
  }

  function installWebGLMask() {
    const isWebGLActive = () => state.enabled && state.maskWebGL;

    for (const Constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Constructor?.prototype) continue;
      const prototype = Constructor.prototype;
      const original = prototype.getParameter;
      if (typeof original !== "function") continue;

      const wrapped = function (parameter) {
        if (isWebGLActive()) {
          if (WEBGL_VENDOR_PARAMS.has(parameter)) return "Generic";
          if (WEBGL_RENDERER_PARAMS.has(parameter)) return "Generic GPU";
        }
        return original.call(this, parameter);
      };

      try {
        Object.defineProperty(wrapped, "name", {
          value: "getParameter",
          configurable: true
        });
      } catch {
        // Ignore if function name cannot be redefined.
      }

      prototype.getParameter = wrapped;
    }
  }

  function applySettings(nextSettings) {
    if (!nextSettings || typeof nextSettings !== "object") return;
    state.enabled = nextSettings.enabled !== false;
    state.maskNavigator = nextSettings.maskNavigator !== false;
    state.maskWebGL = nextSettings.maskWebGL !== false;
  }

  installNavigatorMask();
  installWebGLMask();

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) return;
    applySettings(event.data.settings);
  });
})();
