import { ClockStep, JulianDate } from "@cesium/engine";
import { useSatStore } from "../stores/sat";
import { SatelliteComponentCollection } from "./SatelliteComponentCollection";
import { GroundStationEntity } from "./GroundStationEntity";

import { CesiumCleanupHelper } from "./util/CesiumCleanupHelper";
import { CesiumTimelineHelper } from "./util/CesiumTimelineHelper";

export class SatelliteManager {
  #enabledComponents = ["Point", "Label"];

  #enabledTags = [];

  #enabledSatellites = [];

  #groundStations = [];

  #overpassMode = "elevation";

  constructor(viewer) {
    this.viewer = viewer;

    this.satellites = [];
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
      if (this.viewer.clock.clockStep === ClockStep.SYSTEM_CLOCK ||
          this.viewer.clock.clockStep === ClockStep.TICK_DEPENDENT) {
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

      if (!JulianDate.equals(lastStartTime, currentStart) ||
          !JulianDate.equals(lastStopTime, currentStop)) {
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
      timelineContainer.addEventListener('wheel', () => {
        setTimeout(() => {
          try {
            // First constrain timeline bounds to prevent invalid dates
            if (window.cc && window.cc.constrainTimelineBounds) {
              window.cc.constrainTimelineBounds();
            }
            this.checkAndUpdateDaytimeRanges();
          } catch (error) {
            console.error('Error in timeline wheel event handler:', error);
          }
        }, 200);
      });

      // Listen for mouse events that might change timeline
      ['mouseup', 'touchend'].forEach(eventType => {
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
          console.log('Timeline moved outside calculated range, recalculating daytime highlights');
          CesiumTimelineHelper.clearGroundStationDaytimeRanges(this.viewer);
          CesiumTimelineHelper.addGroundStationDaytimeRanges(this.viewer, firstGroundStation);
        }
      }
    } catch (error) {
      console.error('Error updating daytime ranges:', error);
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
        for (let i = 3; i < lines.length; i + 3) {
          const tle = lines.splice(i - 3, i).join("\n");
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
    const existingSat = this.satellites.find((sat) => sat.props.satnum === newSat.props.satnum && sat.props.name === newSat.props.name);
    if (existingSat) {
      existingSat.props.addTags(newSat.props.tags);
      if (newSat.props.tags.some((tag) => this.#enabledTags.includes(tag))) {
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
    return this.satellites.find((sat) => sat.props.name === name);
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
    return this.#enabledSatellites;
  }

  set enabledSatellites(newSats) {
    this.#enabledSatellites = newSats;
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
    const enabledByTag = this.#enabledTags.some((tag) => sat.props.hasTag(tag));
    const enabledByName = this.#enabledSatellites.includes(sat.props.name);
    return enabledByTag || enabledByName;
  }

  get activeSatellites() {
    return this.satellites.filter((sat) => this.satIsActive(sat));
  }

  showEnabledSatellites() {
    this.satellites.forEach((sat) => {
      if (this.satIsActive(sat)) {
        sat.show(this.#enabledComponents);
      } else {
        sat.hide();
      }
    });
    if (this.visibleSatellites.length === 0) {
      CesiumCleanupHelper.cleanup(this.viewer);
    }
  }

  get enabledTags() {
    return this.#enabledTags;
  }

  set enabledTags(newTags) {
    this.#enabledTags = newTags;
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
    if (this.groundStationAvailable) {
      this.#groundStations[0].track();
    }
  }

  createGroundstation(position, name) {
    const groundStation = new GroundStationEntity(this.viewer, this, position, name);
    groundStation.show();
    return groundStation;
  }

  addGroundStation(position, name) {
    if (position.height < 1) {
      position.height = 0;
    }
    const groundStation = this.createGroundstation(position, name);
    this.groundStations = [...this.#groundStations, groundStation];
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
    // Clear and update passes for all satellites with ground stations to force recalculation
    this.satellites.forEach((sat) => {
      if (sat.props.groundStationAvailable) {
        sat.props.clearPasses();
        sat.props.updatePasses(this.viewer.clock.currentTime);
      }
    });
  }
}
