<template>
  <div class="cesium">
    <!-- iOS Pass Countdown Timer -->
    <pass-countdown-timer v-if="isIos" :show="showPassCountdown" :tracked-satellite="trackedSatelliteName" :passes="trackedSatellitePasses" />

    <div v-show="showUI" id="toolbarLeft">
      <div class="toolbarButtons">
        <button v-tooltip="'Satellite selection'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('cat')">
          <i class="icon svg-sat"></i>
        </button>
        <button v-tooltip="'Satellite elements'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('sat')">
          <font-awesome-icon icon="fas fa-layer-group" />
        </button>
        <button
          v-tooltip="'Ground station (double-click to toggle focus)'"
          type="button"
          class="cesium-button cesium-toolbar-button"
          @click="toggleMenu('gs')"
          @dblclick="focusFirstGroundStation"
        >
          <i class="icon svg-groundstation"></i>
        </button>
        <button v-tooltip="'Map'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('map')">
          <font-awesome-icon icon="fas fa-globe-africa" />
        </button>
        <button v-if="cc.minimalUI" v-tooltip="'Mobile'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('ios')">
          <font-awesome-icon icon="fas fa-mobile-alt" />
        </button>
        <button
          v-if="isIos && trackedSatelliteName && hasUpcomingPass"
          v-tooltip="'Pass Countdown'"
          type="button"
          class="cesium-button cesium-toolbar-button pass-countdown-button"
          :class="{ active: showPassCountdown, 'pass-active': isPassActive }"
          @click="togglePassCountdown"
        >
          <font-awesome-icon icon="fas fa-stopwatch" />
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
          <input v-model="pickMode" type="checkbox" :disabled="isInZenithView" />
          <span class="slider"></span>
          Pick on globe
        </label>
        <label class="toolbarSwitch">
          <input type="button" :disabled="isInZenithView" @click="cc.setGroundStationFromGeolocation()" />
          Set from geolocation
        </label>
        <label class="toolbarSwitch">
          <input type="button" :disabled="isInZenithView" @click="cc.sats.focusGroundStation()" />
          Focus
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="toggleZenithView()" />
          {{ isInZenithView ? "Normal view" : "Zenith view" }}
        </label>
        <label class="toolbarSwitch">
          <input v-model="hideSunlightPasses" type="checkbox" />
          <span class="slider"></span>
          Hide passes in daylight
        </label>
        <label class="toolbarSwitch">
          <input v-model="showOnlyLitPasses" type="checkbox" />
          <span class="slider"></span>
          Show only lit satellites
        </label>
        <label class="toolbarSwitch">
          <input v-model="useLocalTime" type="checkbox" :disabled="!canUseLocalTime" />
          <span class="slider"></span>
          Use local time
        </label>
        <label class="toolbarSwitch">
          <input type="button" :disabled="isInZenithView" @click="removeGroundStation()" />
          Remove ground station
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
          <input v-model="showCameraAltitude" type="checkbox" />
          <span class="slider"></span>
          Camera Altitude
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
        <div class="toolbarTitle">Planets</div>
        <label class="toolbarSwitch">
          <input v-model="planetsEnabled" type="checkbox" @change="togglePlanets" />
          <span class="slider"></span>
          Show planets
        </label>
        <template v-if="planetsEnabled">
          <label class="toolbarSwitch">
            <input v-model="planetRenderMode" type="radio" value="billboard" @change="setPlanetRenderMode" />
            <span class="slider"></span>
            Billboard
          </label>
          <label class="toolbarSwitch">
            <input v-model="planetRenderMode" type="radio" value="point" @change="setPlanetRenderMode" />
            <span class="slider"></span>
            Point Primitive
          </label>
          <label class="toolbarSwitch">
            <input v-model="enabledComponents" type="checkbox" value="Moon orbit" />
            <span class="slider"></span>
            Moon orbit
          </label>
          <template v-if="enabledComponents.includes('Moon orbit')">
            <label class="toolbarSwitch">
              <input v-model="moonOrbitHeliocentric" type="checkbox" @change="toggleMoonOrbitMode" />
              <span class="slider"></span>
              Heliocentric Moon orbit
            </label>
          </template>
          <label class="toolbarSwitch">
            <input v-model="enabledComponents" type="checkbox" value="Planet orbits" />
            <span class="slider"></span>
            Planet orbits
          </label>
        </template>
        <div class="toolbarTitle">Overpass calculation</div>
        <label class="toolbarSwitch">
          <input v-model="enableSwathPasses" type="checkbox" />
          <span class="slider"></span>
          Enable swath passes
        </label>
        <template v-if="enableSwathPasses">
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
        </template>
      </div>
    </div>
    <div id="toolbarRight">
      <a v-if="showUI" v-tooltip="'Github'" class="cesium-button cesium-toolbar-button" href="https://github.com/anttikuosmanen-rgb/satvis" target="_blank" rel="noopener">
        <font-awesome-icon icon="fab fa-github" />
      </a>
      <button v-tooltip="'Toggle UI'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleUI">
        <font-awesome-icon icon="fas fa-eye" />
      </button>
    </div>
    <div v-show="showUI && !isIos" id="timelineControls">
      <button v-tooltip="'Zoom In Timeline'" type="button" class="cesium-button cesium-toolbar-button timeline-button" @click="zoomInTimeline">+</button>
      <button v-tooltip="'Zoom Out Timeline'" type="button" class="cesium-button cesium-toolbar-button timeline-button" @click="zoomOutTimeline">-</button>
    </div>
    <div v-if="showCameraAltitude" id="cameraAltitudeDisplay">Camera Altitude: {{ formattedCameraAltitude }}</div>
    <div v-if="isIos" id="currentTimeDisplay">{{ currentTime }}</div>
  </div>
