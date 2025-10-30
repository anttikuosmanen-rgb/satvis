import { CallbackProperty, Cartesian3, Color, PathGraphics, PolylineGraphics, ReferenceFrame, JulianDate, Transforms, Matrix3, DistanceDisplayCondition } from "@cesium/engine";

/**
 * Generic orbit renderer for celestial bodies
 * Handles orbit visualization for any body with a position function
 */
export class CelestialOrbitRenderer {
  constructor(viewer) {
    this.viewer = viewer;
    this.orbitEntities = new Map(); // Map of body name to orbit entity
  }

  /**
   * Add or update orbit for a celestial body
   * @param {string} bodyName - Unique name for the body
   * @param {Function} positionFunction - Function(time) that returns Cartesian3 position
   * @param {Object} options - Orbit visualization options
   * @param {number} options.orbitalPeriod - Orbital period in seconds
   * @param {Color} options.color - Orbit line color (default: white with alpha 0.3)
   * @param {number} options.width - Line width (default: 1)
   * @param {number} options.resolution - Sample resolution in seconds (default: 3600)
   * @param {number} options.leadTimeFraction - Fraction of orbit to show ahead (default: 0.5)
   * @param {number} options.trailTimeFraction - Fraction of orbit to show behind (default: 0.5)
   * @param {ReferenceFrame} options.referenceFrame - Reference frame for position (default: ReferenceFrame.INERTIAL)
   * @param {boolean} options.useSampledPosition - Use SampledPositionProperty instead of CallbackProperty (default: false)
   * @param {boolean} options.usePolyline - Use PolylineGraphics for complete orbit rendering without LOD culling (default: false)
   */
  addOrbit(bodyName, positionFunction, options = {}) {
    // Remove existing orbit if present
    this.removeOrbit(bodyName);

    const {
      orbitalPeriod,
      color = Color.WHITE.withAlpha(0.3),
      width = 1,
      resolution = 3600,
      leadTimeFraction = 0.5,
      trailTimeFraction = 0.5,
      referenceFrame = ReferenceFrame.INERTIAL,
      useSampledPosition = false,
      usePolyline = false,
    } = options;

    if (!orbitalPeriod) {
      console.error(`CelestialOrbitRenderer: orbitalPeriod required for ${bodyName}`);
      return;
    }

    let orbitEntity;

    if (usePolyline) {
      // Pre-calculate complete orbit positions for PolylineGraphics
      // This avoids PathGraphics LOD culling issues
      const currentTime = this.viewer.clock.currentTime;

      // Limit number of samples to prevent memory allocation failure
      // Use at most 1000 samples for very long orbits, more for shorter ones
      const maxSamples = 1000;
      const idealSamples = Math.ceil(orbitalPeriod / resolution);
      const numSamples = Math.min(idealSamples, maxSamples);
      const positions = [];

      console.log(`Creating polyline for ${bodyName}: ${numSamples} samples (period: ${(orbitalPeriod / (24 * 60 * 60)).toFixed(1)} days)`);

      for (let i = 0; i <= numSamples; i++) {
        const sampleTime = JulianDate.addSeconds(currentTime, (i / numSamples) * orbitalPeriod, new JulianDate());
        const posInertial = positionFunction(sampleTime);

        // Transform from inertial to fixed frame if needed
        // PolylineGraphics always expects positions in the Fixed (ECEF) frame
        if (referenceFrame === ReferenceFrame.INERTIAL) {
          const icrfToFixed = Transforms.computeIcrfToFixedMatrix(sampleTime);
          if (icrfToFixed) {
            const posFixed = Matrix3.multiplyByVector(icrfToFixed, posInertial, new Cartesian3());
            positions.push(posFixed);

            // Debug: Log first few positions
            if (i < 3) {
              console.log(`  Sample ${i} INERTIAL: x=${posInertial.x.toExponential(2)}, y=${posInertial.y.toExponential(2)}, z=${posInertial.z.toExponential(2)}`);
              console.log(`  Sample ${i} FIXED:    x=${posFixed.x.toExponential(2)}, y=${posFixed.y.toExponential(2)}, z=${posFixed.z.toExponential(2)}`);
            }
          } else {
            // Fallback if transformation fails
            positions.push(Cartesian3.clone(posInertial));
          }
        } else {
          // Already in Fixed frame
          positions.push(Cartesian3.clone(posInertial));

          // Debug: Log first few positions
          if (i < 3) {
            console.log(`  Sample ${i}: x=${posInertial.x.toExponential(2)}, y=${posInertial.y.toExponential(2)}, z=${posInertial.z.toExponential(2)}`);
          }
        }
      }

      console.log(`Created ${positions.length} positions for ${bodyName} polyline`);

      // Create polyline entity with pre-calculated positions
      // Positions are always in Fixed (ECEF) frame after transformation
      orbitEntity = this.viewer.entities.add({
        id: `orbit-${bodyName}`,
        polyline: new PolylineGraphics({
          show: true,
          positions: positions,
          material: color,
          width: width,
          arcType: 0, // ArcType.NONE - no geodesic/rhumb line interpolation
          distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
        }),
        distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
      });
      console.log(`Added polyline entity for ${bodyName}:`, {
        id: orbitEntity.id,
        hasPolyline: !!orbitEntity.polyline,
        polylineShow: orbitEntity.polyline?.show,
        polylineWidth: orbitEntity.polyline?.width,
        numPositions: orbitEntity.polyline?.positions?.getValue?.()?.length || positions.length,
      });
    } else {
      // Use PathGraphics with dynamic position property
      let positionProperty;

      if (useSampledPosition && referenceFrame === ReferenceFrame.INERTIAL) {
        // For inertial frame, use a CallbackProperty that returns position in INERTIAL frame
        // Cesium's PathGraphics will sample this at different times automatically
        positionProperty = new CallbackProperty((time, result) => {
          const pos = positionFunction(time);
          return Cartesian3.clone(pos, result);
        }, false);

        // Mark this as an inertial frame position by adding referenceFrame property
        positionProperty.referenceFrame = referenceFrame;

        // Add getValueInReferenceFrame method that properly handles inertial positions
        positionProperty.getValueInReferenceFrame = function (time, requestedFrame, result) {
          // Get position in inertial frame
          const inertialPos = this.getValue(time, result);

          // If requested frame is FIXED, transform from inertial to fixed
          if (requestedFrame === ReferenceFrame.FIXED) {
            const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
            if (icrfToFixed) {
              return Matrix3.multiplyByVector(icrfToFixed, inertialPos, result);
            }
          }

          // Otherwise return inertial position
          return inertialPos;
        };
      } else {
        // Use CallbackProperty (positions assumed to be in Fixed frame)
        positionProperty = new CallbackProperty((time, result) => {
          const pos = positionFunction(time);
          return Cartesian3.clone(pos, result);
        }, false);

        // Add getValueInReferenceFrame method required by PathGraphics
        positionProperty.getValueInReferenceFrame = function (time, referenceFrame, result) {
          return this.getValue(time, result);
        };
      }

      // Create orbit entity with PathGraphics
      orbitEntity = this.viewer.entities.add({
        id: `orbit-${bodyName}`,
        position: positionProperty,
        path: new PathGraphics({
          show: true,
          leadTime: orbitalPeriod * leadTimeFraction,
          trailTime: orbitalPeriod * trailTimeFraction,
          material: color,
          resolution: resolution,
          width: width,
          distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
        }),
        distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
      });
    }

    this.orbitEntities.set(bodyName, orbitEntity);
    return orbitEntity;
  }

