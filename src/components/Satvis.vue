<template>
  <div class="cesium">
    <div v-show="showUI" id="toolbarLeft">
      <div class="toolbarButtons">
        <button v-tooltip="'Satellite selection'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('cat')">
          <i class="icon svg-sat"></i>
        </button>
        <button v-tooltip="'Satellite elements'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('sat')">
          <font-awesome-icon icon="fas fa-layer-group" />
        </button>
        <button v-tooltip="'Ground station (double-click to toggle focus)'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('gs')" @dblclick="focusFirstGroundStation">
          <i class="icon svg-groundstation"></i>
        </button>
        <button v-tooltip="'Map'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('map')">
          <font-awesome-icon icon="fas fa-globe-africa" />
        </button>
        <button v-if="cc.minimalUI" v-tooltip="'Mobile'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('ios')">
          <font-awesome-icon icon="fas fa-mobile-alt" />
        </button>
        <button v-tooltip="'Debug'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('dbg')">
          <font-awesome-icon icon="fas fa-hammer" />
        </button>
      </div>
      <div v-show="menu.cat" class="toolbarSwitches">
        <satellite-select />
      </div>
      <div v-show="menu.sat" class="toolbarSwitches">
        <div class="toolbarTitle">Satellite elements</div>
        <label v-for="componentName in cc.sats.availableComponents" :key="componentName" class="toolbarSwitch">
          <input v-model="enabledComponents" type="checkbox" :value="componentName" />
          <span class="slider"></span>
          {{ componentName }}
        </label>
        <!--
        <label class="toolbarSwitch">
          <input type="button" @click="cc.viewer.trackedEntity = undefined">
          Untrack Entity
        </label>
        -->
      </div>
      <div v-show="menu.gs" class="toolbarSwitches">
        <div class="toolbarTitle">Ground station</div>
        <label class="toolbarSwitch">
          <input v-model="pickMode" type="checkbox" />
          <span class="slider"></span>
          Pick on globe
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.setGroundStationFromGeolocation()" />
          Set from geolocation
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.sats.focusGroundStation()" />
          Focus
        </label>
        <div class="toolbarTitle">Overpass calculation</div>
        <label class="toolbarSwitch">
          <input v-model="overpassMode" type="radio" value="elevation" />
          <span class="slider"></span>
          Elevation
        </label>
        <label class="toolbarSwitch">
          <input v-model="overpassMode" type="radio" value="swath" />
          <span class="slider"></span>
          Swath
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="clearAllGroundStations()">
          Clear all stations
        </label>
        <label class="toolbarSwitch">
          <input v-model="hideSunlightPasses" type="checkbox">
          <span class="slider"></span>
          Hide passes in daylight
        </label>
        <label class="toolbarSwitch">
          <input v-model="showOnlyLitPasses" type="checkbox">
          <span class="slider"></span>
          Show only lit satellites
        </label>
        <label class="toolbarSwitch">
          <input v-model="useLocalTime" type="checkbox" :disabled="!canUseLocalTime">
          <span class="slider"></span>
          Use local time
        </label>
      </div>
      <div v-show="menu.map" class="toolbarSwitches">
        <div class="toolbarTitle">Layers</div>
        <label v-for="name in cc.imageryProviderNames" :key="name" class="toolbarSwitch">
          <input v-model="layers" type="checkbox" :value="name" />
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">Terrain</div>
        <label v-for="name in cc.terrainProviderNames" :key="name" class="toolbarSwitch">
          <input v-model="terrainProvider" type="radio" :value="name" />
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">View</div>
        <label v-for="name in cc.sceneModes" :key="name" class="toolbarSwitch">
          <input v-model="sceneMode" type="radio" :value="name" />
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">Camera</div>
        <label v-for="name in cc.cameraModes" :key="name" class="toolbarSwitch">
          <input v-model="cameraMode" type="radio" :value="name" />
          <span class="slider"></span>
          {{ name }}
        </label>
      </div>
      <div v-show="menu.ios" class="toolbarSwitches">
        <div class="toolbarTitle">Mobile</div>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.useWebVR" type="checkbox" />
          <span class="slider"></span>
          VR
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.clock.shouldAnimate" type="checkbox" />
          <span class="slider"></span>
          Play
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.viewer.clockViewModel.multiplier *= 2" />
          Increase play speed
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.viewer.clockViewModel.multiplier /= 2" />
          Decrease play speed
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="$router.go({ path: '', force: true })" />
          Reload
        </label>
      </div>
      <div v-show="menu.dbg" class="toolbarSwitches">
        <div class="toolbarTitle">Debug</div>
        <label class="toolbarSwitch">
          <input v-model="showFps" type="checkbox" />
          <span class="slider"></span>
          FPS
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.requestRenderMode" type="checkbox" />
          <span class="slider"></span>
          RequestRender
        </label>
        <label class="toolbarSwitch">
          <input v-model="qualityPreset" true-value="high" false-value="low" type="checkbox" />
          <span class="slider"></span>
          High Quality
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.fog.enabled" type="checkbox" />
          <span class="slider"></span>
          Fog
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.globe.enableLighting" type="checkbox" />
          <span class="slider"></span>
          Lighting
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.highDynamicRange" type="checkbox" />
          <span class="slider"></span>
          HDR
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.globe.showGroundAtmosphere" type="checkbox" />
          <span class="slider"></span>
          Atmosphere
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.jumpTo('Everest')" />
          Jump to Everest
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.jumpTo('HalfDome')" />
          Jump to HalfDome
        </label>
      </div>
    </div>
    <div id="toolbarRight">
      <a v-if="showUI" v-tooltip="'Github'" class="cesium-button cesium-toolbar-button" href="https://github.com/Flowm/satvis/" target="_blank" rel="noopener">
        <font-awesome-icon icon="fab fa-github" />
      </a>
      <button v-tooltip="'Toggle UI'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleUI">
        <font-awesome-icon icon="fas fa-eye" />
      </button>
    </div>
    <div v-show="showUI && !isIos" id="timelineControls">
      <button v-tooltip="'Zoom In Timeline'" type="button" class="cesium-button cesium-toolbar-button timeline-button" @click="zoomInTimeline">
        +
      </button>
      <button v-tooltip="'Zoom Out Timeline'" type="button" class="cesium-button cesium-toolbar-button timeline-button" @click="zoomOutTimeline">
        -
      </button>
    </div>
  </div>
