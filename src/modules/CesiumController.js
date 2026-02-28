import {
  ArcGisMapServerImageryProvider,
  ArcGISTiledElevationTerrainProvider,
  buildModuleUrl,
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  ClockStep,
  Color,
  Credit,
  EllipsoidTerrainProvider,
  ImageryLayer,
  JulianDate,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  OpenStreetMapImageryProvider,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TileCoordinatesImageryProvider,
  TileMapServiceImageryProvider,
  TimeInterval,
  Transforms,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  defined,
} from "@cesium/engine";
import { Viewer } from "@cesium/widgets";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import * as Sentry from "@sentry/browser";
import { icon } from "@fortawesome/fontawesome-svg-core";
import { faBell, faInfo } from "@fortawesome/free-solid-svg-icons";
import infoBoxCss from "@cesium/widgets/Source/InfoBox/InfoBoxDescription.css?raw";
import * as satellitejs from "satellite.js";

import SkyBox from "@cesium/engine/Source/Scene/SkyBox";

import { useCesiumStore } from "../stores/cesium";
import { useSatStore } from "../stores/sat";
import infoBoxOverrideCss from "../css/infobox.css?raw";
import { useToastProxy } from "../composables/useToastProxy";
import { MultiLayerSkyBox } from "./MultiLayerSkyBox";
import { DeviceDetect } from "./util/DeviceDetect";
import { PushManager } from "./util/PushManager";
import { CesiumPerformanceStats } from "./util/CesiumPerformanceStats";
import { CesiumTimelineHelper } from "./util/CesiumTimelineHelper";
import { SatelliteManager } from "./SatelliteManager";
import { SatelliteComponentCollection } from "./SatelliteComponentCollection";
import { TimeFormatHelper } from "./util/TimeFormatHelper";
import { PlanetManager } from "./PlanetManager";
import { EarthManager } from "./EarthManager";
import { LaunchSiteManager } from "./LaunchSiteManager";
import { filterAndSortPasses } from "./util/PassFilter";
import { ClockMonitor } from "./util/ClockMonitor";
import { DescriptionHelper } from "./util/DescriptionHelper";

dayjs.extend(utc);

