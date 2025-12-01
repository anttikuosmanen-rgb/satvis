import { describe, test, expect, beforeEach, vi } from "vitest";
import { DeviceDetect } from "../modules/util/DeviceDetect.js";

describe("DeviceDetect", () => {
  // Save original values
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset window object before each test
    global.window = {
      self: global.window,
      top: global.window,
      matchMedia: vi.fn(),
      navigator: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        standalone: false,
      },
      screen: {
        width: 1920,
        height: 1080,
      },
      devicePixelRatio: 1,
    };
  });

  describe("inIframe", () => {
    test("returns false when not in iframe (window.self === window.top)", () => {
      global.window.self = global.window;
      global.window.top = global.window;

      const result = DeviceDetect.inIframe();
      expect(result).toBe(false);
    });

    test("returns true when in iframe (window.self !== window.top)", () => {
      global.window.self = { name: "iframe" };
      global.window.top = { name: "parent" };

      const result = DeviceDetect.inIframe();
      expect(result).toBe(true);
    });

    test("returns true when accessing window.top throws error (cross-origin iframe)", () => {
      Object.defineProperty(global.window, "top", {
        get: () => {
          throw new Error("Cross-origin access denied");
        },
      });

      const result = DeviceDetect.inIframe();
      expect(result).toBe(true);
    });
  });

  describe("hasTouch", () => {
    test("returns true for touch devices (pointer: coarse)", () => {
      global.window.matchMedia = vi.fn((query) => ({
        matches: query === "(pointer: coarse)",
      }));

      const result = DeviceDetect.hasTouch();
      expect(result).toBe(true);
      expect(global.window.matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
    });

    test("returns false for non-touch devices (pointer: fine)", () => {
      global.window.matchMedia = vi.fn((query) => ({
        matches: false,
      }));

      const result = DeviceDetect.hasTouch();
      expect(result).toBe(false);
    });
  });

  describe("canHover", () => {
    test("returns true for hover-capable devices", () => {
      global.window.matchMedia = vi.fn((query) => ({
        matches: false, // hover: none is false, meaning hover is available
      }));

      const result = DeviceDetect.canHover();
      expect(result).toBe(true);
      expect(global.window.matchMedia).toHaveBeenCalledWith("(hover: none)");
    });

    test("returns false for non-hover devices (touch-only)", () => {
      global.window.matchMedia = vi.fn((query) => ({
        matches: query === "(hover: none)",
      }));

      const result = DeviceDetect.canHover();
      expect(result).toBe(false);
    });
  });

  describe("isIos", () => {
    test("returns true for iPhone user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)";

      const result = DeviceDetect.isIos();
      expect(result).toBe(true);
    });

    test("returns true for iPad user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X)";

      const result = DeviceDetect.isIos();
      expect(result).toBe(true);
    });

    test("returns true for iPod user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0 like Mac OS X)";

      const result = DeviceDetect.isIos();
      expect(result).toBe(true);
    });

    test("returns false for Android user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36";

      const result = DeviceDetect.isIos();
      expect(result).toBe(false);
    });

    test("returns false for Desktop Chrome user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/91.0";

      const result = DeviceDetect.isIos();
      expect(result).toBe(false);
    });
  });

  describe("isSafari", () => {
    test("returns true for Safari user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15";

      const result = DeviceDetect.isSafari();
      expect(result).toBe(true);
    });

    test("returns false for Chrome user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/91.0.4472.124";

      const result = DeviceDetect.isSafari();
      expect(result).toBe(false);
    });

    test("returns false for Firefox user agent", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0";

      const result = DeviceDetect.isSafari();
      expect(result).toBe(false);
    });
  });

  describe("isInStandaloneMode", () => {
    test("returns true when in PWA standalone mode", () => {
      global.window.navigator.standalone = true;

      const result = DeviceDetect.isInStandaloneMode();
      expect(result).toBe(true);
    });

    test("returns false when not in standalone mode", () => {
      global.window.navigator.standalone = false;

      const result = DeviceDetect.isInStandaloneMode();
      expect(result).toBe(false);
    });

    test("returns false when standalone property does not exist", () => {
      delete global.window.navigator.standalone;

      const result = DeviceDetect.isInStandaloneMode();
      expect(result).toBe(false);
    });
  });

  describe("isiPhoneWithNotch", () => {
    test("returns true for iPhone X with correct aspect ratio", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)";
      global.window.screen.height = 812;
      global.window.screen.width = 375;

      const result = DeviceDetect.isiPhoneWithNotch();
      expect(result).toBe(true);
    });

    test("returns false for non-iPhone device", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (Linux; Android 10)";
      global.window.screen.height = 812;
      global.window.screen.width = 375;

      const result = DeviceDetect.isiPhoneWithNotch();
      expect(result).toBe(false);
    });

    test("returns false for older iPhone without notch", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)";
      global.window.screen.height = 667;
      global.window.screen.width = 375;

      const result = DeviceDetect.isiPhoneWithNotch();
      expect(result).toBe(false);
    });
  });

  describe("isiPhoneWithNotchVisible", () => {
    test("returns true for iPhone X in standalone mode", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) Safari/605.1.15";
      global.window.navigator.standalone = true;
      global.window.screen.height = 812;
      global.window.screen.width = 375;

      const result = DeviceDetect.isiPhoneWithNotchVisible();
      expect(result).toBe(true);
    });

    test("returns false for iPhone X in Safari browser mode", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) Safari/605.1.15";
      global.window.navigator.standalone = false;
      global.window.screen.height = 812;
      global.window.screen.width = 375;

      const result = DeviceDetect.isiPhoneWithNotchVisible();
      expect(result).toBe(false);
    });

    test("returns true for iPhone X in Chrome (not Safari)", () => {
      global.window.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) CriOS/91.0";
      global.window.navigator.standalone = false;
      global.window.screen.height = 812;
      global.window.screen.width = 375;

      const result = DeviceDetect.isiPhoneWithNotchVisible();
      expect(result).toBe(true);
    });
  });

  describe("getiPhoneModel", () => {
    test("identifies iPhone X/XS (812/375 ratio)", () => {
      global.window.screen.height = 812;
      global.window.screen.width = 375;
      global.window.devicePixelRatio = 3;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone X, iPhone XS");
    });

    test("identifies iPhone XR (896/414 ratio, devicePixelRatio 2)", () => {
      global.window.screen.height = 896;
      global.window.screen.width = 414;
      global.window.devicePixelRatio = 2;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone XR");
    });

    test("identifies iPhone XS Max (896/414 ratio, devicePixelRatio 3)", () => {
      global.window.screen.height = 896;
      global.window.screen.width = 414;
      global.window.devicePixelRatio = 3;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone XS Max");
    });

    test("identifies iPhone 6/7/8 (667/375 ratio, devicePixelRatio 2)", () => {
      global.window.screen.height = 667;
      global.window.screen.width = 375;
      global.window.devicePixelRatio = 2;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone 6, 6s, 7 or 8");
    });

    test("identifies iPhone 6 Plus/7 Plus/8 Plus (736/414 ratio)", () => {
      global.window.screen.height = 736;
      global.window.screen.width = 414;
      global.window.devicePixelRatio = 3;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone 6 Plus, 6s Plus, 7 Plus or 8 Plus");
    });

    test("identifies iPhone 5/SE (1.775 ratio)", () => {
      global.window.screen.height = 568;
      global.window.screen.width = 320;
      global.window.devicePixelRatio = 2;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone 5, 5C, 5S, SE or 6, 6s, 7 and 8 (display zoom)");
    });

    test("identifies iPhone 4/4S (1.5 ratio, devicePixelRatio 2)", () => {
      global.window.screen.height = 480;
      global.window.screen.width = 320;
      global.window.devicePixelRatio = 2;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone 4 or 4s");
    });

    test("identifies iPhone 1/3G/3GS (1.5 ratio, devicePixelRatio 1)", () => {
      global.window.screen.height = 480;
      global.window.screen.width = 320;
      global.window.devicePixelRatio = 1;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("iPhone 1, 3G or 3GS");
    });

    test("returns 'Not an iPhone' for non-iPhone device", () => {
      global.window.screen.height = 1080;
      global.window.screen.width = 1920;
      global.window.devicePixelRatio = 1;

      const model = DeviceDetect.getiPhoneModel();
      expect(model).toBe("Not an iPhone");
    });
  });
});
