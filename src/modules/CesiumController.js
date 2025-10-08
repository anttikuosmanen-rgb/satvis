import {
  ArcGisMapServerImageryProvider,
  ArcGISTiledElevationTerrainProvider,
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

import { useCesiumStore } from "../stores/cesium";
import infoBoxOverrideCss from "../css/infobox.css?raw";
import { useToastProxy } from "../composables/useToastProxy";
import { DeviceDetect } from "./util/DeviceDetect";
import { PushManager } from "./util/PushManager";
import { CesiumPerformanceStats } from "./util/CesiumPerformanceStats";
import { SatelliteManager } from "./SatelliteManager";

dayjs.extend(utc);

export class CesiumController {
  constructor() {
    this.initConstants();
    this.preloadReferenceFrameData();
    this.minimalUI = DeviceDetect.inIframe() || DeviceDetect.isIos();

    this.viewer = new Viewer("cesiumContainer", {
      animation: !this.minimalUI,
      baseLayer: this.createImageryLayer("OfflineHighres"),
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
    // Comment out requestRenderMode temporarily to see if it's interfering
    // this.viewer.scene.requestRenderMode = true;

    // Cesium Performance Tools
    // this.viewer.scene.debugShowFramesPerSecond = true;
    // this.FrameRateMonitor = FrameRateMonitor.fromScene(this.viewer.scene);
    // this.viewer.scene.postRender.addEventListener((scene) => {
    //   console.log(this.FrameRateMonitor.lastFramesPerSecond)
    // });
    // this.performanceStats = new CesiumPerformanceStats(this.viewer.scene, true);

    // Export CesiumController for debugger
    window.cc = this;

    // CesiumController config
    this.sceneModes = ["3D", "2D", "Columbus"];
    this.cameraModes = ["Fixed", "Inertial"];

    this.createInputHandler();
    this.addErrorHandler();
    this.styleInfoBox();

    // Create Satellite Manager
    this.sats = new SatelliteManager(this.viewer);

    // Add event listener to detect when time is set to "now" (today/real-time button)
    this.setupTimelineResetOnNow();

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

  set sceneMode(sceneMode) {
    if (sceneMode === "3D") {
      this.viewer.scene.morphTo3D();
      return;
    }
    if (this.sats.enabledComponents.includes("Orbit")) {
      useToastProxy().add({
        severity: "warn",
        summary: "Warning",
        detail: "Disable the Orbit satellite element for 2D mode",
        life: 3000,
      });
      return;
    }
    if (sceneMode === "2D") {
      this.viewer.scene.morphTo2D();
      return;
    }
    if (sceneMode === "Columbus") {
      this.viewer.scene.morphToColumbusView();
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

  setTime(current, start = dayjs.utc(current).subtract(12, "hour").toISOString(), stop = dayjs.utc(current).add(7, "day").toISOString()) {
    this.viewer.clock.startTime = JulianDate.fromIso8601(dayjs.utc(start).toISOString());
    this.viewer.clock.stopTime = JulianDate.fromIso8601(dayjs.utc(stop).toISOString());
    this.viewer.clock.currentTime = JulianDate.fromIso8601(dayjs.utc(current).toISOString());
    if (typeof this.viewer.timeline !== "undefined") {
      this.viewer.timeline.updateFromClock();
      this.viewer.timeline.zoomTo(this.viewer.clock.startTime, this.viewer.clock.stopTime);
    }
  }

  constrainTimelineBounds() {
    if (!this.viewer.timeline) return;

    // Define safe date bounds (years 1900-2100 to stay well within Cesium's limits)
    const minDate = JulianDate.fromIso8601('1900-01-01T00:00:00Z');
    const maxDate = JulianDate.fromIso8601('2100-12-31T23:59:59Z');

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

        // If bounds need updating, safely update them
        if (needsUpdate) {
          // Ensure the range makes sense (end > start)
          const timeDiff = JulianDate.secondsDifference(newEnd, newStart);
          if (timeDiff <= 0) {
            // If the range is invalid, create a default 7-day range
            newStart = JulianDate.clone(minDate);
            newEnd = JulianDate.addDays(newStart, 7, new JulianDate());
          }

          // Update clock bounds
          this.viewer.clock.startTime = newStart;
          this.viewer.clock.stopTime = newEnd;

          // Update timeline to reflect new bounds
          timeline.zoomTo(newStart, newEnd);
        }
      }
    } catch (error) {
      // If there's any error with bounds checking, reset to a safe default
      console.warn('Timeline bounds error, resetting to safe defaults:', error);
      const safeStart = JulianDate.fromIso8601('2024-01-01T00:00:00Z');
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
    handler.setInputAction((event) => {
      const { pickMode } = useCesiumStore();
      if (!pickMode) {
        return;
      }
      this.setGroundStationFromClickEvent(event);
    }, ScreenSpaceEventType.LEFT_CLICK);
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
      this.viewer.scene.backgroundColor = Color.TRANSPARENT;
      this.viewer.scene.moon = undefined;
      this.viewer.scene.skyAtmosphere = undefined;
      this.viewer.scene.skyBox = undefined;
      this.viewer.scene.sun = undefined;
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      document.getElementById("cesiumContainer").style.background = "transparent";
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

      const notifyForPass = (pass, aheadMin = 5) => {
        const start = dayjs(pass.start).startOf("second");
        this.pm.notifyAtDate(start.subtract(aheadMin, "minute"), `${pass.name} pass in ${aheadMin} minutes`);
        this.pm.notifyAtDate(start, `${pass.name} pass starting now`);
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
      },
      false,
    );

    // Allow js in infobox
    frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-forms allow-scripts");
    frame.setAttribute("allowTransparency", "true");
    frame.src = "about:blank";

    // Allow time changes and satellite tracking from infobox pass clicks
    window.addEventListener("message", (e) => {
      const pass = e.data;
      if ("start" in pass) {
        console.log("Ground station pass clicked:", pass);

        // Set time to pass start
        this.setTime(pass.start);

        // Track the satellite for this pass
        if (pass.satelliteName || pass.name) {
          const satelliteName = pass.satelliteName || pass.name;
          console.log(`Attempting to track satellite: ${satelliteName}`);

          try {
            // Find the satellite entity with proper error handling
            const entities = this.viewer.entities.values;

            // Ensure entities is actually an array
            if (!Array.isArray(entities)) {
              console.warn('Entities collection is not an array, skipping satellite tracking');
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
              console.log(`Found satellite entity: ${satelliteEntity.name}`);

              // Clear existing tracking but keep selection to maintain highlights
              this.viewer.trackedEntity = null;

              // Also try to select satellite through satellite manager
              if (this.sats) {
                try {
                  console.log(`Tracking satellite through manager: ${satelliteName}`);
                  this.sats.trackedSatellite = satelliteName;
                } catch (error) {
                  console.warn("Could not use satellite manager:", error);
                }
              }

              // Set tracking with delay
              setTimeout(() => {
                this.viewer.trackedEntity = satelliteEntity;
                console.log(`Now tracking satellite: ${satelliteEntity.name} for pass`);
              }, 100);
            } else {
              console.warn(`Could not find satellite entity for: ${satelliteName}`);
              console.log("Available entities:", entities.map((entity) => entity.name).filter((n) => n));
            }
          } catch (error) {
            console.error('Error while tracking satellite:', error);
          }
        }
      }
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
        // Reset timeline zoom to show default range (12 hours before to 7 days after current time)
        const start = dayjs.utc(JulianDate.toDate(currentTime)).subtract(12, "hour").toISOString();
        const stop = dayjs.utc(JulianDate.toDate(currentTime)).add(7, "day").toISOString();

        this.setTime(JulianDate.toDate(currentTime), start, stop);
      }

      lastCurrentTime = JulianDate.clone(currentTime);
    });
  }
}