</template>

<script>
import * as Cesium from "@cesium/engine";
import { mapWritableState } from "pinia";
import { useCesiumStore } from "../stores/cesium";
import { useSatStore } from "../stores/sat";

import { DeviceDetect } from "../modules/util/DeviceDetect";
import SatelliteSelect from "./SatelliteSelect.vue";

export default {
  components: {
    "satellite-select": SatelliteSelect,
  },
  data() {
    return {
      menu: {
        cat: false,
        sat: false,
        gs: false,
        map: false,
        ios: false,
        dbg: false,
      },
      showUI: true,
    };
  },
  computed: {
    ...mapWritableState(useCesiumStore, [
      "layers",
      "terrainProvider",
      "sceneMode",
      "cameraMode",
      "qualityPreset",
      "showFps",
      "background",
      "pickMode",
    ]),
    ...mapWritableState(useSatStore, [
      "enabledComponents",
      "groundStations",
      "overpassMode",
      "hideSunlightPasses",
      "showOnlyLitPasses",
      "useLocalTime",
    ]),
    isIos() {
      return DeviceDetect.isIos();
    },
    canUseLocalTime() {
      return this.groundStations && this.groundStations.length > 0;
    },
  },
  watch: {
    layers: {
      handler(newLayers, oldLayers) {
        // Ensure only a single base layer is active
        const newBaseLayers = newLayers.filter((layer) => cc.baseLayers.includes(layer));
        if (newBaseLayers.length > 1) {
          const oldBaseLayers = oldLayers.filter((layer) => cc.baseLayers.includes(layer));
          this.layers = newBaseLayers.filter((layer) => !oldBaseLayers.includes(layer));
          return;
        }
        cc.imageryLayers = newLayers;
      },
      deep: true,
    },
    terrainProvider(newProvider) {
      cc.terrainProvider = newProvider;
    },
    sceneMode(newMode) {
      cc.sceneMode = newMode;
    },
    cameraMode(newMode) {
      cc.cameraMode = newMode;
    },
    qualityPreset: {
      handler(value) {
        cc.qualityPreset = value;
      },
      immediate: true,
    },
    showFps(value) {
      cc.showFps = value;
    },
    background(value) {
      cc.background = value;
    },
    enabledComponents: {
      handler(newComponents) {
        cc.sats.enabledComponents = newComponents;
      },
      deep: true,
    },
    groundStations(newGroundStations, oldGroundStations) {
      // Ignore if new and old positions are identical
      if (oldGroundStations.length === newGroundStations.length) {
        return;
      }
      cc.setGroundStations(newGroundStations);

      // Disable local time if no ground stations exist
      if (newGroundStations.length === 0 && this.useLocalTime) {
        this.useLocalTime = false;
      }
    },
    overpassMode(newMode) {
      cc.sats.overpassMode = newMode;
    },
    hideSunlightPasses() {
      // Invalidate pass cache and refresh highlights when filter changes
      this.refreshGroundStationHighlights();
    },
    showOnlyLitPasses() {
      // Invalidate pass cache and refresh highlights when filter changes
      this.refreshGroundStationHighlights();
    },
    useLocalTime() {
      // Update timeline and clock formatting when local time setting changes
      if (cc.viewer && cc.viewer.timeline) {
        cc.viewer.timeline.updateFromClock();
        // Force timeline to re-render labels
        if (cc.viewer.timeline._makeTics) {
          cc.viewer.timeline._makeTics();
        }
      }
      // Force animation widget to update - the clock naturally updates every tick
      // so we just need to make sure the next tick happens soon
      if (cc.viewer && cc.viewer.clock) {
        // Store current animation state
        const wasAnimating = cc.viewer.clock.shouldAnimate;
        // Temporarily enable animation for one frame to trigger formatter
        cc.viewer.clock.shouldAnimate = true;
        setTimeout(() => {
          // Restore original state
          cc.viewer.clock.shouldAnimate = wasAnimating;
        }, 100);
      }
      // Refresh info boxes to update time display
      this.refreshGroundStationHighlights();
    },
  },
  mounted() {
    if (this.$route.query.time) {
      cc.setTime(this.$route.query.time);
    }
    this.showUI = !DeviceDetect.inIframe();

    // Set lighting fade distances - very high so lighting always visible
    this.$nextTick(() => {
      if (cc.viewer && cc.viewer.scene && cc.viewer.scene.globe) {
        const lightingFadeOut = 100000000; // 100,000 km
        const lightingFadeIn = 50000000;   // 50,000 km
        cc.viewer.scene.globe.lightingFadeOutDistance = lightingFadeOut;
        cc.viewer.scene.globe.lightingFadeInDistance = lightingFadeIn;

        // Set night imagery fade distances - keep higher for visibility
        const nightFadeDistance = 10000000;
        cc.viewer.scene.globe.nightFadeOutDistance = nightFadeDistance;
        cc.viewer.scene.globe.nightFadeInDistance = nightFadeDistance * 0.5;
      }
    });
  },
  methods: {
    toggleMenu(name) {
      const oldState = this.menu[name];
      Object.keys(this.menu).forEach((k) => {
        this.menu[k] = false;
      });
      this.menu[name] = !oldState;
    },
    focusFirstGroundStation() {
      // Toggle between focusing on first ground station and returning to normal view
      const currentTrackedEntity = this.cc.viewer.trackedEntity;

      // Check if we're currently tracking a ground station
      // Ground stations now have names like "Groundstation [60.81°, 23.95°]"
      const isTrackingGroundStation = currentTrackedEntity &&
        currentTrackedEntity.name &&
        currentTrackedEntity.name.includes("Groundstation");

      if (isTrackingGroundStation) {
        // Return to normal view focused on center of Earth
        this.cc.viewer.trackedEntity = undefined;
        this.cc.viewer.selectedEntity = undefined;

        // Focus camera on center of Earth with a nice overview
        this.cc.viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000000), // 15,000 km above Earth center
          orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO, // Look straight down
            roll: 0,
          },
        });
      } else {
        // Focus on the first ground station
        if (this.groundStations && this.groundStations.length > 0) {
          this.cc.sats.focusGroundStation(this.groundStations[0]);
        }
      }
    },
    toggleUI() {
      this.showUI = !this.showUI;
      if (!cc.minimalUI) {
        cc.showUI = this.showUI;
      }
    },
    formatDate(timestamp) {
      const date = new Date(timestamp);
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    },
    formatDuration(duration) {
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    },
    formatAzimuth(azimuth) {
      const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      const index = Math.round(azimuth / 45) % 8;
      return `${azimuth.toFixed(0)}° (${directions[index]})`;
    },
    formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    },
    refreshGroundStationHighlights() {
      // Invalidate cache on all ground stations
      if (this.cc && this.cc.sats && this.cc.sats.groundStations) {
        this.cc.sats.groundStations.forEach((gs) => {
          if (gs.invalidatePassCache) {
            gs.invalidatePassCache();
          }
        });
      }

      // Refresh highlights if a ground station is currently selected/tracked
      const selectedEntity = this.cc.viewer.selectedEntity;
      if (selectedEntity && selectedEntity.name && selectedEntity.name.includes("Groundstation")) {
        // Trigger a refresh by setting the selected entity again
        this.cc.viewer.selectedEntity = undefined;
        setTimeout(() => {
          this.cc.viewer.selectedEntity = selectedEntity;
        }, 10);
      }
    },
    clearAllGroundStations() {
      // Check if we're currently tracking a ground station and unfocus first
      const currentTrackedEntity = this.cc.viewer.trackedEntity;
      const isTrackingGroundStation = currentTrackedEntity &&
        currentTrackedEntity.name &&
        currentTrackedEntity.name.includes("Groundstation");

      if (isTrackingGroundStation) {
        // Return to normal view focused on center of Earth
        this.cc.viewer.trackedEntity = undefined;
        this.cc.viewer.selectedEntity = undefined;
        this.cc.viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000000),
          orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
          },
        });
      }

      // Properly remove all ground station entities from Cesium viewer
      this.cc.sats.groundStations.forEach((groundStation) => {
        // Hide components first
        groundStation.hide();

        // Ensure all entities are removed from the viewer
        Object.values(groundStation.components).forEach((component) => {
          if (component instanceof Cesium.Entity && this.cc.viewer.entities.contains(component)) {
            this.cc.viewer.entities.remove(component);
          }
        });
      });

      // Additional cleanup: remove any remaining ground station entities from viewer
      // This handles cases where entities might not be properly tracked by the component system
      const entitiesToRemove = [];
      this.cc.viewer.entities.values.forEach((entity) => {
        if (entity.name && entity.name.includes("Groundstation")) {
          entitiesToRemove.push(entity);
        }
      });
      entitiesToRemove.forEach((entity) => {
        this.cc.viewer.entities.remove(entity);
      });

      // Clear all ground stations by setting empty array
      this.cc.sats.groundStations = [];
    },
    zoomInTimeline() {
      if (!this.cc.viewer.timeline) {
        return;
      }

      try {
        // Use Cesium's timeline zoom functionality directly
        // Get current timeline range and zoom in by reducing the range
        const timeline = this.cc.viewer.timeline;
        const clock = this.cc.viewer.clock;

        const currentStart = clock.startTime;
        const currentStop = clock.stopTime;
        const currentTime = clock.currentTime;

        // Calculate current range in seconds
        const totalSeconds = Cesium.JulianDate.secondsDifference(currentStop, currentStart);

        // Zoom in by reducing the range to 75% of current
        const newRangeSeconds = totalSeconds * 0.75;
        const halfRange = newRangeSeconds / 2;

        // Center the new range around current time
        const newStart = Cesium.JulianDate.addSeconds(currentTime, -halfRange, new Cesium.JulianDate());
        const newStop = Cesium.JulianDate.addSeconds(currentTime, halfRange, new Cesium.JulianDate());

        // Constrain timeline bounds first to prevent invalid dates
        if (this.cc.constrainTimelineBounds) {
          this.cc.constrainTimelineBounds();
        }

        // Update clock and timeline
        clock.startTime = newStart;
        clock.stopTime = newStop;
        timeline.updateFromClock();
        timeline.zoomTo(newStart, newStop);

        // Trigger daytime range recalculation after a small delay
        setTimeout(() => {
          this.cc.sats.checkAndUpdateDaytimeRanges();
        }, 100);
      } catch (error) {
        console.error('Error in timeline zoom in:', error);
      }
    },
    zoomOutTimeline() {
      if (!this.cc.viewer.timeline) {
        return;
      }

      try {
        // Use Cesium's timeline zoom functionality directly
        // Get current timeline range and zoom out by increasing the range
        const timeline = this.cc.viewer.timeline;
        const clock = this.cc.viewer.clock;

        const currentStart = clock.startTime;
        const currentStop = clock.stopTime;
        const currentTime = clock.currentTime;

        // Calculate current range in seconds
        const totalSeconds = Cesium.JulianDate.secondsDifference(currentStop, currentStart);

        // Zoom out by increasing the range to 133% of current
        const newRangeSeconds = totalSeconds * 1.33;
        const halfRange = newRangeSeconds / 2;

        // Center the new range around current time
        const newStart = Cesium.JulianDate.addSeconds(currentTime, -halfRange, new Cesium.JulianDate());
        const newStop = Cesium.JulianDate.addSeconds(currentTime, halfRange, new Cesium.JulianDate());

        // Constrain timeline bounds first to prevent invalid dates
        if (this.cc.constrainTimelineBounds) {
          this.cc.constrainTimelineBounds();
        }

        // Update clock and timeline
        clock.startTime = newStart;
        clock.stopTime = newStop;
        timeline.updateFromClock();
        timeline.zoomTo(newStart, newStop);

        // Trigger daytime range recalculation after a small delay
        setTimeout(() => {
          this.cc.sats.checkAndUpdateDaytimeRanges();
        }, 100);
      } catch (error) {
        console.error('Error in timeline zoom out:', error);
      }
    },
  },
};
</script>

<style scoped>

.toolbarText {
  color: #aaa;
  padding: 10px;
  text-align: center;
  font-style: italic;
}
</style>
