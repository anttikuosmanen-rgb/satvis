/**
 * SnapshotService - Capture and restore complete view state as URL
 *
 * Creates shareable snapshot URLs that capture the exact view state including:
 * - Time state (currentTime, startTime, stopTime, multiplier, animation)
 * - Camera state (globe view position or entity tracking with offset)
 * - Ground station locations
 * - Optionally: TLE data for enabled satellites
 */

import LZString from "lz-string";
import { JulianDate, Cartesian3 } from "@cesium/engine";
import { useToastProxy } from "../../composables/useToastProxy";
import { useSatStore } from "../../stores/sat";

export class SnapshotService {
  constructor(cesiumController) {
    this.cc = cesiumController;
  }

  /**
   * Capture current state as a snapshot object
   * @param {Object} options - Capture options
   * @param {boolean} options.includeTles - Include TLE data for enabled satellites
   * @returns {Object} Snapshot state object
   */
  captureSnapshot(options = { includeTles: false }) {
    const viewer = this.cc.viewer;
    const state = {
      v: 1, // Version for future compatibility
      t: this.captureTimeState(),
    };

    // Capture zenith view state if active
    if (this.cc.sats.isInZenithView) {
      state.zen = this.captureZenithViewState();
    } else if (viewer.trackedEntity) {
      // Capture camera state (globe view or tracked entity)
      const trackingState = this.captureTrackedCamera();
      if (trackingState) {
        state.trk = trackingState;
      }
    } else {
      state.cam = this.captureGlobeCamera();
    }

    // Capture ground station locations
    const gs = this.captureGroundStations();
    if (gs.length > 0) {
      state.gs = gs;
    }

    // Capture enabled satellite components (Orbit, Label, Orbit track, etc.)
    const components = this.captureEnabledComponents();
    if (components.length > 0) {
      state.cmp = components;
    }

    // Optionally capture TLE data
    if (options.includeTles) {
      const tles = this.captureTleSnapshot();
      if (Object.keys(tles).length > 0) {
        state.tle = tles;
      }
    }

    return state;
  }

  /**
   * Capture time state from Cesium clock
   */
  captureTimeState() {
    const clock = this.cc.viewer.clock;
    return {
      c: JulianDate.toIso8601(clock.currentTime),
      s: JulianDate.toIso8601(clock.startTime),
      e: JulianDate.toIso8601(clock.stopTime),
      m: clock.multiplier,
      a: clock.shouldAnimate,
    };
  }

  /**
   * Capture camera position for globe view (not tracking)
   */
  captureGlobeCamera() {
    const cam = this.cc.viewer.camera;
    return {
      p: [cam.position.x, cam.position.y, cam.position.z],
      h: cam.heading,
      i: cam.pitch,
      r: cam.roll,
    };
  }

  /**
   * Capture zenith view state (FOV and camera orientation)
   */
  captureZenithViewState() {
    const cam = this.cc.viewer.camera;
    // Get FOV in degrees from radians
    const fovDegrees = cam.frustum.fov * (180 / Math.PI);
    return {
      fov: fovDegrees,
      h: cam.heading,
      i: cam.pitch,
    };
  }

  /**
   * Capture camera state when tracking an entity
   */
  captureTrackedCamera() {
    const entity = this.cc.viewer.trackedEntity;
    if (!entity) return null;

    // Use CesiumController's helper to get camera offset
    const offset = this.cc.captureTrackedEntityCameraOffset();
    if (!offset) return null;

    return {
      n: entity.name,
      v: [offset.viewFrom.x, offset.viewFrom.y, offset.viewFrom.z],
    };
  }

  /**
   * Capture TLE data for all enabled satellites
   */
  captureTleSnapshot() {
    const tles = {};
    const activeSats = this.cc.sats.activeSatellites;

    for (const sat of activeSats) {
      if (sat.props?.orbit?.tle) {
        // Store TLE as newline-joined string
        tles[sat.props.name] = sat.props.orbit.tle.join("\n");
      }
    }

    return tles;
  }

  /**
   * Capture ground station locations from the store
   */
  captureGroundStations() {
    const satStore = useSatStore();
    const groundStations = satStore.groundStations || [];

    // Store as compact array: [lat, lon] or [lat, lon, name] if name exists
    return groundStations.map((gs) => {
      const arr = [gs.lat, gs.lon];
      if (gs.name) {
        arr.push(gs.name);
      }
      return arr;
    });
  }

  /**
   * Capture enabled satellite visualization components
   * (Point, Label, Orbit, Orbit track, Visibility area, Height stick, 3D model)
   */
  captureEnabledComponents() {
    return [...this.cc.sats.enabledComponents];
  }

  /**
   * Serialize snapshot state to URL-safe string
   * Uses LZ-string compression with z: prefix
   */
  serializeSnapshot(state) {
    const json = JSON.stringify(state);
    return "z:" + LZString.compressToEncodedURIComponent(json);
  }

