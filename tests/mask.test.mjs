import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";

const mainScriptSource = fs.readFileSync(
  path.resolve("content/main.js"),
  "utf8"
);

function createMockBrowserEnv() {
  const listeners = [];

  class MockConnection {
    get effectiveType() { return "3g"; }
    get downlink() { return 1.6; }
    get rtt() { return 100; }
    get saveData() { return true; }
  }

  class MockStorageManager {
    async estimate() {
      return { quota: 10737418240, usage: 512 };
    }
  }

  class MockMediaDevices {
    async enumerateDevices() {
      return [
        { kind: "audioinput", label: "", deviceId: "" },
        { kind: "audioinput", label: "", deviceId: "" },
        { kind: "videoinput", label: "", deviceId: "" },
        { kind: "audiooutput", label: "", deviceId: "" },
        { kind: "audiooutput", label: "", deviceId: "" }
      ];
    }
  }

  class MockBattery {
    get charging() { return false; }
    get chargingTime() { return Infinity; }
    get dischargingTime() { return 3400; }
    get level() { return 0.42; }
  }

  class MockNavigator {
    get platform() { return "MacIntel"; }
    get hardwareConcurrency() { return 16; }
    get deviceMemory() { return 32; }
    get maxTouchPoints() { return 5; }
    get language() { return "ru"; }
    get languages() { return ["ru", "en", "en-GB", "en-US", "ru-RU"]; }
    async getBattery() { return new MockBattery(); }
  }

  class MockUserAgentData {
    get platform() { return "macOS"; }
    get mobile() { return true; }
    get model() { return "MacBookPro18,1"; }
    async getHighEntropyValues(hints) {
      const full = {
        brands: [{ brand: "Chromium", version: "158" }],
        platform: "macOS",
        platformVersion: "14.5.0",
        model: "MacBookPro18,1",
        architecture: "arm",
        bitness: "64",
        wow64: false
      };
      const result = { brands: full.brands };
      for (const hint of hints || []) {
        if (hint in full) result[hint] = full[hint];
      }
      return result;
    }
  }

  class MockOrientation {
    get type() { return "portrait-primary"; }
    get angle() { return 90; }
  }

  class MockScreen {
    constructor() {
      this.orientation = new MockOrientation();
    }
    get width() { return 3440; }
    get height() { return 1440; }
    get availWidth() { return 3440; }
    get availHeight() { return 1392; }
    get availLeft() { return -1920; }
    get availTop() { return 20; }
    get colorDepth() { return 30; }
    get pixelDepth() { return 30; }
  }

  class WebGLRenderingContext {
    getParameter(param) {
      const map = {
        0x1F00: "Apple Inc.",
        0x1F01: "Apple M3 Max",
        0x9245: "Apple Inc.",
        0x9246: "Apple M3 Max GPU",
        0x0D33: 32768,
        0x1F02: "WebGL 2.0"
      };
      return map[param] ?? null;
    }
  }

  class WebGL2RenderingContext extends WebGLRenderingContext {}

  class GPUAdapter {
    get info() {
      if (!(this instanceof GPUAdapter)) throw new TypeError("Illegal invocation");
      return { vendor: "nvidia", architecture: "ada", device: "0x2684", description: "RTX 4090" };
    }
  }

  class CanvasRenderingContext2D {
    constructor() { this._font = "10px sans-serif"; }
    get font() { return this._font; }
    set font(v) { this._font = v; }
    getImageData(_sx, _sy, sw, sh) {
      const data = new Uint8ClampedArray(sw * sh * 4);
      data.fill(128);
      return { data, width: sw, height: sh };
    }
    putImageData() {}
    drawImage() {}
  }

  class HTMLCanvasElement {
    constructor() {
      this.width = 120;
      this.height = 40;
      this._ctx = new CanvasRenderingContext2D();
    }
    getContext() { return this._ctx; }
    toDataURL() { return "data:image/png;base64,AAA"; }
    toBlob(cb) { cb(null); }
  }

  class FontFaceSet {
    constructor() {
      this._faces = [{ family: "CustomWebFont" }];
    }
    [Symbol.iterator]() { return this._faces[Symbol.iterator](); }
    check() { return true; }
  }

  class CSSStyleDeclaration {
    constructor() { this._ff = ""; }
    get fontFamily() { return this._ff; }
    set fontFamily(v) { this._ff = v; }
  }

  class AudioBuffer {
    constructor() {
      this._ch = new Float32Array(128).fill(0.25);
    }
    getChannelData() { return this._ch; }
  }

  const navigatorInstance = new MockNavigator();
  navigatorInstance.userAgentData = new MockUserAgentData();
  navigatorInstance.connection = new MockConnection();
  navigatorInstance.storage = new MockStorageManager();
  navigatorInstance.mediaDevices = new MockMediaDevices();

  const screenInstance = new MockScreen();
  const attributes = new Map();
  const fontsSet = new FontFaceSet();

  const windowObj = {
    navigator: navigatorInstance,
    screen: screenInstance,
    WebGLRenderingContext,
    WebGL2RenderingContext,
    GPUAdapter,
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    FontFaceSet,
    CSSStyleDeclaration,
    AudioBuffer,
    document: {
      fonts: fontsSet,
      createElement(tag) {
        if (tag === "canvas") return new HTMLCanvasElement();
        return {};
      },
      documentElement: {
        setAttribute(k, v) { attributes.set(k, v); },
        hasAttribute(k) { return attributes.has(k); }
      }
    },
    addEventListener(type, fn) {
      if (type === "message") listeners.push(fn);
    },
    dispatchSettings(settings) {
      for (const fn of listeners) {
        fn({ source: windowObj, data: { source: "device-veil-settings", settings } });
      }
    }
  };

  let dpr = 2;
  let outerW = 3440;
  let outerH = 1392;
  let sx = -1920;
  let sy = 20;
  Object.defineProperties(windowObj, {
    devicePixelRatio: { get: () => dpr, configurable: true },
    outerWidth: { get: () => outerW, configurable: true },
    outerHeight: { get: () => outerH, configurable: true },
    screenX: { get: () => sx, configurable: true },
    screenY: { get: () => sy, configurable: true },
    screenLeft: { get: () => sx, configurable: true },
    screenTop: { get: () => sy, configurable: true }
  });

  const context = vm.createContext({
    window: windowObj,
    navigator: navigatorInstance,
    document: windowObj.document,
    crypto: crypto.webcrypto,
    Set,
    Map,
    WeakMap,
    WeakSet,
    Object,
    Uint32Array,
    Math
  });

  vm.runInContext(mainScriptSource, context);
  return {
    window: windowObj,
    navigator: navigatorInstance,
    screen: screenInstance,
    classes: { CanvasRenderingContext2D, CSSStyleDeclaration, AudioBuffer, GPUAdapter }
  };
}