  /**
   * Remove orbit for a celestial body
   * @param {string} bodyName - Name of the body
   */
  removeOrbit(bodyName) {
    const entity = this.orbitEntities.get(bodyName);
    if (entity) {
      this.viewer.entities.remove(entity);
      this.orbitEntities.delete(bodyName);
    }
  }

  /**
   * Show/hide orbit for a celestial body
   * @param {string} bodyName - Name of the body
   * @param {boolean} visible - Whether to show the orbit
   */
  setOrbitVisibility(bodyName, visible) {
    const entity = this.orbitEntities.get(bodyName);
    if (entity) {
      if (entity.path) {
        entity.path.show = visible;
      } else if (entity.polyline) {
        entity.polyline.show = visible;
      }
    }
  }

  /**
   * Update orbit properties
   * @param {string} bodyName - Name of the body
   * @param {Object} updates - Properties to update (color, width, etc.)
   */
  updateOrbit(bodyName, updates) {
    const entity = this.orbitEntities.get(bodyName);
    if (!entity) {
      return;
    }

    const graphics = entity.path || entity.polyline;
    if (!graphics) {
      return;
    }

    if (updates.color !== undefined) {
      graphics.material = updates.color;
    }
    if (updates.width !== undefined) {
      graphics.width = updates.width;
    }
    if (updates.show !== undefined) {
      graphics.show = updates.show;
    }
  }

  /**
   * Check if orbit exists for a body
   * @param {string} bodyName - Name of the body
   * @returns {boolean} True if orbit exists
   */
  hasOrbit(bodyName) {
    return this.orbitEntities.has(bodyName);
  }

  /**
   * Remove all orbits
   */
  clear() {
    for (const entity of this.orbitEntities.values()) {
      this.viewer.entities.remove(entity);
    }
    this.orbitEntities.clear();
  }

  /**
   * Get all orbit body names
   * @returns {Array<string>} Array of body names
   */
  getOrbitNames() {
    return Array.from(this.orbitEntities.keys());
  }
}
