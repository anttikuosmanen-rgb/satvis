import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PushManager } from "../modules/util/PushManager.js";
import dayjs from "dayjs";

describe("PushManager", () => {
  let pushManager;
  let mockNotification;
  let mockServiceWorkerRegistration;

  beforeEach(() => {
    // Reset timers
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));

    // Mock Notification API
    mockNotification = {
      permission: "granted",
      requestPermission: vi.fn((callback) => {
        callback("granted");
      }),
    };
    global.Notification = mockNotification;

    // Mock ServiceWorkerRegistration
    mockServiceWorkerRegistration = {
      showNotification: vi.fn().mockResolvedValue(undefined),
    };

    // Mock navigator.serviceWorker
    global.navigator = {
      ...global.navigator,
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
      },
    };

    // Mock ServiceWorkerRegistration constructor check
    global.ServiceWorkerRegistration = class {};

    // Mock console methods
    vi.spyOn(console, "log").mockImplementation(() => {});

    pushManager = new PushManager({ icon: "test-icon.png" });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete global.window.webkit;
  });

  describe("constructor", () => {
    it("should initialize with options", () => {
      const options = { icon: "custom-icon.png" };
      const pm = new PushManager(options);

      expect(pm.options).toEqual(options);
    });

    it("should initialize with empty timers array", () => {
      expect(pushManager.timers).toEqual([]);
    });

    it("should initialize with default empty options if not provided", () => {
      const pm = new PushManager();

      expect(pm.options).toEqual({});
    });
  });

  describe("available getter", () => {
    it("should return true when webkit is present (iOS)", () => {
      global.window.webkit = { messageHandlers: { iosNotify: {} } };

      expect(pushManager.available).toBe(true);
    });

    it("should return false when Notification API is not supported", () => {
      delete global.Notification;

      expect(pushManager.available).toBe(false);
      expect(console.log).toHaveBeenCalledWith("Notification API not supported!");
    });

    it("should return true even when ServiceWorkerRegistration is not supported (fallback to Notification)", () => {
      delete global.ServiceWorkerRegistration;

      // ServiceWorkerRegistration is no longer required - we fall back to regular Notification
      expect(pushManager.available).toBe(true);
    });

    it("should return true when permission is granted", () => {
      mockNotification.permission = "granted";

      expect(pushManager.available).toBe(true);
    });

    it("should return true and request permission when permission is default", () => {
      mockNotification.permission = "default";

      expect(pushManager.available).toBe(true);
      expect(mockNotification.requestPermission).toHaveBeenCalled();
    });

    it("should return false when permission is denied", () => {
      mockNotification.permission = "denied";

      expect(pushManager.available).toBe(false);
    });

    it("should return false for unknown permission state", () => {
      mockNotification.permission = "unknown";

      expect(pushManager.available).toBe(false);
    });
  });

  describe("requestPermission", () => {
    it("should call Notification.requestPermission", () => {
      pushManager.requestPermission();

      expect(mockNotification.requestPermission).toHaveBeenCalled();
    });

    it("should log permission result", () => {
      pushManager.requestPermission();

      expect(console.log).toHaveBeenCalledWith("Notifcation permission result: granted");
    });
  });

  describe("active getter", () => {
    it("should return false when no timers are active", () => {
      expect(pushManager.active).toBe(false);
    });

    it("should return true when timers are active", () => {
      pushManager.timers.push({ id: 123, date: dayjs(), message: "test" });

      expect(pushManager.active).toBe(true);
    });
  });

  describe("clearTimers", () => {
    it("should clear all timers", () => {
      const timer1 = setTimeout(() => {}, 1000);
      const timer2 = setTimeout(() => {}, 2000);

      pushManager.timers = [
        { id: timer1, date: dayjs(), message: "test1" },
        { id: timer2, date: dayjs(), message: "test2" },
      ];

      pushManager.clearTimers();

      expect(pushManager.timers).toEqual([]);
    });

    it("should call clearTimeout for each timer", () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const timer1 = setTimeout(() => {}, 1000);
      const timer2 = setTimeout(() => {}, 2000);

      pushManager.timers = [
        { id: timer1, date: dayjs(), message: "test1" },
        { id: timer2, date: dayjs(), message: "test2" },
      ];

      pushManager.clearTimers();

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer2);
    });
  });

  describe("persistentNotification", () => {
    it("should not show notification if not available", () => {
      mockNotification.permission = "denied";

      pushManager.persistentNotification("Test message");

      expect(navigator.serviceWorker.getRegistration).not.toHaveBeenCalled();
    });

    it("should get service worker registration", async () => {
      pushManager.persistentNotification("Test message");

      await vi.waitFor(() => {
        expect(navigator.serviceWorker.getRegistration).toHaveBeenCalled();
      });
    });

    it("should show notification with merged options", async () => {
      pushManager.persistentNotification("Test message", { tag: "test-tag" });

      await vi.waitFor(() => {
        expect(mockServiceWorkerRegistration.showNotification).toHaveBeenCalledWith("Test message", { icon: "test-icon.png", tag: "test-tag" });
      });
    });

    it("should override default options with provided options", async () => {
      pushManager.persistentNotification("Test message", {
        icon: "override-icon.png",
      });

      await vi.waitFor(() => {
        expect(mockServiceWorkerRegistration.showNotification).toHaveBeenCalledWith("Test message", { icon: "override-icon.png" });
      });
    });

    it("should handle service worker registration error and fall back to Notification", async () => {
      const NotificationMock = vi.fn();
      global.Notification = Object.assign(NotificationMock, mockNotification);
      navigator.serviceWorker.getRegistration = vi.fn().mockRejectedValue(new Error("Registration failed"));

      pushManager.persistentNotification("Test message");

      await vi.waitFor(() => {
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Service Worker registration error"));
        expect(NotificationMock).toHaveBeenCalledWith("Test message", { icon: "test-icon.png" });
      });
    });

    it("should fall back to Notification when service worker registration returns undefined", async () => {
      const NotificationMock = vi.fn();
      global.Notification = Object.assign(NotificationMock, mockNotification);
      navigator.serviceWorker.getRegistration = vi.fn().mockResolvedValue(undefined);

      pushManager.persistentNotification("Test message", { tag: "fallback-test" });

      await vi.waitFor(() => {
        expect(NotificationMock).toHaveBeenCalledWith("Test message", { icon: "test-icon.png", tag: "fallback-test" });
      });
    });

    it("should fall back to Notification when navigator.serviceWorker is not available", async () => {
      const NotificationMock = vi.fn();
      global.Notification = Object.assign(NotificationMock, mockNotification);
      delete navigator.serviceWorker;

      pushManager.persistentNotification("Test message");

      await vi.waitFor(() => {
        expect(NotificationMock).toHaveBeenCalledWith("Test message", { icon: "test-icon.png" });
      });
    });

    it("should log error when fallback Notification fails", async () => {
      const NotificationMock = vi.fn().mockImplementation(() => {
        throw new Error("Notification blocked");
      });
      global.Notification = Object.assign(NotificationMock, mockNotification);
      navigator.serviceWorker.getRegistration = vi.fn().mockResolvedValue(undefined);

      pushManager.persistentNotification("Test message");

      await vi.waitFor(() => {
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Notification API error"));
      });
    });
  });

  describe("notifyInMs", () => {
    it("should not schedule notification if not available", () => {
      mockNotification.permission = "denied";

      pushManager.notifyInMs(5000, "Test message");

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Notify "Test message"'));
    });

    it("should log notification scheduling", () => {
      pushManager.notifyInMs(5000, "Test message");

      expect(console.log).toHaveBeenCalledWith('Notify "Test message" in 5s');
    });

    it("should schedule notification with setTimeout", () => {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      pushManager.notifyInMs(3000, "Test message");

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
    });

    it("should trigger persistentNotification after delay", async () => {
      const persistentNotificationSpy = vi.spyOn(pushManager, "persistentNotification");

      pushManager.notifyInMs(1000, "Test message", { tag: "test" });

      vi.advanceTimersByTime(1000);

      expect(persistentNotificationSpy).toHaveBeenCalledWith("Test message", {
        tag: "test",
      });
    });
  });

  describe("notifyAtDate", () => {
    it("should not schedule notification if not available", () => {
      mockNotification.permission = "denied";
      const futureDate = dayjs().add(1, "hour").toDate();

      pushManager.notifyAtDate(futureDate, "Test message");

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Notify "Test message"'));
    });

    it("should not schedule notification for past dates", () => {
      const pastDate = dayjs().subtract(1, "hour").toDate();

      pushManager.notifyAtDate(pastDate, "Test message");

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Notify "Test message"'));
    });

    it("should log notification scheduling", () => {
      const futureDate = dayjs().add(1, "hour").toDate();

      pushManager.notifyAtDate(futureDate, "Test message");

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Notify "Test message" at'));
    });

    it.skip("should ignore duplicate notifications within 10 seconds", () => {
      const futureDate = dayjs().add(1, "hour");
      const nearDuplicate = futureDate.add(5, "seconds");

      pushManager.notifyAtDate(futureDate.toDate(), "Test message 1");
      pushManager.notifyAtDate(nearDuplicate.toDate(), "Test message 2");

      expect(console.log).toHaveBeenCalledWith("Ignore duplicate entry");
      expect(pushManager.timers).toHaveLength(1);
    });

    it.skip("should not ignore notifications more than 10 seconds apart", () => {
      const futureDate1 = dayjs().add(1, "hour");
      const futureDate2 = futureDate1.add(15, "seconds");

      pushManager.notifyAtDate(futureDate1.toDate(), "Test message 1");
      pushManager.notifyAtDate(futureDate2.toDate(), "Test message 2");

      expect(pushManager.timers).toHaveLength(2);
    });

    it("should use iOS webkit notification on iOS", () => {
      global.window.webkit = {
        messageHandlers: {
          iosNotify: {
            postMessage: vi.fn(),
          },
        },
      };

      const futureDate = dayjs().add(1, "hour").toDate();
      pushManager.notifyAtDate(futureDate, "Test message");

      expect(window.webkit.messageHandlers.iosNotify.postMessage).toHaveBeenCalledWith({
        date: dayjs(futureDate).unix(),
        delay: 3600,
        message: "Test message",
      });
    });

    it("should schedule timeout for non-iOS platforms", () => {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      const futureDate = dayjs().add(30, "minutes").toDate();

      pushManager.notifyAtDate(futureDate, "Test message");

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
      expect(pushManager.timers).toHaveLength(1);
    });

    it("should store timer information for non-iOS platforms", () => {
      const futureDate = dayjs().add(1, "hour").toDate();

      pushManager.notifyAtDate(futureDate, "Test message");

      expect(pushManager.timers[0]).toMatchObject({
        id: expect.anything(), // Timer ID can be number or object depending on environment
        date: futureDate,
        message: "Test message",
      });
    });
  });
});
