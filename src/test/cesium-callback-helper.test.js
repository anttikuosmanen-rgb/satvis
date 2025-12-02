import { describe, it, expect, beforeEach, vi } from "vitest";
import { CesiumCallbackHelper } from "../modules/util/CesiumCallbackHelper.js";

// Mock Cesium JulianDate
vi.mock("@cesium/engine", () => ({
  JulianDate: {
    secondsDifference: vi.fn((time1, time2) => {
      // Mock implementation: return difference in seconds
      if (time1?.seconds !== undefined && time2?.seconds !== undefined) {
        return time1.seconds - time2.seconds;
      }
      return 0;
    }),
  },
}));

describe("CesiumCallbackHelper", () => {
  let mockViewer;
  let mockEvent;
  let eventListeners;

  beforeEach(() => {
    eventListeners = [];

    // Create mock event that stores listeners
    mockEvent = {
      addEventListener: vi.fn((listener) => {
        eventListeners.push(listener);
        // Return removal function
        return () => {
          const index = eventListeners.indexOf(listener);
          if (index > -1) {
            eventListeners.splice(index, 1);
          }
        };
      }),
    };

    // Create mock viewer with clock
    mockViewer = {
      clock: {
        currentTime: { seconds: 0 },
        onTick: mockEvent,
      },
    };
  });

  describe("createPeriodicTickCallback", () => {
    it("should register an event listener", () => {
      const callback = vi.fn();
      const refreshRate = 5;

      CesiumCallbackHelper.createPeriodicTickCallback(mockViewer, refreshRate, callback);

      expect(mockEvent.addEventListener).toHaveBeenCalledTimes(1);
      expect(mockEvent.addEventListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should not execute callback before refreshRate ticks", () => {
      const callback = vi.fn();
      const refreshRate = 5;

      CesiumCallbackHelper.createPeriodicTickCallback(mockViewer, refreshRate, callback);

      // Trigger events less than refreshRate times
      eventListeners[0](); // Tick 1
      eventListeners[0](); // Tick 2
      eventListeners[0](); // Tick 3
      eventListeners[0](); // Tick 4

      expect(callback).not.toHaveBeenCalled();
    });

    it("should execute callback after exactly refreshRate ticks", () => {
      const callback = vi.fn();
      const refreshRate = 3;

      CesiumCallbackHelper.createPeriodicTickCallback(mockViewer, refreshRate, callback);

      // Trigger events refreshRate + 1 times (callback fires on (refreshRate+1)th tick)
      eventListeners[0](); // Tick 1 (counter = 0, increment to 1)
      eventListeners[0](); // Tick 2 (counter = 1, increment to 2)
      eventListeners[0](); // Tick 3 (counter = 2, increment to 3)
      eventListeners[0](); // Tick 4 (counter = 3, not < 3, fire callback)

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(mockViewer.clock.currentTime);
    });

    it("should execute callback periodically every refreshRate ticks", () => {
      const callback = vi.fn();
      const refreshRate = 2;

      CesiumCallbackHelper.createPeriodicTickCallback(mockViewer, refreshRate, callback);

      // First period (fires on 3rd tick for refreshRate=2)
      eventListeners[0](); // Tick 1 (counter: 0 -> 1)
      eventListeners[0](); // Tick 2 (counter: 1 -> 2)
      eventListeners[0](); // Tick 3 (counter: 2, fire callback, reset to 0)

      // Second period
      eventListeners[0](); // Tick 4 (counter: 0 -> 1)
      eventListeners[0](); // Tick 5 (counter: 1 -> 2)
      eventListeners[0](); // Tick 6 (counter: 2, fire callback, reset to 0)

      // Third period
      eventListeners[0](); // Tick 7 (counter: 0 -> 1)
      eventListeners[0](); // Tick 8 (counter: 1 -> 2)
      eventListeners[0](); // Tick 9 (counter: 2, fire callback, reset to 0)

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it("should return a removal function", () => {
      const callback = vi.fn();
      const refreshRate = 2;

      const removeListener = CesiumCallbackHelper.createPeriodicTickCallback(mockViewer, refreshRate, callback);

      expect(removeListener).toBeInstanceOf(Function);
      expect(eventListeners).toHaveLength(1);

      // Call removal function
      removeListener();

      expect(eventListeners).toHaveLength(0);
    });

    it("should use custom event if provided", () => {
      const customEvent = {
        addEventListener: vi.fn(() => () => {}),
      };
      const callback = vi.fn();

      CesiumCallbackHelper.createPeriodicTickCallback(mockViewer, 5, callback, customEvent);

      expect(customEvent.addEventListener).toHaveBeenCalledTimes(1);
      expect(mockEvent.addEventListener).not.toHaveBeenCalled();
    });
  });

  describe("createPeriodicTimeCallback", () => {
    it("should register an event listener", () => {
      const callback = vi.fn();
      const refreshRate = 1.0; // 1 second

      CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, refreshRate, callback);

      expect(mockEvent.addEventListener).toHaveBeenCalledTimes(1);
      expect(mockEvent.addEventListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should not execute callback before refreshRate seconds elapse", () => {
      const callback = vi.fn();
      const refreshRate = 2.0; // 2 seconds

      mockViewer.clock.currentTime = { seconds: 0 };

      CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, refreshRate, callback);

      // Advance time by less than refreshRate
      mockViewer.clock.currentTime = { seconds: 1.5 };
      eventListeners[0]();

      expect(callback).not.toHaveBeenCalled();
    });

    it("should execute callback after refreshRate seconds elapse", () => {
      const callback = vi.fn();
      const refreshRate = 2.0; // 2 seconds

      mockViewer.clock.currentTime = { seconds: 0 };

      CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, refreshRate, callback);

      // Advance time by exactly refreshRate
      mockViewer.clock.currentTime = { seconds: 2.0 };
      eventListeners[0]();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(mockViewer.clock.currentTime);
    });

    it("should execute callback periodically every refreshRate seconds", () => {
      const callback = vi.fn();
      const refreshRate = 1.0; // 1 second

      mockViewer.clock.currentTime = { seconds: 0 };

      CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, refreshRate, callback);

      // First period - 1 second
      mockViewer.clock.currentTime = { seconds: 1.0 };
      eventListeners[0](); // callback #1

      // Second period - 2 seconds
      mockViewer.clock.currentTime = { seconds: 2.0 };
      eventListeners[0](); // callback #2

      // Third period - 3 seconds
      mockViewer.clock.currentTime = { seconds: 3.0 };
      eventListeners[0](); // callback #3

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it("should handle backward time changes using absolute difference", () => {
      const callback = vi.fn();
      const refreshRate = 2.0;

      mockViewer.clock.currentTime = { seconds: 10 };

      CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, refreshRate, callback);

      // Time goes backward (e.g., user drags timeline)
      mockViewer.clock.currentTime = { seconds: 8 };
      eventListeners[0]();

      // Math.abs(8 - 10) = 2, which equals refreshRate
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should return a removal function", () => {
      const callback = vi.fn();
      const refreshRate = 1.0;

      const removeListener = CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, refreshRate, callback);

      expect(removeListener).toBeInstanceOf(Function);
      expect(eventListeners).toHaveLength(1);

      // Call removal function
      removeListener();

      expect(eventListeners).toHaveLength(0);
    });

    it("should use custom event if provided", () => {
      const customEvent = {
        addEventListener: vi.fn(() => () => {}),
      };
      const callback = vi.fn();

      CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, 1.0, callback, customEvent);

      expect(customEvent.addEventListener).toHaveBeenCalledTimes(1);
      expect(mockEvent.addEventListener).not.toHaveBeenCalled();
    });

    it("should update lastUpdated timestamp after callback execution", () => {
      const callback = vi.fn();
      const refreshRate = 1.0;

      mockViewer.clock.currentTime = { seconds: 0 };

      CesiumCallbackHelper.createPeriodicTimeCallback(mockViewer, refreshRate, callback);

      // First callback at 1 second
      mockViewer.clock.currentTime = { seconds: 1.0 };
      eventListeners[0]();
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance by 0.5 seconds (not enough for next callback)
      mockViewer.clock.currentTime = { seconds: 1.5 };
      eventListeners[0]();
      expect(callback).toHaveBeenCalledTimes(1); // Still 1

      // Advance to 2.0 seconds total (1 second from last callback)
      mockViewer.clock.currentTime = { seconds: 2.0 };
      eventListeners[0]();
      expect(callback).toHaveBeenCalledTimes(2); // Now 2
    });
  });
});
