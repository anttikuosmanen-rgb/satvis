<template>
  <div class="cesium">
    <!-- iOS Pass Countdown Timer -->
    <pass-countdown-timer v-if="isIos" :show="showPassCountdown" :tracked-satellite="trackedSatelliteName" :passes="trackedSatellitePasses" />

    <div v-show="showUI" id="toolbarLeft">
      <div class="toolbarButtons">
        <button v-tooltip="'Satellite selection'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('cat')">
          <i class="icon svg-sat"></i>
        </button>
        <button v-tooltip="'Satellite visuals'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('sat')">
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
        <satellite-select
          ref="satelliteSelect"
          :focused-index="activeMenuKey === 'cat' ? menuFocusIndex : -1"
          @dropdown-opened="onDropdownOpened"
          @dropdown-closed="onDropdownClosed"
        />
      </div>
      <div v-show="menu.sat" class="toolbarSwitches">
        <div class="toolbarTitle">Satellite visuals</div>
        <label v-for="(componentName, index) in cc.sats.availableComponents" :key="componentName" class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('sat', index) }">
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
        <label class="toolbarSwitch" :class="{ 'gs-picker-hint': showGsPickerHint, 'menu-item-focused': isFocused('gs', 0) }">
          <input v-model="pickMode" type="checkbox" :disabled="isInZenithView" />
          <span class="slider"></span>
          Pick on globe
          <span v-if="showGsPickerHint" class="hint-arrow">← Click on globe</span>
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('gs', 1) }">
          <input type="button" :disabled="isInZenithView" @click="cc.setGroundStationFromGeolocation()" />
          Set from geolocation
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('gs', 2) }">
          <input type="button" :disabled="isInZenithView" @click="cc.sats.focusGroundStation()" />
          Focus
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('gs', 3) }">
          <input type="button" :disabled="isInZenithView" @click="removeGroundStation()" />
          Remove ground station
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('gs', 4) }">
          <input type="button" @click="toggleZenithView()" />
          {{ isInZenithView ? "Normal view" : "Zenith view" }}
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('gs', 5) }">
          <input v-model="hideSunlightPasses" type="checkbox" />
          <span class="slider"></span>
          Hide passes in daylight
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('gs', 6) }">
          <input v-model="showOnlyLitPasses" type="checkbox" />
          <span class="slider"></span>
          Show only lit satellites
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('gs', 7) }">
          <input v-model="useLocalTime" type="checkbox" :disabled="!canUseLocalTime" />
          <span class="slider"></span>
          Use local time
        </label>
      </div>
      <div v-show="menu.map" class="toolbarSwitches">
        <div class="toolbarTitle">Layers</div>
        <label v-for="(name, index) in cc.imageryProviderNames" :key="name" class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('map', index) }">
          <input v-model="layers" type="checkbox" :value="name" />
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">Terrain</div>
        <label
          v-for="(name, index) in cc.terrainProviderNames"
          :key="name"
          class="toolbarSwitch"
          :class="{ 'menu-item-focused': isFocused('map', cc.imageryProviderNames.length + index) }"
        >
          <input v-model="terrainProvider" type="radio" :value="name" />
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">View</div>
        <label
          v-for="(name, index) in cc.sceneModes"
          :key="name"
          class="toolbarSwitch"
          :class="{ 'menu-item-focused': isFocused('map', cc.imageryProviderNames.length + cc.terrainProviderNames.length + index) }"
        >
          <input v-model="sceneMode" type="radio" :value="name" />
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">Camera</div>
        <label
          v-for="(name, index) in cc.cameraModes"
          :key="name"
          class="toolbarSwitch"
          :class="{ 'menu-item-focused': isFocused('map', cc.imageryProviderNames.length + cc.terrainProviderNames.length + cc.sceneModes.length + index) }"
        >
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
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 0) }">
          <input v-model="debugConsoleLog" type="checkbox" />
          <span class="slider"></span>
          Console Logging
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 1) }">
          <input v-model="showFps" type="checkbox" />
          <span class="slider"></span>
          FPS
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 2) }">
          <input v-model="showCameraAltitude" type="checkbox" />
          <span class="slider"></span>
          Camera Altitude
        </label>
        <label v-if="isIos" class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 3) }">
          <input v-model="showIosClock" type="checkbox" />
          <span class="slider"></span>
          Show iOS Clock
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 4) }">
          <input v-model="cc.viewer.scene.requestRenderMode" type="checkbox" />
          <span class="slider"></span>
          RequestRender
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 5) }">
          <input v-model="qualityPreset" true-value="high" false-value="low" type="checkbox" />
          <span class="slider"></span>
          High Quality
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 6) }">
          <input v-model="cc.viewer.scene.fog.enabled" type="checkbox" />
          <span class="slider"></span>
          Fog
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 7) }">
          <input v-model="cc.viewer.scene.globe.enableLighting" type="checkbox" />
          <span class="slider"></span>
          Lighting
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 8) }">
          <input v-model="cc.viewer.scene.highDynamicRange" type="checkbox" />
          <span class="slider"></span>
          HDR
        </label>
        <label class="toolbarSwitch" :class="{ 'menu-item-focused': isFocused('dbg', 9) }">
          <input v-model="cc.viewer.scene.globe.showGroundAtmosphere" type="checkbox" />
          <span class="slider"></span>
          Atmosphere
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
    <div v-if="isIos && showIosClock" id="currentTimeDisplay">{{ currentTime }}</div>
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
      showIosClock: false, // Toggle for iOS clock visibility (default off)
      currentTime: "",
      showGsPickerHint: false, // Show hint arrow next to "Pick on globe" when spacebar pressed with no GS
      menuFocusIndex: -1, // Currently focused item in menu (-1 = none)
      activeMenuKey: null, // Which menu is open via keyboard shortcut
      dropdownOpen: false, // Track if a dropdown is currently open (disables menu navigation)
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
      "debugConsoleLog",
      "customSatellites",
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

      // Hide GS picker hint when a ground station is placed
      if (newGroundStations.length > 0 && this.showGsPickerHint) {
        this.showGsPickerHint = false;
      }

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
    showIosClock(enabled) {
      if (this.isIos) {
        if (enabled) {
          // Start updating current time
          this.updateCurrentTime();
          this.currentTimeInterval = setInterval(() => {
            this.updateCurrentTime();
          }, 1000);
        } else {
          // Stop updating
          if (this.currentTimeInterval) {
            clearInterval(this.currentTimeInterval);
            this.currentTimeInterval = null;
          }
        }
      }
    },
    customSatellites(newTles) {
      // Watcher is triggered when URL parameter changes
      // The actual adding happens in satellitesLoaded event handler or after satellites are loaded
      if (newTles && newTles.length > 0 && cc && cc.sats) {
        // Add each custom satellite
        newTles.forEach((tle) => {
          this.addCustomSatellite(tle);
        });
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

    // Listen for satellites loaded event to add custom satellites
    this.satellitesLoadedHandler = () => {
      // If customSatellites is set from URL, add them now
      if (this.customSatellites && this.customSatellites.length > 0) {
        this.customSatellites.forEach((tle) => {
          this.addCustomSatellite(tle);
        });
      }
    };
    window.addEventListener("satellitesLoaded", this.satellitesLoadedHandler);

    // Listen for spacebar press when no GS is set - open GS menu with hint
    this.requestGsPickerHandler = () => {
      // Close all menus first, then open GS menu
      Object.keys(this.menu).forEach((k) => {
        this.menu[k] = false;
      });
      this.menu.gs = true; // Open GS menu
      this.pickMode = true; // Enable pick mode
      this.showGsPickerHint = true; // Show hint arrow
    };
    window.addEventListener("requestGsPicker", this.requestGsPickerHandler);

    // Listen for menu open events from keyboard shortcuts
    this.openMenuHandler = (event) => {
      // Close all menus first
      Object.keys(this.menu).forEach((k) => {
        this.menu[k] = false;
      });
      // Open the requested menu
      this.menu[event.detail] = true;
      this.activeMenuKey = event.detail;
      this.menuFocusIndex = 0; // Focus first item
    };
    window.addEventListener("openMenu", this.openMenuHandler);

    // Listen for keyboard navigation within menus
    this.menuKeyHandler = (event) => {
      if (!this.activeMenuKey) return;

      // ESC always works to close menu, regardless of menuItems
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeActiveMenu();
        return;
      }

      // Disable menu navigation when a dropdown is open
      if (this.dropdownOpen) return;

      const menuItems = this.getMenuItems(this.activeMenuKey);
      if (!menuItems.length) return; // No keyboard navigation for this menu

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = (this.menuFocusIndex + 1) % menuItems.length;
        this.menuFocusIndex = nextIndex;
        // For satellite selection menu, auto-open dropdown when navigating with arrows
        if (this.activeMenuKey === "cat") {
          this.activateMenuItem(menuItems[nextIndex]);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex = (this.menuFocusIndex - 1 + menuItems.length) % menuItems.length;
        this.menuFocusIndex = prevIndex;
        // For satellite selection menu, auto-open dropdown when navigating with arrows
        if (this.activeMenuKey === "cat") {
          this.activateMenuItem(menuItems[prevIndex]);
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        // Only activate if focus index is valid (not -1, which means dropdown is open)
        if (this.menuFocusIndex >= 0) {
          this.activateMenuItem(menuItems[this.menuFocusIndex]);
        }
      }
    };
    window.addEventListener("keydown", this.menuKeyHandler);

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

    // Set clock to follow real-time on iOS
    if (this.isIos) {
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
    // Clean up satellites loaded listener
    if (this.satellitesLoadedHandler) {
      window.removeEventListener("satellitesLoaded", this.satellitesLoadedHandler);
    }
    // Clean up GS picker request listener
    if (this.requestGsPickerHandler) {
      window.removeEventListener("requestGsPicker", this.requestGsPickerHandler);
    }
    // Clean up menu open listener
    if (this.openMenuHandler) {
      window.removeEventListener("openMenu", this.openMenuHandler);
    }
    // Clean up menu keyboard navigation listener
    if (this.menuKeyHandler) {
      window.removeEventListener("keydown", this.menuKeyHandler);
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
    addCustomSatellite(tle) {
      if (!tle || !cc || !cc.sats) {
        return;
      }

      try {
        console.log("Adding custom satellite from URL parameter");

        // Parse TLE - handle both newline-separated and space-separated formats
        let line0 = "";
        let line1 = "";
        let line2 = "";

        // First try splitting by newlines
        let lines = tle.split(/\r?\n/).filter((line) => line.trim());

        if (lines.length >= 2) {
          // Check if first line is TLE line 1 (starts with "1 ")
          if (lines[0].trim().startsWith("1 ")) {
            // 2-line format (no name)
            line1 = lines[0].trim();
            line2 = lines[1].trim();
          } else if (lines.length >= 3) {
            // 3-line format (with name)
            line0 = lines[0].trim();
            line1 = lines[1].trim();
            line2 = lines[2].trim();
          }
        }

        // If we still don't have valid lines, try parsing space-separated format
        // This handles the case where browser converts newlines to spaces when pasting in address bar
        if (!line1 || !line2) {
          const text = tle.trim();
          // Find line 1 (starts with "1 " followed by satellite number)
          const line1Match = text.match(/1 \d{5}[A-Z].*?(?=2 \d{5}|$)/);
          // Find line 2 (starts with "2 " followed by satellite number)
          const line2Match = text.match(/2 \d{5} .*$/);

          if (line1Match && line2Match) {
            const line1Start = text.indexOf(line1Match[0]);
            line0 = text.substring(0, line1Start).trim();
            line1 = line1Match[0].trim();
            line2 = line2Match[0].trim();
            console.log("Parsed space-separated TLE format");
          }
        }

        // Validate we have at least the two TLE lines
        if (!line1 || !line2) {
          console.warn("Custom satellite TLE must have at least 2 lines (line1, line2) or 3 lines (name, line1, line2)");
          console.warn("Received:", tle);
          return;
        }

        // Validate TLE line format (must start with "1 " or "2 " and be correct length)
        if (!line1.startsWith("1 ") || line1.length < 69) {
          console.warn("Invalid TLE line 1 format. Line 1 should start with '1 ' and be 69 characters.");
          console.warn("Line 1:", line1);
          return;
        }
        if (!line2.startsWith("2 ") || line2.length < 69) {
          console.warn("Invalid TLE line 2 format. Line 2 should start with '2 ' and be 69 characters.");
          console.warn("Line 2:", line2);
          return;
        }

        // Get satellite name (from line0, or extract from line1, or use default)
        let originalName = line0;
        if (!originalName) {
          // Extract satellite number from line 1 and use as name
          const satNumMatch = line1.match(/^1 (\d{5})/);
          originalName = satNumMatch ? `NORAD ${satNumMatch[1]}` : "Custom Satellite";
        }

        // Check if custom satellite with this name already exists
        const customName = `[Custom] ${originalName}`;
        const satStore = useSatStore();
        const satelliteExists = cc.sats.getSatellite(customName);

        if (!satelliteExists) {
          // Build TLE with [Custom] prefix to avoid name clashes
          const modifiedTle = `${customName}\n${line1}\n${line2}`;

          // Add custom satellite from modified TLE with "Custom" tag
          // Pass updateStore=false to avoid triggering satellitesLoaded event again
          cc.sats.addFromTle(modifiedTle, ["Custom"], false);

          console.log(`Custom satellite added: ${customName}`);

          // Manually update the store to refresh UI
          satStore.availableTags = cc.sats.tags;
          satStore.availableSatellitesByTag = cc.sats.taglist;
        } else {
          console.log(`Custom satellite ${customName} already exists, ensuring it's enabled`);
        }

        // Enable the custom satellite automatically after a short delay
        // This allows Cesium's reference frame data to load first
        // Do this whether satellite was just added or already existed
        setTimeout(() => {
          if (customName) {
            // Add to enabled satellites if not already there
            if (!satStore.enabledSatellites.includes(customName)) {
              satStore.enabledSatellites = [...satStore.enabledSatellites, customName];
              console.log(`Custom satellite enabled: ${customName}`);
            } else {
              // Satellite already in enabled list (from URL state)
              // Trigger showEnabledSatellites to actually show it
              console.log(`Custom satellite already enabled, showing: ${customName}`);
              cc.sats.showEnabledSatellites();
            }
          }
        }, 1000); // Wait 1 second for reference frame data to load
      } catch (error) {
        console.error("Failed to add custom satellite:", error);
      }
    },
    toggleMenu(name) {
      const oldState = this.menu[name];
      Object.keys(this.menu).forEach((k) => {
        this.menu[k] = false;
      });
      this.menu[name] = !oldState;
      // Set activeMenuKey so ESC works for click-opened menus
      // Reset focus index since menu was opened by click (not keyboard)
      if (!oldState) {
        // Menu is being opened
        this.activeMenuKey = name;
        this.menuFocusIndex = -1; // -1 means no keyboard focus yet
      } else {
        // Menu is being closed
        this.activeMenuKey = null;
        this.menuFocusIndex = -1;
      }
    },
    // Get list of interactive items for a menu
    getMenuItems(menuKey) {
      if (menuKey === "cat") {
        // Satellite selection has two dropdown items: groups and satellites
        return [
          { type: "satellite-dropdown", index: 0 },
          { type: "satellite-dropdown", index: 1 },
        ];
      } else if (menuKey === "sat") {
        return this.cc.sats.availableComponents.map((componentName) => ({
          type: "checkbox",
          component: componentName,
        }));
      } else if (menuKey === "gs") {
        return [
          { type: "checkbox", model: "pickMode" },
          { type: "button", action: "setGsFromGeolocation" },
          { type: "button", action: "focusFirstGroundStation" },
          { type: "button", action: "removeGroundStation" },
          { type: "button", action: "toggleZenithView" },
          { type: "checkbox", model: "hideSunlightPasses" },
          { type: "checkbox", model: "showOnlyLitPasses" },
          { type: "checkbox", model: "useLocalTime" },
        ];
      } else if (menuKey === "map") {
        const items = [];
        // Layers checkboxes
        this.cc.imageryProviderNames.forEach((name) => {
          items.push({ type: "checkbox-array", model: "layers", value: name });
        });
        // Terrain radio buttons
        this.cc.terrainProviderNames.forEach((name) => {
          items.push({ type: "radio", model: "terrainProvider", value: name });
        });
        // View radio buttons
        this.cc.sceneModes.forEach((name) => {
          items.push({ type: "radio", model: "sceneMode", value: name });
        });
        // Camera radio buttons
        this.cc.cameraModes.forEach((name) => {
          items.push({ type: "radio", model: "cameraMode", value: name });
        });
        return items;
      } else if (menuKey === "dbg") {
        const items = [
          { type: "checkbox", model: "debugConsoleLog" },
          { type: "checkbox", model: "showFps" },
          { type: "checkbox", model: "showCameraAltitude" },
        ];
        if (this.isIos) {
          items.push({ type: "checkbox", model: "showIosClock" });
        }
        items.push(
          { type: "cesium-checkbox", path: "viewer.scene.requestRenderMode" },
          { type: "quality-checkbox", model: "qualityPreset" },
          { type: "cesium-checkbox", path: "viewer.scene.fog.enabled" },
          { type: "cesium-checkbox", path: "viewer.scene.globe.enableLighting" },
          { type: "cesium-checkbox", path: "viewer.scene.highDynamicRange" },
          { type: "cesium-checkbox", path: "viewer.scene.globe.showGroundAtmosphere" },
        );
        return items;
      }
      return [];
    },
    // Activate the focused menu item (toggle checkbox or click button)
    activateMenuItem(item) {
      if (!item) return;
      if (item.type === "satellite-dropdown") {
        // Focus and activate the satellite selection dropdown
        if (this.$refs.satelliteSelect) {
          this.$refs.satelliteSelect.activateFocusedItem(item.index);
        }
      } else if (item.type === "checkbox") {
        // Handle satellite component checkboxes (array-based)
        if (item.component) {
          const index = this.enabledComponents.indexOf(item.component);
          if (index > -1) {
            // Remove from array
            this.enabledComponents.splice(index, 1);
          } else {
            // Add to array
            this.enabledComponents.push(item.component);
          }
        } else if (item.model in this) {
          // Handle regular boolean checkboxes
          this[item.model] = !this[item.model];
        }
      } else if (item.type === "checkbox-array") {
        // Handle array-based checkboxes (like layers)
        const arr = this[item.model];
        const index = arr.indexOf(item.value);
        if (index > -1) {
          arr.splice(index, 1);
        } else {
          arr.push(item.value);
        }
      } else if (item.type === "radio") {
        // Handle radio buttons
        this[item.model] = item.value;
      } else if (item.type === "cesium-checkbox") {
        // Handle Cesium viewer property checkboxes
        const keys = item.path.split(".");
        let obj = this.cc;
        for (let i = 0; i < keys.length - 1; i++) {
          obj = obj[keys[i]];
        }
        const lastKey = keys[keys.length - 1];
        obj[lastKey] = !obj[lastKey];
      } else if (item.type === "quality-checkbox") {
        // Handle quality preset toggle
        this.qualityPreset = this.qualityPreset === "high" ? "low" : "high";
      } else if (item.type === "button") {
        // Call the button action
        if (item.action === "setGsFromGeolocation") {
          cc.setGroundStationFromGeolocation();
        } else if (item.action === "focusFirstGroundStation") {
          cc.sats.focusGroundStation();
        } else if (item.action === "removeGroundStation") {
          this.removeGroundStation();
        } else if (item.action === "toggleZenithView") {
          this.toggleZenithView();
        }
      }
    },
    // Close the currently active menu
    closeActiveMenu() {
      if (this.activeMenuKey) {
        this.menu[this.activeMenuKey] = false;
        this.activeMenuKey = null;
        this.menuFocusIndex = -1;
        this.dropdownOpen = false;
      }
    },
    // Handle dropdown opened event from satellite-select
    onDropdownOpened() {
      // Remove highlight when dropdown is opened
      this.menuFocusIndex = -1;
      // Disable menu keyboard navigation
      this.dropdownOpen = true;
    },
    // Handle dropdown closed event from satellite-select
    onDropdownClosed() {
      // Re-enable menu keyboard navigation
      this.dropdownOpen = false;
    },
    // Check if a menu item is focused (for applying CSS class)
    isFocused(menuKey, index) {
      return this.activeMenuKey === menuKey && this.menuFocusIndex === index;
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

/* GS picker hint styling */
.gs-picker-hint {
  background-color: rgba(76, 175, 80, 0.3) !important;
  border: 1px solid #4caf50;
  border-radius: 4px;
}

.hint-arrow {
  color: #4caf50;
  font-weight: bold;
  margin-left: 8px;
  animation: pulse-hint 1s ease-in-out infinite;
}

@keyframes pulse-hint {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* Menu item keyboard focus indicator */
.menu-item-focused {
  outline: 2px solid #4caf50;
  outline-offset: 2px;
  background-color: rgba(76, 175, 80, 0.2) !important;
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