export class CesiumController {
  constructor() {
    this.initConstants();
    this.preloadReferenceFrameData();
    this.minimalUI = DeviceDetect.inIframe() || DeviceDetect.isIos();

    // Use online imagery for iOS devices to avoid texture loading issues
    const baseImageryLayer = DeviceDetect.isIos() ? "OSM" : "OfflineHighres";

    this.viewer = new Viewer("cesiumContainer", {
      animation: !this.minimalUI,
      baseLayer: this.createImageryLayer(baseImageryLayer),
      baseLayerPicker: false,
      fullscreenButton: !this.minimalUI,
      fullscreenElement: document.body,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: !this.minimalUI,
      vrButton: !this.minimalUI,
      contextOptions: {
        webgl: {
          alpha: true,
        },
      },
    });

    // Cesium default settings
    this.viewer.clock.shouldAnimate = true;
    this.viewer.clock.multiplier = 1.0; // Ensure clock multiplier is set
    this.viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    this.viewer.scene.globe.enableLighting = true;
    this.viewer.scene.highDynamicRange = true;
    this.viewer.scene.maximumRenderTimeChange = 1 / 30;
    this.viewer.scene.requestRenderMode = true;

    // Set initial camera view centered on Helsinki longitude (24.94°E)
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(24.94, 20, 20000000), // Helsinki longitude, looking at Earth from space
    });

    // State for spacebar double-tap detection
    this._lastSpacebarTime = 0;

    // Center the visible timeline window around current time on startup
    // This makes the current time marker appear in the center instead of the left edge
    if (this.viewer.timeline) {
      const currentJulian = this.viewer.clock.currentTime;
      const visibleStart = JulianDate.addHours(currentJulian, -12, new JulianDate());
      const visibleStop = JulianDate.addHours(currentJulian, 12, new JulianDate());
      this.viewer.timeline.zoomTo(visibleStart, visibleStop);

      // Override zoomFrom to enforce min/max duration limits.
      // This prevents the user from zooming past the bounds — the timeline
      // simply stops at the limit instead of zooming past and snapping back.
      const timeline = this.viewer.timeline;
      const originalZoomFrom = timeline.zoomFrom.bind(timeline);
      const minDuration = 3600; // 1 hour
      const maxDuration = 730 * 86400; // ~2 years
      timeline.zoomFrom = function (amount) {
        const currentSpan = this._timeBarSecondsSpan;
        const newSpan = currentSpan * amount;
        let clampedAmount = amount;
        if (newSpan < minDuration) {
          clampedAmount = minDuration / currentSpan;
        } else if (newSpan > maxDuration) {
          clampedAmount = maxDuration / currentSpan;
        }
        // If we're already at the limit and trying to zoom further, do nothing
        if (Math.abs(clampedAmount - 1) < 1e-9) return;
        originalZoomFrom(clampedAmount);
      };

      // Track timeline scrubbing state to prevent recentering during drag
      this.isTimelineScrubbing = false;
      this.viewer.timeline.container.addEventListener("mousedown", () => {
        this.isTimelineScrubbing = true;
      });
      window.addEventListener("mouseup", () => {
        if (this.isTimelineScrubbing) {
          this.isTimelineScrubbing = false;
          // Recenter timeline after scrubbing ends
          const current = this.viewer.clock.currentTime;
          const timeline = this.viewer.timeline;
          const currentStart = timeline._startJulian;
          const currentEnd = timeline._endJulian;
          if (currentStart && currentEnd) {
            const rangeDurationSeconds = JulianDate.secondsDifference(currentEnd, currentStart);
            const halfDuration = rangeDurationSeconds / 2;
            const newStart = JulianDate.addSeconds(current, -halfDuration, new JulianDate());
            const newEnd = JulianDate.addSeconds(current, halfDuration, new JulianDate());
            timeline.zoomTo(newStart, newEnd);
          }
        }
      });
    }

    // Cesium Performance Tools
    // this.viewer.scene.debugShowFramesPerSecond = true;
    // this.FrameRateMonitor = FrameRateMonitor.fromScene(this.viewer.scene);
    // this.viewer.scene.postRender.addEventListener((scene) => {
    //   console.log(this.FrameRateMonitor.lastFramesPerSecond)
    // });
    // this.performanceStats = new CesiumPerformanceStats(this.viewer.scene, true);

    // Export CesiumController for debugger
    window.cc = this;

    // Store sat store reference for use in timeline/animation formatters
    // This avoids calling useSatStore() from non-Vue contexts
    // Wrap in try-catch in case Pinia isn't initialized yet (e.g., in test environments)
    try {
      this.satStore = useSatStore();
    } catch (error) {
      console.warn("[CesiumController] Could not access sat store, local time formatting may not work:", error.message);
      this.satStore = null;
    }

    // Initialize ClockMonitor for centralized time change detection
    // This must be created before other managers so they can listen to events
    this.clockMonitor = new ClockMonitor(this.viewer, {
      checkInterval: 1000, // Check every 1 second
      threshold: 60, // Emit event for jumps >1 minute
    });

    // Listen for time jumps to update timeline window
    this.setupClockTimeJumpListener();

    // CesiumController config
    this.sceneModes = ["3D", "2D", "Columbus"];
    this.cameraModes = ["Fixed", "Inertial"];

    this.createInputHandler();
    this.addErrorHandler();
    this.styleInfoBox();

    // Create Satellite Manager
    this.sats = new SatelliteManager(this.viewer);

    // Create Planet Manager
    this.planets = new PlanetManager(this.viewer);

    // Create Earth/Moon Manager
    this.earthMoon = new EarthManager(this.viewer);

    // Create Launch Site Manager
    this.launchSites = new LaunchSiteManager(this.viewer);
    this.launchSites.initialize();

    // Wire LaunchSiteManager to SatelliteManager for pre-launch satellite positioning
    this.sats.launchSiteManager = this.launchSites;

    // Add event listener for ground station selection
    this.setupGroundStationSelectionListener();

    // Add event listener to detect when time is set to "now" (today/real-time button)
    this.setupTimelineResetOnNow();

    // Setup local time formatting for clock and timeline
    this.setupLocalTimeFormatting();

    this.pm = new PushManager();

    // Add privacy policy to credits when not running in iframe
    if (!DeviceDetect.inIframe()) {
      this.viewer.creditDisplay.addStaticCredit(new Credit(`<a href="/privacy.html" target="_blank"><u>Privacy</u></a>`, true));
    }
    this.viewer.creditDisplay.addStaticCredit(new Credit(`Satellite TLE data provided by <a href="https://celestrak.org/NORAD/elements/" target="_blank"><u>Celestrak</u></a>`));

    // Fix Cesium logo in minimal ui mode
    if (this.minimalUI) {
      setTimeout(() => {
        this.fixLogo();
      }, 2500);
    }

    this.activeLayers = [];
  }

  initConstants() {
    this.imageryProviders = {
      Offline: {
        create: () => TileMapServiceImageryProvider.fromUrl("/cesium/Assets/Textures/NaturalEarthII"),
        alpha: 1,
        base: true,
      },
      OfflineHighres: {
        create: () =>
          TileMapServiceImageryProvider.fromUrl("data/cesium-assets/imagery/NaturalEarthII", {
            maximumLevel: 5,
            credit: "Imagery courtesy Natural Earth",
          }),
        alpha: 1,
        base: true,
      },
      ArcGis: {
        create: () =>
          ArcGisMapServerImageryProvider.fromUrl("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer", {
            enablePickFeatures: false,
          }),
        alpha: 1,
        base: true,
      },
      OSM: {
        create: () =>
          new OpenStreetMapImageryProvider({
            url: "https://a.tile.openstreetmap.org/",
          }),
        alpha: 1,
        base: true,
      },
      Topo: {
        create: () =>
          new UrlTemplateImageryProvider({
            url: "https://api.maptiler.com/maps/topo-v2/{z}/{x}/{y}@2x.png?key=smE1YAavFPhU2rf3prVZ",
            credit: `<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>`,
          }),
        alpha: 1,
        base: true,
      },
      BlackMarble: {
        create: () =>
          new WebMapServiceImageryProvider({
            url: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
            layers: "VIIRS_Black_Marble",
            style: "default",
            tileMatrixSetID: "250m",
            format: "image/png",
            tileWidth: 512,
            tileHeight: 512,
            credit: "NASA Global Imagery Browse Services for EOSDIS",
          }),
        alpha: 1,
        base: true,
      },
      Tiles: {
        create: () => new TileCoordinatesImageryProvider(),
        alpha: 1,
        base: false,
      },
      "GOES-IR": {
        create: () =>
          new WebMapServiceImageryProvider({
            url: "https://mesonet.agron.iastate.edu/cgi-bin/wms/goes/conus_ir.cgi?",
            layers: "goes_conus_ir",
            credit: "Infrared data courtesy Iowa Environmental Mesonet",
            parameters: {
              transparent: "true",
              format: "image/png",
            },
          }),
        alpha: 0.5,
        base: false,
      },
      Nextrad: {
        create: () =>
          new WebMapServiceImageryProvider({
            url: "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi?",
            layers: "nexrad-n0r",
            credit: "US Radar data courtesy Iowa Environmental Mesonet",
            parameters: {
              transparent: "true",
              format: "image/png",
            },
          }),
        alpha: 0.5,
        base: false,
      },
    };
    const defaultSkyBoxUrl = (suffix) => buildModuleUrl(`Assets/Textures/SkyBox/tycho2t3_80_${suffix}.jpg`);
    this._defaultStarSources = {
      positiveX: defaultSkyBoxUrl("px"),
      negativeX: defaultSkyBoxUrl("mx"),
      positiveY: defaultSkyBoxUrl("py"),
      negativeY: defaultSkyBoxUrl("my"),
      positiveZ: defaultSkyBoxUrl("pz"),
      negativeZ: defaultSkyBoxUrl("mz"),
    };
    /* global __SATVIS_LOCAL_DEV__ */
    const skyFaces = (dir) => ({
      positiveX: `${dir}/px.jpg`,
      negativeX: `${dir}/mx.jpg`,
      positiveY: `${dir}/py.jpg`,
      negativeY: `${dir}/my.jpg`,
      positiveZ: `${dir}/pz.jpg`,
      negativeZ: `${dir}/mz.jpg`,
    });
    this.skyMapProviders = {
      MilkyWay: {
        defaultAlpha: 0.5,
        sources: skyFaces("data/stars/milkyway_2020_4k"),
      },
      ...(__SATVIS_LOCAL_DEV__
        ? {
            MilkyWay8K: {
              defaultAlpha: 0.5,
              sources: skyFaces("data/stars/milkyway_2020_8k"),
            },
          }
        : {}),
      Tycho2K: {
        sources: {
          positiveX: "data/cesium-assets/stars/TychoSkymapII.t3_08192x04096/TychoSkymapII.t3_08192x04096_80_px.jpg",
          negativeX: "data/cesium-assets/stars/TychoSkymapII.t3_08192x04096/TychoSkymapII.t3_08192x04096_80_mx.jpg",
          positiveY: "data/cesium-assets/stars/TychoSkymapII.t3_08192x04096/TychoSkymapII.t3_08192x04096_80_py.jpg",
          negativeY: "data/cesium-assets/stars/TychoSkymapII.t3_08192x04096/TychoSkymapII.t3_08192x04096_80_my.jpg",
          positiveZ: "data/cesium-assets/stars/TychoSkymapII.t3_08192x04096/TychoSkymapII.t3_08192x04096_80_pz.jpg",
          negativeZ: "data/cesium-assets/stars/TychoSkymapII.t3_08192x04096/TychoSkymapII.t3_08192x04096_80_mz.jpg",
        },
      },
      ...(__SATVIS_LOCAL_DEV__
        ? {
            Starmap8K: {
              sources: skyFaces("data/stars/starmap_8k"),
            },
          }
        : {}),
      HipTyc16K: {
        sources: skyFaces("data/stars/hiptyc_2020_16k"),
      },
      Constellations: {
        defaultAlpha: 0.5,
        sources: {
          positiveX: "data/stars/constellations/px.png",
          negativeX: "data/stars/constellations/mx.png",
          positiveY: "data/stars/constellations/py.png",
          negativeY: "data/stars/constellations/my.png",
          positiveZ: "data/stars/constellations/pz.png",
          negativeZ: "data/stars/constellations/mz.png",
        },
      },
    };
    this.terrainProviders = {
      None: {
        create: () => new EllipsoidTerrainProvider(),
      },
      Maptiler: {
        create: () =>
          CesiumTerrainProvider.fromUrl("https://api.maptiler.com/tiles/terrain-quantized-mesh/?key=smE1YAavFPhU2rf3prVZ", {
            credit:
              '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
            requestVertexNormals: true,
          }),
      },
      ArcGIS: {
        create: () => ArcGISTiledElevationTerrainProvider.fromUrl("https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"),
        visible: false,
      },
    };
  }

  preloadReferenceFrameData() {
    // Preload reference frame data for a timeframe of 180 days
    const timeInterval = new TimeInterval({
      start: JulianDate.addDays(JulianDate.now(), -60, new JulianDate()),
      stop: JulianDate.addDays(JulianDate.now(), 120, new JulianDate()),
    });
    Transforms.preloadIcrfFixed(timeInterval).then(() => {
      console.log("Reference frame data loaded");
    });
  }

  get imageryProviderNames() {
    return Object.keys(this.imageryProviders);
  }

  get baseLayers() {
    return Object.entries(this.imageryProviders)
      .filter(([, val]) => val.base)
      .map(([key]) => key);
  }

  get overlayLayers() {
    return Object.entries(this.imageryProviders)
      .filter(([, val]) => !val.base)
      .map(([key]) => key);
  }

  set imageryLayers(newLayerNames) {
    this.clearImageryLayers();
    newLayerNames.forEach((layerName) => {
      const [name, alpha] = layerName.split("_");
      const layer = this.createImageryLayer(name, alpha);
      if (layer) {
        this.viewer.scene.imageryLayers.add(layer);
      }
    });
  }

  clearImageryLayers() {
    this.viewer.scene.imageryLayers.removeAll();
  }

  createImageryLayer(imageryProviderName, alpha) {
    if (!this.imageryProviderNames.includes(imageryProviderName)) {
      console.error("Unknown imagery layer");
      return false;
    }

    const provider = this.imageryProviders[imageryProviderName];
    const layer = ImageryLayer.fromProviderAsync(provider.create());
    if (alpha === undefined) {
      layer.alpha = provider.alpha;
    } else {
      layer.alpha = alpha;
    }
    return layer;
  }

  get terrainProviderNames() {
    return Object.entries(this.terrainProviders)
      .filter(([, val]) => val.visible ?? true)
      .map(([key]) => key);
  }

  set terrainProvider(terrainProviderName) {
    this.updateTerrainProvider(terrainProviderName);
  }

  async updateTerrainProvider(terrainProviderName) {
    if (!this.terrainProviderNames.includes(terrainProviderName)) {
      console.error("Unknown terrain provider");
      return;
    }

    const provider = await this.terrainProviders[terrainProviderName].create();
    this.viewer.terrainProvider = provider;
  }

  get skyMapProviderNames() {
    return Object.keys(this.skyMapProviders);
  }

  /**
   * Set sky map layers from an array of {name, alpha} configs.
   * Pass an empty array to restore the default Cesium skybox.
   */
  set skyMapLayers(configs) {
    if (!configs || configs.length === 0) {
      // Restore default sky box
      if (this._multiLayerSkyBox) {
        this._multiLayerSkyBox.destroy();
        this._multiLayerSkyBox = null;
      }
      this.viewer.scene.skyBox = SkyBox.createEarthSkyBox();
      this.viewer.scene.requestRender();
      return;
    }

    // Build layer configs with full source paths
    const layerConfigs = configs
      .filter((c) => this.skyMapProviders[c.name])
      .map((c) => ({
        name: c.name,
        sources: this.skyMapProviders[c.name].sources,
        alpha: c.alpha ?? 1.0,
      }));

    if (layerConfigs.length === 0) return;

    // If no star map layer is selected (only background/overlay layers like MilkyWay or Constellations),
    // include the default Cesium stars as an implicit base so they aren't replaced entirely
    const starMapNames = Object.keys(this.skyMapProviders).filter((n) => !this.skyMapProviders[n].defaultAlpha);
    const hasStarMap = layerConfigs.some((c) => starMapNames.includes(c.name));
    if (!hasStarMap) {
      layerConfigs.unshift({
        name: "_defaultStars",
        sources: this._defaultStarSources,
        alpha: 1.0,
      });
    }

    if (!this._multiLayerSkyBox) {
      this._multiLayerSkyBox = new MultiLayerSkyBox();
      this._multiLayerSkyBox.onLoad = () => this.viewer.scene.requestRender();
      this._multiLayerSkyBox.setLayers(layerConfigs);
      this.viewer.scene.skyBox = this._multiLayerSkyBox;
      this.viewer.scene.requestRender();
      return;
    }

    // Check if only alpha values changed (same layers in same order)
    const currentNames = this._multiLayerSkyBox._layers.map((l) => l.name);
    const newNames = layerConfigs.map((l) => l.name);
    const sameLayerSet = currentNames.length === newNames.length && currentNames.every((n, i) => n === newNames[i]);

    if (sameLayerSet) {
      // Only update alpha values — no image reload needed
      for (const cfg of layerConfigs) {
        this._multiLayerSkyBox.setLayerAlpha(cfg.name, cfg.alpha);
      }
    } else {
      // Layer set changed — full reload
      this._multiLayerSkyBox.setLayers(layerConfigs);
    }
    this.viewer.scene.skyBox = this._multiLayerSkyBox;
    this.viewer.scene.requestRender();
  }

  set sceneMode(sceneMode) {
    // Exit zenith view before switching away from 3D - zenith view only works in 3D
    if (sceneMode !== "3D" && this.sats.isInZenithView) {
      this.sats.exitZenithView();
    }

    // Remove orbit primitives before morphing - Primitive.modelMatrix is only supported in 3D
    // and crashes during the morph transition. Recreate after morph completes.
    const hasOrbit = this.sats.enabledComponents.includes("Orbit");
    if (hasOrbit) {
      this.sats.disableComponent("Orbit");
      // Also synchronously remove the shared geometry primitive used for non-tracked orbits.
      // disableComponent schedules removal asynchronously via recreateGeometryInstancePrimitive,
      // but the morph starts before that tick callback fires.
      if (SatelliteComponentCollection.primitive) {
        this.viewer.scene.primitives.remove(SatelliteComponentCollection.primitive);
        SatelliteComponentCollection.primitive = undefined;
      }
    }

    if (sceneMode === "3D") {
      this.viewer.scene.morphTo3D();
    } else if (sceneMode === "2D") {
      this.viewer.scene.morphTo2D();
    } else if (sceneMode === "Columbus") {
      this.viewer.scene.morphToColumbusView();
    }

    // Recreate orbit components after morph completes so they use the correct
    // visualization type (PathGraphics for 2D/Columbus, Primitive for 3D)
    if (hasOrbit) {
      const removeCallback = this.viewer.scene.morphComplete.addEventListener(() => {
        removeCallback();
        this.sats.enableComponent("Orbit");
      });
    }
  }

  jumpTo(location) {
    switch (location) {
      case "Everest": {
        const target = new Cartesian3(300770.50872389384, 5634912.131394585, 2978152.2865545116);
        const offset = new Cartesian3(6344.974098678562, -793.3419798081741, 2499.9508860763162);
        this.viewer.camera.lookAt(target, offset);
        this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
        break;
      }
      case "HalfDome": {
        const target = new Cartesian3(-2489625.0836225147, -4393941.44443024, 3882535.9454173897);
        const offset = new Cartesian3(-6857.40902037546, 412.3284835694358, 2147.5545426812023);
        this.viewer.camera.lookAt(target, offset);
        this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
        break;
      }
      default:
        console.error("Unknown location");
    }
  }

  set cameraMode(cameraMode) {
    switch (cameraMode) {
      case "Inertial":
        this.viewer.scene.postUpdate.addEventListener(this.cameraTrackEci);
        break;
      case "Fixed":
        this.viewer.scene.postUpdate.removeEventListener(this.cameraTrackEci);
        break;
      default:
        console.error("Unknown camera mode");
    }
  }

  cameraTrackEci(scene, time) {
    if (scene.mode !== SceneMode.SCENE3D) {
      return;
    }

    const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
    if (defined(icrfToFixed)) {
      const { camera } = scene;
      const offset = Cartesian3.clone(camera.position);
      const transform = Matrix4.fromRotationTranslation(icrfToFixed);
      camera.lookAtTransform(transform, offset);
    }
  }

  /**
   * Flip camera 180° to the opposite side of Earth
   * Maintains the same altitude and orientation (heading, pitch, roll)
   * Useful when satellite billboard is on the far side and not visible
   */
  flipCameraToOppositeSide() {
    const camera = this.viewer.camera;

    // Get current camera position in cartographic coordinates
    const currentPosition = camera.positionCartographic;
    const currentHeight = currentPosition.height;

    // Get current camera orientation
    const currentHeading = camera.heading;
    const currentPitch = camera.pitch;
    const currentRoll = camera.roll;

    // Calculate opposite position: flip longitude by 180°, negate latitude
    const oppositeLongitude = currentPosition.longitude + Math.PI;
    const oppositeLatitude = -currentPosition.latitude;

    // Set camera to opposite side with same altitude and orientation
    camera.setView({
      destination: Cartesian3.fromRadians(oppositeLongitude, oppositeLatitude, currentHeight),
      orientation: {
        heading: currentHeading,
        pitch: currentPitch,
        roll: currentRoll,
      },
    });
  }

  // Helper: Capture current camera view for later restoration
  captureCurrentView() {
    const camera = this.viewer.camera;
    return {
      position: Cartesian3.clone(camera.position),
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    };
  }

  // Fly to the app's default view (Helsinki-centered globe view)
  flyToDefaultView(duration = 1.5) {
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(24.94, 20, 20000000), // Helsinki longitude, looking at Earth from space
      duration,
    });
  }

  // Helper: Capture camera offset relative to currently tracked entity
  // Returns the viewFrom Cartesian3 that can be used to restore camera position
  captureTrackedEntityCameraOffset() {
    const trackedEntity = this.viewer.trackedEntity;
    if (!trackedEntity) return null;

    const camera = this.viewer.camera;
    const currentTime = this.viewer.clock.currentTime;
    const entityPosition = trackedEntity.position?.getValue(currentTime);
    if (!entityPosition) return null;

    // Calculate vector from entity to camera in world coordinates
    const cameraOffset = Cartesian3.subtract(camera.positionWC, entityPosition, new Cartesian3());
    const range = Cartesian3.magnitude(cameraOffset);

    // Check if entity has an orientation property (satellites have VelocityOrientationProperty)
    const entityOrientation = trackedEntity.orientation?.getValue(currentTime);

    let inverseTransform;
    if (entityOrientation) {
      // Entity has orientation (satellite) - use entity's actual local frame
      // The viewFrom is interpreted in this oriented frame
      const rotationMatrix = Matrix3.fromQuaternion(entityOrientation, new Matrix3());
      const modelMatrix = Matrix4.fromRotationTranslation(rotationMatrix, entityPosition, new Matrix4());
      inverseTransform = Matrix4.inverse(modelMatrix, new Matrix4());
    } else {
      // No orientation (ground station) - use ENU frame at entity position
      const transform = Transforms.eastNorthUpToFixedFrame(entityPosition);
      inverseTransform = Matrix4.inverse(transform, new Matrix4());
    }

    // Transform camera offset to entity's local coordinates
    const localOffset = Matrix4.multiplyByPointAsVector(inverseTransform, cameraOffset, new Cartesian3());

    return {
      viewFrom: Cartesian3.clone(localOffset),
      range: range,
    };
  }

  // Helper: Apply saved camera offset - no longer needed since we use viewFrom
  applyTrackedEntityCameraOffset() {
    // This function is now deprecated - we set viewFrom before tracking instead
  }

  // Helper: Check if currently tracking a ground station
  isTrackingGroundStation() {
    const tracked = this.viewer.trackedEntity;
    return tracked?.name?.includes("Groundstation");
  }

  // Helper: Toggle between GS focus and satellite tracking
  toggleGsSatelliteFocus() {
    // Initialize camera offset storage if not exists
    if (!this._savedCameraOffsets) {
      this._savedCameraOffsets = new Map();
    }

    // Default viewFrom used by entities (matches CesiumComponentCollection.createCesiumEntity)
    const defaultViewFrom = new Cartesian3(0, -3600000, 4200000);

    if (this.isTrackingGroundStation()) {
      // Currently at GS -> save GS camera offset and track last satellite
      const gsEntity = this.viewer.trackedEntity;
      if (gsEntity) {
        const gsOffset = this.captureTrackedEntityCameraOffset();
        if (gsOffset) {
          this._savedCameraOffsets.set("groundstation", gsOffset);
        }
      }

      if (this.sats.lastTrackedSatelliteName) {
        const sat = this.sats.getSatellite(this.sats.lastTrackedSatelliteName);
        if (sat) {
          // Set viewFrom on satellite entity BEFORE tracking if we have a saved offset
          const satOffset = this._savedCameraOffsets.get(this.sats.lastTrackedSatelliteName);
          if (satOffset && sat.defaultEntity) {
            sat.defaultEntity.viewFrom = satOffset.viewFrom;
          }
          sat.track();

          // Reset viewFrom to default after camera is positioned
          // Use timeout to ensure Cesium has used the viewFrom for positioning
          // This ensures other tracking methods (pass clicks, etc.) use default view
          if (satOffset && sat.defaultEntity) {
            const entity = sat.defaultEntity;
            setTimeout(() => {
              entity.viewFrom = defaultViewFrom;
            }, 500);
          }
        }
      }
    } else {
      // Not at GS -> save satellite camera offset and focus GS
      const trackedEntity = this.viewer.trackedEntity;
      if (trackedEntity && this.sats.lastTrackedSatelliteName) {
        const satOffset = this.captureTrackedEntityCameraOffset();
        if (satOffset) {
          this._savedCameraOffsets.set(this.sats.lastTrackedSatelliteName, satOffset);
        }
      }

      this.sats.lastGlobeView = this.captureCurrentView();

      // Set viewFrom on GS entity BEFORE focusing if we have a saved offset
      const gsOffset = this._savedCameraOffsets.get("groundstation");
      const gs = this.sats.groundStations[0];
      if (gsOffset && gs?.defaultEntity) {
        gs.defaultEntity.viewFrom = gsOffset.viewFrom;

        // Reset viewFrom to default after camera is positioned
        // Use timeout to ensure Cesium has used the viewFrom for positioning
        const entity = gs.defaultEntity;
        setTimeout(() => {
          entity.viewFrom = defaultViewFrom;
        }, 500);
      }

      this.sats.focusGroundStation();
    }
  }

  // Helper: Point camera at last tracked satellite (for zenith view)
  pointCameraAtLastSatellite() {
    if (!this.sats?.lastTrackedSatelliteName) return;
    const sat = this.sats.getSatellite(this.sats.lastTrackedSatelliteName);
    if (!sat) return;

    // Get ground station position
    const gs = this.sats.groundStations[0];
    if (!gs) return;
    const gsPos = gs.position;

    // Convert GS to satellite.js format (radians, km)
    const deg2rad = Math.PI / 180;
    const groundStation = {
      latitude: gsPos.latitude * deg2rad,
      longitude: gsPos.longitude * deg2rad,
      height: gsPos.height / 1000,
    };

    // Get satellite ECF position at current time
    const jsDate = JulianDate.toDate(this.viewer.clock.currentTime);
    const positionEcf = sat.props.orbit.positionECF(jsDate);
    if (!positionEcf) return;

    // Calculate look angles using satellite.js
    const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);

    // Clamp elevation to horizon (0°) if satellite is below horizon
    const elevation = Math.max(0, lookAngles.elevation);

    this.viewer.camera.setView({
      orientation: {
        heading: lookAngles.azimuth,
        pitch: elevation,
        roll: 0,
      },
    });
    this.viewer.scene.requestRender();
  }

  setTime(current, start = dayjs.utc(current).subtract(12, "hour").toISOString(), stop = dayjs.utc(current).add(7, "day").toISOString()) {
    // Skip time changes on iOS
    if (DeviceDetect.isIos()) {
      return;
    }
    this.viewer.clock.startTime = JulianDate.fromIso8601(dayjs.utc(start).toISOString());
    this.viewer.clock.stopTime = JulianDate.fromIso8601(dayjs.utc(stop).toISOString());
    this.viewer.clock.currentTime = JulianDate.fromIso8601(dayjs.utc(current).toISOString());
    if (typeof this.viewer.timeline !== "undefined") {
      this.viewer.timeline.updateFromClock();

      // Center the visible timeline window around current time (±12 hours)
      // This makes the current time marker appear in the center of the timeline
      const currentJulian = this.viewer.clock.currentTime;
      const visibleStart = JulianDate.addHours(currentJulian, -12, new JulianDate());
      const visibleStop = JulianDate.addHours(currentJulian, 12, new JulianDate());
      this.viewer.timeline.zoomTo(visibleStart, visibleStop);
    }
  }

  setCurrentTimeOnly(current) {
    // Skip time changes on iOS
    if (DeviceDetect.isIos()) {
      return;
    }
    const newCurrentTime = JulianDate.fromIso8601(dayjs.utc(current).toISOString());
    this.viewer.clock.currentTime = newCurrentTime;

    if (typeof this.viewer.timeline !== "undefined") {
      // Skip recentering while timeline is being scrubbed (mouse button down)
      // Recentering will happen on mouseup
      if (this.isTimelineScrubbing) {
        this.viewer.timeline.updateFromClock();
        return;
      }

      // Get current timeline visible range duration
      const timeline = this.viewer.timeline;
      const currentStart = timeline._startJulian;
      const currentEnd = timeline._endJulian;

      if (currentStart && currentEnd) {
        // Calculate the duration of the current visible range
        const rangeDurationSeconds = JulianDate.secondsDifference(currentEnd, currentStart);
        const halfDuration = rangeDurationSeconds / 2;

        // Center the timeline around the new current time with the same zoom level
        const newStart = JulianDate.addSeconds(newCurrentTime, -halfDuration, new JulianDate());
        const newEnd = JulianDate.addSeconds(newCurrentTime, halfDuration, new JulianDate());

        // Use zoomTo to move the timeline view while maintaining the zoom level
        timeline.zoomTo(newStart, newEnd);
      }

      this.viewer.timeline.updateFromClock();

      // After updating timeline window, refresh pass highlights for the new visible range
      // This ensures highlights are shown for passes in the updated window
      if (this.sats && this.sats.updatePassHighlightsAfterTimelineChange) {
        // Use setTimeout to avoid blocking and ensure timeline update completes first
        setTimeout(() => {
          this.sats.updatePassHighlightsAfterTimelineChange();
        }, 100);
      }
    }
  }

  constrainTimelineBounds() {
    if (!this.viewer.timeline) return;

    // Define safe date bounds (years 1900-2100 to stay well within Cesium's limits)
    const minDate = JulianDate.fromIso8601("1900-01-01T00:00:00Z");
    const maxDate = JulianDate.fromIso8601("2100-12-31T23:59:59Z");

    try {
      const timeline = this.viewer.timeline;

      // Get current timeline bounds
      const currentStart = timeline._startJulian;
      const currentEnd = timeline._endJulian;

      if (currentStart && currentEnd) {
        let needsUpdate = false;
        let newStart = currentStart;
        let newEnd = currentEnd;

        // Check if start time is before minimum allowed date
        if (JulianDate.lessThan(currentStart, minDate)) {
          newStart = JulianDate.clone(minDate);
          needsUpdate = true;
        }

        // Check if end time is after maximum allowed date
        if (JulianDate.greaterThan(currentEnd, maxDate)) {
          newEnd = JulianDate.clone(maxDate);
          needsUpdate = true;
        }

        // Enforce minimum duration (1 hour)
        const minDuration = 3600;
        // Enforce maximum duration (~2 years)
        const maxDuration = 730 * 86400;

        const duration = JulianDate.secondsDifference(newEnd, newStart);
        if (duration > 0 && duration < minDuration) {
          const midpoint = JulianDate.addSeconds(newStart, duration / 2, new JulianDate());
          newStart = JulianDate.addSeconds(midpoint, -minDuration / 2, new JulianDate());
          newEnd = JulianDate.addSeconds(midpoint, minDuration / 2, new JulianDate());
          needsUpdate = true;
        } else if (duration > maxDuration) {
          const midpoint = JulianDate.addSeconds(newStart, duration / 2, new JulianDate());
          newStart = JulianDate.addSeconds(midpoint, -maxDuration / 2, new JulianDate());
          newEnd = JulianDate.addSeconds(midpoint, maxDuration / 2, new JulianDate());
          needsUpdate = true;
        }

        if (needsUpdate) {
          // Ensure the range makes sense (end > start)
          const timeDiff = JulianDate.secondsDifference(newEnd, newStart);
          if (timeDiff <= 0) {
            newStart = JulianDate.clone(minDate);
            newEnd = JulianDate.addDays(newStart, 7, new JulianDate());
          }

          this.viewer.clock.startTime = newStart;
          this.viewer.clock.stopTime = newEnd;
          timeline.zoomTo(newStart, newEnd);
        }
      }
    } catch (error) {
      // If there's any error with bounds checking, reset to a safe default
      console.warn("Timeline bounds error, resetting to safe defaults:", error);
      const safeStart = JulianDate.fromIso8601("2024-01-01T00:00:00Z");
      const safeEnd = JulianDate.addDays(safeStart, 7, new JulianDate());

      this.viewer.clock.startTime = safeStart;
      this.viewer.clock.stopTime = safeEnd;
      this.viewer.clock.currentTime = JulianDate.clone(safeStart);

      if (this.viewer.timeline) {
        this.viewer.timeline.updateFromClock();
        this.viewer.timeline.zoomTo(safeStart, safeEnd);
      }
    }
  }

  createInputHandler() {
    const handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);

    // Track orbit scrubbing state
    let isDraggingSatellite = false;
    let draggedSatellite = null;
    let orbitPositions = [];
    let orbitTimes = [];
    let wasAnimating = false;
    let extendCooldown = 0; // Cooldown counter to prevent immediate re-extension
    let minTimeReached = null; // Track the earliest time we've scrubbed to
    let maxTimeReached = null; // Track the latest time we've scrubbed to
    let currentOrbitNumber = null; // Track which orbit we're currently on
    let lastOrbitJumpTime = null; // Track when we last jumped to a different orbit
    let isFirstScrubbingMove = false; // Track if this is the first mouse move after clicking
    let scrubThrottleTimeout = null; // Timeout for throttling scrub updates

    handler.setInputAction((event) => {
      const { pickMode } = useCesiumStore();
      if (!pickMode) {
        return;
      }
      this.setGroundStationFromClickEvent(event);
    }, ScreenSpaceEventType.LEFT_CLICK);

    // LEFT_DOWN: Start orbit scrubbing if clicking on satellite
    handler.setInputAction((event) => {
      const pickedObject = this.viewer.scene.pick(event.position);
      if (defined(pickedObject) && defined(pickedObject.id)) {
        const entity = pickedObject.id;

        // Check if this is a satellite entity (not ground station)
        if (entity.name && !entity.name.includes("Groundstation")) {
          // Extract satellite name from entity name (format: "SatelliteName - Point")
          const satelliteName = entity.name.split(" - ")[0];
          let satellite = this.sats.getSatellite(satelliteName);

          if (satellite && satellite.props) {
            // Start orbit scrubbing
            isDraggingSatellite = true;
            draggedSatellite = satellite;

            // Pause animation during scrubbing
            wasAnimating = this.viewer.clock.shouldAnimate;
            this.viewer.clock.shouldAnimate = false;

            // Disable camera controls to prevent globe movement during scrubbing
            this.viewer.scene.screenSpaceCameraController.enableRotate = false;
            this.viewer.scene.screenSpaceCameraController.enableZoom = false;
            this.viewer.scene.screenSpaceCameraController.enableLook = false;
            this.viewer.scene.screenSpaceCameraController.enableTilt = false;
            this.viewer.scene.screenSpaceCameraController.enableTranslate = false;

            // Pre-calculate orbit positions and times for multiple orbital periods
            // This allows continuous scrubbing across orbit boundaries
            const currentTime = this.viewer.clock.currentTime;
            const orbitalPeriodMinutes = satellite.props.orbit.orbitalPeriod;
            const orbitalPeriodSeconds = orbitalPeriodMinutes * 60;

            // Increase samples for smoother scrubbing: ~1 sample per 10-20 seconds
            const numSamplesPerOrbit = Math.min(720, Math.max(180, Math.floor(orbitalPeriodMinutes * 3)));

            // Calculate for 5 complete orbits (2.5 before and 2.5 after current time)
            // This allows more extended scrubbing in both directions
            const numOrbits = 5;
            const totalSamples = numSamplesPerOrbit * numOrbits;

            orbitPositions = [];
            orbitTimes = [];

            // Start 2.5 orbits before current time (so current time is at middle of orbit 3)
            const startTime = JulianDate.addSeconds(currentTime, -orbitalPeriodSeconds * 2.5, new JulianDate());

            // Calculate time step between samples for regular spacing
            const timeStep = (orbitalPeriodSeconds * numOrbits) / totalSamples;

            for (let i = 0; i <= totalSamples; i++) {
              const sampleTime = JulianDate.addSeconds(startTime, timeStep * i, new JulianDate());

              // Use computePosition() directly instead of position()
              // The position() function uses a SampledPositionProperty with HOLD extrapolation,
              // which returns cached positions for times outside the sampled range
              const { positionFixed } = satellite.props.computePosition(sampleTime);

              if (positionFixed) {
                orbitPositions.push(positionFixed);
                orbitTimes.push(sampleTime);
              }
            }

            // Initialize current orbit number based on current time
            // This prevents jumping to a different orbit on first mouse move
            const currentTimeElapsed = JulianDate.secondsDifference(currentTime, startTime);
            const currentOrbitsElapsed = currentTimeElapsed / orbitalPeriodSeconds;
            currentOrbitNumber = Math.floor(currentOrbitsElapsed);

            // Set flag to indicate this is the start of scrubbing
            // The first mouse move will lock to the current position
            isFirstScrubbingMove = true;

            // Change cursor to indicate scrubbing mode
            this.viewer.canvas.style.cursor = "ew-resize";
          }
        }
      }
    }, ScreenSpaceEventType.LEFT_DOWN);

    // MOUSE_MOVE: Update time based on orbit position (throttled to 50ms)
    handler.setInputAction((movement) => {
      if (isDraggingSatellite && draggedSatellite && orbitPositions.length > 0) {
        // Clear any pending throttle timeout
        if (scrubThrottleTimeout) {
          clearTimeout(scrubThrottleTimeout);
        }

        // Throttle updates to every 50ms for smoother performance
        scrubThrottleTimeout = setTimeout(() => {
          // Execute the scrubbing logic after 50ms delay
          performOrbitScrub(movement);
        }, 50);
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // Extract scrubbing logic into a separate function for throttling
    const performOrbitScrub = (movement) => {
      if (isDraggingSatellite && draggedSatellite && orbitPositions.length > 0) {
        // On the first mouse move, find the sample closest to the satellite's current position
        // This prevents jumping to the far side of Earth
        if (isFirstScrubbingMove) {
          isFirstScrubbingMove = false;

          // Get the satellite's current position
          const currentTime = this.viewer.clock.currentTime;
          const { positionFixed: currentSatellitePos } = draggedSatellite.props.computePosition(currentTime);

          if (currentSatellitePos) {
            // Find the closest sample to the current satellite position
            let closestDistance = Number.POSITIVE_INFINITY;
            let closestIndex = -1;

            for (let i = 0; i < orbitPositions.length; i++) {
              const orbitPos = orbitPositions[i];
              const distance = Cartesian3.distance(orbitPos, currentSatellitePos);

              if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
              }
            }

            // Update to this position without jumping
            if (closestIndex >= 0) {
              const initialScrubTime = orbitTimes[closestIndex];
              this.viewer.clock.currentTime = JulianDate.clone(initialScrubTime);

              if (this.viewer.timeline) {
                this.viewer.timeline.updateFromClock();
              }

              this.viewer.scene.requestRender();
            }
          }

          return; // Skip normal mouse position processing on first move
        }

        // Get 3D position of mouse in world space
        const ray = this.viewer.camera.getPickRay(movement.endPosition);
        if (!ray) return;

        // Get camera position for visibility check
        const cameraPosition = this.viewer.camera.positionWC;

        // Find closest sample per orbit, then select the orbit with the smallest angular distance
        // This allows reaching orbit 5 even when orbit 4 is closer in absolute terms
        const rayDirection = ray.direction;
        const earthCenter = Cartesian3.ZERO;
        const earthToCamera = Cartesian3.subtract(cameraPosition, earthCenter, new Cartesian3());
        const earthToCameraNormalized = Cartesian3.normalize(earthToCamera, new Cartesian3());

        // Track the closest sample for each orbit number
        const orbitClosestSamples = new Map(); // orbitNumber -> {index, angularDistance}

        // First pass: Calculate orbital period for orbit number identification
        const orbitalPeriodMinutes = draggedSatellite.props.orbit.orbitalPeriod;
        const orbitalPeriodSeconds = orbitalPeriodMinutes * 60;
        const startTime = orbitTimes[0];

        for (let i = 0; i < orbitPositions.length; i++) {
          const orbitPos = orbitPositions[i];

          // Find the direction from Earth center to orbit position
          const earthToOrbit = Cartesian3.subtract(orbitPos, earthCenter, new Cartesian3());
          const earthToOrbitNormalized = Cartesian3.normalize(earthToOrbit, new Cartesian3());

          // Angle between these two directions
          // If angle > threshold degrees, the orbit position is on the far (invisible) hemisphere
          const angleFromCameraDirection = Cartesian3.angleBetween(earthToCameraNormalized, earthToOrbitNormalized);

          // Use 120 degrees as the visibility threshold to catch adjacent orbit tracks
          // LEO satellites at equator have ~25-30° ground track separation, so we need
          // to extend beyond the 90° perpendicular plane to see neighboring orbits
          if (angleFromCameraDirection > CesiumMath.toRadians(120)) {
            continue; // Skip positions on far side of Earth
          }

          // Calculate which orbit this sample belongs to
          const sampleTime = orbitTimes[i];
          const sampleTimeElapsed = JulianDate.secondsDifference(sampleTime, startTime);
          const sampleOrbitsElapsed = sampleTimeElapsed / orbitalPeriodSeconds;
          const orbitNumber = Math.floor(sampleOrbitsElapsed);

          // Calculate angular distance from mouse ray direction to orbit position
          // Direction from camera to orbit position
          const cameraToOrbit = Cartesian3.subtract(orbitPos, cameraPosition, new Cartesian3());
          const cameraToOrbitNormalized = Cartesian3.normalize(cameraToOrbit, new Cartesian3());

          // Angular distance: angle between ray direction and direction to orbit
          const angularDistance = Cartesian3.angleBetween(rayDirection, cameraToOrbitNormalized);

          // Track the closest sample for this orbit
          if (!orbitClosestSamples.has(orbitNumber) || angularDistance < orbitClosestSamples.get(orbitNumber).angularDistance) {
            orbitClosestSamples.set(orbitNumber, {
              index: i,
              angularDistance: angularDistance,
            });
          }
        }

        // Second pass: Find which orbit has the overall smallest angular distance
        // But only allow jumping to adjacent orbits (with a cooldown period)
        let closestAngularDistance = Number.POSITIVE_INFINITY;
        let closestIndex = -1;
        let selectedOrbitNum = -1;

        // currentOrbitNumber should already be set when scrubbing starts
        // If somehow it's not set, initialize to first visible orbit as fallback
        if (currentOrbitNumber === null && orbitClosestSamples.size > 0) {
          currentOrbitNumber = Math.min(...orbitClosestSamples.keys());
        }

        // Orbit jump cooldown: 500ms between jumps (prevents rapid multi-orbit jumps)
        const ORBIT_JUMP_COOLDOWN_MS = 500;
        const now = Date.now();
        const canJumpToNewOrbit = !lastOrbitJumpTime || now - lastOrbitJumpTime > ORBIT_JUMP_COOLDOWN_MS;

        for (const [orbitNum, data] of orbitClosestSamples.entries()) {
          // Only consider this orbit if:
          // 1. It's the current orbit, OR
          // 2. It's an adjacent orbit AND we can jump (cooldown expired)
          const isCurrentOrbit = orbitNum === currentOrbitNumber;
          const isAdjacentOrbit = Math.abs(orbitNum - currentOrbitNumber) === 1;
          const canSelectThisOrbit = isCurrentOrbit || (isAdjacentOrbit && canJumpToNewOrbit);

          if (canSelectThisOrbit && data.angularDistance < closestAngularDistance) {
            closestAngularDistance = data.angularDistance;
            closestIndex = data.index;
            selectedOrbitNum = orbitNum;
          }
        }

        // Only update if we found a valid visible position
        if (closestIndex >= 0 && closestIndex < orbitTimes.length && closestAngularDistance < Number.POSITIVE_INFINITY) {
          // Track orbit changes and update cooldown
          if (currentOrbitNumber !== null && selectedOrbitNum !== currentOrbitNumber) {
            lastOrbitJumpTime = Date.now();
          }
          currentOrbitNumber = selectedOrbitNum;

          // Decrement cooldown counter
          if (extendCooldown > 0) {
            extendCooldown--;
          }

          // Get the current scrub time
          const currentScrubTime = orbitTimes[closestIndex];

          // Update clock time to the selected orbit position
          this.viewer.clock.currentTime = JulianDate.clone(currentScrubTime);

          // Update timeline to reflect new time
          if (this.viewer.timeline) {
            this.viewer.timeline.updateFromClock();
          }

          // Track time range accessed
          if (minTimeReached === null || JulianDate.lessThan(currentScrubTime, minTimeReached)) {
            minTimeReached = JulianDate.clone(currentScrubTime);
          }
          if (maxTimeReached === null || JulianDate.greaterThan(currentScrubTime, maxTimeReached)) {
            maxTimeReached = JulianDate.clone(currentScrubTime);
          }

          // Check if we're approaching time boundaries (within 2.0 orbits of the edge)
          // Use a large threshold since only ~20% of orbit is visible at any time
          // Note: orbitalPeriodMinutes and orbitalPeriodSeconds already declared above
          const arrayStartTime = orbitTimes[0];
          const arrayEndTime = orbitTimes[orbitTimes.length - 1];
          const timeBoundaryThreshold = orbitalPeriodSeconds * 2.0; // 2.0 orbits from edge

          const timeFromStart = JulianDate.secondsDifference(currentScrubTime, arrayStartTime);
          const timeToEnd = JulianDate.secondsDifference(arrayEndTime, currentScrubTime);

          const isNearStartTime = extendCooldown === 0 && timeFromStart < timeBoundaryThreshold;
          const isNearEndTime = extendCooldown === 0 && timeToEnd < timeBoundaryThreshold;

          // Extend sample arrays when approaching time boundaries
          if (isNearStartTime) {
            // Get fresh satellite reference to avoid stale propagator state
            const satelliteName = draggedSatellite.props.name;
            const freshSatellite = this.sats.getSatellite(satelliteName);

            if (!freshSatellite) {
              console.warn(`[Orbit Scrubbing] Could not get fresh satellite reference for ${satelliteName}`);
              return;
            }

            // Prepend 2 more orbits at the beginning
            // Note: orbitalPeriodMinutes and orbitalPeriodSeconds already declared above
            const numSamplesPerOrbit = Math.min(720, Math.max(180, Math.floor(orbitalPeriodMinutes * 3)));
            const orbitsToAdd = 2;
            const samplesToAdd = numSamplesPerOrbit * orbitsToAdd;

            const newPositions = [];
            const newTimes = [];

            // Calculate new samples going backward from current start time
            const currentStartTime = orbitTimes[0];
            const extendStartTime = JulianDate.addSeconds(currentStartTime, -orbitalPeriodSeconds * orbitsToAdd, new JulianDate());

            // Calculate time step between samples
            const timeStep = (orbitalPeriodSeconds * orbitsToAdd) / samplesToAdd;

            for (let i = 0; i <= samplesToAdd; i++) {
              const sampleTime = JulianDate.addSeconds(extendStartTime, timeStep * i, new JulianDate());
              const { positionFixed } = freshSatellite.props.computePosition(sampleTime);

              if (positionFixed) {
                newPositions.push(positionFixed);
                newTimes.push(sampleTime);
              }
            }

            // Prepend new samples (but remove the last one to avoid duplicate at junction)
            newPositions.pop();
            newTimes.pop();
            orbitPositions = newPositions.concat(orbitPositions);
            orbitTimes = newTimes.concat(orbitTimes);

            // Set cooldown to prevent immediate re-extension
            // Use a larger cooldown to ensure user can move through the extended region
            extendCooldown = 50;

            // Update timeline bounds
            if (this.viewer.timeline && orbitTimes.length > 0) {
              const newStart = orbitTimes[0];
              if (JulianDate.lessThan(newStart, this.viewer.clock.startTime)) {
                this.viewer.clock.startTime = JulianDate.clone(newStart);
              }
            }

            // Invalidate ground station pass caches when extending time range
            if (this.sats && this.sats.groundStations) {
              this.sats.groundStations.forEach((gs) => {
                if (gs.invalidatePassCache) {
                  gs.invalidatePassCache();
                }
              });
            }
          }

          if (isNearEndTime) {
            // Get fresh satellite reference to avoid stale propagator state
            const satelliteName = draggedSatellite.props.name;
            const freshSatellite = this.sats.getSatellite(satelliteName);

            if (!freshSatellite) {
              console.warn(`[Orbit Scrubbing] Could not get fresh satellite reference for ${satelliteName}`);
              return;
            }

            // Append 2 more orbits at the end
            // Note: orbitalPeriodMinutes and orbitalPeriodSeconds already declared above
            const numSamplesPerOrbit = Math.min(720, Math.max(180, Math.floor(orbitalPeriodMinutes * 3)));
            const orbitsToAdd = 2;
            const samplesToAdd = numSamplesPerOrbit * orbitsToAdd;

            const newPositions = [];
            const newTimes = [];

            // Calculate new samples going forward from current end time
            const currentEndTime = orbitTimes[orbitTimes.length - 1];

            // Calculate time step between samples
            const timeStep = (orbitalPeriodSeconds * orbitsToAdd) / samplesToAdd;

            for (let i = 1; i <= samplesToAdd; i++) {
              // Start from i=1 to skip duplicate at junction
              const sampleTime = JulianDate.addSeconds(currentEndTime, timeStep * i, new JulianDate());
              const { positionFixed } = freshSatellite.props.computePosition(sampleTime);

              if (positionFixed) {
                newPositions.push(positionFixed);
                newTimes.push(sampleTime);
              }
            }

            // Append new samples
            orbitPositions = orbitPositions.concat(newPositions);
            orbitTimes = orbitTimes.concat(newTimes);

            // Set cooldown to prevent immediate re-extension
            // Use a larger cooldown to ensure user can move through the extended region
            extendCooldown = 50;

            // Update timeline bounds
            if (this.viewer.timeline && orbitTimes.length > 0) {
              const newEnd = orbitTimes[orbitTimes.length - 1];
              if (JulianDate.greaterThan(newEnd, this.viewer.clock.stopTime)) {
                this.viewer.clock.stopTime = JulianDate.clone(newEnd);
              }
            }

            // Invalidate ground station pass caches when extending time range
            if (this.sats && this.sats.groundStations) {
              this.sats.groundStations.forEach((gs) => {
                if (gs.invalidatePassCache) {
                  gs.invalidatePassCache();
                }
              });
            }
          }

          // Request render to show satellite at new position
          this.viewer.scene.requestRender();
        }
      }
    }; // End of performOrbitScrub function

    // LEFT_UP: End orbit scrubbing
    handler.setInputAction(() => {
      if (isDraggingSatellite) {
        isDraggingSatellite = false;
        draggedSatellite = null;
        orbitPositions = [];
        orbitTimes = [];
        currentOrbitNumber = null; // Reset orbit tracking
        lastOrbitJumpTime = null; // Reset jump cooldown
        isFirstScrubbingMove = false; // Reset first move flag

        // Restore animation state
        this.viewer.clock.shouldAnimate = wasAnimating;

        // Apply appropriate camera controls based on current view mode (zenith or normal)
        if (this.sats) {
          this.sats.applyCameraControlsForCurrentMode();
        }

        // Restore cursor
        this.viewer.canvas.style.cursor = "default";

        // Request final render
        this.viewer.scene.requestRender();
      }
    }, ScreenSpaceEventType.LEFT_UP);

    // Right-click handler for individual satellite path mode toggle
    // Cycles through: Plain (off) → Smart Path (colored visibility/lighting)
    // Works independently of global Orbit/Orbit track components
    handler.setInputAction(() => {
      // Get the currently selected satellite
      const selectedEntity = this.viewer.selectedEntity;
      if (!selectedEntity || !selectedEntity.name) {
        return;
      }

      // Find the satellite from the selected entity
      // Entity names follow pattern: "SatelliteName - Point", "SatelliteName - Label", etc.
      const entityName = selectedEntity.name;
      const satelliteName = entityName.split(" - ")[0];

      // Get the satellite object
      const satellite = this.sats.getSatellite(satelliteName);
      if (satellite) {
        // Toggle the path mode (null ↔ Smart Path)
        satellite.cyclePathMode();

        // Request render to update the view
        this.viewer.scene.requestRender();
      }
    }, ScreenSpaceEventType.RIGHT_CLICK);

    // Add keyboard shortcut for debug info during scrubbing
    // Press 'D' key to dump visibility debug info while dragging
    document.addEventListener("keydown", (event) => {
      // Ignore keyboard shortcuts when typing in input fields
      const activeElement = document.activeElement;
      const isTyping = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable);

      // Z key: Flip camera 180° to opposite side of Earth
      if (event.key === "z" || event.key === "Z") {
        if (isTyping) return; // Don't flip camera when typing
        this.flipCameraToOppositeSide();
        return;
      }

      // Cardinal direction shortcuts (N, E, S, W) - only in zenith view
      // Point camera at horizon in the specified direction
      if (this.sats && this.sats.isInZenithView && !isTyping) {
        const cardinalKeys = {
          n: 0, // North
          N: 0,
          e: 90, // East
          E: 90,
          s: 180, // South
          S: 180,
          w: 270, // West
          W: 270,
        };

        if (cardinalKeys[event.key] !== undefined) {
          const heading = CesiumMath.toRadians(cardinalKeys[event.key]);
          this.viewer.camera.setView({
            orientation: {
              heading: heading,
              pitch: CesiumMath.toRadians(20), // 20° above horizon
              roll: 0,
            },
          });
          this.viewer.scene.requestRender();
          return;
        }
      }

      // Spacebar: Toggle between GS and satellite views
      if (event.code === "Space" && !isTyping) {
        event.preventDefault();
        const now = Date.now();
        const isDoubleTap = now - this._lastSpacebarTime < 300;
        this._lastSpacebarTime = now;

        if (this.sats && this.sats.isInZenithView) {
          if (isDoubleTap) {
            // Double tap in zenith: Exit and track satellite
            this.sats.exitZenithView();
            if (this.sats.lastTrackedSatelliteName) {
              const sat = this.sats.getSatellite(this.sats.lastTrackedSatelliteName);
              if (sat) sat.track();
            }
          } else {
            // Single tap in zenith: Point at satellite
            this.pointCameraAtLastSatellite();
          }
        } else {
          // Globe view
          if (!this.sats || !this.sats.groundStationAvailable) {
            // No GS: dispatch event to open GS menu with hint
            window.dispatchEvent(new CustomEvent("requestGsPicker"));
          } else if (isDoubleTap && this.viewer.scene.mode === SceneMode.SCENE3D) {
            // Double tap: Enter zenith view (only in 3D mode)
            this.sats.lastGlobeView = this.captureCurrentView();
            this.sats.zenithViewFromGroundStation();
          } else {
            // Single tap: Toggle GS/satellite focus
            this.toggleGsSatelliteFocus();
          }
        }
        return;
      }

      // Menu keyboard shortcuts (don't trigger when typing in input fields)
      if (!isTyping) {
        // s - Satellite selection menu (only when not shift)
        if (event.key === "s" && !event.shiftKey) {
          window.dispatchEvent(new CustomEvent("openMenu", { detail: "cat" }));
          return;
        }
        // Shift+S - Satellite visuals menu
        if (event.key === "S" && event.shiftKey) {
          window.dispatchEvent(new CustomEvent("openMenu", { detail: "sat" }));
          return;
        }
        // g - Ground station menu (only when not shift)
        if (event.key === "g" && !event.shiftKey) {
          window.dispatchEvent(new CustomEvent("openMenu", { detail: "gs" }));
          return;
        }
        // l - Layers menu (only when not shift)
        if (event.key === "l" && !event.shiftKey) {
          window.dispatchEvent(new CustomEvent("openMenu", { detail: "map" }));
          return;
        }
        // Shift+D - Debug menu
        if (event.key === "D" && event.shiftKey) {
          window.dispatchEvent(new CustomEvent("openMenu", { detail: "dbg" }));
          return;
        }

        // Time jump shortcuts
        // , (comma) - jump backward 1 hour
        if (event.key === ",") {
          event.preventDefault();
          const currentTime = this.viewer.clock.currentTime;
          const newTime = JulianDate.addHours(currentTime, -1, new JulianDate());
          this.viewer.clock.currentTime = newTime;
          return;
        }
        // . (period) - jump forward 1 hour
        if (event.key === ".") {
          event.preventDefault();
          const currentTime = this.viewer.clock.currentTime;
          const newTime = JulianDate.addHours(currentTime, 1, new JulianDate());
          this.viewer.clock.currentTime = newTime;
          return;
        }
        // ; (semicolon) or < - jump backward 24 hours
        if (event.key === ";" || event.key === "<") {
          event.preventDefault();
          const currentTime = this.viewer.clock.currentTime;
          const newTime = JulianDate.addHours(currentTime, -24, new JulianDate());
          this.viewer.clock.currentTime = newTime;
          return;
        }
        // : (colon) or > - jump forward 24 hours
        if (event.key === ":" || event.key === ">") {
          event.preventDefault();
          const currentTime = this.viewer.clock.currentTime;
          const newTime = JulianDate.addHours(currentTime, 24, new JulianDate());
          this.viewer.clock.currentTime = newTime;
          return;
        }
        // t - Set to real time (current time at 1x speed)
        if (event.key === "t") {
          event.preventDefault();
          this.viewer.clock.currentTime = JulianDate.now();
          this.viewer.clock.multiplier = 1;
          this.viewer.clock.shouldAnimate = true;
          return;
        }

        // T (Shift+T) - Track selected entity (camera follows it)
        if (event.key === "T" && event.shiftKey) {
          event.preventDefault();
          const selectedEntity = this.viewer.selectedEntity;
          if (selectedEntity && selectedEntity.name) {
            // Try to find satellite by name
            const satelliteName = selectedEntity.name.split(" - ")[0];
            const satellite = this.sats.getSatellite(satelliteName);
            if (satellite) {
              satellite.track();
              return;
            }
            // If not a satellite, might be a ground station - track directly
            if (selectedEntity.name.includes("Groundstation")) {
              this.viewer.trackedEntity = selectedEntity;
              return;
            }
          }
          return;
        }

        // Number keys 0-9 for time acceleration
        // 1 = 1x, 2 = 2x, 3 = 8x (2^3), 4 = 16x (2^4), ... 0 = 1024x (2^10)
        // Shift+number = negative (reverse time)
        // Use event.code (physical key) instead of event.key (character produced)
        // because Shift+1 produces "!" on US keyboards, not "1"
        const digitCodeMatch = event.code.match(/^Digit([0-9])$/);
        if (digitCodeMatch) {
          event.preventDefault();
          const digit = parseInt(digitCodeMatch[1], 10);
          // digit 0 -> 2^10 = 1024, digit 1 -> 2^0 = 1, digit 2 -> 2^1 = 2, etc.
          const exponent = digit === 0 ? 10 : digit - 1;
          let multiplier = Math.pow(2, exponent);
          // Shift key makes it negative (reverse time)
          if (event.shiftKey) {
            multiplier = -multiplier;
          }
          this.viewer.clock.multiplier = multiplier;
          this.viewer.clock.shouldAnimate = true;
          return;
        }

        // i - Select tracked entity (show info box for camera-tracked satellite/GS)
        if (event.key === "i") {
          event.preventDefault();
          const trackedEntity = this.viewer.trackedEntity;
          if (trackedEntity && trackedEntity !== this.viewer.selectedEntity) {
            this.viewer.selectedEntity = trackedEntity;
          }
          return;
        }

        // o - Toggle orbit track, double-tap for Smart Path on current satellite
        if (event.key === "o") {
          event.preventDefault();
          const doubleTapThreshold = 300; // ms

          if (this._oKeyTimeout) {
            // Double-tap detected: cancel single-tap action and do Smart Path toggle
            clearTimeout(this._oKeyTimeout);
            this._oKeyTimeout = null;

            const selectedEntity = this.viewer.selectedEntity;
            if (selectedEntity && selectedEntity.name) {
              const satelliteName = selectedEntity.name.split(" - ")[0];
              const satellite = this.sats.getSatellite(satelliteName);
              if (satellite) {
                satellite.cyclePathMode();
                this.viewer.scene.requestRender();
              }
            }
          } else {
            // First tap: schedule single-tap action (toggle Orbit)
            this._oKeyTimeout = setTimeout(() => {
              this._oKeyTimeout = null;
              const isEnabled = this.sats.enabledComponents.includes("Orbit");
              if (isEnabled) {
                this.sats.disableComponent("Orbit");
              } else {
                this.sats.enableComponent("Orbit");
              }
              // Update store
              const satStore = useSatStore();
              satStore.enabledComponents = this.sats.enabledComponents;
            }, doubleTapThreshold);
          }
          return;
        }
      }

      // D key: Debug scrubbing info (only when not shift - Shift+D opens debug menu)
      if ((event.key === "d" || event.key === "D") && !event.shiftKey) {
        if (isDraggingSatellite && draggedSatellite && orbitPositions.length > 0) {
          console.log("=== SCRUBBING DEBUG INFO (D key pressed) ===");

          // Calculate visible orbit info
          const cameraPosition = this.viewer.camera.positionWC;
          const visibleOrbits = new Set();
          const orbitSampleCounts = new Map(); // Track samples per orbit
          let minVisibleIndex = Number.POSITIVE_INFINITY;
          let maxVisibleIndex = -1;
          let visibleCount = 0;

          const startTime = orbitTimes[0];
          const orbitalPeriodMinutes = draggedSatellite.props.orbit.orbitalPeriod;
          const orbitalPeriodSeconds = orbitalPeriodMinutes * 60;

          // Also track first and last sample of each orbit for debugging
          const orbitBoundaries = new Map(); // orbit number -> {first: index, last: index}

          for (let i = 0; i < orbitPositions.length; i++) {
            const orbitPos = orbitPositions[i];
            const sampleTime = orbitTimes[i];
            const sampleTimeElapsed = JulianDate.secondsDifference(sampleTime, startTime);
            const sampleOrbitsElapsed = sampleTimeElapsed / orbitalPeriodSeconds;
            const sampleOrbitNumber = Math.floor(sampleOrbitsElapsed);

            // Track orbit boundaries
            if (!orbitBoundaries.has(sampleOrbitNumber)) {
              orbitBoundaries.set(sampleOrbitNumber, { first: i, last: i });
            } else {
              orbitBoundaries.get(sampleOrbitNumber).last = i;
            }

            const earthCenter = Cartesian3.ZERO;
            const earthToOrbit = Cartesian3.subtract(orbitPos, earthCenter, new Cartesian3());
            const earthToOrbitNormalized = Cartesian3.normalize(earthToOrbit, new Cartesian3());
            const earthToCamera = Cartesian3.subtract(cameraPosition, earthCenter, new Cartesian3());
            const earthToCameraNormalized = Cartesian3.normalize(earthToCamera, new Cartesian3());
            const angleFromCameraDirection = Cartesian3.angleBetween(earthToCameraNormalized, earthToOrbitNormalized);

            if (angleFromCameraDirection <= CesiumMath.toRadians(90)) {
              visibleCount++;
              visibleOrbits.add(sampleOrbitNumber + 1);

              // Count samples per orbit
              const orbitKey = sampleOrbitNumber + 1;
              orbitSampleCounts.set(orbitKey, (orbitSampleCounts.get(orbitKey) || 0) + 1);

              minVisibleIndex = Math.min(minVisibleIndex, i);
              maxVisibleIndex = Math.max(maxVisibleIndex, i);
            }
          }

          console.log(`Total array size: ${orbitPositions.length} samples`);
          console.log(`Visible samples: ${visibleCount} (${((visibleCount / orbitPositions.length) * 100).toFixed(1)}%)`);
          console.log(`Visible sample range: ${minVisibleIndex} to ${maxVisibleIndex}`);
          console.log(
            `Visible orbit numbers: ${Array.from(visibleOrbits)
              .sort((a, b) => a - b)
              .join(", ")}`,
          );

          // Show sample count per orbit
          console.log("Visible samples per orbit:");
          Array.from(visibleOrbits)
            .sort((a, b) => a - b)
            .forEach((orbitNum) => {
              const count = orbitSampleCounts.get(orbitNum);
              console.log(`  Orbit ${orbitNum}: ${count} samples`);
            });

          // Show all orbit boundaries to understand the array structure
          console.log("All orbit boundaries in array:");
          Array.from(orbitBoundaries.entries())
            .sort((a, b) => a[0] - b[0])
            .forEach(([orbitNum, bounds]) => {
              const totalSamples = bounds.last - bounds.first + 1;
              console.log(`  Orbit ${orbitNum + 1}: samples ${bounds.first}-${bounds.last} (${totalSamples} total)`);
            });

          // Debug: Check angles for samples at the boundary
          console.log("\nAngle check for samples near visibility boundary:");
          const samplesToCheck = [1055, 1056, 1057, 1058, 1127, 1128, 1129, 1130, 1131, 1132, 1140, 1150, 1160]; // Around the boundary and deeper into orbit 5
          samplesToCheck.forEach((idx) => {
            if (idx < orbitPositions.length) {
              const orbitPos = orbitPositions[idx];
              const earthCenter = Cartesian3.ZERO;
              const earthToOrbit = Cartesian3.subtract(orbitPos, earthCenter, new Cartesian3());
              const earthToOrbitNormalized = Cartesian3.normalize(earthToOrbit, new Cartesian3());
              const earthToCamera = Cartesian3.subtract(cameraPosition, earthCenter, new Cartesian3());
              const earthToCameraNormalized = Cartesian3.normalize(earthToCamera, new Cartesian3());
              const angle = Cartesian3.angleBetween(earthToCameraNormalized, earthToOrbitNormalized);
              const angleDeg = CesiumMath.toDegrees(angle);

              const sampleTime = orbitTimes[idx];
              const sampleTimeElapsed = JulianDate.secondsDifference(sampleTime, startTime);
              const sampleOrbitsElapsed = sampleTimeElapsed / orbitalPeriodSeconds;
              const orbitNum = Math.floor(sampleOrbitsElapsed);

              // Also show the actual 3D position to see if they're identical
              const posStr = `(${orbitPos.x.toFixed(0)}, ${orbitPos.y.toFixed(0)}, ${orbitPos.z.toFixed(0)})`;

              // Show the actual time in ISO format for debugging
              const timeStr = JulianDate.toIso8601(sampleTime);

              console.log(`  Sample ${idx} (Orbit ${orbitNum + 1}): ${angleDeg.toFixed(2)}° ${angleDeg <= 120 ? "✓ visible" : "✗ filtered"} | Pos: ${posStr} | Time: ${timeStr}`);
            }
          });

          console.log(`\nArray time range: ${JulianDate.toIso8601(orbitTimes[0])} to ${JulianDate.toIso8601(orbitTimes[orbitTimes.length - 1])}`);
          console.log("=====================================");
        }
      }
    });
  }

  setGroundStationFromClickEvent(event) {
    const cartesian = this.viewer.camera.pickEllipsoid(event.position);
    const didHitGlobe = defined(cartesian);
    if (didHitGlobe) {
      const coordinates = {};
      const cartographicPosition = Cartographic.fromCartesian(cartesian);
      coordinates.longitude = CesiumMath.toDegrees(cartographicPosition.longitude);
      coordinates.latitude = CesiumMath.toDegrees(cartographicPosition.latitude);
      coordinates.height = CesiumMath.toDegrees(cartographicPosition.height);
      coordinates.cartesian = cartesian;
      this.sats.addGroundStation(coordinates);
      useCesiumStore().pickMode = false;
      // Close the GS menu after placement
      window.dispatchEvent(new CustomEvent("closeGsMenu"));
    }
  }

  setGroundStationFromGeolocation() {
    navigator.geolocation.getCurrentPosition((position) => {
      if (typeof position === "undefined") {
        return;
      }
      const coordinates = {};
      coordinates.longitude = position.coords.longitude;
      coordinates.latitude = position.coords.latitude;
      coordinates.height = position.coords.altitude;
      coordinates.cartesian = Cartesian3.fromDegrees(coordinates.longitude, coordinates.latitude, coordinates.height);
      this.sats.addGroundStation(coordinates, "Geolocation");
    });
  }

  setGroundStationFromLatLon(lat, lon, height = 0) {
    if (!lat || !lon) {
      return;
    }
    const coordinates = {
      longitude: lon,
      latitude: lat,
      height,
    };
    coordinates.longitude = lon;
    coordinates.latitude = lat;
    coordinates.height = height;
    coordinates.cartesian = Cartesian3.fromDegrees(coordinates.longitude, coordinates.latitude, coordinates.height);
    this.sats.addGroundStation(coordinates);
  }

  setGroundStations(groundStations) {
    if (!groundStations && groundStations.length === 0) {
      return;
    }
    const groundStationEntities = [];
    groundStations.forEach((gs) => {
      if (!gs.lat || !gs.lon) {
        return;
      }
      const coordinates = {
        longitude: gs.lon,
        latitude: gs.lat,
        height: 0,
      };
      coordinates.cartesian = Cartesian3.fromDegrees(coordinates.longitude, coordinates.latitude, coordinates.height);
      groundStationEntities.push(this.sats.createGroundstation(coordinates, gs.name));
    });
    this.sats.groundStations = groundStationEntities;
  }

  set showUI(enabled) {
    if (enabled) {
      this.viewer._animation.container.style.visibility = "";
      this.viewer._timeline.container.style.visibility = "";
      this.viewer._fullscreenButton._container.style.visibility = "";
      this.viewer._vrButton._container.style.visibility = "";
      this.viewer._bottomContainer.style.left = this.oldBottomContainerStyleLeft;
      this.viewer._bottomContainer.style.bottom = "30px";
    } else {
      this.viewer._animation.container.style.visibility = "hidden";
      this.viewer._timeline.container.style.visibility = "hidden";
      this.viewer._fullscreenButton._container.style.visibility = "hidden";
      this.viewer._vrButton._container.style.visibility = "hidden";
      this.oldBottomContainerStyleLeft = this.viewer._bottomContainer.style.left;
      this.viewer._bottomContainer.style.left = "5px";
      this.viewer._bottomContainer.style.bottom = "0px";
    }
  }

  get showUI() {
    return this.viewer._timeline.container.style.visibility !== "hidden";
  }

  fixLogo() {
    if (this.minimalUI) {
      this.viewer._bottomContainer.style.left = "5px";
    }
    if (DeviceDetect.isiPhoneWithNotchVisible()) {
      this.viewer._bottomContainer.style.bottom = "20px";
    }
  }

  set qualityPreset(quality) {
    switch (quality) {
      case "low":
        // Ignore browser's device pixel ratio and use CSS pixels instead of device pixels for render resolution
        this.viewer.useBrowserRecommendedResolution = true;
        break;
      case "high":
        // Use browser's device pixel ratio for render resolution
        this.viewer.useBrowserRecommendedResolution = false;
        break;
      default:
        console.error("Unknown quality preset");
    }
  }

  set showFps(value) {
    cc.viewer.scene.debugShowFramesPerSecond = value;
  }

  set background(active) {
    if (!active) {
      // Store current sky box before clearing so it can be restored
      this._savedSkyBox = this.viewer.scene.skyBox;
      this.viewer.scene.backgroundColor = Color.TRANSPARENT;
      this.viewer.scene.moon = undefined;
      this.viewer.scene.skyAtmosphere = undefined;
      this.viewer.scene.skyBox = undefined;
      this.viewer.scene.sun = undefined;
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      document.getElementById("cesiumContainer").style.background = "transparent";
    } else if (this._savedSkyBox) {
      // Restore previously saved sky box
      this.viewer.scene.skyBox = this._savedSkyBox;
      this._savedSkyBox = null;
    }
  }

  enablePerformanceStats(logContinuously = false) {
    this.performanceStats = new CesiumPerformanceStats(this.viewer.scene, logContinuously);
  }

  addErrorHandler() {
    // Rethrow scene render errors
    this.viewer.scene.rethrowRenderErrors = true;
    this.viewer.scene.renderError.addEventListener((scene, error) => {
      console.error(scene, error);
      Sentry.captureException(error);
    });

    // Proxy and log CesiumWidget render loop errors that only display a UI error message
    const widget = this.viewer.cesiumWidget;
    const proxied = widget.showErrorPanel;
    widget.showErrorPanel = function widgetError(title, message, error) {
      proxied.apply(this, [title, message, error]);
      Sentry.captureException(error);
    };
  }

  styleInfoBox() {
    const infoBox = this.viewer.infoBox.container.getElementsByClassName("cesium-infoBox")[0];
    const close = this.viewer.infoBox.container.getElementsByClassName("cesium-infoBox-close")[0];
    if (infoBox && close) {
      // Container for additional buttons
      const container = document.createElement("div");
      container.setAttribute("class", "cesium-infoBox-container");
      infoBox.insertBefore(container, close);

      // Find when satellite crosses horizon (0° elevation) before pass.start
      const findHorizonCrossing = (pass) => {
        const satellite = this.sats.getSatellite(pass.name);
        if (!satellite || !satellite.props.orbit) {
          return pass.start; // Fallback to pass.start
        }

        const gs = this.sats.groundStations[0];
        if (!gs) {
          return pass.start;
        }

        const deg2rad = Math.PI / 180;
        const groundStation = {
          latitude: gs.position.latitude * deg2rad,
          longitude: gs.position.longitude * deg2rad,
          height: (gs.position.height || 0) / 1000,
        };

        // Search backwards from pass.start in 5-second steps to find horizon crossing
        const searchDate = new Date(pass.start);
        const minSearchDate = new Date(pass.start - 10 * 60 * 1000); // Max 10 min before

        while (searchDate > minSearchDate) {
          searchDate.setSeconds(searchDate.getSeconds() - 5);
          const position = satellite.props.orbit.positionECF(searchDate);
          if (!position) continue;

          const positionEcf = {
            x: position.x / 1000,
            y: position.y / 1000,
            z: position.z / 1000,
          };
          const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);
          const elevation = lookAngles.elevation / deg2rad;

          if (elevation <= 0) {
            // Found horizon crossing, return next step (just above horizon)
            return searchDate.getTime() + 5000;
          }
        }

        return pass.start; // Fallback if not found
      };

      const notifyForPass = (pass, aheadMin = 5) => {
        const horizonTime = findHorizonCrossing(pass);
        const horizonStart = dayjs(horizonTime).startOf("second");
        const passStart = dayjs(pass.start).startOf("second");

        this.pm.notifyAtDate(horizonStart.subtract(aheadMin, "minute"), `${pass.name} pass in ${aheadMin} minutes`);
        this.pm.notifyAtDate(horizonStart, `${pass.name} rising over horizon`);
        this.pm.notifyAtDate(passStart, `${pass.name} above 5° elevation`);
        // this.pm.notifyAtDate(dayjs().add(5, "second"), `${pass.name} notification test`);
      };

      // Notify button
      const notifyButton = document.createElement("button");
      notifyButton.setAttribute("type", "button");
      notifyButton.setAttribute("class", "cesium-button cesium-infoBox-custom");
      notifyButton.innerHTML = icon(faBell).html;
      notifyButton.addEventListener("click", () => {
        let passes = [];
        const toast = useToastProxy();
        if (!this.sats.groundStationAvailable) {
          toast.add({
            severity: "warn",
            summary: "Warning",
            detail: "Ground station required to notify for passes",
            life: 3000,
          });
          return;
        }
        const selectedGroundstation = this.sats.groundStations.find((gs) => gs.isSelected);
        if (this.sats.selectedSatellite) {
          passes = this.sats.getSatellite(this.sats.selectedSatellite).props.passes;
        } else if (selectedGroundstation) {
          passes = selectedGroundstation.passes(this.viewer.clock.currentTime);
        }
        if (!passes) {
          toast.add({
            severity: "info",
            summary: "Info",
            detail: `No passes available`,
            life: 3000,
          });
          return;
        }
        passes.forEach((pass) => notifyForPass(pass));
        toast.add({
          severity: "success",
          summary: "Success",
          detail: `Notifying for ${passes.length} passes`,
          life: 3000,
        });
      });
      container.appendChild(notifyButton);

      // Info button
      const infoButton = document.createElement("button");
      infoButton.setAttribute("type", "button");
      infoButton.setAttribute("class", "cesium-button cesium-infoBox-custom");
      infoButton.innerHTML = icon(faInfo).html;
      infoButton.addEventListener("click", () => {
        if (!this.sats.selectedSatellite) {
          return;
        }
        const { satnum } = this.sats.getSatellite(this.sats.selectedSatellite).props;
        const url = `https://www.n2yo.com/satellite/?s=${satnum}`;
        window.open(url, "_blank", "noopener");
      });
      container.appendChild(infoButton);
    }

    const { frame } = this.viewer.infoBox;
    frame.addEventListener(
      "load",
      () => {
        // Inline infobox css as iframe does not use service worker
        const { head } = frame.contentDocument;
        const links = head.getElementsByTagName("link");
        [...links].forEach((link) => {
          head.removeChild(link);
        });
        const style = frame.contentDocument.createElement("style");
        const node = document.createTextNode(infoBoxCss + "\n" + infoBoxOverrideCss);
        style.appendChild(node);
        head.appendChild(style);

        // Disable spacebar navigation in infoBox - let spacebar trigger global GS/Sat toggle
        frame.contentDocument.addEventListener("keydown", (event) => {
          if (event.code === "Space") {
            event.preventDefault();
            // Trigger the global spacebar handler in the parent window
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
          }
        });
      },
      false,
    );

    // Allow js in infobox
    frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-forms allow-scripts");
    frame.setAttribute("allowTransparency", "true");
    frame.src = "about:blank";

    // Allow time changes and satellite tracking from infobox pass clicks
    window.addEventListener("message", (e) => {
      const data = e.data;

      // Handle "Load More Passes" button click
      if (data.action === "loadMorePasses") {
        // Increment the loaded batch count for this entity
        // This persists across re-renders so the passes stay visible
        DescriptionHelper.incrementLoadedBatches(data.entityId);

        // Also show the batch immediately in the current DOM
        const frameDoc = frame.contentDocument;
        if (frameDoc) {
          const hiddenBatches = frameDoc.querySelectorAll('.passes-batch[style*="display: none"]');
          if (hiddenBatches.length > 0) {
            hiddenBatches[0].style.display = "block";

            // Update button text
            const btn = frameDoc.getElementById("load-more-passes");
            const remainingBatches = hiddenBatches.length - 1;
            if (btn) {
              if (remainingBatches > 0) {
                const remainingPasses = remainingBatches * data.batchSize;
                btn.textContent = `Load ${Math.min(data.batchSize, remainingPasses)} more (${remainingPasses} remaining)`;
              } else {
                btn.style.display = "none";
              }
            }
          }
        }
        return;
      }

      // Handle brightness calculation actions
      if (data.action === "calculateBrightness") {
        const gs = this.sats?.groundStations?.[0];
        if (gs) {
          gs.calculateBrightness();
        }
        return;
      }

      if (data.action === "cancelBrightnessCalculation") {
        const gs = this.sats?.groundStations?.[0];
        if (gs) {
          gs.cancelBrightnessCalculation();
        }
        return;
      }

      if (data.action === "brightnessFilterChange") {
        const gs = this.sats?.groundStations?.[0];
        if (gs && gs._brightPassesState) {
          gs._brightPassesState.filters[data.filter] = data.value;
          gs.refreshDescription();
        }
        return;
      }

      const pass = data;
      if ("start" in pass) {
        // Set time to pass start without changing timeline zoom
        this.setCurrentTimeOnly(pass.start);

        // Show highlights for all passes of this satellite
        const satelliteName = pass.satelliteName || pass.name;
        if (satelliteName && this.sats) {
          // Find the satellite object
          const satellite = this.sats.getSatellite(satelliteName);
          if (satellite) {
            // If this satellite has Smart Path mode enabled, regenerate the path for the new time
            // This preserves the Smart Path toggle state while updating the visualization for the selected pass
            if (satellite.individualOrbitMode === "Smart Path") {
              satellite.regenerateSmartPath();
            }

            // Update passes for this satellite and show all its pass highlights
            satellite.props
              .updatePasses(this.viewer.clock.currentTime)
              .then(() => {
                CesiumTimelineHelper.clearHighlightRanges(this.viewer);
                CesiumTimelineHelper.addHighlightRanges(this.viewer, satellite.props.passes, satelliteName);
              })
              .catch((err) => {
                console.warn("Failed to update passes for pass click:", err);
              });
          } else {
            // Fallback to showing just the clicked pass if satellite not found
            CesiumTimelineHelper.clearHighlightRanges(this.viewer);
            CesiumTimelineHelper.addHighlightRanges(this.viewer, [pass], satelliteName);
          }
        } else {
          // Fallback to showing just the clicked pass
          CesiumTimelineHelper.clearHighlightRanges(this.viewer);
          CesiumTimelineHelper.addHighlightRanges(this.viewer, [pass], pass.satelliteName || pass.name);
        }

        // Track or point at the satellite for this pass
        if (pass.satelliteName || pass.name) {
          const satelliteName = pass.satelliteName || pass.name;

          try {
            // Find the satellite entity with proper error handling
            const entities = this.viewer.entities.values;

            // Ensure entities is actually an array
            if (!Array.isArray(entities)) {
              console.warn("Entities collection is not an array, skipping satellite tracking");
              return;
            }

            // Try different naming patterns to find the satellite entity
            let satelliteEntity = entities.find((entity) => entity && entity.name && entity.name.includes(satelliteName) && entity.name.includes("Point"));

            // If not found with "Point", try just the satellite name
            if (!satelliteEntity) {
              satelliteEntity = entities.find((entity) => entity && entity.name && entity.name === satelliteName);
            }

            // If still not found, try partial match
            if (!satelliteEntity) {
              satelliteEntity = entities.find((entity) => entity && entity.name && entity.name.includes(satelliteName));
            }

            if (satelliteEntity) {
              // Check if we're in zenith view
              const isInZenithView = this.sats && this.sats.isInZenithView;

              if (isInZenithView) {
                // In zenith view: point camera at satellite without moving position, and select it
                // Use a small delay to ensure satellite position is calculated at the new time
                setTimeout(() => {
                  const satellitePosition = satelliteEntity.position.getValue(this.viewer.clock.currentTime);
                  if (satellitePosition) {
                    const cameraPosition = this.viewer.camera.positionWC;
                    const direction = Cartesian3.subtract(satellitePosition, cameraPosition, new Cartesian3());
                    Cartesian3.normalize(direction, direction);
                    this.viewer.camera.direction = direction;
                    // Select the satellite to show its info
                    this.viewer.selectedEntity = satelliteEntity;
                    // Request render to update the view
                    this.viewer.scene.requestRender();
                  }
                }, 100);
              } else {
                // Normal mode: track the satellite
                this.viewer.trackedEntity = null;

                // Also try to select satellite through satellite manager
                if (this.sats) {
                  try {
                    this.sats.trackedSatellite = satelliteName;
                  } catch (error) {
                    console.warn("Could not use satellite manager:", error);
                  }
                }

                // Set tracking with delay
                setTimeout(() => {
                  this.viewer.trackedEntity = satelliteEntity;
                }, 100);
              }
            }
          } catch (error) {
            console.error("Error while tracking satellite:", error);
          }
        }
      }
    });
  }

  setupClockTimeJumpListener() {
    // Listen for time discontinuities detected by ClockMonitor
    // When time jumps, update timeline window while preserving zoom level
    // Note: SatelliteManager already listens for this event and triggers pass highlight updates
    window.addEventListener("cesium:clockTimeJumped", (event) => {
      const { newTime } = event.detail;

      // Update timeline window to center around the new time while preserving zoom level
      const newTimeDate = JulianDate.toDate(newTime);
      this.setCurrentTimeOnly(newTimeDate.toISOString());
    });
  }

  setupTimelineResetOnNow() {
    if (!this.viewer.timeline || !this.viewer.animation) {
      return;
    }

    // Monitor clock changes to detect when current time is set to "now"
    let lastCurrentTime = this.viewer.clock.currentTime;

    this.viewer.clock.onTick.addEventListener(() => {
      const currentTime = this.viewer.clock.currentTime;
      const now = JulianDate.now();

      // Check if the current time was just set to very close to "now" (within 1 second)
      // This typically happens when the real-time/today button is clicked
      const timeDifference = Math.abs(JulianDate.secondsDifference(currentTime, now));
      const lastTimeDifference = Math.abs(JulianDate.secondsDifference(lastCurrentTime, now));

      // If current time just jumped to be very close to "now" (and wasn't close before)
      if (timeDifference < 1 && lastTimeDifference > 60) {
        // Move timeline to show current time while preserving zoom level
        this.setCurrentTimeOnly(JulianDate.toDate(currentTime));
      }

      lastCurrentTime = JulianDate.clone(currentTime);
    });
  }

  setupLocalTimeFormatting() {
    if (!this.viewer.timeline || !this.viewer.animation) {
      return;
    }

    // Store original makeLabel function and its context for timeline
    const timeline = this.viewer.timeline;
    const originalTimelineMakeLabel = timeline.makeLabel.bind(timeline);

    // Override timeline makeLabel to support local time
    this.viewer.timeline.makeLabel = function (time) {
      try {
        // Get store lazily - Pinia may not be initialized when CesiumController is created
        const satStore = useSatStore();
        if (satStore && satStore.useLocalTime && satStore.groundStations.length > 0) {
          // Get first ground station position for timezone
          const groundStationPosition = {
            latitude: satStore.groundStations[0].lat,
            longitude: satStore.groundStations[0].lon,
          };

          // Format in ground station's local time
          const date = JulianDate.toDate(time);
          const timezone = TimeFormatHelper.getTimezoneFromCoordinates(groundStationPosition.latitude, groundStationPosition.longitude);

          const tzOffset = TimeFormatHelper.getTimezoneOffset(timezone, date);

          // Format in DD.MM HH:MM:SS format for timeline
          const formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });

          const formatted = formatter.format(date);
          // Format is "DD/MM/YYYY, HH:MM:SS" - convert to "DD.MM HH:MM:SS"
          const parts = formatted.split(", ");
          const datePart = parts[0].substring(0, 5).replace("/", "."); // Get DD.MM only
          const timePart = parts[1];
          return `${datePart} ${timePart} ${tzOffset}`;
        }
      } catch {
        // Pinia store not ready yet or error accessing it, fall back to UTC
      }

      // Use original UTC formatting with proper context
      return originalTimelineMakeLabel(time);
    };

    // Store original animation time formatter
    const animation = this.viewer.animation;
    const originalAnimationTimeFormatter = animation.viewModel.timeFormatter;

    // Store original animation date formatter
    const originalAnimationDateFormatter = animation.viewModel.dateFormatter;

    // Override animation date formatter to support local time
    animation.viewModel.dateFormatter = function (date, viewModel) {
      try {
        // Get store lazily - Pinia may not be initialized when CesiumController is created
        const satStore = useSatStore();
        if (satStore && satStore.useLocalTime && satStore.groundStations && satStore.groundStations.length > 0) {
          // Convert to JavaScript Date if needed
          const jsDate = date instanceof Date ? date : new Date(date);

          // Get first ground station position for timezone
          const groundStationPosition = {
            latitude: satStore.groundStations[0].lat,
            longitude: satStore.groundStations[0].lon,
          };

          // Format in ground station's local time
          const timezone = TimeFormatHelper.getTimezoneFromCoordinates(groundStationPosition.latitude, groundStationPosition.longitude);

          // Format in MMM DD YYYY format (without timezone, that goes with time)
          const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            month: "short",
            day: "2-digit",
            year: "numeric",
          });

          return formatter.format(jsDate);
        }
      } catch {
        // Pinia store not ready yet or error accessing it, fall back to UTC
      }

      // Use original UTC formatting
      return originalAnimationDateFormatter(date, viewModel);
    };

    // Override animation time formatter to support local time
    animation.viewModel.timeFormatter = function (date, viewModel) {
      try {
        // Get store lazily - Pinia may not be initialized when CesiumController is created
        const satStore = useSatStore();
        if (satStore && satStore.useLocalTime && satStore.groundStations && satStore.groundStations.length > 0) {
          // Convert to JavaScript Date if needed (Cesium may pass JulianDate or other formats)
          const jsDate = date instanceof Date ? date : new Date(date);

          // Get first ground station position for timezone
          const groundStationPosition = {
            latitude: satStore.groundStations[0].lat,
            longitude: satStore.groundStations[0].lon,
          };

          // Format in ground station's local time
          const timezone = TimeFormatHelper.getTimezoneFromCoordinates(groundStationPosition.latitude, groundStationPosition.longitude);

          const tzOffset = TimeFormatHelper.getTimezoneOffset(timezone, jsDate);

          // Format in HH:MM:SS UTC+x format
          const formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });

          return `${formatter.format(jsDate)} ${tzOffset}`;
        }
      } catch {
        // Pinia store not ready yet or error accessing it, fall back to UTC
      }

      // Use original UTC formatting
      return originalAnimationTimeFormatter(date, viewModel);
    };

    // Update timeline when local time setting changes
    this.viewer.timeline.updateFromClock();
  }

  setupGroundStationSelectionListener() {
    // Listen for entity selection changes to show timeline highlights when ground station is selected
    let lastSelectedEntity = null;

    // Use selectedEntityChanged event to detect selection changes
    this.viewer.selectedEntityChanged.addEventListener(() => {
      const selectedEntity = this.viewer.selectedEntity;

      // Deselect non-selectable entities (e.g., Smart Path polylines)
      if (selectedEntity && selectedEntity._nonSelectable) {
        this.viewer.selectedEntity = undefined;
        return;
      }

      // Only process if selection actually changed
      if (selectedEntity === lastSelectedEntity) {
        return;
      }
      lastSelectedEntity = selectedEntity;

      // Check if the selected entity is a ground station
      if (selectedEntity && selectedEntity.name && selectedEntity.name.includes("Groundstation")) {
        // Find the ground station in the satellite manager
        // Match by entity name since the entity may be recreated with a different ID
        // when description is refreshed or during HMR (Hot Module Reload)
        const groundStation = this.sats.groundStations.find((gs) => gs.components?.Groundstation?.name === selectedEntity.name);

        if (groundStation) {
          // Get all passes for enabled satellites at this ground station
          const currentTime = this.viewer.clock.currentTime;

          // Clear existing satellite pass highlights
          CesiumTimelineHelper.clearHighlightRanges(this.viewer);

          // Add highlights for all passes of all enabled satellites
          const activeSatellites = this.sats.activeSatellites;

          // Use activeSatellites to include satellites enabled by tags
          const passPromises = activeSatellites.map((satellite) => {
            if (satellite && satellite.props) {
              return satellite.props
                .updatePasses(currentTime)
                .then(() => {
                  // Filter passes based on time and user preferences (sunlight/eclipse filters)
                  const filteredPasses = filterAndSortPasses(satellite.props.passes, JulianDate.toDate(currentTime));
                  if (filteredPasses && filteredPasses.length > 0) {
                    CesiumTimelineHelper.addHighlightRanges(this.viewer, filteredPasses, satellite.props.name);
                  }
                })
                .catch((err) => {
                  console.warn(`[GS Selection] Failed to update passes for ${satellite.props.name}:`, err);
                });
            }
            return Promise.resolve();
          });

          Promise.all(passPromises).then(() => {
            // Force an immediate timeline update after all passes are loaded
            // This ensures highlights show on first ground station selection
            if (this.viewer.timeline) {
              this.viewer.timeline.updateFromClock();
              if (this.viewer.timeline._makeTics) {
                this.viewer.timeline._makeTics();
              }
            }
          });
        }
      }
    });
  }
}