test("masks navigator, languages, peripherals, and userAgentData without DOM leak", async () => {
  const { window, navigator } = createMockBrowserEnv();

  assert.equal(navigator.platform, "Win32");
  assert.equal(navigator.hardwareConcurrency, 8);
  assert.equal(navigator.deviceMemory, 8);
  assert.equal(navigator.maxTouchPoints, 0);
  assert.deepEqual([...navigator.languages], ["ru", "en-US", "en"]);
  assert.equal(navigator.connection.downlink, 10);
  assert.equal(navigator.connection.rtt, 50);
  assert.equal(navigator.connection.saveData, false);
  assert.equal(window.document.documentElement.hasAttribute("data-device-veil"), false);

  const battery = await navigator.getBattery();
  assert.equal(battery.charging, true);
  assert.equal(battery.level, 1);

  const storageEst = await navigator.storage.estimate();
  assert.equal(storageEst.quota, 107374182400);
  assert.equal(storageEst.usage, 0);

  const devices = await navigator.mediaDevices.enumerateDevices();
  assert.equal(devices.length, 3);

  const partial = await navigator.userAgentData.getHighEntropyValues(["platform", "architecture"]);
  assert.equal(partial.platform, "Windows");
  assert.equal(partial.architecture, "x86");
  assert.equal("platformVersion" in partial, false);
});

