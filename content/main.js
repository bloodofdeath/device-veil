(() => {
  const MESSAGE_SOURCE = "device-veil-settings";

  const SCREEN_PRESETS = {
    "1920x1080": { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, dpr: 1 },
    "2560x1440": { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400, dpr: 1 },
    "1536x864": { width: 1536, height: 864, availWidth: 1536, availHeight: 824, dpr: 1.25 },
    "1366x768": { width: 1366, height: 768, availWidth: 1366, availHeight: 728, dpr: 1 }
  };

  const state = {
    enabled: true,
    maskNavigator: true,
    maskScreen: true,
    screenPreset: "1920x1080",
    maskWebGL: true,
    maskFingerprint: true
  };

  // Per-page-load deterministic seed so two reads within the same page match,
  // while cross-session / cross-tab hashes differ.
  const sessionSeed = (() => {
    try {
      const buf = new Uint32Array(1);
      globalThis.crypto.getRandomValues(buf);
      return buf[0] || 0x9e3779b9;
    } catch {
      return 0x9e3779b9;
    }
  })();

  const HIGH_ENTROPY_DEFAULTS = {
    platform: "Windows",
    platformVersion: "10.0.0",
    model: "",
    architecture: "x86",
    bitness: "64",
    wow64: false,
    formFactors: ["Desktop"]
  };

  const WEBGL_MASKED_PARAMS = new Map([
    [0x1F00, "WebKit"], // VENDOR
    [0x1F01, "WebKit WebGL"], // RENDERER
    [0x9245, "Google Inc. (Intel)"], // UNMASKED_VENDOR_WEBGL
    [0x9246, "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)"], // UNMASKED_RENDERER_WEBGL
    [0x0D33, 16384], // MAX_TEXTURE_SIZE
    [0x851C, 16384], // MAX_CUBE_MAP_TEXTURE_SIZE
    [0x84E8, 16384] // MAX_RENDERBUFFER_SIZE
  ]);

  const STANDARD_WINDOWS_FONTS = new Set([
    "arial",
    "arial black",
    "bahnschrift",
    "calibri",
    "cambria",
    "cambria math",
    "candara",
    "comic sans ms",
    "consolas",
    "constantia",
    "corbel",
    "courier",
    "courier new",
    "ebrima",
    "franklin gothic medium",
    "gabriola",
    "gadugi",
    "georgia",
    "impact",
    "ink free",
    "javanese text",
    "leelawadee ui",
    "lucida console",
    "lucida sans unicode",
    "malgun gothic",
    "marlett",
    "microsoft himalaya",
    "microsoft jhenghei",
    "microsoft new tai lue",
    "microsoft phagspa",
    "microsoft sans serif",
    "microsoft tai le",
    "microsoft yahei",
    "microsoft yi baiti",
    "mingliu-extb",
    "mongolian baiti",
    "ms gothic",
    "mv boli",
    "myanmar text",
    "nirmala ui",
    "palatino linotype",
    "segoe mdl2 assets",
    "segoe print",
    "segoe script",
    "segoe ui",
    "segoe ui emoji",
    "segoe ui historic",
    "segoe ui symbol",
    "simsun",
    "sitka text",
    "sylfaen",
    "symbol",
    "tahoma",
    "times",
    "times new roman",
    "trebuchet ms",
    "verdana",
    "webdings",
    "wingdings",
    "yu gothic",
    // CSS generic & keywords
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "emoji",
    "math",
    "fangsong",
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer"
  ]);

  const nativeStrings = new WeakMap();

  function markNative(fn, name) {
    try {
      Object.defineProperty(fn, "name", { value: name, configurable: true });
    } catch {
      // Ignore if name cannot be redefined.
    }
    nativeStrings.set(fn, `function ${name}() { [native code] }`);
    return fn;
  }

  function installFunctionToStringShield() {
    const origToString = Function.prototype.toString;
    const wrappedToString = function () {
      if (nativeStrings.has(this)) {
        return nativeStrings.get(this);
      }
      return origToString.call(this);
    };
    markNative(wrappedToString, "toString");
    Function.prototype.toString = wrappedToString;
  }

  function replaceGetter(target, property, isActive, replacement) {
    if (!target) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (!descriptor || !descriptor.configurable || typeof descriptor.get !== "function") return;

    const originalGetter = descriptor.get;
    const getterName = originalGetter.name || `get ${property}`;
    const wrappedGetter = markNative(function () {
      return isActive() ? replacement.call(this, originalGetter) : originalGetter.call(this);
    }, getterName);

    Object.defineProperty(target, property, {
      ...descriptor,
      get: wrappedGetter
    });
  }

  function replaceMethod(target, methodName, wrapperFactory) {
    if (!target) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, methodName);
    const original = descriptor ? descriptor.value : target[methodName];
    if (typeof original !== "function") return;
    if (descriptor && !descriptor.configurable && !descriptor.writable) return;

    const wrapped = markNative(wrapperFactory(original), methodName);
    if (descriptor) {
      Object.defineProperty(target, methodName, { ...descriptor, value: wrapped });
    } else {
      target[methodName] = wrapped;
    }
  }

  function getScreenPreset() {
    return SCREEN_PRESETS[state.screenPreset] || SCREEN_PRESETS["1920x1080"];
  }

  function normalizeLanguages(rawLanguages, primaryLanguage) {
    const primary = typeof primaryLanguage === "string" && primaryLanguage.trim()
      ? primaryLanguage.trim()
      : (Array.isArray(rawLanguages) && rawLanguages[0]) || "en-US";
    const base = primary.split("-")[0].toLowerCase();
    const result = [];
    const pushUnique = (lang) => {
      if (lang && !result.includes(lang)) result.push(lang);
    };
    pushUnique(primary);
    if (base && base !== primary.toLowerCase()) pushUnique(base);
    if (base !== "en") {
      pushUnique("en-US");
      pushUnique("en");
    } else {
      pushUnique("en");
    }
    return Object.freeze(result);
  }

  function installNavigatorMask() {
    const isNavigatorActive = () => state.enabled && state.maskNavigator;
    const navigatorPrototype = Object.getPrototypeOf(navigator);

    replaceGetter(navigatorPrototype, "platform", isNavigatorActive, () => "Win32");
    replaceGetter(navigatorPrototype, "hardwareConcurrency", isNavigatorActive, () => 8);
    replaceGetter(navigatorPrototype, "deviceMemory", isNavigatorActive, () => 8);
    replaceGetter(navigatorPrototype, "maxTouchPoints", isNavigatorActive, () => 0);
    replaceGetter(navigatorPrototype, "languages", isNavigatorActive, function (origGetter) {
      const raw = origGetter.call(this);
      return normalizeLanguages(raw, this.language);
    });

    if (typeof navigatorPrototype.getBattery === "function") {
      let batteryPatched = false;
      replaceMethod(navigatorPrototype, "getBattery", (original) => function (...args) {
        if (!isNavigatorActive()) return original.apply(this, args);
        return original.apply(this, args).then((battery) => {
          if (!battery || typeof battery !== "object") return battery;
          if (!batteryPatched) {
            batteryPatched = true;
            const batteryProto = Object.getPrototypeOf(battery);
            replaceGetter(batteryProto, "charging", isNavigatorActive, () => true);
            replaceGetter(batteryProto, "chargingTime", isNavigatorActive, () => 0);
            replaceGetter(batteryProto, "dischargingTime", isNavigatorActive, () => Infinity);
            replaceGetter(batteryProto, "level", isNavigatorActive, () => 1);
          }
          return battery;
        });
      });
    }

    if (navigator.connection) {
      const connProto = Object.getPrototypeOf(navigator.connection);
      replaceGetter(connProto, "effectiveType", isNavigatorActive, () => "4g");
      replaceGetter(connProto, "downlink", isNavigatorActive, () => 10);
      replaceGetter(connProto, "rtt", isNavigatorActive, () => 50);
      replaceGetter(connProto, "saveData", isNavigatorActive, () => false);
    }

    if (navigator.storage) {
      const storageProto = Object.getPrototypeOf(navigator.storage);
      replaceMethod(storageProto, "estimate", (original) => function (...args) {
        return original.apply(this, args).then((est) => {
          if (!isNavigatorActive() || !est || typeof est !== "object") return est;
          return {
            ...est,
            quota: 107374182400,
            usage: typeof est.usage === "number" && est.usage > 1048576
              ? Math.round(est.usage / 1048576) * 1048576
              : 0
          };
        });
      });
    }

    if (navigator.mediaDevices) {
      const mediaProto = Object.getPrototypeOf(navigator.mediaDevices);
      replaceMethod(mediaProto, "enumerateDevices", (original) => function (...args) {
        return original.apply(this, args).then((devices) => {
          if (!isNavigatorActive() || !Array.isArray(devices)) return devices;
          // Keep real devices if user granted mic/camera access (labels are populated).
          if (devices.some((d) => d && d.label)) return devices;
          const seenKinds = new Set();
          return devices.filter((d) => {
            if (!d || !d.kind || seenKinds.has(d.kind)) return false;
            seenKinds.add(d.kind);
            return true;
          });
        });
      });
    }

    const userAgentData = navigator.userAgentData;
    if (!userAgentData) return;

    const dataPrototype = Object.getPrototypeOf(userAgentData);
    replaceGetter(dataPrototype, "platform", isNavigatorActive, () => "Windows");
    replaceGetter(dataPrototype, "mobile", isNavigatorActive, () => false);
    replaceGetter(dataPrototype, "model", isNavigatorActive, () => "");

    replaceMethod(dataPrototype, "getHighEntropyValues", (original) => function (hints) {
      return original.call(this, hints).then((values) => {
        if (!isNavigatorActive() || !values || typeof values !== "object") return values;

        const requested = Array.isArray(hints) ? new Set(hints) : null;
        const masked = { ...values };
        for (const [key, fallbackValue] of Object.entries(HIGH_ENTROPY_DEFAULTS)) {
          if (Object.prototype.hasOwnProperty.call(masked, key) || (requested && requested.has(key))) {
            masked[key] = Array.isArray(fallbackValue) ? [...fallbackValue] : fallbackValue;
          }
        }
        return masked;
      });
    });
  }

  function installScreenMask() {
    const isScreenActive = () => state.enabled && state.maskScreen;

    if (typeof window.screen === "object" && window.screen !== null) {
      const screenProto = Object.getPrototypeOf(window.screen);
      replaceGetter(screenProto, "width", isScreenActive, () => getScreenPreset().width);
      replaceGetter(screenProto, "height", isScreenActive, () => getScreenPreset().height);
      replaceGetter(screenProto, "availWidth", isScreenActive, () => getScreenPreset().availWidth);
      replaceGetter(screenProto, "availHeight", isScreenActive, () => getScreenPreset().availHeight);
      replaceGetter(screenProto, "availLeft", isScreenActive, () => 0);
      replaceGetter(screenProto, "availTop", isScreenActive, () => 0);
      replaceGetter(screenProto, "colorDepth", isScreenActive, () => 24);
      replaceGetter(screenProto, "pixelDepth", isScreenActive, () => 24);

      if (window.screen.orientation) {
        const orientProto = Object.getPrototypeOf(window.screen.orientation);
        replaceGetter(orientProto, "type", isScreenActive, () => "landscape-primary");
        replaceGetter(orientProto, "angle", isScreenActive, () => 0);
      }
    }

    replaceGetter(window, "devicePixelRatio", isScreenActive, () => getScreenPreset().dpr);
    replaceGetter(window, "outerWidth", isScreenActive, () => getScreenPreset().availWidth);
    replaceGetter(window, "outerHeight", isScreenActive, () => getScreenPreset().availHeight);
    replaceGetter(window, "screenX", isScreenActive, () => 0);
    replaceGetter(window, "screenY", isScreenActive, () => 0);
    replaceGetter(window, "screenLeft", isScreenActive, () => 0);
    replaceGetter(window, "screenTop", isScreenActive, () => 0);
  }

  function installWebGLMask() {
    const isWebGLActive = () => state.enabled && state.maskWebGL;

    for (const Constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Constructor?.prototype) continue;
      replaceMethod(Constructor.prototype, "getParameter", (original) => function (parameter) {
        if (isWebGLActive() && WEBGL_MASKED_PARAMS.has(parameter)) {
          return WEBGL_MASKED_PARAMS.get(parameter);
        }
        return original.call(this, parameter);
      });
    }

    if (window.GPUAdapter?.prototype) {
      replaceGetter(window.GPUAdapter.prototype, "info", isWebGLActive, function (origGetter) {
        const realInfo = origGetter.call(this);
        if (!realInfo || typeof realInfo !== "object") return realInfo;
        return Object.freeze({
          vendor: "intel",
          architecture: "gen-9",
          device: "",
          description: ""
        });
      });
    }
  }

  function hashStep(x) {
    let h = (x ^ sessionSeed) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function perturbImageDataBytes(data, width, height) {
    const totalPixels = width * height;
    if (totalPixels <= 0 || data.length < 4) return;
    const samples = Math.min(16, totalPixels);
    for (let i = 0; i < samples; i++) {
      const h = hashStep(i * 2654435761 + totalPixels);
      const pixelIdx = (h % totalPixels) * 4;
      const channel = h % 3; // R, G, or B
      const delta = (h & 4) ? 1 : -1;
      const next = data[pixelIdx + channel] + delta;
      data[pixelIdx + channel] = next < 0 ? 1 : next > 255 ? 254 : next;
    }
  }

  function getLoadedWebFonts() {
    const loaded = new Set();
    try {
      if (document?.fonts && typeof document.fonts[Symbol.iterator] === "function") {
        for (const face of document.fonts) {
          if (face?.family) {
            loaded.add(face.family.replace(/^['"]+|['"]+$/g, "").trim().toLowerCase());
          }
        }
      }
    } catch {
      // Ignore font iteration errors.
    }
    return loaded;
  }

  function sanitizeFontFamilyList(familyListString) {
    if (typeof familyListString !== "string" || !familyListString.trim()) return familyListString;
    if (familyListString.includes("var(")) return familyListString;

    const webFonts = getLoadedWebFonts();
    const parts = familyListString.split(",");
    const kept = [];

    for (const rawPart of parts) {
      const trimmed = rawPart.trim();
      const normalized = trimmed.replace(/^['"]+|['"]+$/g, "").trim().toLowerCase();
      if (!normalized) continue;
      if (STANDARD_WINDOWS_FONTS.has(normalized) || webFonts.has(normalized)) {
        kept.push(trimmed);
      }
    }

    return kept.length > 0 ? kept.join(", ") : "sans-serif";
  }

  function sanitizeCanvasFontShorthand(fontValue) {
    if (typeof fontValue !== "string") return fontValue;
    // Match CSS font shorthand size (+ optional line-height) followed by family list
    const match = fontValue.match(/^(\s*(?:(?:italic|oblique|normal|bold|bolder|lighter|\d{3}|small-caps)\s+)*\d+(?:\.\d+)?(?:px|pt|em|rem|%|vh|vw|vmin|vmax|ex|ch|cm|mm|in|pc)(?:\s*\/\s*[^\s]+)?\s+)(.+)$/i);
    if (!match) return fontValue;
    return match[1] + sanitizeFontFamilyList(match[2]);
  }

  function installFingerprintMask() {
    const isFpActive = () => state.enabled && state.maskFingerprint;

    // 1. Canvas 2D readback protection (clones canvas so visible pixels are never altered)
    const HtmlCanvas = window.HTMLCanvasElement;
    const Context2D = window.CanvasRenderingContext2D;

    if (Context2D?.prototype) {
      const origGetImageData = Context2D.prototype.getImageData;
      if (typeof origGetImageData === "function") {
        replaceMethod(Context2D.prototype, "getImageData", (original) => function (sx, sy, sw, sh, ...rest) {
          const imageData = original.call(this, sx, sy, sw, sh, ...rest);
          if (isFpActive() && imageData?.data && sw * sh <= 262144) {
            perturbImageDataBytes(imageData.data, imageData.width, imageData.height);
          }
          return imageData;
        });

        const cloneWithNoise = (sourceCanvas) => {
          const w = sourceCanvas.width;
          const h = sourceCanvas.height;
          if (!w || !h || w > 2048 || h > 2048 || !document?.createElement) return null;
          try {
            const clone = document.createElement("canvas");
            clone.width = w;
            clone.height = h;
            const ctx = clone.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(sourceCanvas, 0, 0);
            const img = origGetImageData.call(ctx, 0, 0, w, h);
            perturbImageDataBytes(img.data, w, h);
            ctx.putImageData(img, 0, 0);
            return clone;
          } catch {
            return null;
          }
        };

        if (HtmlCanvas?.prototype) {
          replaceMethod(HtmlCanvas.prototype, "toDataURL", (original) => function (...args) {
            if (isFpActive()) {
              const clone = cloneWithNoise(this);
              if (clone) return original.apply(clone, args);
            }
            return original.apply(this, args);
          });

          replaceMethod(HtmlCanvas.prototype, "toBlob", (original) => function (...args) {
            if (isFpActive()) {
              const clone = cloneWithNoise(this);
              if (clone) return original.apply(clone, args);
            }
            return original.apply(this, args);
          });
        }
      }

      // Canvas font probing guard
      const fontDesc = Object.getOwnPropertyDescriptor(Context2D.prototype, "font");
      if (fontDesc?.configurable && typeof fontDesc.set === "function") {
        const origSet = fontDesc.set;
        const wrappedSet = markNative(function (val) {
          return origSet.call(this, isFpActive() ? sanitizeCanvasFontShorthand(val) : val);
        }, "set font");
        Object.defineProperty(Context2D.prototype, "font", { ...fontDesc, set: wrappedSet });
      }
    }

    // 2. Font enumeration guards (FontFaceSet.check + inline style.fontFamily)
    if (window.FontFaceSet?.prototype) {
      replaceMethod(window.FontFaceSet.prototype, "check", (original) => function (font, text) {
        if (isFpActive() && typeof font === "string") {
          const match = font.match(/\d+(?:\.\d+)?(?:px|pt|em|rem|%)\s*(?:\/\s*[^\s]+\s*)?(.+)$/i);
          if (match) {
            const webFonts = getLoadedWebFonts();
            const families = match[1].split(",").map((f) => f.replace(/^['"]+|['"]+$/g, "").trim().toLowerCase()).filter(Boolean);
            if (families.some((fam) => !STANDARD_WINDOWS_FONTS.has(fam) && !webFonts.has(fam))) {
              return false;
            }
          }
        }
        return text !== undefined ? original.call(this, font, text) : original.call(this, font);
      });
    }

    if (window.CSSStyleDeclaration?.prototype) {
      const styleProto = window.CSSStyleDeclaration.prototype;
      const ffDesc = Object.getOwnPropertyDescriptor(styleProto, "fontFamily");
      if (ffDesc?.configurable && typeof ffDesc.set === "function") {
        const origSet = ffDesc.set;
        const wrappedSet = markNative(function (val) {
          return origSet.call(this, isFpActive() && typeof val === "string" ? sanitizeFontFamilyList(val) : val);
        }, "set fontFamily");
        Object.defineProperty(styleProto, "fontFamily", { ...ffDesc, set: wrappedSet });
      }
    }

    // 3. Web Audio fingerprint protection (deterministic micro-offset per AudioBuffer)
    if (window.AudioBuffer?.prototype) {
      const perturbedBuffers = new WeakSet();
      replaceMethod(window.AudioBuffer.prototype, "getChannelData", (original) => function (channel) {
        const data = original.call(this, channel);
        if (isFpActive() && data && !perturbedBuffers.has(data)) {
          perturbedBuffers.add(data);
          const stride = Math.max(1, Math.floor(data.length / 64));
          for (let i = 0; i < data.length; i += stride) {
            if (data[i] !== 0) {
              const offset = ((hashStep(i + channel * 97) % 11) - 5) * 1e-7;
              data[i] += offset;
            }
          }
        }
        return data;
      });
    }
  }

  function applySettings(nextSettings) {
    if (!nextSettings || typeof nextSettings !== "object") return;
    state.enabled = nextSettings.enabled !== false;
    state.maskNavigator = nextSettings.maskNavigator !== false;
    state.maskScreen = nextSettings.maskScreen !== false;
    if (typeof nextSettings.screenPreset === "string" && SCREEN_PRESETS[nextSettings.screenPreset]) {
      state.screenPreset = nextSettings.screenPreset;
    }
    state.maskWebGL = nextSettings.maskWebGL !== false;
    state.maskFingerprint = nextSettings.maskFingerprint !== false;
  }

  installFunctionToStringShield();
  installNavigatorMask();
  installScreenMask();
  installWebGLMask();
  installFingerprintMask();

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) return;
    applySettings(event.data.settings);
  });
})();
