import {
  CallbackProperty,
  Cartesian3,
  Color,
  JulianDate,
  Matrix3,
  Matrix4,
  PrimitiveType,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  defined,
} from "@cesium/engine";
import { useToastProxy } from "../composables/useToastProxy";
import { NeoApiClient } from "./NeoApiClient";
import { KeplerPropagator } from "./KeplerPropagator";
import { getEarthHelioVectorMeters } from "./CelestialOrbitRenderer";
import { OrbitLinePrimitive } from "./OrbitLinePrimitive";
import { CesiumCallbackHelper } from "./util/CesiumCallbackHelper";

const MAX_MISS_DISTANCE_LD = 50; // Only show NEOs closer than this
const NUM_DROP_LINES_HALF = 10; // Lines before/after current position (21 total)
const DROP_LINE_SPACING = 384_400_000; // 1 LD in meters
const DENSE_ORBIT_SAMPLES = 200; // Sample count for dense orbit segment near drop lines
const FULL_ORBIT_SAMPLES = 200; // Sample count for full orbit / sparse arc
const TWO_PI = 2 * Math.PI;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Ecliptic normal in ICRF (equatorial J2000): obliquity = 23.4392911°
const OBLIQUITY_RAD = 23.4392911 * (Math.PI / 180);
const sinObl = Math.sin(OBLIQUITY_RAD);
const cosObl = Math.cos(OBLIQUITY_RAD);
const ECLIPTIC_NORMAL = new Cartesian3(0, -sinObl, cosObl);

/**
 * Manages Near Earth Object (NEO) display in the Cesium viewer.
 * Fetches data from NASA NeoWs and JPL SBDB APIs, creates entities for each NEO.
 */