test("masks screen resolution, DPR, window bounds, and supports presets", () => {
  const { window, screen } = createMockBrowserEnv();

  assert.equal(screen.width, 1920);
  assert.equal(screen.height, 1080);
  assert.equal(screen.availWidth, 1920);
  assert.equal(screen.availHeight, 1040);
  assert.equal(screen.availLeft, 0);
  assert.equal(screen.colorDepth, 24);
  assert.equal(window.devicePixelRatio, 1);
  assert.equal(window.outerWidth, 1920);
  assert.equal(window.outerHeight, 1040);
  assert.equal(window.screenX, 0);

  window.dispatchSettings({ enabled: true, maskScreen: true, screenPreset: "1536x864" });
  assert.equal(screen.width, 1536);
  assert.equal(screen.height, 864);
  assert.equal(window.devicePixelRatio, 1.25);

  window.dispatchSettings({ enabled: true, maskScreen: false });
  assert.equal(screen.width, 3440);
  assert.equal(window.devicePixelRatio, 2);
});

test("masks WebGL with realistic Chromium/Intel ANGLE profile and WebGPU info", () => {
  const { window, classes } = createMockBrowserEnv();
  const gl = new window.WebGL2RenderingContext();
  const gpu = new classes.GPUAdapter();

  assert.equal(gl.getParameter(0x1F00), "WebKit");
  assert.equal(gl.getParameter(0x1F01), "WebKit WebGL");
  assert.equal(gl.getParameter(0x9245), "Google Inc. (Intel)");
  assert.match(gl.getParameter(0x9246), /Intel\(R\) UHD Graphics 630/);
  assert.equal(gl.getParameter(0x0D33), 16384);
  assert.equal(gl.getParameter(0x1F02), "WebGL 2.0");
  assert.equal(gpu.info.vendor, "intel");
  assert.match(gl.getParameter.toString(), /\[native code\]/);
});

test("filters non-standard fonts while preserving standard and page webfonts, and adds deterministic Canvas/Audio noise", () => {
  const { window, classes } = createMockBrowserEnv();

  const ctx = new classes.CanvasRenderingContext2D();
  ctx.font = '72px "JetBrains Mono", monospace';
  assert.equal(ctx.font, "72px monospace");

  ctx.font = '16px "Segoe UI", sans-serif';
  assert.equal(ctx.font, '16px "Segoe UI", sans-serif');

  ctx.font = '16px "CustomWebFont", sans-serif';
  assert.equal(ctx.font, '16px "CustomWebFont", sans-serif');

  assert.equal(window.document.fonts.check('12px "JetBrains Mono"'), false);
  assert.equal(window.document.fonts.check('12px "Arial"'), true);
  assert.equal(window.document.fonts.check('12px "CustomWebFont"'), true);

  const style = new classes.CSSStyleDeclaration();
  style.fontFamily = '"Cascadia Code", Consolas, monospace';
  assert.equal(style.fontFamily, "Consolas, monospace");

  const img1 = ctx.getImageData(0, 0, 16, 16);
  const img2 = ctx.getImageData(0, 0, 16, 16);
  assert.deepEqual([...img1.data], [...img2.data]);
  assert.equal([...img1.data].some((v) => v !== 128), true);

  const buf = new classes.AudioBuffer();
  const ch1 = [...buf.getChannelData(0)];
  const ch2 = [...buf.getChannelData(0)];
  assert.deepEqual(ch1, ch2);
  assert.equal(ch1.some((v) => v !== 0.25), true);
});
