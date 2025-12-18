/**
 * WorkerPool - Manages a pool of WebWorkers for parallel SGP4 calculations
 * Distributes work across multiple workers to maximize CPU utilization
 */
export class WorkerPool {
  constructor(WorkerClass, poolSize = null) {
    // Auto-detect optimal pool size based on CPU cores
    this.poolSize = poolSize || Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 8));
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.nextMessageId = 0;
    this.pendingTasks = new Map();
    this.WorkerClass = WorkerClass;

    // Initialize worker pool
    this.initializeWorkers();
  }

  initializeWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new this.WorkerClass();
      worker._poolId = i;
      worker._busy = false;

      worker.onmessage = (event) => {
        this.handleWorkerMessage(worker, event);
      };

      worker.onerror = (error) => {
        console.error(`Worker ${i} error:`, error);
        // Try to recover by recreating the worker
        this.recreateWorker(i);
      };

      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }

    console.log(`WorkerPool initialized with ${this.poolSize} workers`);
  }

  recreateWorker(poolId) {
    const oldWorker = this.workers[poolId];
    if (oldWorker) {
      oldWorker.terminate();
    }

    const worker = new this.WorkerClass();
    worker._poolId = poolId;
    worker._busy = false;

    worker.onmessage = (event) => {
      this.handleWorkerMessage(worker, event);
    };

    worker.onerror = (error) => {
      console.error(`Worker ${poolId} error:`, error);
      this.recreateWorker(poolId);
    };

    this.workers[poolId] = worker;

    // Only add to available if not already there
    if (!this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker);
    }

    console.log(`Worker ${poolId} recreated`);
  }

  handleWorkerMessage(worker, event) {
    const { id, result, error, success } = event.data;

    // Mark worker as available
    worker._busy = false;
    if (!this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker);
    }

    // Resolve the pending task
    const task = this.pendingTasks.get(id);
    if (task) {
      this.pendingTasks.delete(id);
      if (success) {
        task.resolve(result);
      } else {
        task.reject(new Error(error));
      }
    }

    // Process next task in queue
    this.processQueue();
  }

  processQueue() {
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.taskQueue.shift();
      const worker = this.availableWorkers.shift();
      worker._busy = true;
      worker.postMessage(task.message);
    }
  }

  /**
   * Execute a task on an available worker
   * @param {string} type - Message type
   * @param {Object} data - Data to send to worker
   * @returns {Promise} Resolves with worker result
   */
  execute(type, data) {
    return new Promise((resolve, reject) => {
      const id = this.nextMessageId++;
      const message = { id, type, data };

      // Store the pending task
      this.pendingTasks.set(id, { resolve, reject, message });

      // Try to execute immediately or queue
      if (this.availableWorkers.length > 0) {
        const worker = this.availableWorkers.shift();
        worker._busy = true;
        worker.postMessage(message);
      } else {
        this.taskQueue.push({ message, resolve, reject });
      }
    });
  }

  /**
   * Propagate satellite positions for multiple timestamps
   */
  async propagatePositions(tle, timestamps) {
    return this.execute("PROPAGATE_POSITIONS", { tle, timestamps });
  }

  /**
   * Propagate single geodetic position
   */
  async propagateGeodetic(tle, timestamp) {
    return this.execute("PROPAGATE_GEODETIC", { tle, timestamp });
  }

  /**
   * Compute satellite passes using elevation angle
   */
  async computePassesElevation(tle, groundStationPosition, startDateMs, endDateMs, minElevation = 5, maxPasses = 50, collectStats = false) {
    return this.execute("COMPUTE_PASSES_ELEVATION", {
      tle,
      groundStationPosition,
      startDateMs,
      endDateMs,
      minElevation,
      maxPasses,
      collectStats,
    });
  }

  /**
   * Compute satellite passes using swath width
   */
  async computePassesSwath(tle, groundStationPosition, swathKm, startDateMs, endDateMs, maxPasses = 50, collectStats = false) {
    return this.execute("COMPUTE_PASSES_SWATH", {
      tle,
      groundStationPosition,
      swathKm,
      startDateMs,
      endDateMs,
      maxPasses,
      collectStats,
    });
  }

  /**
   * Clear the satrec cache in all workers
   */
  async clearCache() {
    const promises = this.workers.map(() => this.execute("CLEAR_CACHE", {}));
    return Promise.all(promises);
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      poolSize: this.poolSize,
      availableWorkers: this.availableWorkers.length,
      busyWorkers: this.workers.filter((w) => w._busy).length,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
    };
  }

  /**
   * Terminate all workers and clean up
   */
  terminate() {
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.pendingTasks.clear();
    console.log("WorkerPool terminated");
  }
}