export class NeoManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.neos = []; // Array of { neoData, elements } objects
    this.entities = []; // Cesium entities for cleanup
    this.enabled = false;
    this.showOrbits = false;
    this.loading = false;

    // Full orbit primitives: Map<orbitName, { primitive, updateListener }>
    this._fullOrbitMap = new Map();
    // Inclination visualization state: Map<neoId, { dropLinesPrimitive, denseOrbitPrimitive, sparseOrbitPrimitive, updateListener, orbitWasManual }>
    this._vizMap = new Map();
    this._clickHandler = null;

    // Prevent double-click fly-to on NEO entities
    this._trackedEntityListener = this.viewer.trackedEntityChanged.addEventListener(() => {
      const tracked = this.viewer.trackedEntity;
      if (tracked && tracked.id && tracked.id.startsWith("neo-")) {
        this.viewer.trackedEntity = undefined;
      }
    });

    // Console command to set frustum far plane
    window.setFrustumFar = (value) => {
      this.viewer.camera.frustum.far = value;
      console.log(`Frustum far set to ${value.toExponential()}`);
    };
  }

  /**
   * Fetch and display NEOs with close approaches in the next 7 days.
   * @param {string} apiKey - NASA API key
   */
  async fetchAndDisplayNeos(apiKey = "DEMO_KEY") {
    if (this.loading) return;

    this.loading = true;
    const toast = useToastProxy();

    try {
      // Compute date range (next 7 days from simulation time)
      const simDate = JulianDate.toDate(this.viewer.clock.currentTime);
      const startDate = this._formatDate(simDate);
      const endDate = this._formatDate(new Date(simDate.getTime() + 7 * 86400000));

      toast.add({ severity: "info", summary: "Fetching NEOs...", detail: `Close approaches ${startDate} to ${endDate}`, life: 3000 });

      // Step 1: Fetch close-approach list
      const neoList = await NeoApiClient.fetchCloseApproaches(startDate, endDate, apiKey);

      if (neoList.length === 0) {
        toast.add({ severity: "warn", summary: "No NEOs found", detail: "No close approaches in the next 7 days", life: 3000 });
        this.loading = false;
        return;
      }

      // Filter by miss distance
      const closeNeos = neoList.filter((neo) => neo.close_approach.miss_distance_lunar <= MAX_MISS_DISTANCE_LD);

      if (closeNeos.length === 0) {
        toast.add({ severity: "warn", summary: "No close NEOs", detail: `No approaches within ${MAX_MISS_DISTANCE_LD} LD`, life: 3000 });
        this.loading = false;
        return;
      }

      toast.add({ severity: "info", summary: `Found ${closeNeos.length} NEOs within ${MAX_MISS_DISTANCE_LD} LD`, detail: "Fetching orbital elements...", life: 3000 });

      // Step 2: Fetch orbital elements (with localStorage cache)
      const elementsMap = new Map();
      const uncachedDesignations = [];

      for (const neo of closeNeos) {
        const cached = this._getCachedElements(neo.designation);
        if (cached) {
          elementsMap.set(neo.designation, cached);
        } else {
          uncachedDesignations.push(neo.designation);
        }
      }

      if (uncachedDesignations.length > 0) {
        const fetchedMap = await NeoApiClient.fetchOrbitalElementsBatch(uncachedDesignations, 3, (completed, total) => {
          if (completed % 10 === 0 || completed === total) {
            window.dispatchEvent(new CustomEvent("neoProgress", { detail: { completed, total } }));
          }
        });
        for (const [des, elements] of fetchedMap) {
          elementsMap.set(des, elements);
          this._cacheElements(des, elements);
        }
      }

      // Step 3: Create combined NEO objects (preserve SBDB-searched objects)
      this._clearNeoWsObjects();
      const loadedDesignations = new Set(this.neos.map((n) => n.neoData.designation));
      const newEntries = [];
      for (const neo of closeNeos) {
        const elements = elementsMap.get(neo.designation);
        if (elements && !loadedDesignations.has(neo.designation)) {
          const entry = { neoData: neo, elements };
          this.neos.push(entry);
          newEntries.push(entry);
        }
      }

      // Step 4: Create entities only for newly added NeoWs objects
      this.createEntities(newEntries);
      this.enabled = true;

      const cachedCount = closeNeos.length - uncachedDesignations.length;
      toast.add({
        severity: "success",
        summary: `${this.neos.length} NEOs loaded`,
        detail: `${cachedCount > 0 ? cachedCount + " from cache, " : ""}${closeNeos.length - this.neos.length} skipped (no orbital data)`,
        life: 5000,
      });

      // Notify UI of count change
      window.dispatchEvent(new CustomEvent("neoCountChanged", { detail: this.neos.length }));
    } catch (error) {
      console.error("NeoManager: fetch failed", error);
      toast.add({ severity: "error", summary: "NEO fetch failed", detail: error.message, life: 5000 });
    } finally {
      this.loading = false;
    }
  }

  /**
   * Fetch and display a single NEO by SBDB designation (e.g. "Apophis", "2024 YR4").
   * @param {string} designation
   * @returns {Promise<boolean>} true if successfully added
   */
  async fetchByDesignation(designation) {
    const toast = useToastProxy();

    // Check if already loaded — flash the entity and orbit to highlight it
    const existing = this.neos.find((n) => n.neoData.designation === designation || n.neoData.name === designation);
    if (existing) {
      toast.add({ severity: "info", summary: "Already loaded", detail: designation, life: 3000 });
      this._flashNeo(existing.neoData);
      return true;
    }

    // Check cache first
    let elements = this._getCachedElements(designation);
    if (!elements) {
      elements = await NeoApiClient.fetchOrbitalElements(designation);
      if (!elements) {
        toast.add({ severity: "error", summary: "Not found", detail: `Could not find "${designation}" in SBDB`, life: 5000 });
        return false;
      }
      this._cacheElements(elements.designation || designation, elements);
    }

    const neoData = {
      id: `custom-${elements.designation || designation}`,
      name: elements.name || designation,
      designation: elements.designation || designation,
      magnitude: elements.H || null,
      diameter_km: elements.diameter_km,
      is_hazardous: false,
      close_approach: { date: null, velocity_kms: 0, miss_distance_km: 0, miss_distance_lunar: 0 },
    };

    this.neos.push({ neoData, elements });
    this.createEntities([{ neoData, elements }]);
    this.enabled = true;

    // If orbits are globally on, enable orbit for this NEO too
    if (this.showOrbits) {
      this._addOrbitForNeo(neoData, elements);
    }

    toast.add({ severity: "success", summary: `Added ${neoData.name}`, detail: elements.orbit_class || "", life: 3000 });
    window.dispatchEvent(new CustomEvent("neoCountChanged", { detail: this.neos.length }));
    return true;
  }

  /**
   * Create Cesium entities for all loaded NEOs.
   */
  createEntities(neoEntries) {
    const entries = neoEntries || this.neos;
    for (const { neoData, elements } of entries) {
      const isHazardous = neoData.is_hazardous;
      const pointColor = isHazardous ? Color.RED : Color.CYAN;
      const pixelSize = isHazardous ? 8 : 5;

      // Position via Kepler propagation (CallbackProperty for continuous updates)
      const positionCallback = new CallbackProperty((time, result) => {
        const pos = KeplerPropagator.computeGeocentricCartesian(elements, time);
        if (pos) {
          return Cartesian3.clone(pos, result);
        }
        return result || new Cartesian3();
      }, false);

      const entity = this.viewer.entities.add({
        id: `neo-${neoData.id}`,
        name: neoData.name,
        position: positionCallback,
        point: {
          pixelSize,
          color: pointColor,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
        },
        label: {
          text: neoData.name.replace(/[()]/g, "").trim(),
          font: "11px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 1,
          style: 2, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian3(0, -12, 0),
          show: false, // Hidden by default, toggle via UI if needed
        },
        description: new CallbackProperty(() => this._generateDescription(neoData, elements), false),
      });

      this.entities.push(entity);
    }

    this._setupSelectionListener();
  }

  /**
   * Enable orbit rendering for all loaded NEOs.
   */
  enableOrbits() {
    this.showOrbits = true;
    for (const { neoData, elements } of this.neos) {
      this._addOrbitForNeo(neoData, elements);
    }
  }

  /**
   * Add a full-orbit primitive for a single NEO using eccentric anomaly sampling.
   * Samples uniformly in E (0 to 2π) for near-uniform arc-length density.
   */
  _addOrbitForNeo(neoData, elements) {
    const orbitName = `neo-orbit-${neoData.id}`;
    if (this._fullOrbitMap.has(orbitName)) return;

    const color = neoData.is_hazardous ? Color.RED.withAlpha(0.4) : Color.CYAN.withAlpha(0.3);
    const positions = this._computeFullOrbitPositions(elements);
    const modelMatrix = this._computeHelioModelMatrix(this.viewer.clock.currentTime);

    const primitive = new OrbitLinePrimitive({
      positions,
      color,
      modelMatrix,
      show: true,
      depthTestEnabled: true,
    });
    this.viewer.scene.primitives.add(primitive);

    // Periodic modelMatrix update (orbit geometry is fixed, only transform changes)
    const scratchMatrix = new Matrix4();
    const updateListener = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 0.5, (updateTime) => {
      const entry = this._fullOrbitMap.get(orbitName);
      if (!entry) return;
      entry.primitive.modelMatrix = this._computeHelioModelMatrix(updateTime, scratchMatrix);
    });

    this._fullOrbitMap.set(orbitName, { primitive, updateListener });
  }

  /**
   * Remove a full-orbit primitive for a single NEO.
   */
  _removeOrbitForNeo(neoData) {
    const orbitName = `neo-orbit-${neoData.id}`;
    const entry = this._fullOrbitMap.get(orbitName);
    if (!entry) return;
    entry.updateListener();
    this.viewer.scene.primitives.remove(entry.primitive);
    this._fullOrbitMap.delete(orbitName);
  }

  /**
   * Compute full orbit positions by sampling uniformly in eccentric anomaly.
   * @param {Object} elements - Orbital elements
   * @returns {Cartesian3[]}
   */
  _computeFullOrbitPositions(elements) {
    const positions = [];
    for (let i = 0; i <= FULL_ORBIT_SAMPLES; i++) {
      const E = (i / FULL_ORBIT_SAMPLES) * TWO_PI;
      positions.push(KeplerPropagator.computeHeliocentricICRFByE(elements, E));
    }
    return positions;
  }

  /**
   * Disable orbit rendering.
   */
  disableOrbits() {
    this.showOrbits = false;
    for (const { neoData } of this.neos) {
      this._removeOrbitForNeo(neoData);
    }
  }

  /**
   * Remove only NeoWs-fetched objects, preserving SBDB-searched ones (custom- IDs).
   */
  _clearNeoWsObjects() {
    const customNeos = [];

    for (const { neoData } of this.neos) {
      const isCustom = String(neoData.id).startsWith("custom-");
      if (isCustom) {
        customNeos.push(this.neos.find((n) => n.neoData === neoData));
      } else {
        this._hideInclinationViz(String(neoData.id));
        this._removeOrbitForNeo(neoData);
        const entityId = `neo-${neoData.id}`;
        const entityIdx = this.entities.findIndex((e) => e.id === entityId);
        if (entityIdx >= 0) {
          this.viewer.entities.remove(this.entities[entityIdx]);
          this.entities.splice(entityIdx, 1);
        }
      }
    }

    this.neos = customNeos;
  }

  /**
   * Clear all NEO entities and orbits.
   */
  clear() {
    this._hideAllInclinationViz();
    if (this._clickHandler) {
      this._clickHandler.destroy();
      this._clickHandler = null;
    }

    // Remove full orbit primitives
    for (const [, entry] of this._fullOrbitMap) {
      entry.updateListener();
      this.viewer.scene.primitives.remove(entry.primitive);
    }
    this._fullOrbitMap.clear();

    // Remove entities
    for (const entity of this.entities) {
      this.viewer.entities.remove(entity);
    }
    this.entities = [];
    this.neos = [];
    this.enabled = false;
    this.showOrbits = false;

    window.dispatchEvent(new CustomEvent("neoCountChanged", { detail: 0 }));
  }

  /**
   * Destroy manager and clean up all resources.
   */
  destroy() {
    this.clear();
    if (this._trackedEntityListener) {
      this._trackedEntityListener();
      this._trackedEntityListener = null;
    }
    delete window.setFrustumFar;
  }

  /**
   * Set up click handler to toggle inclination visualization on NEO entities.
   * Uses ScreenSpaceEventHandler so clicks are detected even on already-selected entities.
   */
  _setupSelectionListener() {
    if (this._clickHandler) return;
    this._clickHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this._clickHandler.setInputAction((event) => {
      const picked = this.viewer.scene.pick(event.position);
      if (defined(picked) && picked.id && picked.id.id && picked.id.id.startsWith("neo-")) {
        const neoId = picked.id.id.substring(4);
        if (this._vizMap.has(neoId)) {
          this._hideInclinationViz(neoId);
        } else {
          this._showInclinationViz(neoId);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  /**
   * Show drop lines and two-arc orbit (dense + sparse) for a NEO.
   * Replaces the single full-orbit with two arcs to avoid double-drawing.
   * @param {string} neoId
   */
  _showInclinationViz(neoId) {
    if (this._vizMap.has(neoId)) return;

    const neoEntry = this.neos.find((n) => String(n.neoData.id) === String(neoId));
    if (!neoEntry) return;

    const { neoData, elements } = neoEntry;

    // Track whether orbit was already showing (globally on or manually)
    const orbitName = `neo-orbit-${neoData.id}`;
    const orbitWasManual = this._fullOrbitMap.has(orbitName) || this.showOrbits;

    // Remove the full-orbit primitive to avoid double-drawing
    this._removeOrbitForNeo(neoData);

    const time = this.viewer.clock.currentTime;
    const modelMatrix = this._computeHelioModelMatrix(time);

    // Compute drop lines (also returns time range for dense orbit)
    const { positions: dropLinePositions, minTime, maxTime } = this._computeDropLinePositions(elements, time);
    // Create two-arc orbit: dense (drop line region) + sparse (rest of orbit)
    const orbitSegColor = neoData.is_hazardous ? Color.RED.withAlpha(0.4) : Color.CYAN.withAlpha(0.3);

    // Drop lines: darken the orbit segment color so they're visibly subdued
    const dropLineColor = orbitSegColor.darken(0.4, new Color());

    const dropLinesPrimitive = new OrbitLinePrimitive({
      positions: dropLinePositions,
      color: dropLineColor,
      modelMatrix,
      show: true,
      depthTestEnabled: true,
      primitiveType: PrimitiveType.LINES,
    });
    this.viewer.scene.primitives.add(dropLinesPrimitive);

    const denseOrbitPositions = this._computeDenseOrbitPositions(elements, minTime, maxTime);
    const denseOrbitPrimitive = new OrbitLinePrimitive({
      positions: denseOrbitPositions,
      color: orbitSegColor,
      modelMatrix,
      show: true,
      depthTestEnabled: true,
    });
    this.viewer.scene.primitives.add(denseOrbitPrimitive);

    const sparseOrbitPositions = this._computeSparseOrbitPositions(elements, minTime, maxTime);
    const sparseOrbitPrimitive = new OrbitLinePrimitive({
      positions: sparseOrbitPositions,
      color: orbitSegColor,
      modelMatrix,
      show: true,
      depthTestEnabled: true,
    });
    this.viewer.scene.primitives.add(sparseOrbitPrimitive);

    // Register periodic update
    const scratchMatrix = new Matrix4();
    const updateListener = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 0.5, (updateTime) => {
      const entry = this._vizMap.get(neoId);
      if (!entry) return;
      const newMatrix = this._computeHelioModelMatrix(updateTime, scratchMatrix);
      entry.dropLinesPrimitive.modelMatrix = newMatrix;
      entry.denseOrbitPrimitive.modelMatrix = newMatrix;
      entry.sparseOrbitPrimitive.modelMatrix = newMatrix;
      const result = this._computeDropLinePositions(elements, updateTime);
      entry.dropLinesPrimitive.updatePositions(result.positions);
      entry.denseOrbitPrimitive.updatePositions(this._computeDenseOrbitPositions(elements, result.minTime, result.maxTime));
      entry.sparseOrbitPrimitive.updatePositions(this._computeSparseOrbitPositions(elements, result.minTime, result.maxTime));
    });

    this._vizMap.set(neoId, { dropLinesPrimitive, denseOrbitPrimitive, sparseOrbitPrimitive, updateListener, orbitWasManual });
  }

  /**
   * Remove drop lines and two-arc orbit for a specific NEO.
   * Restores the full-orbit primitive if it was previously showing.
   * @param {string} neoId
   */
  _hideInclinationViz(neoId) {
    const entry = this._vizMap.get(neoId);
    if (!entry) return;

    entry.updateListener();
    this.viewer.scene.primitives.remove(entry.dropLinesPrimitive);
    this.viewer.scene.primitives.remove(entry.denseOrbitPrimitive);
    this.viewer.scene.primitives.remove(entry.sparseOrbitPrimitive);

    // Restore full-orbit if it was previously showing (globally on or manually enabled)
    if (entry.orbitWasManual || this.showOrbits) {
      const neoEntry = this.neos.find((n) => String(n.neoData.id) === String(neoId));
      if (neoEntry) {
        this._addOrbitForNeo(neoEntry.neoData, neoEntry.elements);
      }
    }

    this._vizMap.delete(neoId);
  }

  /**
   * Remove all inclination visualizations.
   */
  _hideAllInclinationViz() {
    for (const neoId of [...this._vizMap.keys()]) {
      this._hideInclinationViz(neoId);
    }
  }

  /**
   * Compute heliocentric ICRF → ECEF modelMatrix.
   * @param {JulianDate} time
   * @param {Matrix4} [result]
   * @returns {Matrix4}
   */
  _computeHelioModelMatrix(time, result) {
    const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
    if (!defined(icrfToFixed)) {
      return result ? Matrix4.clone(Matrix4.IDENTITY, result) : Matrix4.clone(Matrix4.IDENTITY);
    }
    const earthHelioICRF = getEarthHelioVectorMeters(time);
    const earthInECEF = Matrix3.multiplyByVector(icrfToFixed, earthHelioICRF, new Cartesian3());
    const translation = Cartesian3.negate(earthInECEF, earthInECEF);
    const m = result || new Matrix4();
    return Matrix4.fromRotationTranslation(icrfToFixed, translation, m);
  }

  /**
   * Compute drop line positions with proper 1 LD spacing using interpolation.
   * Returns vertex pairs for LINES primitive plus the time range covered.
   * @param {Object} elements - Orbital elements
   * @param {JulianDate} currentTime
   * @returns {{ positions: Cartesian3[], minTime: JulianDate, maxTime: JulianDate }}
   */
  _computeDropLinePositions(elements, currentTime) {
    const earthHelioICRF = getEarthHelioVectorMeters(currentTime);
    const currentPos = KeplerPropagator.computeHeliocentricICRF(elements, currentTime);

    const projectToEcliptic = (pos) => {
      const dx = pos.x - earthHelioICRF.x;
      const dy = pos.y - earthHelioICRF.y;
      const dz = pos.z - earthHelioICRF.z;
      const dot = dx * ECLIPTIC_NORMAL.x + dy * ECLIPTIC_NORMAL.y + dz * ECLIPTIC_NORMAL.z;
      return new Cartesian3(pos.x - dot * ECLIPTIC_NORMAL.x, pos.y - dot * ECLIPTIC_NORMAL.y, pos.z - dot * ECLIPTIC_NORMAL.z);
    };

    const currentProj = projectToEcliptic(currentPos);
    const positions = [];

    // Drop line at the current position
    positions.push(Cartesian3.clone(currentPos));
    positions.push(currentProj);

    const orbitalPeriod = elements.period_days ? elements.period_days * 86400 : 365.25 * 86400;
    const timeStep = orbitalPeriod / 500;

    let minTime = JulianDate.clone(currentTime);
    let maxTime = JulianDate.clone(currentTime);

    // Walk forward and backward along the orbit, interpolating at exact LD boundaries
    for (const direction of [1, -1]) {
      let accumulatedDist = 0;
      let prevProj = Cartesian3.clone(currentProj);
      let prevOrbitPos = Cartesian3.clone(currentPos);
      let linesPlaced = 0;

      for (let step = 1; linesPlaced < NUM_DROP_LINES_HALF && step < 2000; step++) {
        const sampleTime = JulianDate.addSeconds(currentTime, direction * step * timeStep, new JulianDate());
        const orbitPos = KeplerPropagator.computeHeliocentricICRF(elements, sampleTime);
        const proj = projectToEcliptic(orbitPos);

        let segDist = Cartesian3.distance(prevProj, proj);
        accumulatedDist += segDist;

        // Place lines at each LD boundary crossed in this segment
        while (accumulatedDist >= DROP_LINE_SPACING && linesPlaced < NUM_DROP_LINES_HALF) {
          // Interpolation: how far back from current sample is the boundary?
          const overshoot = accumulatedDist - DROP_LINE_SPACING;
          const t = segDist > 0 ? 1 - overshoot / segDist : 1;

          const interpOrbitPos = new Cartesian3();
          Cartesian3.lerp(prevOrbitPos, orbitPos, t, interpOrbitPos);
          const interpProj = new Cartesian3();
          Cartesian3.lerp(prevProj, proj, t, interpProj);

          positions.push(interpOrbitPos);
          positions.push(interpProj);
          linesPlaced++;

          // Reset tracking from the interpolated point for next boundary
          accumulatedDist = overshoot;
          segDist = overshoot; // Remaining sub-segment distance for correct interpolation
          prevProj = Cartesian3.clone(interpProj);
          prevOrbitPos = Cartesian3.clone(interpOrbitPos);
        }

        if (linesPlaced >= NUM_DROP_LINES_HALF) {
          // Track the time range for dense orbit segment
          if (direction === 1) {
            maxTime = sampleTime;
          } else {
            minTime = sampleTime;
          }
          break;
        }

        prevProj = Cartesian3.clone(proj);
        prevOrbitPos = Cartesian3.clone(orbitPos);
      }
    }

    return { positions, minTime, maxTime };
  }

  /**
   * Compute densely-sampled orbit positions for the drop line region.
   * Uses eccentric anomaly sampling for uniform arc-length density.
   * @param {Object} elements - Orbital elements
   * @param {JulianDate} minTime - Start of time range
   * @param {JulianDate} maxTime - End of time range
   * @returns {Cartesian3[]}
   */
  _computeDenseOrbitPositions(elements, minTime, maxTime) {
    let E_min = KeplerPropagator.timeToEccentricAnomaly(elements, minTime);
    let E_max = KeplerPropagator.timeToEccentricAnomaly(elements, maxTime);

    // Ensure E_max > E_min (handle wrapping past 2π)
    if (E_max <= E_min) {
      E_max += TWO_PI;
    }

    const span = E_max - E_min;
    if (span <= 0) return [];

    const positions = [];
    for (let i = 0; i <= DENSE_ORBIT_SAMPLES; i++) {
      const E = E_min + (i / DENSE_ORBIT_SAMPLES) * span;
      positions.push(KeplerPropagator.computeHeliocentricICRFByE(elements, E));
    }
    return positions;
  }

  /**
   * Compute sparsely-sampled orbit positions for the rest of the orbit (outside the dense region).
   * Samples uniformly in eccentric anomaly from E_max to E_min + 2π for seamless join.
   * @param {Object} elements - Orbital elements
   * @param {JulianDate} minTime - Start of dense region
   * @param {JulianDate} maxTime - End of dense region
   * @returns {Cartesian3[]}
   */
  _computeSparseOrbitPositions(elements, minTime, maxTime) {
    let E_min = KeplerPropagator.timeToEccentricAnomaly(elements, minTime);
    let E_max = KeplerPropagator.timeToEccentricAnomaly(elements, maxTime);

    // Ensure E_max > E_min (same wrapping as dense)
    if (E_max <= E_min) {
      E_max += TWO_PI;
    }

    // Sparse arc: from E_max to E_min + 2π (complementary arc, wrapping around)
    const sparseStart = E_max;
    const sparseEnd = E_min + TWO_PI;
    const span = sparseEnd - sparseStart;
    if (span <= 0) return [];

    const positions = [];
    for (let i = 0; i <= FULL_ORBIT_SAMPLES; i++) {
      const E = sparseStart + (i / FULL_ORBIT_SAMPLES) * span;
      positions.push(KeplerPropagator.computeHeliocentricICRFByE(elements, E));
    }
    return positions;
  }

  /**
   * Get cached orbital elements from localStorage.
   * @param {string} designation
   * @returns {Object|null} Elements or null if missing/expired
   */
  _getCachedElements(designation) {
    try {
      const raw = localStorage.getItem(`neo-elements-${designation}`);
      if (!raw) return null;
      const { elements, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > CACHE_TTL_MS) {
        localStorage.removeItem(`neo-elements-${designation}`);
        return null;
      }
      return elements;
    } catch {
      return null;
    }
  }

  /**
   * Cache orbital elements in localStorage.
   * @param {string} designation
   * @param {Object} elements
   */
  _cacheElements(designation, elements) {
    try {
      localStorage.setItem(`neo-elements-${designation}`, JSON.stringify({ elements, timestamp: Date.now() }));
    } catch {
      // localStorage full or unavailable — ignore
    }
  }

  /**
   * Format date as YYYY-MM-DD.
   * @param {Date} date
   * @returns {string}
   */
  _formatDate(date) {
    return date.toISOString().split("T")[0];
  }

  /**
   * Briefly flash a NEO's entity point and orbit primitive white to draw attention.
   * @param {Object} neoData
   */
  _flashNeo(neoData) {
    const entity = this.entities.find((e) => e.id === `neo-${neoData.id}`);
    if (!entity) return;

    const originalSize = entity.point.pixelSize.getValue();
    const originalColor = entity.point.color.getValue();
    entity.point.pixelSize = originalSize * 2;
    entity.point.color = Color.WHITE;

    // Flash orbit primitive if visible
    const orbitName = `neo-orbit-${neoData.id}`;
    const orbitEntry = this._fullOrbitMap.get(orbitName);
    let origRenderColor;
    if (orbitEntry) {
      origRenderColor = Color.clone(orbitEntry.primitive._renderColor);
      orbitEntry.primitive._renderColor = Color.WHITE.withAlpha(0.8);
    }

    setTimeout(() => {
      entity.point.pixelSize = originalSize;
      entity.point.color = originalColor;
      if (orbitEntry) {
        Color.clone(origRenderColor, orbitEntry.primitive._renderColor);
      }
    }, 1500);
  }

  /**
   * Generate HTML description for a NEO entity info box.
   * @param {Object} neoData - NEO data from NeoWs
   * @param {Object} elements - Orbital elements from SBDB
   * @returns {string} HTML string
   */
  _generateDescription(neoData, elements) {
    const hazardousLabel = neoData.is_hazardous ? '<span style="color: #ff4444; font-weight: bold;">YES</span>' : "No";

    const diameterStr = neoData.diameter_km ? `${(neoData.diameter_km * 1000).toFixed(1)} m` : elements.diameter_km ? `${(elements.diameter_km * 1000).toFixed(1)} m` : "Unknown";

    let closeApproachSection = "";
    if (neoData.close_approach.date) {
      const missDistKm = neoData.close_approach.miss_distance_km;
      const missDistLD = neoData.close_approach.miss_distance_lunar;
      const missDistStr =
        missDistKm > 1e6
          ? `${(missDistKm / 1e6).toFixed(2)} million km (${missDistLD.toFixed(2)} LD)`
          : `${Math.round(missDistKm).toLocaleString()} km (${missDistLD.toFixed(2)} LD)`;
      closeApproachSection = `
        <tr><th colspan="2" style="padding-top: 8px; font-weight: bold;">Close Approach</th></tr>
        <tr><th>Date</th><td>${neoData.close_approach.date}</td></tr>
        <tr><th>Velocity</th><td>${neoData.close_approach.velocity_kms.toFixed(2)} km/s</td></tr>
        <tr><th>Miss Distance</th><td>${missDistStr}</td></tr>
      `;
    }

    return `
      <h3>${neoData.name}</h3>
      <table>
        <tr><th>Potentially Hazardous</th><td>${hazardousLabel}</td></tr>
        <tr><th>Estimated Diameter</th><td>${diameterStr}</td></tr>
        <tr><th>Absolute Magnitude (H)</th><td>${neoData.magnitude}</td></tr>
        ${closeApproachSection}
        <tr><th colspan="2" style="padding-top: 8px; font-weight: bold;">Orbital Elements</th></tr>
        <tr><th>Orbit Class</th><td>${elements.orbit_class || "N/A"}</td></tr>
        <tr><th>Semi-major Axis</th><td>${elements.a_au.toFixed(4)} AU</td></tr>
        <tr><th>Eccentricity</th><td>${elements.e.toFixed(6)}</td></tr>
        <tr><th>Inclination</th><td>${elements.i_deg.toFixed(4)}°</td></tr>
        <tr><th>Period</th><td>${elements.period_days ? (elements.period_days / 365.25).toFixed(2) + " years" : "N/A"}</td></tr>
      </table>
    `;
  }
}
