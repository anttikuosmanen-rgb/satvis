import { Cartesian3, SceneMode } from "@cesium/engine";

/**
 * Utility for visibility culling to optimize rendering performance
 * Checks if entities are within camera frustum and at reasonable distance
 */
export class VisibilityCulling {
  /**
   * Check if a position is visible in the camera frustum
   * @param {Viewer} viewer - Cesium viewer instance
   * @param {Cartesian3} position - Position to check
   * @param {number} maxDistance - Maximum distance in meters (default: 100M km)
   * @returns {boolean} True if position is potentially visible
   */
  static isPositionVisible(viewer, position, maxDistance = 1e11) {
    if (!viewer || !viewer.camera || !position) {
      return false;
    }

    try {
      // Quick distance check first (cheapest test)
      const cameraPosition = viewer.camera.positionWC;
      const distance = Cartesian3.distance(cameraPosition, position);

      if (distance > maxDistance) {
        return false;
      }

      // For 2D/Columbus view, use simpler visibility check
      if (viewer.scene.mode !== SceneMode.SCENE3D) {
        // In 2D/Columbus, just check if entity is on screen
        const windowCoord = viewer.scene.cartesianToCanvasCoordinates(position);
        if (!windowCoord) {
          return false;
        }
        return windowCoord.x >= 0 && windowCoord.x <= viewer.canvas.clientWidth && windowCoord.y >= 0 && windowCoord.y <= viewer.canvas.clientHeight;
      }

      // Frustum culling for 3D mode
      const occluder = viewer.scene.globe.ellipsoid.occluder;
      const cullingVolume = viewer.camera.frustum.computeCullingVolume(viewer.camera.positionWC, viewer.camera.directionWC, viewer.camera.upWC);

      // Check if position is behind the camera
      const isOccluded = occluder && !occluder.isPointVisible(position);
      if (isOccluded) {
        return false;
      }

      // Check if position is within camera frustum
      // Use bounding sphere with small radius for point-like satellites
      const boundingSphere = {
        center: position,
        radius: 100000, // 100km radius to account for satellite components
      };

      const visibility = cullingVolume.computeVisibility(boundingSphere);

      // Return true if fully visible or partially visible (intersecting frustum)
      return visibility !== -1; // -1 = OUTSIDE, 0 = INTERSECTING, 1 = INSIDE
    } catch (error) {
      // On error, assume visible to avoid breaking rendering
      console.warn("Visibility check error:", error);
      return true;
    }
  }

  /**
   * Create a cached visibility checker with throttling
   * @param {Viewer} viewer - Cesium viewer instance
   * @param {Function} positionGetter - Function that returns current position
   * @param {number} cacheTime - Cache validity in seconds (default: 0.5)
   * @param {number} maxDistance - Maximum visible distance in meters
   * @returns {Function} Function that returns true if visible
   */
  static createCachedVisibilityChecker(viewer, positionGetter, cacheTime = 0.5, maxDistance = 1e11) {
    let lastCheckTime = null;
    let lastResult = true;
    let lastPosition = null;

    return (time) => {
      // Always return true if no time provided (fallback for safety)
      if (!time) {
        return true;
      }

      // Convert JulianDate to seconds for comparison
      const currentSeconds = time.dayNumber * 86400 + time.secondsOfDay;

      // Check cache validity
      if (lastCheckTime !== null && Math.abs(currentSeconds - lastCheckTime) < cacheTime) {
        return lastResult;
      }

      // Get current position
      const position = positionGetter(time);
      if (!position) {
        lastResult = false;
        lastCheckTime = currentSeconds;
        return false;
      }

      // Quick check: if position hasn't changed much, use cached result
      if (lastPosition && Cartesian3.distance(position, lastPosition) < 1000) {
        lastCheckTime = currentSeconds;
        return lastResult;
      }

      // Perform visibility check
      const isVisible = VisibilityCulling.isPositionVisible(viewer, position, maxDistance);

      // Update cache
      lastCheckTime = currentSeconds;
      lastResult = isVisible;
      lastPosition = Cartesian3.clone(position);

      return isVisible;
    };
  }

  /**
   * Create a distance-based LOD (Level of Detail) calculator
   * @param {Viewer} viewer - Cesium viewer instance
   * @param {Function} positionGetter - Function that returns current position
   * @param {Object} thresholds - Distance thresholds in meters
   * @returns {Function} Function that returns LOD level (0=highest, 3=lowest)
   */
  static createLODCalculator(
    viewer,
    positionGetter,
    thresholds = {
      high: 1e7, // < 10,000 km = high detail
      medium: 5e7, // < 50,000 km = medium detail
      low: 2e8, // < 200,000 km = low detail
      // > 200,000 km = minimal detail
    },
  ) {
    let lastCheckTime = null;
    let lastLOD = 0;
    const cacheTime = 1.0; // Cache for 1 second

    return (time) => {
      if (!time) {
        return 0; // Highest detail as fallback
      }

      const currentSeconds = time.dayNumber * 86400 + time.secondsOfDay;

      // Check cache
      if (lastCheckTime !== null && Math.abs(currentSeconds - lastCheckTime) < cacheTime) {
        return lastLOD;
      }

      const position = positionGetter(time);
      if (!position) {
        return 3; // Lowest detail if no position
      }

      const distance = Cartesian3.distance(viewer.camera.positionWC, position);

      let lod;
      if (distance < thresholds.high) {
        lod = 0; // High detail
      } else if (distance < thresholds.medium) {
        lod = 1; // Medium detail
      } else if (distance < thresholds.low) {
        lod = 2; // Low detail
      } else {
        lod = 3; // Minimal detail
      }

      lastCheckTime = currentSeconds;
      lastLOD = lod;

      return lod;
    };
  }

  /**
   * Wrap a CallbackProperty to skip evaluation when not visible
   * @param {Viewer} viewer - Cesium viewer instance
   * @param {Function} callback - Original callback function
   * @param {Function} positionGetter - Function to get entity position
   * @param {*} fallbackValue - Value to return when not visible
   * @returns {Function} Wrapped callback that respects visibility
   */
  static createVisibilityCulledCallback(viewer, callback, positionGetter, fallbackValue = null) {
    const visibilityChecker = VisibilityCulling.createCachedVisibilityChecker(viewer, positionGetter, 0.5);

    return (time, result) => {
      // Check visibility first
      if (!visibilityChecker(time)) {
        return fallbackValue;
      }

      // Entity is visible, run the actual callback
      return callback(time, result);
    };
  }
}
