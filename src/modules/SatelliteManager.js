import {
  CameraEventType,
  Cartesian2,
  Cartesian3,
  ClockStep,
  Color,
  Entity,
  HorizontalOrigin,
  JulianDate,
  KeyboardEventModifier,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventType,
  VerticalOrigin,
} from "@cesium/engine";
import { useSatStore } from "../stores/sat";
import { SatelliteComponentCollection } from "./SatelliteComponentCollection";
import { GroundStationEntity } from "./GroundStationEntity";

import { CesiumCleanupHelper } from "./util/CesiumCleanupHelper";
import { CesiumTimelineHelper } from "./util/CesiumTimelineHelper";

export class SatelliteManager {
  #enabledComponents = ["Point", "Label"];

  #enabledTags = new Set();

  #enabledSatellites = new Set();

  #groundStations = [];

  #overpassMode = "elevation";

  constructor(viewer) {
    this.viewer = viewer;

    this.satellites = [];
    this.satellitesByName = new Map(); // O(1) lookup by name
    this.availableComponents = ["Point", "Label", "Orbit", "Orbit track", "Visibility area", "Height stick", "3D model"];

    this.viewer.trackedEntityChanged.addEventListener(() => {
      if (this.trackedSatellite) {
        this.getSatellite(this.trackedSatellite).show(this.#enabledComponents);
      }
      useSatStore().trackedSatellite = this.trackedSatellite;
    });

    // Add timeline change listener to recalculate daytime ranges when needed
    this.setupTimelineChangeListener();
  }

  setupTimelineChangeListener() {
    if (!this.viewer.clock) {
      return;
    }

    // Listen for clock range changes
    this.viewer.clock.onTick.addEventListener(() => {
      // Only check occasionally (every 60 ticks) to avoid performance issues
      if (this.viewer.clock.clockStep === ClockStep.SYSTEM_CLOCK || this.viewer.clock.clockStep === ClockStep.TICK_DEPENDENT) {
        return; // Don't check during normal time progression
      }

      // Throttle checks - only check every 60 frames
      if (!this._lastTimelineCheck) {
        this._lastTimelineCheck = 0;
      }
      this._lastTimelineCheck++;
      if (this._lastTimelineCheck % 60 !== 0) {
        return;
      }

      this.checkAndUpdateDaytimeRanges();
    });

    // Also listen for timeline zoom events by checking start/stop time changes
    let lastStartTime = this.viewer.clock.startTime;
    let lastStopTime = this.viewer.clock.stopTime;

    const checkTimelineChange = () => {
      const currentStart = this.viewer.clock.startTime;
      const currentStop = this.viewer.clock.stopTime;

      if (!JulianDate.equals(lastStartTime, currentStart) || !JulianDate.equals(lastStopTime, currentStop)) {
        lastStartTime = JulianDate.clone(currentStart);
        lastStopTime = JulianDate.clone(currentStop);

        // Delay the check slightly to avoid multiple rapid updates
        setTimeout(() => this.checkAndUpdateDaytimeRanges(), 100);
      }
    };

    // Check for timeline changes periodically
    setInterval(checkTimelineChange, 1000);

    // Also add direct event listeners to the timeline widget for more responsive updates
    if (this.viewer.timeline && this.viewer.timeline.container) {
      const timelineContainer = this.viewer.timeline.container;

      // Listen for wheel events (scrolling)
      timelineContainer.addEventListener("wheel", () => {
        setTimeout(() => {
          try {
            // First constrain timeline bounds to prevent invalid dates
            if (window.cc && window.cc.constrainTimelineBounds) {
              window.cc.constrainTimelineBounds();
            }
            this.checkAndUpdateDaytimeRanges();
          } catch (error) {
            console.error("Error in timeline wheel event handler:", error);
          }
        }, 200);
      });

      // Listen for mouse events that might change timeline
      ["mouseup", "touchend"].forEach((eventType) => {
        timelineContainer.addEventListener(eventType, () => {
          setTimeout(() => {
            try {
              // First constrain timeline bounds to prevent invalid dates
              if (window.cc && window.cc.constrainTimelineBounds) {
                window.cc.constrainTimelineBounds();
              }
              this.checkAndUpdateDaytimeRanges();
            } catch (error) {
              console.error(`Error in timeline ${eventType} event handler:`, error);
            }
          }, 100);
        });
      });
    }
  }

  checkAndUpdateDaytimeRanges() {
    try {
      if (this.#groundStations.length > 0) {
        const firstGroundStation = this.#groundStations[0];
        if (CesiumTimelineHelper.needsRecalculation(this.viewer, firstGroundStation)) {
          console.log("Timeline moved outside calculated range, recalculating daytime highlights");
          CesiumTimelineHelper.clearGroundStationDaytimeRanges(this.viewer);
          CesiumTimelineHelper.addGroundStationDaytimeRanges(this.viewer, firstGroundStation);
        }
      }
    } catch (error) {
      console.error("Error updating daytime ranges:", error);
    }
  }

  addFromTleUrls(urlTagList) {
    // Initiate async download of all TLE URLs and update store afterwards
    const promises = urlTagList.map(([url, tags]) => this.addFromTleUrl(url, tags, false));
    Promise.all(promises).then(() => this.updateStore());
  }

  addFromTleUrl(url, tags, updateStore = true) {
    return fetch(url, {
      mode: "no-cors",
    })
      .then((response) => {
        if (!response.ok) {
          throw Error(response.statusText);
        }
        return response;
      })
      .then((response) => response.text())
      .then((data) => {
        const lines = data.split(/\r?\n/);
        for (let i = 3; i < lines.length; i += 3) {
          const tle = lines.slice(i - 3, i).join("\n");
          this.addFromTle(tle, tags, updateStore);
        }
      })
      .catch((error) => {
        console.log(error);
      });
  }

  addFromTle(tle, tags, updateStore = true) {
    const sat = new SatelliteComponentCollection(this.viewer, tle, tags);
    this.#add(sat);
    if (updateStore) {
      this.updateStore();
    }
  }

  #add(newSat) {
    const existingSat = this.satellitesByName.get(newSat.props.name);
    if (existingSat && existingSat.props.satnum === newSat.props.satnum) {
      existingSat.props.addTags(newSat.props.tags);
      if (newSat.props.tags.some((tag) => this.#enabledTags.has(tag))) {
        existingSat.show(this.#enabledComponents);
      }
      return;
    }
    if (this.groundStationAvailable) {
      newSat.groundStations = this.#groundStations;
    }
    // Set overpass mode for newly added satellite
    newSat.props.overpassMode = this.#overpassMode;
    this.satellites.push(newSat);
    this.satellitesByName.set(newSat.props.name, newSat); // Add to index

    if (this.satIsActive(newSat)) {
      newSat.show(this.#enabledComponents);
      if (this.pendingTrackedSatellite === newSat.props.name) {
        this.trackedSatellite = newSat.props.name;
      }
    }
  }

  updateStore() {
    const satStore = useSatStore();
    satStore.availableTags = this.tags;
    satStore.availableSatellitesByTag = this.taglist;

    // Refresh labels to pick up new dynamic elevation text behavior
    setTimeout(() => this.refreshLabels(), 1000);
  }

  get taglist() {
    const taglist = {};
    this.satellites.forEach((sat) => {
      sat.props.tags.forEach((tag) => {
        (taglist[tag] = taglist[tag] || []).push(sat.props.name);
      });
    });
    Object.values(taglist).forEach((tag) => {
      tag.sort();
    });
    return taglist;
  }

  get selectedSatellite() {
    const satellite = this.satellites.find((sat) => sat.isSelected);
    return satellite ? satellite.props.name : "";
  }

  get trackedSatellite() {
    const satellite = this.satellites.find((sat) => sat.isTracked);
    return satellite ? satellite.props.name : "";
  }

  set trackedSatellite(name) {
    if (!name) {
      if (this.trackedSatellite) {
        this.viewer.trackedEntity = undefined;
      }
      return;
    }
    if (name === this.trackedSatellite) {
      return;
    }

    const sat = this.getSatellite(name);
    if (sat) {
      sat.track();
      this.pendingTrackedSatellite = undefined;
    } else {
      // Satellite does not exist (yet?)
      this.pendingTrackedSatellite = name;
    }
  }

  get visibleSatellites() {
    return this.satellites.filter((sat) => sat.created);
  }

  get satelliteNames() {
    return this.satellites.map((sat) => sat.props.name);
  }

  getSatellite(name) {
    return this.satellitesByName.get(name);
  }

  refreshLabels() {
    // Force refresh of all existing satellite labels to pick up new dynamic text
    this.visibleSatellites.forEach((sat) => {
      if (sat.components.Label) {
        sat.disableComponent("Label");
        sat.enableComponent("Label");
      }
    });
  }

  get enabledSatellites() {
    return Array.from(this.#enabledSatellites);
  }

  set enabledSatellites(newSats) {
    this.#enabledSatellites = new Set(newSats);
    this.showEnabledSatellites();

    // Invalidate pass cache since visible satellites changed
    this.invalidateGroundStationCaches();

    const satStore = useSatStore();
    satStore.enabledSatellites = newSats;
  }

  get tags() {
    const tags = this.satellites.map((sat) => sat.props.tags);
    return [...new Set([].concat(...tags))];
  }

  getSatellitesWithTag(tag) {
    return this.satellites.filter((sat) => sat.props.hasTag(tag));
  }

  /**
   * Returns true if the satellite is enabled by tag or name
   * @param {SatelliteComponentCollection} sat
   * @returns {boolean} true if the satellite is enabled
   */
  satIsActive(sat) {
    const enabledByTag = sat.props.tags.some((tag) => this.#enabledTags.has(tag));
    const enabledByName = this.#enabledSatellites.has(sat.props.name);
    return enabledByTag || enabledByName;
  }

  get activeSatellites() {
    return this.satellites.filter((sat) => this.satIsActive(sat));
  }

  showEnabledSatellites() {
    const toShow = [];
    const toHide = [];

    // First pass: categorize satellites
    this.satellites.forEach((sat) => {
      if (this.satIsActive(sat)) {
        toShow.push(sat);
      } else {
        toHide.push(sat);
      }
    });

    // Batch process satellites using requestIdleCallback for better performance
    const batchSize = 20;

    // Process satellites to show in batches
    const processBatch = (list, operation, index = 0) => {
      if (index >= list.length) {
        // Done with this operation
        if (operation === 'show' && toHide.length > 0) {
          // Start hiding after showing is complete
          processBatch(toHide, 'hide');
        } else if (operation === 'hide' && this.visibleSatellites.length === 0) {
          CesiumCleanupHelper.cleanup(this.viewer);
        }
        // Request render after batch completion
        if (this.viewer && this.viewer.scene) {
          this.viewer.scene.requestRender();
        }
        return;
      }

      const batch = list.slice(index, index + batchSize);
      batch.forEach((sat) => {
        if (operation === 'show') {
          sat.show(this.#enabledComponents);
        } else {
          sat.hide();
        }
      });

      // Request render after this batch
      if (this.viewer && this.viewer.scene) {
        this.viewer.scene.requestRender();
      }

      // Schedule next batch
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => processBatch(list, operation, index + batchSize), { timeout: 100 });
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => processBatch(list, operation, index + batchSize), 0);
      }
    };

    // Start processing
    if (toShow.length > 0) {
      processBatch(toShow, 'show');
    } else if (toHide.length > 0) {
      processBatch(toHide, 'hide');
    }
  }

  get enabledTags() {
    return Array.from(this.#enabledTags);
  }

  set enabledTags(newTags) {
    this.#enabledTags = new Set(newTags);
    this.showEnabledSatellites();

    // Invalidate pass cache since visible satellites changed
    this.invalidateGroundStationCaches();

    const satStore = useSatStore();
    satStore.enabledTags = newTags;
  }

  get components() {
    const components = this.satellites.map((sat) => sat.components);
    return [...new Set([].concat(...components))];
  }

  get enabledComponents() {
    return this.#enabledComponents;
  }

  set enabledComponents(newComponents) {
    const oldComponents = this.#enabledComponents;
    const add = newComponents.filter((x) => !oldComponents.includes(x));
    const del = oldComponents.filter((x) => !newComponents.includes(x));
    add.forEach((component) => {
      this.enableComponent(component);
    });
    del.forEach((component) => {
      this.disableComponent(component);
    });
  }

  enableComponent(componentName) {
    if (!this.#enabledComponents.includes(componentName)) {
      this.#enabledComponents.push(componentName);
    }

    this.activeSatellites.forEach((sat) => {
      sat.enableComponent(componentName);
    });
  }

  disableComponent(componentName) {
    this.#enabledComponents = this.#enabledComponents.filter((name) => name !== componentName);

    this.activeSatellites.forEach((sat) => {
      sat.disableComponent(componentName);
    });
  }

  get groundStationAvailable() {
    return this.#groundStations.length > 0;
  }

  invalidateGroundStationCaches() {
    // Invalidate pass cache on all ground stations when satellite visibility changes
    this.#groundStations.forEach((gs) => {
      if (gs.invalidatePassCache) {
        gs.invalidatePassCache();
      }
    });

    // Always clear highlights when satellite visibility changes
    CesiumTimelineHelper.clearHighlightRanges(this.viewer);

    // Refresh highlights if a ground station is currently selected
    const selectedEntity = this.viewer.selectedEntity;
    if (selectedEntity && selectedEntity.name && selectedEntity.name.includes("Groundstation")) {
      // Trigger recalculation by temporarily clearing and restoring selection
      setTimeout(() => {
        const entity = selectedEntity;
        this.viewer.selectedEntity = undefined;
        setTimeout(() => {
          this.viewer.selectedEntity = entity;
        }, 10);
      }, 10);
    }
  }

  focusGroundStation() {
    if (!this.groundStationAvailable) {
      return;
    }

    // If in zenith view, exit to normal view first
    if (this.isInZenithView) {
      this.exitZenithView();
      return;
    }

    // Normal focus behavior
    this.#groundStations[0].track();
  }

  get isInZenithView() {
    return !!this.zenithViewCleanup;
  }

  exitZenithView() {
    if (this.zenithViewCleanup) {
      this.zenithViewCleanup();
    }
    // Dispatch event for UI to update
    window.dispatchEvent(new CustomEvent("zenithViewChanged", { detail: { active: false } }));

    // Return to a reasonable view of Earth from distance
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(0, 20, 20000000), // 20,000 km away
      orientation: {
        heading: 0,
        pitch: -CesiumMath.PI_OVER_TWO, // Look down at Earth
        roll: 0,
      },
      duration: 1.5,
    });
  }

