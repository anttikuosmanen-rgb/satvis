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
        <button v-tooltip="'Ground station'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('gs')">
          <i class="icon svg-groundstation"></i>
        </button>
        <button v-tooltip="'Satellite passes'" type="button" class="cesium-button cesium-toolbar-button" @click="toggleMenu('passes')">
          📡
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
      </div>
      <div v-show="menu.passes" class="toolbarSwitches">
        <div class="toolbarTitle">
          Satellite passes
        </div>
        <div v-if="!selectedSatellitePasses.length" class="toolbarText">
          Select a satellite to view passes
        </div>
        <div v-else class="passesContainer">
          <div v-for="pass in selectedSatellitePasses.slice(0, 10)" :key="pass.start" class="passItem">
            <div class="passHeader">
              <strong>{{ formatDate(pass.start) }}</strong>
              <span class="passDuration">{{ formatDuration(pass.duration) }}</span>
            </div>
            <div class="passDetails">
              <div>Max elevation: {{ pass.maxElevation.toFixed(1) }}°</div>
              <div>Start: {{ formatAzimuth(pass.azimuthStart) }} | End: {{ formatAzimuth(pass.azimuthEnd) }}</div>
              <div v-if="pass.groundStationName" class="groundStationName">{{ pass.groundStationName }}</div>
              <div class="darknessInfo">
                <div class="conditionRow">
                  <span class="conditionLabel">Ground:</span>
                  <span :class="{'dark': pass.groundStationDarkAtStart, 'light': !pass.groundStationDarkAtStart}">
                    {{ pass.groundStationDarkAtStart ? '🌙' : '☀️' }}
                  </span>
                  →
                  <span :class="{'dark': pass.groundStationDarkAtEnd, 'light': !pass.groundStationDarkAtEnd}">
                    {{ pass.groundStationDarkAtEnd ? '🌙' : '☀️' }}
                  </span>
                </div>
                <div class="conditionRow" v-if="pass.satelliteEclipsedAtStart !== undefined">
                  <span class="conditionLabel">Satellite:</span>
                  <span :class="{'eclipse': pass.satelliteEclipsedAtStart, 'sunlit': !pass.satelliteEclipsedAtStart}">
                    {{ pass.satelliteEclipsedAtStart ? '🌑' : '☀️' }}
                  </span>
                  →
                  <span :class="{'eclipse': pass.satelliteEclipsedAtEnd, 'sunlit': !pass.satelliteEclipsedAtEnd}">
                    {{ pass.satelliteEclipsedAtEnd ? '🌑' : '☀️' }}
                  </span>
                  <span v-if="pass.eclipseTransitions && pass.eclipseTransitions.length > 0" class="transitionInfo">
                    ({{ pass.eclipseTransitions.length }} transition{{ pass.eclipseTransitions.length > 1 ? 's' : '' }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
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
        passes: false,
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
    ]),
    selectedSatellitePasses() {
      if (!this.cc?.sats?.selectedSatellite) {
        return [];
      }
      const satellite = this.cc.sats.getSatellite(this.cc.sats.selectedSatellite);
      let passes = satellite?.props?.passes || [];

      // Filter out passes in sunlight if option is enabled
      if (this.hideSunlightPasses) {
        passes = passes.filter(pass => {
          // Show pass if either start or end is in darkness
          return pass.groundStationDarkAtStart || pass.groundStationDarkAtEnd;
        });
      }

      return passes;
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
    toggleUI() {
      this.showUI = !this.showUI;
      if (!cc.minimalUI) {
        cc.showUI = this.showUI;
      }
    },
    formatDate(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
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
  },
};
</script>

<style scoped>
.passesContainer {
  max-height: 400px;
  overflow-y: auto;
}

.passItem {
  border-bottom: 1px solid #444;
  padding: 8px 0;
  font-size: 12px;
}

.passItem:last-child {
  border-bottom: none;
}

.passHeader {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.passDuration {
  color: #aaa;
  font-size: 11px;
}

.passDetails {
  color: #ccc;
  line-height: 1.3;
}

.passDetails > div {
  margin-bottom: 2px;
}

.groundStationName {
  color: #8cc8ff;
  font-weight: bold;
}

.darknessInfo {
  margin-top: 4px;
}

.conditionRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.conditionLabel {
  font-size: 10px;
  font-weight: bold;
  min-width: 60px;
  color: #bdc3c7;
}

.darknessInfo span {
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 3px;
}

.darknessInfo .dark {
  background-color: #2c3e50;
  color: #ecf0f1;
}

.darknessInfo .light {
  background-color: #f39c12;
  color: #2c3e50;
}

.darknessInfo .eclipse {
  background-color: #34495e;
  color: #ecf0f1;
}

.darknessInfo .sunlit {
  background-color: #f1c40f;
  color: #2c3e50;
}

.transitionInfo {
  font-size: 9px;
  color: #95a5a6;
  font-style: italic;
}

.toolbarText {
  color: #aaa;
  padding: 10px;
  text-align: center;
  font-style: italic;
}
</style>