  /**
   * Deserialize snapshot from URL parameter
   */
  deserializeSnapshot(encoded) {
    if (!encoded.startsWith("z:")) {
      throw new Error("Unknown snapshot format");
    }
    const json = LZString.decompressFromEncodedURIComponent(encoded.slice(2));
    if (!json) {
      throw new Error("Failed to decompress snapshot data");
    }
    return JSON.parse(json);
  }

  /**
   * Apply snapshot state to the application
   */
  async applySnapshot(state) {
    if (!state || state.v !== 1) {
      throw new Error("Invalid snapshot version");
    }

    // First, restore ground stations (before TLEs and camera, as GS affects pass calculations)
    if (state.gs) {
      this.restoreGroundStations(state.gs);
    }

    // Restore enabled components before TLEs so satellites render with correct visuals
    if (state.cmp) {
      this.restoreEnabledComponents(state.cmp);
    }

    // Restore TLEs if present (before time/camera so satellites exist)
    if (state.tle) {
      await this.restoreTleSnapshot(state.tle);
    }

    // Restore time state
    if (state.t) {
      this.restoreTimeState(state.t);
    }

    // Restore camera state (after a short delay to ensure satellites are loaded)
    setTimeout(() => {
      if (state.zen) {
        // Restore zenith view mode
        this.restoreZenithView(state.zen);
      } else if (state.trk) {
        this.restoreTrackedCamera(state.trk);
      } else if (state.cam) {
        this.restoreGlobeCamera(state.cam);
      }
    }, 500);
  }

  /**
   * Restore time state from snapshot
   * Note: Always restores in paused state for user control
   */
  restoreTimeState(timeState) {
    const clock = this.cc.viewer.clock;
    clock.currentTime = JulianDate.fromIso8601(timeState.c);
    clock.startTime = JulianDate.fromIso8601(timeState.s);
    clock.stopTime = JulianDate.fromIso8601(timeState.e);
    clock.multiplier = timeState.m;
    // Always start paused so user can see the exact snapshot moment
    clock.shouldAnimate = false;

    // Update timeline if present
    if (this.cc.viewer.timeline) {
      this.cc.viewer.timeline.updateFromClock();
    }
  }

  /**
   * Restore ground stations from snapshot
   */
  restoreGroundStations(gsArray) {
    const satStore = useSatStore();

    // Convert compact array format back to objects
    const groundStations = gsArray.map((gs) => ({
      lat: gs[0],
      lon: gs[1],
      name: gs[2] || undefined,
    }));

    // Set ground stations in the store (this will trigger watchers in Satvis.vue)
    satStore.groundStations = groundStations;
  }

  /**
   * Restore enabled satellite visualization components
   */
  restoreEnabledComponents(components) {
    // Use the SatelliteManager's setter which properly enables/disables components
    this.cc.sats.enabledComponents = components;

    // Also update the store so UI reflects the change
    const satStore = useSatStore();
    satStore.enabledComponents = components;
  }

  /**
   * Restore globe camera position
   */
  restoreGlobeCamera(camState) {
    const camera = this.cc.viewer.camera;
    camera.setView({
      destination: new Cartesian3(camState.p[0], camState.p[1], camState.p[2]),
      orientation: {
        heading: camState.h,
        pitch: camState.i,
        roll: camState.r,
      },
    });
  }

  /**
   * Restore zenith view mode with saved FOV and orientation
   */
  restoreZenithView(zenState) {
    // First enter zenith view mode (this sets up the camera controls and FOV handling)
    this.cc.sats.zenithViewFromGroundStation();

    // After zenith view is set up, restore the saved FOV and orientation
    setTimeout(() => {
      const camera = this.cc.viewer.camera;

      // Restore FOV (convert degrees to radians)
      if (zenState.fov) {
        camera.frustum.fov = zenState.fov * (Math.PI / 180);
      }

      // Restore camera orientation (heading and pitch)
      camera.setView({
        orientation: {
          heading: zenState.h || 0,
          pitch: zenState.i || Math.PI / 2, // 90 degrees up by default
          roll: 0,
        },
      });

      // Update FOV readout if it exists
      const readout = document.getElementById("zenithViewReadout");
      if (readout && zenState.fov) {
        readout.textContent = `FOV: ${zenState.fov.toFixed(0)}°`;
      }
    }, 500);
  }

