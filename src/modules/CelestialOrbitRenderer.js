import {
  CallbackProperty,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  JulianDate,
  Matrix3,
  Matrix4,
  PathGraphics,
  PolylineGraphics,
  ReferenceFrame,
  SceneMode,
  Transforms,
  defined,
} from "@cesium/engine";
import * as Astronomy from "astronomy-engine";
import { OrbitLinePrimitive } from "./OrbitLinePrimitive";
import { CesiumCallbackHelper } from "./util/CesiumCallbackHelper";

const AU_TO_METERS = 1.496e11;

/**
 * Get Earth's heliocentric position in meters (ICRF frame).
 * @param {JulianDate} time
 * @returns {Cartesian3}
 */
export function getEarthHelioVectorMeters(time) {
  const jsDate = JulianDate.toDate(time);
  const earthVector = Astronomy.HelioVector(Astronomy.Body.Earth, jsDate);
  return new Cartesian3(earthVector.x * AU_TO_METERS, earthVector.y * AU_TO_METERS, earthVector.z * AU_TO_METERS);
}

/**
 * Generic orbit renderer for celestial bodies
 * Handles orbit visualization for any body with a position function
 */
export class CelestialOrbitRenderer {
  constructor(viewer) {
    this.viewer = viewer;
    this.orbitEntities = new Map(); // Map of body name to orbit entity (PathGraphics/PolylineGraphics)
    this.orbitPrimitives = new Map(); // Map of body name to { primitive, removeCallback, heliocentric, requiredFar }
    this.orbitUpdaters = new Map(); // Map of body name to updater cleanup function
    this._originalFrustumFar = viewer.camera.frustum.far;

    // Hide orbit primitives during morph and in non-3D modes (modelMatrix unsupported)
    this._morphStartListener = viewer.scene.morphStart.addEventListener(() => {
      this._setPrimitivesVisible(false);
    });
    this._morphCompleteListener = viewer.scene.morphComplete.addEventListener(() => {
      const is3D = viewer.scene.mode === SceneMode.SCENE3D;
      this._setPrimitivesVisible(is3D);
    });
  }

  /**
   * Add or update orbit for a celestial body
   * @param {string} bodyName - Unique name for the body
   * @param {Function} positionFunction - Function(time) that returns Cartesian3 position
   * @param {Object} options - Orbit visualization options
   */
  addOrbit(bodyName, positionFunction, options = {}) {
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
      usePrimitive = false,
      heliocentric = false,
      minDistance = 0,
    } = options;

    if (!orbitalPeriod) {
      console.error(`CelestialOrbitRenderer: orbitalPeriod required for ${bodyName}`);
      return;
    }

    if (usePrimitive) {
      return this._addPrimitiveOrbit(bodyName, positionFunction, {
        orbitalPeriod,
        color,
        resolution,
        referenceFrame,
        heliocentric,
        minDistance,
      });
    }

    let orbitEntity;

    if (usePolyline) {
      const currentTime = this.viewer.clock.currentTime;
      const maxSamples = 1000;
      const idealSamples = Math.ceil(orbitalPeriod / resolution);
      const numSamples = Math.min(idealSamples, maxSamples);
      const positions = [];

      for (let i = 0; i <= numSamples; i++) {
        const sampleTime = JulianDate.addSeconds(currentTime, (i / numSamples) * orbitalPeriod, new JulianDate());
        const posInertial = positionFunction(sampleTime);

        if (referenceFrame === ReferenceFrame.INERTIAL) {
          const icrfToFixed = Transforms.computeIcrfToFixedMatrix(sampleTime);
          if (icrfToFixed) {
            positions.push(Matrix3.multiplyByVector(icrfToFixed, posInertial, new Cartesian3()));
          } else {
            positions.push(Cartesian3.clone(posInertial));
          }
        } else {
          positions.push(Cartesian3.clone(posInertial));
        }
      }

      orbitEntity = this.viewer.entities.add({
        id: `orbit-${bodyName}`,
        polyline: new PolylineGraphics({
          show: true,
          positions,
          material: color,
          width,
          arcType: 0,
          distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
        }),
        distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
      });
    } else {
      let positionProperty;

      if (useSampledPosition && referenceFrame === ReferenceFrame.INERTIAL) {
        positionProperty = new CallbackProperty((time, result) => {
          return Cartesian3.clone(positionFunction(time), result);
        }, false);
        positionProperty.referenceFrame = referenceFrame;
        positionProperty.getValueInReferenceFrame = function (time, requestedFrame, result) {
          const inertialPos = this.getValue(time, result);
          if (requestedFrame === ReferenceFrame.FIXED) {
            const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
            if (icrfToFixed) {
              return Matrix3.multiplyByVector(icrfToFixed, inertialPos, result);
            }
          }
          return inertialPos;
        };
      } else {
        positionProperty = new CallbackProperty((time, result) => {
          return Cartesian3.clone(positionFunction(time), result);
        }, false);
        positionProperty.getValueInReferenceFrame = function (time, referenceFrame, result) {
          return this.getValue(time, result);
        };
      }

      orbitEntity = this.viewer.entities.add({
        id: `orbit-${bodyName}`,
        position: positionProperty,
        path: new PathGraphics({
          show: true,
          leadTime: orbitalPeriod * leadTimeFraction,
          trailTime: orbitalPeriod * trailTimeFraction,
          material: color,
          resolution,
          width,
          distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
        }),
        distanceDisplayCondition: new DistanceDisplayCondition(0.0, Number.POSITIVE_INFINITY),
      });
    }

