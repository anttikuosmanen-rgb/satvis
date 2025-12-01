import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CesiumPerformanceStats } from "../modules/util/CesiumPerformanceStats.js";

// Mock Cesium getTimestamp
vi.mock("@cesium/engine", () => ({
  getTimestamp: vi.fn(() => performance.now()),
}));

describe("CesiumPerformanceStats", () => {
  let mockScene;
  let preUpdateListeners;
  let postRenderListeners;
  let perfStats;

  beforeEach(() => {
    preUpdateListeners = [];
    postRenderListeners = [];

    // Mock scene with event listeners
    mockScene = {
      requestRenderMode: true,
      preUpdate: {
        addEventListener: vi.fn((listener) => {
          preUpdateListeners.push(listener);
        }),
      },
      postRender: {
        addEventListener: vi.fn((listener) => {
          postRenderListeners.push(listener);
        }),
      },
    };

    // Mock performance API
    vi.spyOn(performance, "mark").mockImplementation(() => {});
    vi.spyOn(performance, "measure").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    // Mock performance.now for predictable timestamps
    let currentTime = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      currentTime += 16.67; // ~60 FPS
      return currentTime;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with default sample count of 60", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(perfStats.sampleCount).toBe(60);
    });

    it("should initialize index to 0", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(perfStats.idx).toBe(0);
    });

    it("should initialize empty postRenderTimes array", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(perfStats.postRenderTimes).toEqual([]);
    });

    it("should initialize stats to 0", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(perfStats.avgFps).toBe(0);
      expect(perfStats.avgFrameTime).toBe(0);
      expect(perfStats.worstFrameTime).toBe(0);
    });

    it("should disable scene requestRenderMode", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(mockScene.requestRenderMode).toBe(false);
    });

    it("should register preUpdate event listener", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(mockScene.preUpdate.addEventListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should register postRender event listener", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(mockScene.postRender.addEventListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should set discardNext to true by default", () => {
      perfStats = new CesiumPerformanceStats(mockScene);

      expect(perfStats.discardNext).toBe(true);
    });
  });

  describe("event listeners", () => {
    beforeEach(() => {
      perfStats = new CesiumPerformanceStats(mockScene);
    });

    it("should mark preUpdate in performance timeline", () => {
      preUpdateListeners[0]();

      expect(performance.mark).toHaveBeenCalledWith("preUpdate");
    });

    it("should mark postRender in performance timeline", () => {
      postRenderListeners[0]();

      expect(performance.mark).toHaveBeenCalledWith("postRender");
    });

    it("should measure SceneRender duration", () => {
      preUpdateListeners[0]();
      postRenderListeners[0]();

      expect(performance.measure).toHaveBeenCalledWith("SceneRender", "preUpdate", "postRender");
    });

    it("should store postRender timestamp", async () => {
      const { getTimestamp } = await import("@cesium/engine");

      postRenderListeners[0]();

      expect(perfStats.postRenderTimes[0]).toBeDefined();
      expect(getTimestamp).toHaveBeenCalled();
    });

    it("should increment index on each postRender", () => {
      postRenderListeners[0]();
      expect(perfStats.idx).toBe(1);

      postRenderListeners[0]();
      expect(perfStats.idx).toBe(2);

      postRenderListeners[0]();
      expect(perfStats.idx).toBe(3);
    });

    it("should wrap index at sampleCount", () => {
      // Trigger sampleCount (60) times
      for (let i = 0; i < 60; i++) {
        postRenderListeners[0]();
      }

      expect(perfStats.idx).toBe(0);
    });

    it("should discard first sample period", () => {
      const calculateStatsSpy = vi.spyOn(perfStats, "calculateStats");

      // First cycle - should discard
      for (let i = 0; i < 60; i++) {
        postRenderListeners[0]();
      }

      expect(calculateStatsSpy).not.toHaveBeenCalled();
      expect(perfStats.discardNext).toBe(false);
    });

    it("should calculate stats on second cycle", () => {
      const calculateStatsSpy = vi.spyOn(perfStats, "calculateStats");

      // First cycle - discard
      for (let i = 0; i < 60; i++) {
        postRenderListeners[0]();
      }

      // Second cycle - calculate
      for (let i = 0; i < 60; i++) {
        postRenderListeners[0]();
      }

      expect(calculateStatsSpy).toHaveBeenCalledTimes(1);
    });

    it("should log stats when logContinuously is true", () => {
      perfStats = new CesiumPerformanceStats(mockScene, true);
      const formatStatsSpy = vi.spyOn(perfStats, "formatStats");

      // First cycle - discard
      for (let i = 0; i < 60; i++) {
        postRenderListeners[1]();
      }

      // Second cycle - calculate and log
      for (let i = 0; i < 60; i++) {
        postRenderListeners[1]();
      }

      expect(formatStatsSpy).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it("should not log stats when logContinuously is false", () => {
      perfStats = new CesiumPerformanceStats(mockScene, false);

      // First cycle - discard
      for (let i = 0; i < 60; i++) {
        postRenderListeners[1]();
      }

      // Second cycle - calculate but don't log
      for (let i = 0; i < 60; i++) {
        postRenderListeners[1]();
      }

      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("calculateStats", () => {
    beforeEach(() => {
      perfStats = new CesiumPerformanceStats(mockScene);
    });

    it("should calculate average FPS", () => {
      // Simulate 60 frames at 16.67ms each (60 FPS)
      for (let i = 0; i < 60; i++) {
        perfStats.postRenderTimes[i] = i * 16.67;
      }

      perfStats.calculateStats();

      // Tolerance of -1 allows difference up to 5
      expect(perfStats.avgFps).toBeCloseTo(60, -1);
    });

    it("should calculate average frame time", () => {
      // Simulate 60 frames at 16.67ms each
      for (let i = 0; i < 60; i++) {
        perfStats.postRenderTimes[i] = i * 16.67;
      }

      perfStats.calculateStats();

      // Looser tolerance
      expect(perfStats.avgFrameTime).toBeCloseTo(16.67, 0);
    });

    it("should find worst frame time", () => {
      // Normal frames at 16ms, one spike at 100ms
      for (let i = 0; i < 60; i++) {
        perfStats.postRenderTimes[i] = i * 16;
      }
      // Add a spike
      perfStats.postRenderTimes[30] = perfStats.postRenderTimes[29] + 100;

      perfStats.calculateStats();

      expect(perfStats.worstFrameTime).toBeCloseTo(100, 0);
    });
  });

  describe("reset", () => {
    beforeEach(() => {
      perfStats = new CesiumPerformanceStats(mockScene);
      perfStats.idx = 25;
      perfStats.avgFps = 60;
      perfStats.avgFrameTime = 16.67;
      perfStats.worstFrameTime = 50;
    });

    it("should reset index to 0", () => {
      perfStats.reset();

      expect(perfStats.idx).toBe(0);
    });

    it("should reset avgFps to 0", () => {
      perfStats.reset();

      expect(perfStats.avgFps).toBe(0);
    });

    it("should reset avgFrameTime to 0", () => {
      perfStats.reset();

      expect(perfStats.avgFrameTime).toBe(0);
    });

    it("should reset worstFrameTime to 0", () => {
      perfStats.reset();

      expect(perfStats.worstFrameTime).toBe(0);
    });

    it("should set discardNext to true by default", () => {
      perfStats.discardNext = false;
      perfStats.reset();

      expect(perfStats.discardNext).toBe(true);
    });

    it("should allow setting discardNext to false", () => {
      perfStats.reset(false);

      expect(perfStats.discardNext).toBe(false);
    });
  });

  describe("getStats", () => {
    beforeEach(() => {
      perfStats = new CesiumPerformanceStats(mockScene);
      perfStats.avgFps = 58.5;
      perfStats.avgFrameTime = 17.1;
      perfStats.worstFrameTime = 45.2;
    });

    it("should return stats object with current values", () => {
      const stats = perfStats.getStats();

      expect(stats).toEqual({
        avgFps: 58.5,
        avgFrameTime: 17.1,
        worstFrameTime: 45.2,
      });
    });
  });

  describe("formatStats", () => {
    beforeEach(() => {
      perfStats = new CesiumPerformanceStats(mockScene);
    });

    it("should format stats as string", () => {
      perfStats.avgFps = 60.12;
      perfStats.avgFrameTime = 16.67;
      perfStats.worstFrameTime = 33.45;

      const formatted = perfStats.formatStats();

      expect(formatted).toContain("Avg FPS:");
      expect(formatted).toContain("60.12");
      expect(formatted).toContain("Avg Frametime:");
      expect(formatted).toContain("16.67");
      expect(formatted).toContain("Worst Frametime:");
      expect(formatted).toContain("33.45");
    });

    it("should format numbers to 2 decimal places", () => {
      perfStats.avgFps = 60.123456;
      perfStats.avgFrameTime = 16.789012;
      perfStats.worstFrameTime = 33.456789;

      const formatted = perfStats.formatStats();

      expect(formatted).toContain("60.12");
      expect(formatted).toContain("16.79");
      expect(formatted).toContain("33.46");
    });
  });
});
