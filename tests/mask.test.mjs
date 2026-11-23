import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const mainScriptSource = fs.readFileSync(
  path.resolve("content/main.js"),
  "utf8"
);

function createMockBrowserEnv() {
  const listeners = [];

  class MockNavigator {
    get platform() { return "MacIntel"; }
    get hardwareConcurrency() { return 16; }
    get deviceMemory() { return 32; }
    get maxTouchPoints() { return 5; }
  }

  class MockUserAgentData {
    get platform() { return "macOS"; }
    get model() { return "MacBookPro18,1"; }
    async getHighEntropyValues(hints) {
      const full = {
        brands: [{ brand: "Chromium", version: "130" }],
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

  class MockScreen {
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
        0x1F02: "WebGL 1.0"
      };
      return map[param] ?? null;
    }
  }

  class WebGL2RenderingContext extends WebGLRenderingContext {}

  const navigatorInstance = new MockNavigator();
  navigatorInstance.userAgentData = new MockUserAgentData();
  const screenInstance = new MockScreen();
  const attributes = new Map();

  const windowObj = {
    navigator: navigatorInstance,
    screen: screenInstance,
    WebGLRenderingContext,
    WebGL2RenderingContext,
    document: {
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

  const context = vm.createContext({
    window: windowObj,
    navigator: navigatorInstance,
    document: windowObj.document,
    Set,
    Object
  });

  vm.runInContext(mainScriptSource, context);
  return { window: windowObj, navigator: navigatorInstance, screen: screenInstance };
}

test("masks navigator, screen, and userAgentData by default without DOM attribute leak", async () => {
  const { window, navigator, screen } = createMockBrowserEnv();

  assert.equal(navigator.platform, "Win32");
  assert.equal(navigator.hardwareConcurrency, 4);
  assert.equal(navigator.deviceMemory, 8);
  assert.equal(navigator.maxTouchPoints, 0);
  assert.equal(screen.colorDepth, 24);
  assert.equal(screen.pixelDepth, 24);
  assert.equal(navigator.userAgentData.platform, "Windows");
  assert.equal(navigator.userAgentData.model, "");
  assert.equal(window.document.documentElement.hasAttribute("data-device-veil"), false);

  const partial = await navigator.userAgentData.getHighEntropyValues(["platform", "architecture"]);
  assert.equal(partial.platform, "Windows");
  assert.equal(partial.architecture, "x86");
  assert.equal("platformVersion" in partial, false);
  assert.equal("model" in partial, false);
});

test("masks WebGL vendor, renderer, and debug renderer info parameters", () => {
  const { window } = createMockBrowserEnv();
  const gl1 = new window.WebGLRenderingContext();
  const gl2 = new window.WebGL2RenderingContext();

  for (const gl of [gl1, gl2]) {
    assert.equal(gl.getParameter(0x1F00), "Generic");
    assert.equal(gl.getParameter(0x1F01), "Generic GPU");
    assert.equal(gl.getParameter(0x9245), "Generic");
    assert.equal(gl.getParameter(0x9246), "Generic GPU");
    assert.equal(gl.getParameter(0x1F02), "WebGL 1.0");
  }
});

test("respects master toggle and granular module toggles via settings message", async () => {
  const { window, navigator } = createMockBrowserEnv();
  const gl = new window.WebGLRenderingContext();

  window.dispatchSettings({ enabled: true, maskNavigator: false, maskWebGL: true });
  assert.equal(navigator.platform, "MacIntel");
  assert.equal(navigator.hardwareConcurrency, 16);
  assert.equal(gl.getParameter(0x9246), "Generic GPU");

  window.dispatchSettings({ enabled: true, maskNavigator: true, maskWebGL: false });
  assert.equal(navigator.platform, "Win32");
  assert.equal(gl.getParameter(0x9246), "Apple M3 Max GPU");

  window.dispatchSettings({ enabled: false, maskNavigator: true, maskWebGL: true });
  assert.equal(navigator.platform, "MacIntel");
  assert.equal(gl.getParameter(0x1F01), "Apple M3 Max");
  const raw = await navigator.userAgentData.getHighEntropyValues(["platform", "model"]);
  assert.equal(raw.platform, "macOS");
  assert.equal(raw.model, "MacBookPro18,1");
});