    this.orbitEntities.set(bodyName, orbitEntity);
    return orbitEntity;
  }

  /**
   * Create orbit using OrbitLinePrimitive (GL_LINE_STRIP, cull-free).
   * Positions are pre-computed in the orbit's native frame and transformed
   * to ECEF via modelMatrix updated every 0.5s.
   */
  _addPrimitiveOrbit(bodyName, positionFunction, { orbitalPeriod, color, resolution, referenceFrame, heliocentric, minDistance = 0 }) {
    const currentTime = this.viewer.clock.currentTime;
    const maxSamples = 1000;
    const idealSamples = Math.ceil(orbitalPeriod / resolution);
    const numSamples = Math.min(idealSamples, maxSamples);

    // Pre-compute positions in native frame
    const positions = [];
    for (let i = 0; i <= numSamples; i++) {
      const sampleTime = JulianDate.addSeconds(currentTime, (i / numSamples) * orbitalPeriod, new JulianDate());
      positions.push(Cartesian3.clone(positionFunction(sampleTime)));
    }

    // Compute initial modelMatrix
    const modelMatrix = this._computeModelMatrix(currentTime, referenceFrame, heliocentric);

    const primitive = new OrbitLinePrimitive({
      positions,
      color,
      modelMatrix,
      show: true,
      depthTestEnabled: true,
      minDistance,
    });

    this.viewer.scene.primitives.add(primitive);

    // Store max orbit radius for dynamic frustum far computation
    const maxOrbitRadius = positions.reduce((max, p) => Math.max(max, Cartesian3.magnitude(p)), 0);

    // Register periodic callback to update modelMatrix
    let removeCallback;
    if (referenceFrame === ReferenceFrame.INERTIAL) {
      const scratchMatrix = new Matrix4();
      removeCallback = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 0.5, (time) => {
        const entry = this.orbitPrimitives.get(bodyName);
        if (!entry) {
          removeCallback();
          return;
        }
        const newMatrix = this._computeModelMatrix(time, referenceFrame, heliocentric, scratchMatrix);
        entry.primitive.modelMatrix = newMatrix;
        // Re-apply frustum far in case something else reset it
        this._updateFrustumFar();
      });
    }

    this.orbitPrimitives.set(bodyName, { primitive, removeCallback, heliocentric, maxOrbitRadius });
    this._updateFrustumFar();

    return primitive;
  }

  /**
   * Compute modelMatrix for transforming native-frame positions to ECEF.
   *
   * For geocentric orbits: ICRF→ECEF rotation only.
   * For heliocentric orbits: ICRF→ECEF rotation + translation to offset
   *   from Earth to Sun (negate Earth's helio position in ECEF).
   */
  _computeModelMatrix(time, referenceFrame, heliocentric, result) {
    if (referenceFrame !== ReferenceFrame.INERTIAL) {
      return result ? Matrix4.clone(Matrix4.IDENTITY, result) : Matrix4.clone(Matrix4.IDENTITY);
    }

    const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
    if (!defined(icrfToFixed)) {
      return result ? Matrix4.clone(Matrix4.IDENTITY, result) : Matrix4.clone(Matrix4.IDENTITY);
    }

    if (!heliocentric) {
      // Geocentric: just rotation from ICRF to ECEF
      const m = result || new Matrix4();
      return Matrix4.fromRotationTranslation(icrfToFixed, Cartesian3.ZERO, m);
    }

    // Heliocentric: rotate ICRF→ECEF, then translate so Sun-centered
    // positions end up at the correct ECEF location.
    // Earth's helio position in ICRF → rotate to ECEF → negate = translation
    const earthHelioICRF = getEarthHelioVectorMeters(time);
    const earthInECEF = Matrix3.multiplyByVector(icrfToFixed, earthHelioICRF, new Cartesian3());
    const translation = Cartesian3.negate(earthInECEF, earthInECEF);

    const m = result || new Matrix4();
    return Matrix4.fromRotationTranslation(icrfToFixed, translation, m);
  }

  /**
   * Update camera frustum far plane to accommodate the largest orbit primitive.
   * Accounts for both orbit size and current camera distance, so orbits remain
   * visible even when the camera is far beyond the outermost orbit.
   */
  _updateFrustumFar() {
    let maxRequired = this._originalFrustumFar;
    const cameraDistance = Cartesian3.magnitude(this.viewer.camera.positionWC);
    for (const entry of this.orbitPrimitives.values()) {
      // Need camera distance + orbit radius to see the far side of the orbit
      const required = cameraDistance + entry.maxOrbitRadius * 2;
      if (required > maxRequired) {
        maxRequired = required;
      }
    }
    // Only increase, never decrease — another renderer may need a larger value
    if (maxRequired > this.viewer.camera.frustum.far) {
      this.viewer.camera.frustum.far = maxRequired;
    }
  }

  removeOrbit(bodyName) {
    const entity = this.orbitEntities.get(bodyName);
    if (entity) {
      this.viewer.entities.remove(entity);
      this.orbitEntities.delete(bodyName);
    }

    const entry = this.orbitPrimitives.get(bodyName);
    if (entry) {
      this.viewer.scene.primitives.remove(entry.primitive);
      if (entry.removeCallback) {
        entry.removeCallback();
      }
      this.orbitPrimitives.delete(bodyName);
      this._updateFrustumFar();
    }

    const removeCallback = this.orbitUpdaters.get(bodyName);
    if (removeCallback) {
      removeCallback();
      this.orbitUpdaters.delete(bodyName);
    }
  }

  setOrbitVisibility(bodyName, visible) {
    const entity = this.orbitEntities.get(bodyName);
    if (entity) {
      if (entity.path) {
        entity.path.show = visible;
      } else if (entity.polyline) {
        entity.polyline.show = visible;
      }
    }

    const entry = this.orbitPrimitives.get(bodyName);
    if (entry) {
      entry.primitive.show = visible;
    }
  }

  updateOrbit(bodyName, updates) {
    const entity = this.orbitEntities.get(bodyName);
    if (!entity) return;

    const graphics = entity.path || entity.polyline;
    if (!graphics) return;

    if (updates.color !== undefined) graphics.material = updates.color;
    if (updates.width !== undefined) graphics.width = updates.width;
    if (updates.show !== undefined) graphics.show = updates.show;
  }

  hasOrbit(bodyName) {
    return this.orbitEntities.has(bodyName) || this.orbitPrimitives.has(bodyName);
  }

  /**
   * Show or hide all orbit primitives (used during scene mode transitions).
   * @param {boolean} visible
   */
  _setPrimitivesVisible(visible) {
    for (const entry of this.orbitPrimitives.values()) {
      entry.primitive.show = visible;
    }
  }

  clear() {
    for (const entity of this.orbitEntities.values()) {
      this.viewer.entities.remove(entity);
    }
    this.orbitEntities.clear();

    for (const entry of this.orbitPrimitives.values()) {
      this.viewer.scene.primitives.remove(entry.primitive);
      if (entry.removeCallback) {
        entry.removeCallback();
      }
    }
    this.orbitPrimitives.clear();
    this._updateFrustumFar();

    for (const removeCallback of this.orbitUpdaters.values()) {
      removeCallback();
    }
    this.orbitUpdaters.clear();
  }

  getOrbitNames() {
    return [...this.orbitEntities.keys(), ...this.orbitPrimitives.keys()];
  }

  /**
   * Clean up all resources including scene mode listeners.
   * Call when this renderer is no longer needed.
   */
  destroy() {
    this.clear();
    if (this._morphStartListener) {
      this._morphStartListener();
      this._morphStartListener = null;
    }
    if (this._morphCompleteListener) {
      this._morphCompleteListener();
      this._morphCompleteListener = null;
    }
  }
}