  /**
   * Restore tracked entity camera state
   */
  restoreTrackedCamera(trkState) {
    // Find the entity by name
    const entityName = trkState.n;
    const sat = this.cc.sats.getSatellite(entityName);

    if (sat && sat.defaultEntity) {
      // Set viewFrom before tracking
      sat.defaultEntity.viewFrom = new Cartesian3(trkState.v[0], trkState.v[1], trkState.v[2]);

      // Track the satellite
      sat.track();

      // Reset viewFrom to default after camera is positioned
      // Default from CesiumComponentCollection.createCesiumEntity
      const defaultViewFrom = new Cartesian3(0, -3600000, 4200000);
      setTimeout(() => {
        sat.defaultEntity.viewFrom = defaultViewFrom;
      }, 500);
    } else {
      // Entity not found - might be a ground station or not loaded yet
      // Check if it's a ground station
      const viewer = this.cc.viewer;
      const entity = viewer.entities.values.find((e) => e.name === entityName);
      if (entity) {
        entity.viewFrom = new Cartesian3(trkState.v[0], trkState.v[1], trkState.v[2]);
        viewer.trackedEntity = entity;
      }
    }
  }

  /**
   * Restore TLE data from snapshot
   * Creates [Snapshot] prefixed satellites to avoid conflicts with database
   */
  restoreTleSnapshot(tles) {
    const snapshotNames = [];

    for (const [name, tle] of Object.entries(tles)) {
      // Prepend [Snapshot] to distinguish from database satellites
      const snapshotName = `[Snapshot] ${name}`;
      const lines = tle.split("\n");

      // Replace the name line with snapshot-prefixed name
      let modifiedTle;
      if (lines.length === 2 && lines[0].startsWith("1 ")) {
        // 2-line TLE (no name) - add name line
        modifiedTle = `${snapshotName}\n${lines[0]}\n${lines[1]}`;
      } else if (lines.length >= 3) {
        // 3-line TLE - replace name
        modifiedTle = `${snapshotName}\n${lines[1]}\n${lines[2]}`;
      } else {
        console.warn(`Invalid TLE format for ${name}`);
        continue;
      }

      // Add as custom satellite with Snapshot tag
      this.cc.sats.addFromTle(modifiedTle, ["Snapshot"], false);
      snapshotNames.push(snapshotName);
    }

    // Update store so satellites appear in the list
    this.cc.sats.updateStore();

    // Enable the snapshot satellites using SatelliteManager's setter
    // This triggers showEnabledSatellites() to actually render them
    const currentEnabled = [...this.cc.sats.enabledSatellites];
    const newEnabled = [...new Set([...currentEnabled, ...snapshotNames])];
    this.cc.sats.enabledSatellites = newEnabled;

    return snapshotNames;
  }

  /**
   * Check URL for snapshot parameter and restore if present
   */
  async restoreFromUrlIfPresent() {
    const url = new URL(window.location.href);
    const snapParam = url.searchParams.get("snap");

    if (snapParam) {
      try {
        const state = this.deserializeSnapshot(snapParam);
        await this.applySnapshot(state);

        useToastProxy().add({
          severity: "success",
          summary: "Snapshot Restored",
          detail: "View state has been restored from URL",
          life: 3000,
        });

        return true;
      } catch (error) {
        console.error("Failed to restore snapshot:", error);
        useToastProxy().add({
          severity: "error",
          summary: "Snapshot Error",
          detail: "Failed to restore view state from URL",
          life: 5000,
        });
        return false;
      }
    }

    return false;
  }

  /**
   * Generate full snapshot URL and copy to clipboard
   * @param {Object} options - Capture options
   * @param {boolean} options.includeTles - Include TLE data
   * @returns {string|null} The generated URL, or null if failed
   */
  async copySnapshotUrl(options = { includeTles: false }) {
    const toast = useToastProxy();
    const state = this.captureSnapshot(options);
    const encoded = this.serializeSnapshot(state);

    const url = new URL(window.location.href);
    // Clear existing URL params that might conflict with snapshot
    url.search = "";
    url.searchParams.set("snap", encoded);
    const fullUrl = url.toString();
    const chars = fullUrl.length;

    // Hard limit - refuse to create
    if (chars > 32000) {
      toast.add({
        severity: "error",
        summary: "URL Too Long",
        detail: `Cannot create snapshot: ${chars} characters exceeds browser limits. Try enabling fewer satellites.`,
        life: 8000,
      });
      return null;
    }

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(fullUrl);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      toast.add({
        severity: "error",
        summary: "Copy Failed",
        detail: "Failed to copy URL to clipboard",
        life: 5000,
      });
      return null;
    }

    // Show appropriate toast based on URL length
    if (chars > 8000) {
      toast.add({
        severity: "warn",
        summary: "Very Long URL",
        detail: `Copied! URL is ${chars} characters - may not work in all browsers or when shared via some services.`,
        life: 8000,
      });
    } else if (chars > 2000) {
      toast.add({
        severity: "info",
        summary: "Long URL",
        detail: `Copied! URL is ${chars} characters - should work in most browsers.`,
        life: 5000,
      });
    } else {
      toast.add({
        severity: "success",
        summary: "Snapshot Copied",
        detail: `URL copied to clipboard (${chars} characters)`,
        life: 3000,
      });
    }

    return fullUrl;
  }
}
