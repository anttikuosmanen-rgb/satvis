import { WorkerPool } from "./WorkerPool";
// eslint-disable-next-line import/no-unresolved, import/extensions
import SGP4Worker from "./sgp4.worker.js?worker";

/**
 * Singleton instance of the SGP4 worker pool
 * Provides a global interface for offloading SGP4 calculations to WebWorkers
 */
class SGP4WorkerPoolSingleton {
  constructor() {
    this.pool = null;
    this.enabled = true; // Can be disabled for debugging
  }

  /**
   * Initialize the worker pool
   * @param {number} poolSize - Number of workers (defaults to auto-detect)
   */
  initialize(poolSize = null) {
    if (this.pool) {
      console.warn("SGP4 WorkerPool already initialized");
      return;
    }

    try {
      this.pool = new WorkerPool(SGP4Worker, poolSize);
      console.log("SGP4 WorkerPool initialized successfully");
    } catch (error) {
      console.error("Failed to initialize SGP4 WorkerPool:", error);
      this.enabled = false;
    }
  }

  /**
   * Get the worker pool instance (lazy initialization)
   */
  getPool() {
    if (!this.pool && this.enabled) {
      this.initialize();
    }
    return this.pool;
  }

  /**
   * Propagate satellite positions for multiple timestamps
   * @param {Array<string>} tle - TLE lines [line0, line1, line2]
   * @param {Array<number>} timestamps - Array of timestamps in milliseconds
   * @returns {Promise<Array>} Array of position results
   */
  async propagatePositions(tle, timestamps) {
    const pool = this.getPool();
    if (!pool || !this.enabled) {
      throw new Error("SGP4 WorkerPool not available");
    }
    return pool.propagatePositions(tle, timestamps);
  }

  /**
   * Propagate single geodetic position
   * @param {Array<string>} tle - TLE lines
   * @param {number} timestamp - Timestamp in milliseconds
   * @returns {Promise<Object>} Geodetic position {latitude, longitude, height}
   */
  async propagateGeodetic(tle, timestamp) {
    const pool = this.getPool();
    if (!pool || !this.enabled) {
      throw new Error("SGP4 WorkerPool not available");
    }
    return pool.propagateGeodetic(tle, timestamp);
  }

  /**
   * Compute satellite passes using elevation angle
   * @param {Array<string>} tle - TLE lines
   * @param {Object} groundStationPosition - {latitude, longitude, height}
   * @param {number} startDateMs - Start time in milliseconds
   * @param {number} endDateMs - End time in milliseconds
   * @param {number} minElevation - Minimum elevation angle
   * @param {number} maxPasses - Maximum number of passes to compute
   * @param {boolean} collectStats - Whether to collect performance stats
   * @returns {Promise<Array>} Array of pass objects
   */
  async computePassesElevation(tle, groundStationPosition, startDateMs, endDateMs, minElevation = 5, maxPasses = 50, collectStats = false) {
    const pool = this.getPool();
    if (!pool || !this.enabled) {
      throw new Error("SGP4 WorkerPool not available");
    }
    return pool.computePassesElevation(tle, groundStationPosition, startDateMs, endDateMs, minElevation, maxPasses, collectStats);
  }

  /**
   * Compute satellite passes using swath width
   * @param {Array<string>} tle - TLE lines
   * @param {Object} groundStationPosition - {latitude, longitude, height}
   * @param {number} swathKm - Swath width in kilometers
   * @param {number} startDateMs - Start time in milliseconds
   * @param {number} endDateMs - End time in milliseconds
   * @param {number} maxPasses - Maximum number of passes to compute
   * @param {boolean} collectStats - Whether to collect performance stats
   * @returns {Promise<Array>} Array of pass objects
   */
  async computePassesSwath(tle, groundStationPosition, swathKm, startDateMs, endDateMs, maxPasses = 50, collectStats = false) {
    const pool = this.getPool();
    if (!pool || !this.enabled) {
      throw new Error("SGP4 WorkerPool not available");
    }
    return pool.computePassesSwath(tle, groundStationPosition, swathKm, startDateMs, endDateMs, maxPasses, collectStats);
  }

  /**
   * Clear the satrec cache in all workers
   */
  async clearCache() {
    const pool = this.getPool();
    if (pool) {
      return pool.clearCache();
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const pool = this.getPool();
    return pool ? pool.getStats() : null;
  }

  /**
   * Check if worker pool is available
   */
  isAvailable() {
    return this.enabled && this.pool !== null;
  }

  /**
   * Enable or disable the worker pool
   * @param {boolean} enabled - Whether to enable workers
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && this.pool) {
      console.log("Disabling SGP4 WorkerPool");
    }
  }

  /**
   * Terminate the worker pool
   */
  terminate() {
    if (this.pool) {
      this.pool.terminate();
      this.pool = null;
    }
  }
}

// Export singleton instance
export const SGP4WorkerPool = new SGP4WorkerPoolSingleton();

// Auto-initialize on module load
if (typeof window !== "undefined") {
  // Initialize after a short delay to not block initial page load
  setTimeout(() => {
    SGP4WorkerPool.initialize();
  }, 100);
}
