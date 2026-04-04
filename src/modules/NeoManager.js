import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ExtrapolationType,
  JulianDate,
  LagrangePolynomialApproximation,
  Matrix3,
  Matrix4,
  PrimitiveType,
  ReferenceFrame,
  SampledPositionProperty,
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
const AU_TO_METERS = 1.496e11;

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

    // Horizons ephemeris auto-extension: Map<id, { command, positionProperty, windowStart, windowStop, fetching }>
    this._horizonsTracking = new Map();
    this._horizonsExtendListener = null;

    // Prevent double-click fly-to on NEO entities
    this._trackedEntityListener = this.viewer.trackedEntityChanged.addEventListener(() => {
      const tracked = this.viewer.trackedEntity;
      if (tracked && tracked.id && tracked.id.startsWith("neo-")) {
        this.viewer.trackedEntity = undefined;
      }
    });

    // Debug: Earth position checker state
    this._debugEntities = [];
    this._debugPrimitives = [];

    // Console commands
    window.setFrustumFar = (value) => {
      this.viewer.camera.frustum.far = value;
      console.log(`Frustum far set to ${value.toExponential()}`);
    };
    window.debugEarthPosition = () => this._debugEarthFromHorizons();
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
    const input = designation.trim();

    // MB prefix: force Horizons major body / spacecraft lookup (e.g. MB399, MB-234)
    if (/^MB-?\d+$/i.test(input)) {
      return this.fetchByHorizonsCommand(input.slice(2));
    }

    // Pure negative integer → Horizons spacecraft/body ID (SBDB rejects negative designations)
    if (/^-\d+$/.test(input)) {
      return this.fetchByHorizonsCommand(input);
    }

    // Check if already loaded — flash the entity and orbit to highlight it
    const existing = this.neos.find((n) => n.neoData.designation === designation || n.neoData.name === designation);
    if (existing) {
      toast.add({ severity: "info", summary: "Already loaded", detail: designation, life: 3000 });
      this._flashNeo(existing.neoData);
      return true;
    }

    // Check SBDB cache / API first
    let elements = this._getCachedElements(designation);
    if (!elements) {
      elements = await NeoApiClient.fetchOrbitalElements(designation);
      if (elements) {
        this._cacheElements(elements.designation || designation, elements);
      }
    }

    if (!elements) {
      // SBDB miss — try Horizons as fallback (handles spacecraft names, Horizons-only IDs)
      return this.fetchByHorizonsCommand(input);
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
   * Fetch and display a solar system body by JPL Horizons COMMAND string.
   * Works for planets, spacecraft, and any body with a Horizons numeric ID.
   * @param {string} command - Horizons COMMAND (e.g. '399', '-234')
   * @returns {Promise<boolean>} true if successfully added
   */
  async fetchByHorizonsCommand(command) {
    const toast = useToastProxy();
    const id = `horizons-${command}`;

    // Check if already loaded
    const existing = this.neos.find((n) => n.neoData.id === id);
    if (existing) {
      toast.add({ severity: "info", summary: "Already loaded", detail: command, life: 3000 });
      this._flashNeo(existing.neoData);
      return true;
    }

    const simDate = JulianDate.toDate(this.viewer.clock.currentTime);
    let result;
    try {
      result = await NeoApiClient.fetchEphemerisVectors(command, simDate, 1);
    } catch (err) {
      toast.add({ severity: "error", summary: "Horizons error", detail: err.message, life: 5000 });
      return false;
    }

    if (!result || result.vectors.length === 0) {
      toast.add({ severity: "error", summary: "Not found", detail: `No data returned for "${command}"`, life: 5000 });
      return false;
    }

    // Build geocentric ICRF SampledPositionProperty (km → m)
    const position = new SampledPositionProperty(ReferenceFrame.INERTIAL);
    position.backwardExtrapolationType = ExtrapolationType.HOLD;
    position.forwardExtrapolationType = ExtrapolationType.HOLD;
    position.setInterpolationOptions({
      interpolationDegree: 5,
      interpolationAlgorithm: LagrangePolynomialApproximation,
    });
    for (const vec of result.vectors) {
      // Convert Julian Date (TDB) to Cesium JulianDate via JS Date
      const cesiumTime = JulianDate.fromDate(new Date((vec.julianDate - 2440587.5) * 86400000));
      position.addSample(cesiumTime, new Cartesian3(vec.x * 1000, vec.y * 1000, vec.z * 1000));
    }

    const neoData = {
      id,
      name: result.name,
      designation: command,
      magnitude: null,
      diameter_km: null,
      is_hazardous: false,
      close_approach: { date: null, velocity_kms: 0, miss_distance_km: 0, miss_distance_lunar: 0 },
    };

    this.neos.push({ neoData, elements: null });

    // Set up tracking BEFORE entity creation so path lead/trail CallbackProperties can reference it
    const jdToDate = (jd) => new Date((jd - 2440587.5) * 86400000);
    const trackingEntry = {
      command,
      positionProperty: position,
      windowStart: jdToDate(result.vectors[0].julianDate),
      windowStop: jdToDate(result.vectors[result.vectors.length - 1].julianDate),
      fetching: false,
      showPath: false, // Controlled by _addOrbitForNeo/_removeOrbitForNeo
      entity: null, // Set after entity creation
      ephemerisStart: null, // Set async by fetchEphemerisSpan
      ephemerisEnd: null,
      spanQueried: false, // True once fetchEphemerisSpan has completed
      backwardBounded: false, // True when backward extension reached the ephemeris start
      forwardBounded: false, // True when forward extension reached the ephemeris end
    };
    this._horizonsTracking.set(id, trackingEntry);

    const entity = this.viewer.entities.add({
      id: `neo-${id}`,
      name: result.name,
      position,
      point: {
        pixelSize: 6,
        color: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
      },
      label: {
        text: result.name,
        font: "11px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        style: 2,
        pixelOffset: new Cartesian3(0, -12, 0),
        show: false,
      },
      description: new CallbackProperty(() => {
        const fmtDate = (d) => d.toISOString().slice(0, 10);
        let spanText;
        if (!trackingEntry.spanQueried) {
          spanText = "<i>querying…</i>";
        } else if (trackingEntry.ephemerisStart && trackingEntry.ephemerisEnd) {
          spanText = `${fmtDate(trackingEntry.ephemerisStart)} – ${fmtDate(trackingEntry.ephemerisEnd)} UTC`;
        } else if (trackingEntry.ephemerisStart) {
          spanText = `from ${fmtDate(trackingEntry.ephemerisStart)} UTC`;
        } else if (trackingEntry.ephemerisEnd) {
          spanText = `until ${fmtDate(trackingEntry.ephemerisEnd)} UTC`;
        } else {
          spanText = "unlimited";
        }
        const nowMs = JulianDate.toDate(this.viewer.clock.currentTime).getTime();
        const inRange =
          (!trackingEntry.ephemerisStart || nowMs >= trackingEntry.ephemerisStart.getTime()) && (!trackingEntry.ephemerisEnd || nowMs <= trackingEntry.ephemerisEnd.getTime());
        const warning =
          trackingEntry.ephemerisStart || trackingEntry.ephemerisEnd
            ? inRange
              ? ""
              : `<p style="color:#f90">⚠ Simulation time is outside the ephemeris span. Object is hidden.</p>`
            : "";
        return `<h3>${result.name}</h3>
          <p>Source: JPL Horizons (ID: ${command})</p>
          <p><b>Ephemeris span:</b> ${spanText}</p>
          ${warning}`;
      }, false),
      path: {
        // Only render the path when within the loaded ephemeris window.
        // PathGraphics evaluates ICRF positions via computeIcrfToFixedMatrix at render time;
        // outside the sample range (HOLD extrapolation) or before EOP data loads, that
        // conversion returns null → PathGraphics falls back to (0,0,0) → projectTo2D crash.
        // showPath is toggled by _addOrbitForNeo/_removeOrbitForNeo; we confirm EOP is ready
        // via _addOrbitWhenEopReady before setting it to true.
        show: new CallbackProperty((time) => {
          if (!trackingEntry.showPath) return false;
          const nowMs = JulianDate.toDate(time).getTime();
          return nowMs >= trackingEntry.windowStart.getTime() && nowMs <= trackingEntry.windowStop.getTime();
        }, false),
        leadTime: new CallbackProperty((time) => {
          const nowMs = JulianDate.toDate(time).getTime();
          const stopMs = trackingEntry.windowStop.getTime();
          return Math.max(0, (stopMs - nowMs) / 1000 - 1800);
        }, false),
        trailTime: new CallbackProperty((time) => {
          const nowMs = JulianDate.toDate(time).getTime();
          const startMs = trackingEntry.windowStart.getTime();
          return Math.max(0, (nowMs - startMs) / 1000 - 1800);
        }, false),
        width: 1,
        material: Color.WHITE.withAlpha(0.4),
      },
    });

    trackingEntry.entity = entity;
    this.entities.push(entity);
    this.enabled = true;
    this._setupSelectionListener();

    // Fetch full ephemeris span asynchronously; apply visibility once known
    NeoApiClient.fetchEphemerisSpan(command, simDate)
      .then((span) => {
        trackingEntry.ephemerisStart = span.start;
        trackingEntry.ephemerisEnd = span.end;
        trackingEntry.spanQueried = true;
        this._applyHorizonsVisibility(trackingEntry);
      })
      .catch(() => {
        trackingEntry.spanQueried = true;
      });

    if (this.showOrbits) {
      this._addOrbitWhenEopReady(neoData);
    }

    if (!this._horizonsExtendListener) {
      this._horizonsExtendListener = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 2, (time) => this._extendHorizonsEphemeris(time));
    }

    toast.add({ severity: "success", summary: `Added ${result.name}`, detail: `Horizons COMMAND=${command}`, life: 3000 });
    window.dispatchEvent(new CustomEvent("neoCountChanged", { detail: this.neos.length }));
    return true;
  }

  /**
   * Extend Horizons ephemeris windows when sim time approaches the loaded edges.
   * Fires every 2 real seconds; fetches next/prev 1-day chunk when within 12 hours of edge.
   */
  _extendHorizonsEphemeris(time) {
    const now = JulianDate.toDate(time).getTime();
    const THRESHOLD_MS = 12 * 3600000; // 12 hours — start fetching next chunk when this close to edge
    const FAR_JUMP_MS = 2 * 86400000; // 2 days — threshold for "large jump" re-center
    const WINDOW_DAYS = 1;

    for (const [, tracking] of this._horizonsTracking) {
      this._applyHorizonsVisibility(tracking);

      if (tracking.fetching) continue;

      const distForward = now - tracking.windowStop.getTime();
      const distBackward = tracking.windowStart.getTime() - now;

      // Large time jump: sim time is >2 days outside the loaded window.
      // Re-center around current time instead of incrementally extending — avoids waiting
      // for many sequential 1-day fetches before the entity reappears at the correct position.
      if (distForward > FAR_JUMP_MS || distBackward > FAR_JUMP_MS) {
        // Reset bounded flags — new position may be in a different part of the ephemeris
        tracking.backwardBounded = false;
        tracking.forwardBounded = false;
        tracking.fetching = true;
        NeoApiClient.fetchEphemerisVectors(tracking.command, new Date(now), WINDOW_DAYS)
          .then((chunk) => {
            if (chunk && chunk.vectors.length > 0) {
              const jdToDate = (jd) => new Date((jd - 2440587.5) * 86400000);
              for (const vec of chunk.vectors) {
                const cesiumTime = JulianDate.fromDate(new Date((vec.julianDate - 2440587.5) * 86400000));
                tracking.positionProperty.addSample(cesiumTime, new Cartesian3(vec.x * 1000, vec.y * 1000, vec.z * 1000));
              }
              // Replace window bounds with the new chunk (there is a gap — old samples remain
              // in the property for interpolation accuracy but the render window is reset)
              tracking.windowStart = jdToDate(chunk.vectors[0].julianDate);
              tracking.windowStop = jdToDate(chunk.vectors[chunk.vectors.length - 1].julianDate);
            }
            tracking.fetching = false;
          })
          .catch(() => {
            tracking.fetching = false;
          });
        continue;
      }

      // Normal incremental extension: fetch the next/prev 1-day chunk when within 12h of edge.
      // Skip a direction if we've already hit a hard ephemeris boundary there (no data returned).
      const needsForward = !tracking.forwardBounded && distForward >= -THRESHOLD_MS;
      const needsBackward = !tracking.backwardBounded && distBackward >= -THRESHOLD_MS;
      if (!needsForward && !needsBackward) continue;

      const extendForward = needsForward;
      tracking.fetching = true;
      const anchor = extendForward ? tracking.windowStop : tracking.windowStart;
      const centerDate = new Date(anchor.getTime() + ((extendForward ? 1 : -1) * (WINDOW_DAYS * 86400000)) / 2);

      NeoApiClient.fetchEphemerisVectors(tracking.command, centerDate, WINDOW_DAYS)
        .then((chunk) => {
          if (chunk && chunk.vectors.length > 0) {
            const jdToDate = (jd) => new Date((jd - 2440587.5) * 86400000);
            for (const vec of chunk.vectors) {
              const cesiumTime = JulianDate.fromDate(new Date((vec.julianDate - 2440587.5) * 86400000));
              tracking.positionProperty.addSample(cesiumTime, new Cartesian3(vec.x * 1000, vec.y * 1000, vec.z * 1000));
            }
            const newStart = jdToDate(chunk.vectors[0].julianDate);
            const newStop = jdToDate(chunk.vectors[chunk.vectors.length - 1].julianDate);
            if (newStart < tracking.windowStart) tracking.windowStart = newStart;
            if (newStop > tracking.windowStop) tracking.windowStop = newStop;
          } else {
            // No data returned — ephemeris boundary reached in this direction; stop extending
            if (extendForward) tracking.forwardBounded = true;
            else tracking.backwardBounded = true;
          }
          tracking.fetching = false;
        })
        .catch(() => {
          tracking.fetching = false;
        });
    }
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
    if (!elements) {
      // Horizons object: show trajectory via PathGraphics.
      // The path.show CallbackProperty reads showPath, so just toggle the flag.
      const tracking = this._horizonsTracking.get(neoData.id);
      if (tracking) tracking.showPath = true;
      return;
    }
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
    // Horizons object: hide path via tracking flag
    if (String(neoData.id).startsWith("horizons-")) {
      const tracking = this._horizonsTracking.get(neoData.id);
      if (tracking) tracking.showPath = false;
      return;
    }
    const orbitName = `neo-orbit-${neoData.id}`;
    const entry = this._fullOrbitMap.get(orbitName);
    if (!entry) return;
    entry.updateListener();
    this.viewer.scene.primitives.remove(entry.primitive);
    this._fullOrbitMap.delete(orbitName);
  }

  /**
   * Show or hide a Horizons entity based on whether the current sim time is within
   * its known ephemeris span. Called after the span is fetched and on each periodic tick.
   */
  _applyHorizonsVisibility(tracking) {
    if (!tracking.entity) return;
    const nowMs = JulianDate.toDate(this.viewer.clock.currentTime).getTime();
    // Hide when outside known ephemeris span (if available)
    const spanOk = (!tracking.ephemerisStart || nowMs >= tracking.ephemerisStart.getTime()) && (!tracking.ephemerisEnd || nowMs <= tracking.ephemerisEnd.getTime());
    // Hide when outside the loaded sample window — prevents the entity from freezing at
    // the HOLD-extrapolated boundary position while extension fetches are in flight
    const windowOk = nowMs >= tracking.windowStart.getTime() && nowMs <= tracking.windowStop.getTime();
    const visible = spanOk && windowOk;
    if (tracking.entity.show !== visible) tracking.entity.show = visible;
  }

  /**
   * Enable PathGraphics for a Horizons object once EOP data is confirmed loaded.
   * computeIcrfToFixedMatrix returns null at app startup before EOP files finish loading —
   * showing the path immediately would cause PathGraphics to receive undefined positions,
   * which Cesium falls back to (0,0,0) → GeometryPipeline.projectTo2D crash.
   */
  _addOrbitWhenEopReady(neoData, attempt = 0) {
    if (!Transforms.computeIcrfToFixedMatrix(JulianDate.now(), new Matrix3())) {
      if (attempt < 20) {
        setTimeout(() => this._addOrbitWhenEopReady(neoData, attempt + 1), 200);
      }
      return;
    }
    this._addOrbitForNeo(neoData, null);
  }

  /**
   * Compute full orbit positions by sampling uniformly in eccentric anomaly.
   * For hyperbolic orbits, samples uniformly in H over a range centered on perihelion.
   * @param {Object} elements - Orbital elements
   * @returns {Cartesian3[]}
   */
  _computeFullOrbitPositions(elements) {
    const positions = [];

    if (elements.e >= 1) {
      // Hyperbolic orbit: sample H from -H_max to +H_max
      // Limit arc to where distance < ~10 AU from Sun
      const H_max = Math.acosh(Math.min(1000 / Math.abs(elements.a_au) / elements.e + 1 / elements.e, 50));
      for (let i = 0; i <= FULL_ORBIT_SAMPLES; i++) {
        const H = -H_max + (i / FULL_ORBIT_SAMPLES) * 2 * H_max;
        positions.push(KeplerPropagator.computeHeliocentricICRFByH(elements, H));
      }
    } else {
      for (let i = 0; i <= FULL_ORBIT_SAMPLES; i++) {
        const E = (i / FULL_ORBIT_SAMPLES) * TWO_PI;
        positions.push(KeplerPropagator.computeHeliocentricICRFByE(elements, E));
      }
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

    // Stop Horizons ephemeris auto-extension
    if (this._horizonsExtendListener) {
      this._horizonsExtendListener();
      this._horizonsExtendListener = null;
    }
    this._horizonsTracking.clear();

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
    this._clearDebugViz();
    delete window.setFrustumFar;
    delete window.debugEarthPosition;
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
    if (!neoEntry || !neoEntry.elements) return; // Horizons-only objects have no Kepler elements

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
    const A_min = KeplerPropagator.timeToEccentricAnomaly(elements, minTime);
    const A_max = KeplerPropagator.timeToEccentricAnomaly(elements, maxTime);
    const isHyperbolic = elements.e >= 1;

    let start = A_min;
    let end = A_max;
    if (!isHyperbolic && end <= start) {
      end += TWO_PI;
    }

    const span = end - start;
    if (span <= 0 && !isHyperbolic) return [];

    const positions = [];
    const computeFn = isHyperbolic ? (a) => KeplerPropagator.computeHeliocentricICRFByH(elements, a) : (a) => KeplerPropagator.computeHeliocentricICRFByE(elements, a);

    for (let i = 0; i <= DENSE_ORBIT_SAMPLES; i++) {
      const anomaly = start + (i / DENSE_ORBIT_SAMPLES) * span;
      positions.push(computeFn(anomaly));
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
    if (elements.e >= 1) {
      // Hyperbolic orbits: sparse arc covers the full orbit minus the dense region
      // Use H range from full orbit limits
      const H_max = Math.acosh(Math.min(1000 / Math.abs(elements.a_au) / elements.e + 1 / elements.e, 50));
      const H_denseMin = KeplerPropagator.timeToEccentricAnomaly(elements, minTime);
      const H_denseMax = KeplerPropagator.timeToEccentricAnomaly(elements, maxTime);

      const positions = [];
      // Before dense region
      const spanBefore = H_denseMin - -H_max;
      if (spanBefore > 0) {
        const count = Math.round((FULL_ORBIT_SAMPLES * spanBefore) / (2 * H_max));
        for (let i = 0; i <= count; i++) {
          const H = -H_max + (i / Math.max(count, 1)) * spanBefore;
          positions.push(KeplerPropagator.computeHeliocentricICRFByH(elements, H));
        }
      }
      // After dense region
      const spanAfter = H_max - H_denseMax;
      if (spanAfter > 0) {
        const count = Math.round((FULL_ORBIT_SAMPLES * spanAfter) / (2 * H_max));
        for (let i = 0; i <= count; i++) {
          const H = H_denseMax + (i / Math.max(count, 1)) * spanAfter;
          positions.push(KeplerPropagator.computeHeliocentricICRFByH(elements, H));
        }
      }
      return positions;
    }

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
   * Clear debug visualization entities and primitives.
   */
  _clearDebugViz() {
    for (const entity of this._debugEntities) {
      this.viewer.entities.remove(entity);
    }
    this._debugEntities = [];
    for (const primitive of this._debugPrimitives) {
      this.viewer.scene.primitives.remove(primitive);
    }
    this._debugPrimitives = [];
  }

  /**
   * Fetch Earth's position from JPL Horizons API and compare with astronomy-engine.
   * Creates diagnostic billboards showing the position error.
   */
  async _debugEarthFromHorizons() {
    this._clearDebugViz();
    const time = this.viewer.clock.currentTime;
    const simDate = JulianDate.toDate(time);

    // Format dates for Horizons API
    const fmt = (d) => d.toISOString().split("T")[0];
    const startDate = fmt(simDate);
    const endDate = fmt(new Date(simDate.getTime() + 86400000));

    console.log(`[DebugEarth] Fetching Horizons data for ${startDate}...`);

    try {
      // Fetch from Horizons API
      const params = new URLSearchParams({
        format: "json",
        COMMAND: "'399'",
        EPHEM_TYPE: "'VECTORS'",
        CENTER: "'@sun'",
        START_TIME: `'${startDate}'`,
        STOP_TIME: `'${endDate}'`,
        STEP_SIZE: "'1d'",
        OUT_UNITS: "'AU-D'",
        REF_SYSTEM: "'ICRF'",
        REF_PLANE: "'FRAME'", // Equatorial plane of ICRF (not ecliptic default)
        VEC_TABLE: "'1'",
      });

      const response = await fetch(`/api/horizons?${params}`);
      if (!response.ok) {
        throw new Error(`Horizons API error: ${response.status}`);
      }

      const data = await response.json();
      const result = data.result;

      // Parse XYZ from $$SOE...$$SOE block
      const soeIdx = result.indexOf("$$SOE");
      const eoeIdx = result.indexOf("$$EOE");
      if (soeIdx < 0 || eoeIdx < 0) {
        throw new Error("Could not find $$SOE/$$EOE markers in Horizons response");
      }

      const block = result.substring(soeIdx + 5, eoeIdx);
      const xMatch = block.match(/X\s*=\s*([^\s]+)/);
      const yMatch = block.match(/Y\s*=\s*([^\s]+)/);
      const zMatch = block.match(/Z\s*=\s*([^\s]+)/);
      if (!xMatch || !yMatch || !zMatch) {
        throw new Error("Could not parse XYZ from Horizons response");
      }

      const horizonsAU = {
        x: parseFloat(xMatch[1]),
        y: parseFloat(yMatch[1]),
        z: parseFloat(zMatch[1]),
      };

      // Convert to meters (heliocentric ICRF)
      const horizonsICRF = new Cartesian3(horizonsAU.x * AU_TO_METERS, horizonsAU.y * AU_TO_METERS, horizonsAU.z * AU_TO_METERS);

      // Get astronomy-engine position for same time
      const astroICRF = getEarthHelioVectorMeters(time);

      // Compute delta (error vector in ICRF meters)
      const deltaICRF = new Cartesian3(horizonsICRF.x - astroICRF.x, horizonsICRF.y - astroICRF.y, horizonsICRF.z - astroICRF.z);
      const errorMeters = Cartesian3.magnitude(deltaICRF);
      const errorKm = errorMeters / 1000;

      // Convert delta to ECEF for entity positioning
      const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
      let deltaECEF;
      if (defined(icrfToFixed)) {
        deltaECEF = Matrix3.multiplyByVector(icrfToFixed, deltaICRF, new Cartesian3());
      } else {
        deltaECEF = Cartesian3.clone(deltaICRF);
      }

      // Console output: comparison table
      console.log("[DebugEarth] Heliocentric ICRF comparison (AU):");
      console.table({
        Horizons: { X: horizonsAU.x, Y: horizonsAU.y, Z: horizonsAU.z },
        "astronomy-engine": {
          X: astroICRF.x / AU_TO_METERS,
          Y: astroICRF.y / AU_TO_METERS,
          Z: astroICRF.z / AU_TO_METERS,
        },
        "Delta (AU)": {
          X: deltaICRF.x / AU_TO_METERS,
          Y: deltaICRF.y / AU_TO_METERS,
          Z: deltaICRF.z / AU_TO_METERS,
        },
      });
      console.log(`[DebugEarth] Position error: ${errorKm.toFixed(3)} km (${errorMeters.toFixed(1)} m)`);

      // Create diagnostic entity at error offset from Earth center
      const labelText = `Error: ${errorKm.toFixed(3)} km\nHorizons: [${horizonsAU.x.toFixed(8)}, ${horizonsAU.y.toFixed(8)}, ${horizonsAU.z.toFixed(8)}] AU`;

      const entity = this.viewer.entities.add({
        id: `debug-earth-horizons-${Date.now()}`,
        name: "Horizons Earth Position Error",
        position: deltaECEF,
        point: {
          pixelSize: 10,
          color: Color.YELLOW,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
        },
        label: {
          text: labelText,
          font: "13px monospace",
          fillColor: Color.YELLOW,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 2, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: true,
        },
      });
      this._debugEntities.push(entity);

      // Draw error line from Earth center (0,0,0) to error position
      if (errorMeters > 0.1) {
        const linePositions = [new Cartesian3(0, 0, 0), Cartesian3.clone(deltaECEF)];
        const linePrimitive = new OrbitLinePrimitive({
          positions: linePositions,
          color: Color.YELLOW.withAlpha(0.8),
          modelMatrix: Matrix4.IDENTITY,
          show: true,
          depthTestEnabled: false,
          primitiveType: PrimitiveType.LINES,
        });
        this.viewer.scene.primitives.add(linePrimitive);
        this._debugPrimitives.push(linePrimitive);
      }

      console.log("[DebugEarth] Debug visualization created. Yellow marker shows position error offset from Earth center.");
    } catch (error) {
      console.error("[DebugEarth] Failed:", error);
    }
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