  zenithViewFromGroundStation() {
    if (!this.groundStationAvailable) {
      return;
    }

    const groundStation = this.#groundStations[0];
    const position = groundStation.position;

    // Convert lat/lon/height to Cartesian3 for ground station position
    const groundStationPosition = Cartesian3.fromDegrees(position.longitude, position.latitude, position.height);

    // Check if camera is already at ground station position
    const currentCameraPosition = this.viewer.camera.positionWC;
    const distanceToGroundStation = Cartesian3.distance(currentCameraPosition, groundStationPosition);

    // If camera is more than 1km from ground station, focus on it first
    if (distanceToGroundStation > 1000) {
      // Select ground station entity first (so it shows in zenith view)
      const groundStationEntity = groundStation.components.Groundstation;
      this.viewer.selectedEntity = groundStationEntity;

      // Track ground station to move camera
      this.viewer.trackedEntity = groundStationEntity;

      // Enter zenith view after a short delay for camera to start moving
      setTimeout(() => {
        this.enterZenithViewImmediate();
      }, 300); // Reduced delay - just enough for tracking to engage
      return;
    }

    // Camera is already at ground station, enter zenith view immediately
    this.enterZenithViewImmediate();
  }

  enterZenithViewImmediate() {
    if (!this.groundStationAvailable) {
      return;
    }

    const groundStation = this.#groundStations[0];
    const position = groundStation.position;

    // Convert lat/lon/height to Cartesian3 for camera position
    const cameraPosition = Cartesian3.fromDegrees(position.longitude, position.latitude, position.height);

    // Clear any tracked entity
    this.viewer.trackedEntity = undefined;

    // If camera is in Inertial mode, switch to Fixed mode for zenith view
    // Zenith view needs to stay aligned with the rotating Earth
    let previousCameraMode = null;
    if (window.cc && window.cc.cameraMode === "Inertial") {
      previousCameraMode = "Inertial";
      window.cc.cameraMode = "Fixed";
    }

    // Clean up any existing zenith view handler
    if (this.zenithViewCleanup) {
      this.zenithViewCleanup();
    }

    // Set camera to ground station position looking straight up (zenith)
    this.viewer.camera.setView({
      destination: cameraPosition,
      orientation: {
        heading: 0, // North
        pitch: CesiumMath.toRadians(90), // 90 degrees = straight up (zenith)
        roll: 0,
      },
    });

    // Lock camera position at ground station, only allow looking around
    const controller = this.viewer.scene.screenSpaceCameraController;
    const originalZoomEnabled = controller.enableZoom;
    const originalTranslateEnabled = controller.enableTranslate;
    const originalRotateEnabled = controller.enableRotate;

    // Store original event type mappings before modifying
    const originalLookEventTypes = controller.lookEventTypes;
    const originalTiltEventTypes = controller.tiltEventTypes;

    // Replace default double-click behavior with ground station selection
    const screenSpaceEventHandler = this.viewer.screenSpaceEventHandler;
    const originalLeftDoubleClick = screenSpaceEventHandler.getInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Custom double-click handler for zenith view
    const zenithDoubleClickHandler = () => {
      // Select ground station entity when double-clicking
      const groundStationEntity = groundStation.components.Groundstation;
      if (groundStationEntity) {
        this.viewer.selectedEntity = groundStationEntity;
      }
    };

    screenSpaceEventHandler.setInputAction(zenithDoubleClickHandler, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    controller.enableZoom = false; // Disable default zoom (we use custom wheel handler)
    controller.enableTranslate = false; // Disable panning/moving position
    controller.enableRotate = false; // Disable orbiting which moves camera position
    controller.enableTilt = true; // Allow tilting camera up/down
    controller.enableLook = true; // Allow looking around from fixed position

    // Remap left mouse drag to look instead of rotate (which moves camera position)
    controller.lookEventTypes = [CameraEventType.LEFT_DRAG, CameraEventType.RIGHT_DRAG];
    controller.tiltEventTypes = [
      CameraEventType.MIDDLE_DRAG,
      {
        eventType: CameraEventType.LEFT_DRAG,
        modifier: KeyboardEventModifier.SHIFT,
      },
    ];

    // Store original FOV and apply zenith view FOV
    const originalFov = this.viewer.camera.frustum.fov;

    // FOV settings (in degrees)
    const minFov = 30; // Maximum zoom (narrowest field of view)
    const maxFov = 150; // Maximum wide view
    let currentFov = 90; // Start with 90 degree FOV (medium view)

    // Apply initial FOV
    this.viewer.camera.frustum.fov = CesiumMath.toRadians(currentFov);

    // Create FOV readout display
    const viewReadout = document.createElement("div");
    viewReadout.id = "zenithViewReadout";
    viewReadout.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 14px;
      z-index: 1000;
      pointer-events: none;
    `;
    viewReadout.textContent = `FOV: ${currentFov.toFixed(0)}°`;
    this.viewer.container.appendChild(viewReadout);

    // Create azimuth scale markers on the horizon
    const zenithEntities = [];
    const horizonRadius = 50000; // 50 km from ground station
    const tickLength = 5000; // 5 km tick marks

    // Cardinal directions mapping
    const cardinals = {
      0: "N",
      90: "E",
      180: "S",
      270: "W",
    };

    // Create markers every 30 degrees
    for (let azimuth = 0; azimuth < 360; azimuth += 30) {
      const azimuthRad = CesiumMath.toRadians(azimuth);

      // Calculate position at horizon for this azimuth
      const dx = Math.sin(azimuthRad) * horizonRadius;
      const dy = Math.cos(azimuthRad) * horizonRadius;

      // Convert to lat/lon offset (approximate for small distances)
      const latOffset = dy / 111000; // degrees latitude
      const lonOffset = dx / (111000 * Math.cos(CesiumMath.toRadians(position.latitude))); // degrees longitude

      const markerLat = position.latitude + latOffset;
      const markerLon = position.longitude + lonOffset;

      // Create tick mark (short line extending outward)
      const tickStart = Cartesian3.fromDegrees(markerLon, markerLat, position.height);
      const tickDx = Math.sin(azimuthRad) * tickLength;
      const tickDy = Math.cos(azimuthRad) * tickLength;
      const tickLatOffset = (dy + tickDy) / 111000;
      const tickLonOffset = (dx + tickDx) / (111000 * Math.cos(CesiumMath.toRadians(position.latitude)));
      const tickEnd = Cartesian3.fromDegrees(position.longitude + tickLonOffset, position.latitude + tickLatOffset, position.height);

      const tickEntity = this.viewer.entities.add({
        polyline: {
          positions: [tickStart, tickEnd],
          width: 2,
          material: Color.WHITE,
          clampToGround: false,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always render on top
        },
      });
      zenithEntities.push(tickEntity);

      // Create label with degree marking
      let labelText = `${azimuth}°`;
      if (cardinals[azimuth]) {
        labelText = `${cardinals[azimuth]} (${azimuth}°)`;
      }

      // Position label slightly beyond the tick mark
      const labelDistance = horizonRadius + tickLength + 3000;
      const labelDx = Math.sin(azimuthRad) * labelDistance;
      const labelDy = Math.cos(azimuthRad) * labelDistance;
      const labelLatOffset = labelDy / 111000;
      const labelLonOffset = labelDx / (111000 * Math.cos(CesiumMath.toRadians(position.latitude)));

      const labelEntity = this.viewer.entities.add({
        position: Cartesian3.fromDegrees(position.longitude + labelLonOffset, position.latitude + labelLatOffset, position.height),
        label: {
          text: labelText,
          font: "14px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, 0),
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always render on top
        },
      });
      zenithEntities.push(labelEntity);
    }

    // Add custom mouse wheel handler for FOV zoom
    const canvas = this.viewer.scene.canvas;
    const wheelHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();

      // Reversed: scroll down (deltaY > 0) = zoom in (decrease FOV)
      //           scroll up (deltaY < 0) = zoom out (increase FOV)
      const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05;
      currentFov = currentFov * zoomFactor;

      // Clamp FOV between min and max
      currentFov = Math.max(minFov, Math.min(maxFov, currentFov));

      // Update camera FOV
      this.viewer.camera.frustum.fov = CesiumMath.toRadians(currentFov);

      // Update readout
      viewReadout.textContent = `FOV: ${currentFov.toFixed(0)}°`;

      // Request render to update the view
      this.viewer.scene.requestRender();
    };

    canvas.addEventListener("wheel", wheelHandler, { passive: false, capture: true });

    // Add post-render event to keep horizon level (roll = 0)
    const postRenderListener = this.viewer.scene.postRender.addEventListener(() => {
      // Force camera roll to 0 to keep horizon level
      if (this.viewer.camera.roll !== 0) {
        const heading = this.viewer.camera.heading;
        const pitch = this.viewer.camera.pitch;
        this.viewer.camera.setView({
          orientation: {
            heading: heading,
            pitch: pitch,
            roll: 0,
          },
        });
      }
    });

    // Dispatch event for UI to update
    window.dispatchEvent(new CustomEvent("zenithViewChanged", { detail: { active: true } }));

    // Request immediate render to kickstart terrain loading
    this.viewer.scene.requestRender();

    // Cleanup function
    this.zenithViewCleanup = () => {
      canvas.removeEventListener("wheel", wheelHandler, { capture: true });
      postRenderListener(); // Remove post-render listener
      controller.enableZoom = originalZoomEnabled;
      controller.enableTranslate = originalTranslateEnabled;
      controller.enableRotate = originalRotateEnabled;
      controller.lookEventTypes = originalLookEventTypes;
      controller.tiltEventTypes = originalTiltEventTypes;
      // Restore double-click behavior
      if (originalLeftDoubleClick) {
        screenSpaceEventHandler.setInputAction(originalLeftDoubleClick, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      }
      // Restore original FOV
      this.viewer.camera.frustum.fov = originalFov;
      // Remove view readout
      if (viewReadout && viewReadout.parentNode) {
        viewReadout.parentNode.removeChild(viewReadout);
      }
      // Remove all azimuth entities
      zenithEntities.forEach((entity) => {
        this.viewer.entities.remove(entity);
      });
      // Restore previous camera mode if it was changed
      if (previousCameraMode && window.cc) {
        window.cc.cameraMode = previousCameraMode;
      }
      this.zenithViewCleanup = null;
    };

    // Also cleanup when tracked entity changes
    const trackedEntityListener = this.viewer.trackedEntityChanged.addEventListener(() => {
      if (this.zenithViewCleanup) {
        this.zenithViewCleanup();
      }
      trackedEntityListener();
    });
  }

  createGroundstation(position, name) {
    const groundStation = new GroundStationEntity(this.viewer, this, position, name);
    groundStation.show();
    return groundStation;
  }

  addGroundStation(position, name) {
    // Ensure minimum height of 2 meters above ellipsoid for proper camera rendering in zenith view
    // Camera at 0 meters can cause terrain/globe rendering issues
    if (position.height < 2) {
      position.height = 2;
    }

    // Remove existing ground station if one exists (only support one station at a time)
    if (this.#groundStations.length > 0) {
      const existingStation = this.#groundStations[0];

      // Use hide() method to properly remove components
      existingStation.hide();

      // Remove all entities associated with the ground station from viewer
      Object.values(existingStation.components).forEach((component) => {
        if (component instanceof Entity && this.viewer.entities.contains(component)) {
          this.viewer.entities.remove(component);
        }
      });
    }

    // Additional safety cleanup: remove any remaining ground station entities
    const entitiesToRemove = [];
    this.viewer.entities.values.forEach((entity) => {
      if (entity.name && entity.name.includes("Groundstation")) {
        entitiesToRemove.push(entity);
      }
    });
    entitiesToRemove.forEach((entity) => {
      this.viewer.entities.remove(entity);
    });

    const groundStation = this.createGroundstation(position, name);
    this.groundStations = [groundStation]; // Replace with single station
  }

  get groundStations() {
    return this.#groundStations;
  }

  set groundStations(newGroundStations) {
    // Invalidate pass cache on all existing ground stations
    this.#groundStations.forEach((gs) => {
      if (gs.invalidatePassCache) {
        gs.invalidatePassCache();
      }
    });

    this.#groundStations = newGroundStations;

    // Set groundstation for all satellites
    this.satellites.forEach((sat) => {
      sat.groundStations = this.#groundStations;
    });

    // Update daytime ranges for first ground station
    CesiumTimelineHelper.clearGroundStationDaytimeRanges(this.viewer);
    if (this.#groundStations.length > 0) {
      CesiumTimelineHelper.addGroundStationDaytimeRanges(this.viewer, this.#groundStations[0]);
    }

    // Clear highlights when ground stations change
    CesiumTimelineHelper.clearHighlightRanges(this.viewer);

    // Update store for url state
    const satStore = useSatStore();
    // TODO Store all groundsations in url param with name
    satStore.groundStations = this.#groundStations.map((gs) => ({
      lat: gs.position.latitude,
      lon: gs.position.longitude,
      name: gs.hasName ? gs.name : undefined,
    }));
  }

  get overpassMode() {
    return this.#overpassMode;
  }

  set overpassMode(newMode) {
    this.#overpassMode = newMode;
    // Update overpass mode for all satellites
    this.satellites.forEach((sat) => {
      sat.props.overpassMode = newMode;
    });
    // Clear passes immediately to show old data is stale
    this.satellites.forEach((sat) => {
      if (sat.props.groundStationAvailable) {
        sat.props.clearPasses();
      }
    });

    // Invalidate ground station caches
    this.invalidateGroundStationCaches();

    // Recalculate passes asynchronously in batches to avoid blocking UI
    this.recalculatePassesAsync();
  }

  async recalculatePassesAsync() {
    const satellitesWithGS = this.satellites.filter((sat) => sat.props.groundStationAvailable);
    if (satellitesWithGS.length === 0) return;

    console.log(`Recalculating passes for ${satellitesWithGS.length} satellites in async mode...`);

    // Process satellites in batches - WebWorkers handle parallelization
    const batchSize = 20;
    for (let i = 0; i < satellitesWithGS.length; i += batchSize) {
      const batch = satellitesWithGS.slice(i, i + batchSize);

      // Process this batch asynchronously
      const batchPromises = batch.map((sat) =>
        sat.props.updatePasses(this.viewer.clock.currentTime).catch((err) => {
          console.warn(`Failed to update passes for ${sat.props.name}:`, err);
        })
      );
      await Promise.all(batchPromises);

      // Yield to browser after each batch to keep UI responsive
      if (i + batchSize < satellitesWithGS.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    console.log("Pass recalculation complete");

    // Refresh the currently selected entity's info box if it's a satellite or ground station
    const selectedEntity = this.viewer.selectedEntity;
    if (selectedEntity) {
      // Trigger refresh by temporarily clearing and restoring selection
      const entity = selectedEntity;
      this.viewer.selectedEntity = undefined;
      setTimeout(() => {
        this.viewer.selectedEntity = entity;
      }, 10);
    }
  }
}
