import { JulianDate } from "@cesium/engine";

/**
 * ClockMonitor - Centralized Cesium clock time change detection
 *
 * Detects DISCONTINUITIES in simulation time (true jumps), not continuous
 * fast-forward/rewind. Works correctly with any clock multiplier (including
 * negative for backward time).
 *
 * How it works:
 * - Checks every second using setInterval (independent of rendering/clock state)
 * - Tracks expected simulation time based on clock multiplier
 * - Compares actual vs expected to detect discontinuities
 * - Only emits event on true jumps (user changes time, test sets time, etc.)
 * - Ignores continuous animation at any speed (even 1000x or negative)
 *
 * Emits: 'cesium:clockTimeJumped' event with detail:
 *   {
 *     oldTime: JulianDate,
 *     newTime: JulianDate,
 *     jumpSeconds: number (discontinuity amount, can be negative),
 *     clockMultiplier: number (clock speed at time of jump)
 *   }
 *
 * Usage:
 *   const monitor = new ClockMonitor(viewer, { checkInterval: 1000, threshold: 600 });
 *
 *   window.addEventListener('cesium:clockTimeJumped', (event) => {
 *     const { jumpSeconds, oldTime, newTime, clockMultiplier } = event.detail;
 *     // jumpSeconds is the discontinuity, not affected by multiplier
 *     if (Math.abs(jumpSeconds) > 600) {
 *       // Recalculate passes, smart paths, planet positions, etc.
 *     }
 *   });
 *
 *   // Clean up when done
 *   monitor.destroy();
 */
export class ClockMonitor {
  /**
   * @param {Cesium.Viewer} viewer - Cesium viewer instance
   * @param {Object} options - Configuration options
   * @param {number} options.checkInterval - How often to check for time changes (milliseconds), default 1000
   * @param {number} options.threshold - Minimum time jump to emit event (seconds), default 600 (10 minutes)
   */
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.checkInterval = options.checkInterval ?? 1000;
    this.threshold = options.threshold ?? 600; // 10 minutes default (in simulation seconds)

    if (!this.viewer?.clock?.currentTime?.clone) {
      console.warn("[ClockMonitor] Invalid viewer or clock, monitor disabled");
      this.enabled = false;
      return;
    }

    this.enabled = true;
    this.lastSimTime = this.viewer.clock.currentTime.clone();
    this.lastRealTime = Date.now();
    this.intervalId = null;

    console.log("[ClockMonitor] Initialized with checkInterval:", this.checkInterval, "threshold:", this.threshold);
    this.#setupListener();
  }

  #setupListener() {
    if (!this.enabled) return;

    // Use setInterval to check for time jumps periodically
    // This ensures we detect jumps even when clock is paused and scene isn't rendering
    // (requestRenderMode may prevent preUpdate from firing when nothing is changing)
    this.intervalId = setInterval(() => {
      this.#checkForTimeJump();
    }, this.checkInterval);

    console.log("[ClockMonitor] Started checking for time jumps every", this.checkInterval, "ms");
  }

  #checkForTimeJump() {
    const nowRealTime = Date.now();

    // Only check at the configured interval (default: once per second)
    if (nowRealTime - this.lastRealTime < this.checkInterval) {
      return;
    }

    const currentSimTime = this.viewer.clock.currentTime;
    const clockMultiplier = this.viewer.clock.multiplier || 1.0;

    // Calculate elapsed real-world time (in milliseconds)
    const realTimeElapsedMs = nowRealTime - this.lastRealTime;

    // Calculate expected simulation time change based on clock multiplier
    // multiplier is in "simulation seconds per real second"
    const expectedSimTimeChangeSeconds = (realTimeElapsedMs / 1000) * clockMultiplier;

    // Calculate actual simulation time change
    const actualSimTimeChangeSeconds = JulianDate.secondsDifference(currentSimTime, this.lastSimTime);

    // Calculate discontinuity (difference between expected and actual)
    // This detects true jumps vs. continuous animation (even at high/negative speeds)
    const discontinuitySeconds = actualSimTimeChangeSeconds - expectedSimTimeChangeSeconds;

    // If discontinuity exceeds threshold, we have a true time jump
    if (Math.abs(discontinuitySeconds) > this.threshold) {
      this.#emitTimeJumpEvent(this.lastSimTime.clone(), currentSimTime.clone(), discontinuitySeconds, clockMultiplier);
    }

    // Update tracking for next check
    this.lastSimTime = currentSimTime.clone();
    this.lastRealTime = nowRealTime;
  }

  #emitTimeJumpEvent(oldTime, newTime, discontinuitySeconds, clockMultiplier) {
    // Emit custom event that modules can listen to
    const event = new CustomEvent("cesium:clockTimeJumped", {
      detail: {
        oldTime,
        newTime,
        jumpSeconds: discontinuitySeconds, // The discontinuity amount
        clockMultiplier,
        timestamp: Date.now(),
      },
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(event);
    }

    // Also log for debugging
    console.log(
      `[ClockMonitor] Time discontinuity detected: ${discontinuitySeconds.toFixed(0)}s jump ` +
        `(multiplier: ${clockMultiplier.toFixed(1)}x) ` +
        `(${JulianDate.toDate(oldTime).toISOString()} -> ${JulianDate.toDate(newTime).toISOString()})`,
    );
  }

  /**
   * Get current configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return {
      checkInterval: this.checkInterval,
      threshold: this.threshold,
      enabled: this.enabled,
    };
  }

  /**
   * Update configuration
   * @param {Object} options - New configuration options
   * @param {number} options.checkInterval - How often to check (milliseconds)
   * @param {number} options.threshold - Minimum time jump to emit (seconds)
   */
  updateConfig(options = {}) {
    if (options.checkInterval !== undefined) {
      this.checkInterval = options.checkInterval;
    }
    if (options.threshold !== undefined) {
      this.threshold = options.threshold;
    }
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.enabled = false;
    console.log("[ClockMonitor] Stopped");
  }
}