</template>

<script>
import * as Cesium from "@cesium/engine";
import { mapWritableState } from "pinia";
import { useCesiumStore } from "../stores/cesium";
import { useSatStore } from "../stores/sat";

import { DeviceDetect } from "../modules/util/DeviceDetect";
import SatelliteSelect from "./SatelliteSelect.vue";
import PassCountdownTimer from "./PassCountdownTimer.vue";

export default {
  components: {
    "satellite-select": SatelliteSelect,
    "pass-countdown-timer": PassCountdownTimer,
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
      zenithViewActive: false, // Local reactive state for zenith view
      planetsEnabled: true, // Planet rendering enabled state
      planetRenderMode: "billboard", // 'billboard' or 'point'
      moonOrbitHeliocentric: true, // Toggle for Moon orbit mode (heliocentric vs Earth-centric)
      showCameraAltitude: false,
      cameraAltitude: 0,
      showPassCountdown: false, // Toggle for pass countdown timer visibility
      currentTime: "",
    };
  },
  computed: {
    ...mapWritableState(useCesiumStore, ["layers", "terrainProvider", "sceneMode", "cameraMode", "qualityPreset", "showFps", "background", "pickMode"]),
    ...mapWritableState(useSatStore, [
      "enabledComponents",
      "groundStations",
      "overpassMode",
      "hideSunlightPasses",
      "showOnlyLitPasses",
      "useLocalTime",
      "enableSwathPasses",
      "trackedSatellite",
    ]),
    isIos() {
      return DeviceDetect.isIos();
    },
    canUseLocalTime() {
      return this.groundStations && this.groundStations.length > 0;
    },
    isInZenithView() {
      // Use local reactive state instead of checking cc.sats directly
      return this.zenithViewActive;
    },
    formattedCameraAltitude() {
      const altitudeKm = this.cameraAltitude / 1000;
      if (altitudeKm >= 1000000) {
        return `${(altitudeKm / 1000000).toFixed(2)} million km`;
      } else if (altitudeKm >= 1000) {
        return `${(altitudeKm / 1000).toFixed(2)} thousand km`;
      } else {
        return `${altitudeKm.toFixed(2)} km`;
      }
    },
    trackedSatelliteName() {
      // Get the currently tracked satellite name from Pinia store
      return this.trackedSatellite || null;
    },
    trackedSatellitePasses() {
      // Get passes for the tracked satellite
      if (!this.trackedSatelliteName || !cc || !cc.sats) {
        return [];
      }

      const satellite = cc.sats.getSatellite(this.trackedSatelliteName);
      if (satellite && satellite.props && satellite.props.passes) {
        return satellite.props.passes;
      }
      return [];
    },
    hasUpcomingPass() {
      // Check if there's a tracked satellite with a pass within the next hour
      // Passes require a ground station to be calculated
      if (!this.trackedSatelliteName || this.trackedSatellitePasses.length === 0 || this.groundStations.length === 0) {
        return false;
      }

      const now = Date.now();
      const oneHourFromNow = now + 3600000; // 1 hour in milliseconds

      // Find if there's any pass that starts within the next hour or is currently active
      const upcomingPass = this.trackedSatellitePasses.find((pass) => {
        const passEnd = new Date(pass.end).getTime();
        const passStart = new Date(pass.start).getTime();
        // Pass is either currently active or starts within 1 hour
        return passEnd > now && passStart <= oneHourFromNow;
      });

      return !!upcomingPass;
    },
    isPassActive() {
      // Check if the pass is currently active (ongoing)
      if (!this.trackedSatelliteName || this.trackedSatellitePasses.length === 0) {
        return false;
      }

      const now = Date.now();

      // Find if there's a pass currently active
      const activePass = this.trackedSatellitePasses.find((pass) => {
        const passEnd = new Date(pass.end).getTime();
        const passStart = new Date(pass.start).getTime();
        // Pass is currently active (now is between start and end)
        return now >= passStart && now <= passEnd;
      });

      return !!activePass;
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
        // Update planet label visibility based on enabled components
        if (cc.planets) {
          cc.planets.updateComponents(newComponents);
        }
        // Update Earth/Moon label visibility based on enabled components
        if (cc.earthMoon) {
          cc.earthMoon.updateComponents(newComponents);
        }
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
      // Update current time display immediately for iOS
      if (this.isIos) {
        this.updateCurrentTime();
      }
    },
    showCameraAltitude(enabled) {
      if (enabled) {
        // Start updating camera altitude
        this.cameraAltitudeInterval = setInterval(() => {
          if (cc.viewer && cc.viewer.camera) {
            this.cameraAltitude = cc.viewer.camera.positionCartographic.height;
          }
        }, 100); // Update every 100ms
      } else {
        // Stop updating
        if (this.cameraAltitudeInterval) {
          clearInterval(this.cameraAltitudeInterval);
          this.cameraAltitudeInterval = null;
        }
      }
    },
    trackedSatelliteName(newSat, oldSat) {
      // Hide countdown timer when tracked satellite changes
      if (newSat !== oldSat && this.showPassCountdown) {
        this.showPassCountdown = false;
      }
    },
    hasUpcomingPass(newValue) {
      // Hide countdown timer if there's no longer an upcoming pass
      if (!newValue && this.showPassCountdown) {
        this.showPassCountdown = false;
      }
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
        const lightingFadeIn = 50000000; // 50,000 km
        cc.viewer.scene.globe.lightingFadeOutDistance = lightingFadeOut;
        cc.viewer.scene.globe.lightingFadeInDistance = lightingFadeIn;

        // Set night imagery fade distances - keep higher for visibility
        const nightFadeDistance = 10000000;
        cc.viewer.scene.globe.nightFadeOutDistance = nightFadeDistance;
        cc.viewer.scene.globe.nightFadeInDistance = nightFadeDistance * 0.5;
      }
    });

    // Listen for zenith view state changes
    this.zenithViewChangeHandler = (event) => {
      this.zenithViewActive = event.detail.active;
    };
    window.addEventListener("zenithViewChanged", this.zenithViewChangeHandler);

    // Monitor selected entity changes to hide countdown timer
    this.selectedEntityChangeHandler = () => {
      const selectedEntity = cc.viewer.selectedEntity;
      if (selectedEntity && this.showPassCountdown) {
        // Check if selected entity is a different satellite or a ground station
        const isGroundStation = selectedEntity.name && selectedEntity.name.includes("Groundstation");
        const isDifferentSatellite = selectedEntity.name && selectedEntity.name !== this.trackedSatelliteName;

        if (isGroundStation || isDifferentSatellite) {
          this.showPassCountdown = false;
        }
      }
    };

    // Listen to Cesium's selectedEntityChanged event
    if (cc.viewer) {
      cc.viewer.selectedEntityChanged.addEventListener(this.selectedEntityChangeHandler);
    }

    // Update current time display for iOS and set clock to real-time
    if (this.isIos) {
      this.updateCurrentTime();
      this.currentTimeInterval = setInterval(() => {
        this.updateCurrentTime();
      }, 1000);

      // Set clock to follow real-time on iOS
      this.$nextTick(() => {
        if (cc.viewer && cc.viewer.clock) {
          cc.viewer.clock.shouldAnimate = true;
          cc.viewer.clock.multiplier = 1;
          // Set clock to system time mode
          cc.viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
        }
      });
    }

    // Enable planets by default
    if (this.planetsEnabled) {
      this.$nextTick(() => {
        if (cc.planets) {
          cc.planets.enable(this.planetRenderMode);
        }
        // Also enable Earth/Moon rendering with same mode
        if (cc.earthMoon) {
          cc.earthMoon.enable(this.planetRenderMode);
        }
      });
    }
  },
  beforeUnmount() {
    // Clean up event listener
    if (this.zenithViewChangeHandler) {
      window.removeEventListener("zenithViewChanged", this.zenithViewChangeHandler);
    }
    // Clean up selected entity listener
    if (this.selectedEntityChangeHandler && cc.viewer) {
      cc.viewer.selectedEntityChanged.removeEventListener(this.selectedEntityChangeHandler);
    }
    // Clean up camera altitude interval
    if (this.cameraAltitudeInterval) {
      clearInterval(this.cameraAltitudeInterval);
    }
    // Clean up current time interval
    if (this.currentTimeInterval) {
      clearInterval(this.currentTimeInterval);
    }
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
      const isTrackingGroundStation = currentTrackedEntity && currentTrackedEntity.name && currentTrackedEntity.name.includes("Groundstation");

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
    toggleZenithView() {
      if (this.cc.sats.isInZenithView) {
        // Exit zenith view (event will be dispatched by SatelliteManager)
        this.cc.sats.exitZenithView();
      } else {
        // Enter zenith view (event will be dispatched by SatelliteManager)
        this.cc.sats.zenithViewFromGroundStation();
      }
    },
    removeGroundStation() {
      // Exit zenith view if active (event will be dispatched by SatelliteManager)
      if (this.cc.sats.isInZenithView) {
        this.cc.sats.exitZenithView();
      }

      // Check if we're currently tracking a ground station and unfocus first
      const currentTrackedEntity = this.cc.viewer.trackedEntity;
      const isTrackingGroundStation = currentTrackedEntity && currentTrackedEntity.name && currentTrackedEntity.name.includes("Groundstation");

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

      // Remove ground station entities from Cesium viewer
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

      // Remove ground station by setting empty array
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
        console.error("Error in timeline zoom in:", error);
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
        console.error("Error in timeline zoom out:", error);
      }
    },
    togglePlanets() {
      if (this.planetsEnabled) {
        // Enable planet rendering with current mode
        this.cc.planets.enable(this.planetRenderMode);
        // Also enable Earth/Moon rendering with same mode
        this.cc.earthMoon.enable(this.planetRenderMode);
      } else {
        // Disable planet rendering
        this.cc.planets.disable();
        // Also disable Earth/Moon rendering
        this.cc.earthMoon.disable();
      }
    },
    setPlanetRenderMode() {
      // Update render mode if planets are enabled
      if (this.planetsEnabled) {
        this.cc.planets.setRenderMode(this.planetRenderMode);
        // Also update Earth/Moon render mode
        this.cc.earthMoon.setRenderMode(this.planetRenderMode);
      }
    },
    toggleMoonOrbitMode() {
      // Toggle Moon orbit between heliocentric and Earth-centric modes
      if (this.cc.earthMoon) {
        this.cc.earthMoon.setMoonOrbitMode(this.moonOrbitHeliocentric);
      }
    },
    togglePassCountdown() {
      // Toggle the pass countdown timer visibility
      this.showPassCountdown = !this.showPassCountdown;
    },
    updateCurrentTime() {
      // Update current time from Cesium clock
      if (cc.viewer && cc.viewer.clock) {
        const julianDate = cc.viewer.clock.currentTime;
        const date = Cesium.JulianDate.toDate(julianDate);

        if (this.useLocalTime && this.canUseLocalTime) {
          // Show local time
          const hours = String(date.getHours()).padStart(2, "0");
          const minutes = String(date.getMinutes()).padStart(2, "0");
          const seconds = String(date.getSeconds()).padStart(2, "0");
          this.currentTime = `${hours}:${minutes}:${seconds} Local`;
        } else {
          // Show UTC time
          const hours = String(date.getUTCHours()).padStart(2, "0");
          const minutes = String(date.getUTCMinutes()).padStart(2, "0");
          const seconds = String(date.getUTCSeconds()).padStart(2, "0");
          this.currentTime = `${hours}:${minutes}:${seconds} UTC`;
        }
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

#cameraAltitudeDisplay {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(42, 42, 42, 0.8);
  color: #edffff;
  padding: 5px 15px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 14px;
  z-index: 1000;
  pointer-events: none;
}

#currentTimeDisplay {
  position: fixed;
  bottom: 15px;
  left: 0px;
  background-color: rgba(0, 0, 0, 0.5);
  color: #ffffff;
  padding: 8px 15px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 16px;
  font-weight: 500;
  z-index: 1000;
  pointer-events: none;
}

/* Pass countdown button colors */
.pass-countdown-button {
  color: #ff0000 !important; /* Red for upcoming pass */
}

.pass-countdown-button.pass-active {
  color: #00ff00 !important; /* Green for ongoing pass */
}
</style>
