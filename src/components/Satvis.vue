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
        <div class="toolbarTitle">
          Satellite elements
        </div>
        <label v-for="componentName in cc.sats.availableComponents" :key="componentName" class="toolbarSwitch">
          <input v-model="enabledComponents" type="checkbox" :value="componentName">
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
        <div class="toolbarTitle">
          Ground station
        </div>
        <label class="toolbarSwitch">
          <input v-model="pickMode" type="checkbox">
          <span class="slider"></span>
          Pick on globe
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.setGroundStationFromGeolocation()">
          Set from geolocation
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.sats.focusGroundStation()">
          Focus
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
      </div>
      <div v-show="menu.map" class="toolbarSwitches">
        <div class="toolbarTitle">
          Layers
        </div>
        <label v-for="name in cc.imageryProviderNames" :key="name" class="toolbarSwitch">
          <input v-model="layers" type="checkbox" :value="name">
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">
          Terrain
        </div>
        <label v-for="name in cc.terrainProviderNames" :key="name" class="toolbarSwitch">
          <input v-model="terrainProvider" type="radio" :value="name">
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">
          View
        </div>
        <label v-for="name in cc.sceneModes" :key="name" class="toolbarSwitch">
          <input v-model="sceneMode" type="radio" :value="name">
          <span class="slider"></span>
          {{ name }}
        </label>
        <div class="toolbarTitle">
          Camera
        </div>
        <label v-for="name in cc.cameraModes" :key="name" class="toolbarSwitch">
          <input v-model="cameraMode" type="radio" :value="name">
          <span class="slider"></span>
          {{ name }}
        </label>
      </div>
      <div v-show="menu.ios" class="toolbarSwitches">
        <div class="toolbarTitle">
          Mobile
        </div>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.useWebVR" type="checkbox">
          <span class="slider"></span>
          VR
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.clock.shouldAnimate" type="checkbox">
          <span class="slider"></span>
          Play
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.viewer.clockViewModel.multiplier *= 2">
          Increase play speed
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.viewer.clockViewModel.multiplier /= 2">
          Decrease play speed
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="$router.go({path: '', force: true})">
          Reload
        </label>
      </div>
      <div v-show="menu.dbg" class="toolbarSwitches">
        <div class="toolbarTitle">
          Debug
        </div>
        <label class="toolbarSwitch">
          <input v-model="showFps" type="checkbox">
          <span class="slider"></span>
          FPS
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.requestRenderMode" type="checkbox">
          <span class="slider"></span>
          RequestRender
        </label>
        <label class="toolbarSwitch">
          <input v-model="qualityPreset" true-value="high" false-value="low" type="checkbox">
          <span class="slider"></span>
          High Quality
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.fog.enabled" type="checkbox">
          <span class="slider"></span>
          Fog
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.globe.enableLighting" type="checkbox">
          <span class="slider"></span>
          Lighting
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.highDynamicRange" type="checkbox">
          <span class="slider"></span>
          HDR
        </label>
        <label class="toolbarSwitch">
          <input v-model="cc.viewer.scene.globe.showGroundAtmosphere" type="checkbox">
          <span class="slider"></span>
          Atmosphere
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.jumpTo('Everest')">
          Jump to Everest
        </label>
        <label class="toolbarSwitch">
          <input type="button" @click="cc.jumpTo('HalfDome')">
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
  </div>
</template>

<script>
import { mapWritableState } from "pinia";
import { useCesiumStore } from "../stores/cesium";
import { useSatStore } from "../stores/sat";

import SatelliteSelect from "./SatelliteSelect.vue";
import { DeviceDetect } from "../modules/util/DeviceDetect";

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
      "hideSunlightPasses",
      "showOnlyLitPasses",
    ]),
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
    },
  },
  mounted() {
    if (this.$route.query.time) {
      cc.setTime(this.$route.query.time);
    }
    this.showUI = !DeviceDetect.inIframe();
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

      console.log('Double-click on ground station button');
      console.log('Current tracked entity:', currentTrackedEntity);
      console.log('Entity name:', currentTrackedEntity ? currentTrackedEntity.name : 'None');

      // Check if we're currently tracking a ground station
      // Ground stations now have names like "Groundstation [60.81°, 23.95°]"
      const isTrackingGroundStation = currentTrackedEntity &&
        currentTrackedEntity.name &&
        currentTrackedEntity.name.includes('Groundstation');

      console.log('Is tracking ground station:', isTrackingGroundStation);

      if (isTrackingGroundStation) {
        // Return to normal view focused on center of Earth
        console.log('Returning to normal view focused on center of Earth');
        this.cc.viewer.trackedEntity = undefined;
        this.cc.viewer.selectedEntity = undefined;

        // Focus camera on center of Earth with a nice overview
        this.cc.viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(0, 0, 15000000), // 15,000 km above Earth center
          orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO, // Look straight down
            roll: 0
          }
        });
      } else {
        // Focus on the first ground station
        if (this.groundStations && this.groundStations.length > 0) {
          console.log(`Focusing on first ground station: ${this.groundStations[0].name}`);
          this.cc.sats.focusGroundStation(this.groundStations[0]);
        } else {
          console.warn('No ground stations available to focus on');
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
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    },
    formatDuration(duration) {
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    },
    formatAzimuth(azimuth) {
      const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const index = Math.round(azimuth / 45) % 8;
      return `${azimuth.toFixed(0)}° (${directions[index]})`;
    },
    formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
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
