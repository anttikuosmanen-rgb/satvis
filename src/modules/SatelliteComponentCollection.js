import {
  ArcType,
  BoxGraphics,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  DistanceDisplayCondition,
  EllipseGraphics,
  Entity,
  GeometryInstance,
  HeadingPitchRoll,
  HeightReference,
  HorizontalOrigin,
  JulianDate,
  LabelGraphics,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  ModelGraphics,
  NearFarScalar,
  PathGraphics,
  PointGraphics,
  PolylineColorAppearance,
  PolylineGeometry,
  PolylineGlowMaterialProperty,
  PolylineGraphics,
  Primitive,
  SceneMode,
  Transforms,
  VelocityOrientationProperty,
  defined,
} from "@cesium/engine";
import CesiumSensorVolumes from "cesium-sensor-volumes";
import * as satellitejs from "satellite.js";

import { SatelliteProperties } from "./SatelliteProperties";
import { CesiumComponentCollection } from "./util/CesiumComponentCollection";
import { CesiumTimelineHelper } from "./util/CesiumTimelineHelper";
import { DescriptionHelper } from "./util/DescriptionHelper";
import { CesiumCallbackHelper } from "./util/CesiumCallbackHelper";
import { filterAndSortPasses } from "./util/PassFilter";
import { VisibilityCulling } from "./util/VisibilityCulling";

export class SatelliteComponentCollection extends CesiumComponentCollection {
  constructor(viewer, tle, tags) {
    super(viewer);
    this.props = new SatelliteProperties(tle, tags);
    this.eventListeners = {};
    // Track individual path mode: null (off), "Smart Path" (colored visibility/lighting), or "Orbit track"
    this.individualOrbitMode = null;
    // Cache for smart path segments with metadata
    this._smartPathCache = {
      time: null, // JulianDate when path was created
      entities: null, // Array of polyline entities
    };
    // Track user intent to enable components (separate from actual component existence)
    // This allows orbit components to be "enabled" even when data isn't available
    this._enabledComponentNames = [];
  }

  // Override componentNames to return user intent (what should be shown)
  // rather than just what exists in components object
  get componentNames() {
    return this._enabledComponentNames;
  }

  enableComponent(name) {
    if (!this.created) {
      this.init();
    }

    // For orbit-related components, skip the valid check entirely
    // User intent to show orbit is tracked separately from data availability
    const isOrbitComponent = name === "Orbit" || name === "Orbit track";

    if (!this.props.sampledPosition.valid && !isOrbitComponent) {
      console.error(`No valid position data available for ${this.props.name}`);
      return;
    }

    // Track user intent to enable this component
    if (!this._enabledComponentNames.includes(name)) {
      this._enabledComponentNames.push(name);
    }

    // Create component if it doesn't exist
    // For orbit components, this may not create anything if data is unavailable
    // but the component will be auto-created when data becomes available
    if (!(name in this.components)) {
      this.createComponent(name);
      this.updatedSampledPositionForComponents();
    }

    super.enableComponent(name);

    if (name === "3D model") {
      // Adjust label offset to avoid overlap with model
      if (this.components.Label) {
        this.components.Label.label.pixelOffset = new Cartesian2(20, 0);
      }
    } else if (name === "Height stick") {
      // Refresh label to show elevation text when height stick is enabled
      if (this.components.Label) {
        this.disableComponent("Label");
        this.enableComponent("Label");
      }
    } else if (name === "Orbit" && this.components[name] instanceof Primitive) {
      // Update the model matrix periodically to keep the orbit in the inertial frame
      if (!this.orbitPrimitiveUpdater) {
        this.orbitPrimitiveUpdater = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 0.5, (time) => {
          if (!this.components.Orbit) {
            // Remove callback if orbit is disabled
            this.orbitPrimitiveUpdater();
            return;
          }
          const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
          if (defined(icrfToFixed)) {
            this.components.Orbit.modelMatrix = Matrix4.fromRotationTranslation(icrfToFixed);
          }
        });
      }
    } else if (name === "Orbit" && this.components[name] instanceof GeometryInstance) {
      // Update the model matrix of the primitive containing all orbit geometries periodically to keep the orbit in the inertial frame
      if (!this.constructor.geometryPrimitiveUpdater) {
        if (!this.components.Orbit) {
          // Remove callback if orbit is disabled
          this.geometryPrimitiveUpdater();
          return;
        }
        this.constructor.geometryPrimitiveUpdater = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 0.5, (time) => {
          const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
          if (defined(icrfToFixed) && this.constructor.primitive) {
            this.constructor.primitive.modelMatrix = Matrix4.fromRotationTranslation(icrfToFixed);
          }
        });
      }
    }
  }

  disableComponent(name) {
    // Remove from enabled components list
    this._enabledComponentNames = this._enabledComponentNames.filter((n) => n !== name);

    if (name === "3D model") {
      // Restore old label offset
      if (this.components.Label) {
        this.components.Label.label.pixelOffset = new Cartesian2(10, 0);
      }
    } else if (name === "Smart Path") {
      const component = this.components[name];
      if (component && component._entities) {
        // Clean up all polyline segment entities
        component._entities.forEach((entity) => {
          this.viewer.entities.remove(entity);
        });
        component._entities.length = 0;
      }
    } else if (name === "Height stick") {
      const component = this.components[name];
      if (component) {
        // Clean up tick mark entities
        if (component._tickEntities) {
          component._tickEntities.forEach((tickEntity) => {
            this.viewer.entities.remove(tickEntity);
          });
          component._tickEntities.length = 0;
        }
      }
      // Refresh label to hide elevation text when height stick is disabled
      if (this.components.Label) {
        const wasEnabled = this.componentNames.includes("Label");
        if (wasEnabled) {
          super.disableComponent(name);
          this.disableComponent("Label");
          this.enableComponent("Label");
          return;
        }
      }
    }
    super.disableComponent(name);

    if (this.componentNames.length === 0) {
      // Remove event listeners when no components are enabled
      this.deinit();
    }
  }

  init() {
    this.createDescription();

    this.eventListeners.sampledPosition = this.props.createSampledPosition(this.viewer, () => {
      this.updatedSampledPositionForComponents(true);
    });

    // Set up event listeners
    this.eventListeners.selectedEntity = this.viewer.selectedEntityChanged.addEventListener((entity) => {
      if (!entity) {
        // Don't clear highlights if a ground station is still active
        // This prevents clearing when clicking on an already-selected ground station
        if (!window.cc?.sats?.groundStations || window.cc.sats.groundStations.length === 0) {
          CesiumTimelineHelper.clearHighlightRanges(this.viewer);
        }
        return;
      }

      if (entity?.name?.includes("Groundstation")) {
        this.handleGroundStationHighlights(entity);
        return;
      }

      if (this.isSelected) {
        // Check if passes already exist
        const hasExistingPasses = this.props.passes && this.props.passes.length > 0;

        if (hasExistingPasses) {
          // Passes already exist - show highlights immediately
          // Clear existing highlights before adding new ones
          CesiumTimelineHelper.clearHighlightRanges(this.viewer);

          // Filter passes based on current filter settings (sunlight/eclipse)
          const filteredPasses = filterAndSortPasses(this.props.passes, this.viewer.clock.currentTime);
          // Use baseName to match the name in pass objects (without asterisk for future epochs)
          CesiumTimelineHelper.updateHighlightRanges(this.viewer, filteredPasses, this.props.baseName);

          // Request a render to update the UI
          if (this.viewer && this.viewer.scene) {
            this.viewer.scene.requestRender();
          }
        } else {
          // No passes yet - calculate them
          // Clear existing highlights before recalculating
          CesiumTimelineHelper.clearHighlightRanges(this.viewer);

          // Calculate passes asynchronously and update highlights when complete
          this.props
            .updatePasses(this.viewer.clock.currentTime)
            .then(() => {
              // Filter passes based on current filter settings (sunlight/eclipse)
              const filteredPasses = filterAndSortPasses(this.props.passes, this.viewer.clock.currentTime);
              // Use baseName to match the name in pass objects (without asterisk for future epochs)
              CesiumTimelineHelper.updateHighlightRanges(this.viewer, filteredPasses, this.props.baseName);

              // Request a render to update the UI
              if (this.viewer && this.viewer.scene) {
                this.viewer.scene.requestRender();
              }
            })
            .catch((err) => {
              console.warn("Failed to calculate passes for selected satellite:", err);
            });
        }
      }
    });

    this.eventListeners.trackedEntity = this.viewer.trackedEntityChanged.addEventListener(() => {
      // Handle ground station tracking (double-click to focus)
      const trackedEntity = this.viewer.trackedEntity;
      if (trackedEntity?.name?.includes("Groundstation")) {
        this.handleGroundStationHighlights(trackedEntity);
        return;
      }

      if (this.isTracked) {
        this.artificiallyTrack();
      }
      if ("Orbit" in this.components && !this.isCorrectOrbitComponent()) {
        // Recreate Orbit to change visualisation type
        this.disableComponent("Orbit");
        this.enableComponent("Orbit");
      }
    });

    // Listen for ClockMonitor time jump events to update Smart Path
    this.handleClockTimeJump = (event) => {
      const { jumpSeconds } = event.detail;
      // Only regenerate if Smart Path is active and jump is significant (>80 minutes)
      if (this.individualOrbitMode === "Smart Path" && Math.abs(jumpSeconds) > 4800) {
        this.regenerateSmartPath();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("cesium:clockTimeJumped", this.handleClockTimeJump);
    }
  }

  async handleGroundStationHighlights(entity) {
    // Handle ground station selection/tracking - show all passes for that ground station
    // Find the ground station that owns this entity
    const groundStation = window.cc?.sats?.groundStations?.find((gs) => gs.components && Object.values(gs.components).includes(entity));

    if (!groundStation) {
      CesiumTimelineHelper.clearHighlightRanges(this.viewer);
      return;
    }

    // Check if highlights already exist for this ground station
    // If the timeline already has highlights and the ground station is already selected, skip recalculation
    const hasExistingHighlights = this.viewer.timeline?._highlightRanges?.length > 0;
    const isAlreadySelected = this.viewer.selectedEntity === entity || this.viewer.trackedEntity === entity;

    if (hasExistingHighlights && isAlreadySelected) {
      // Highlights already exist and ground station is already selected - no need to recalculate
      return;
    }

    // Clear existing highlights immediately for responsive feedback
    CesiumTimelineHelper.clearHighlightRanges(this.viewer);

    // Yield to browser to keep UI responsive
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Calculate passes asynchronously (will use cache if available)
    const passes = await groundStation.passesAsync(this.viewer.clock.currentTime);

    if (passes.length > 0) {
      // Show highlights for all passes from this ground station, grouped by satellite
      const passesBySatellite = passes.reduce((acc, pass) => {
        const satelliteName = pass.name || pass.satelliteName;
        if (!acc[satelliteName]) acc[satelliteName] = [];
        acc[satelliteName].push(pass);
        return acc;
      }, {});

      // Add highlights asynchronously to avoid blocking
      await CesiumTimelineHelper.addHighlightRangesAsync(this.viewer, passesBySatellite);
    }
  }

  deinit() {
    // Remove event listeners
    this.eventListeners.sampledPosition();
    this.eventListeners.selectedEntity();
    this.eventListeners.trackedEntity();

    // Remove ClockMonitor listener
    if (typeof window !== "undefined" && this.handleClockTimeJump) {
      window.removeEventListener("cesium:clockTimeJumped", this.handleClockTimeJump);
    }

    // Reset individual orbit mode when satellite is fully hidden
    this.individualOrbitMode = null;
  }

  updatedSampledPositionForComponents(update = false) {
    const { fixed, inertial } = this.props.sampledPosition;

    // For prelaunch satellites, create a CallbackProperty that uses props.position()
    // which applies the pre-launch launch site override
    const isPrelaunch = this.props.hasTag("Prelaunch") && this.props.isEpochInFuture();
    const props = this.props;
    const prelaunchPositionProperty = isPrelaunch ? new CallbackProperty((time) => props.position(time), false) : null;

    // Event-driven recreation: Check if orbit components are enabled but not created
    // This handles pre-launch satellites where positions become available after time changes
    const orbitComponents = ["Orbit", "Orbit track"];
    for (const componentName of orbitComponents) {
      // Check if component is enabled (user wants it) but not created (no data was available)
      if (this.componentNames.includes(componentName) && !(componentName in this.components)) {
        // Try to create it now that positions may be available
        this.createComponent(componentName);
      }
    }

    Object.entries(this.components).forEach(([type, component]) => {
      if (type === "Orbit") {
        component.position = inertial;
        if (update && (component instanceof Primitive || component instanceof GeometryInstance)) {
          // Primitives need to be recreated to update the geometry
          this.disableComponent("Orbit");
          this.enableComponent("Orbit");
        }
      } else if (type === "Orbit track") {
        // PathGraphics requires SampledPositionProperty (with getValueInReferenceFrame)
        // Cannot use CallbackProperty here - it would crash Cesium's PathVisualizer
        component.position = fixed;
      } else if (type === "Height stick") {
        component.position = isPrelaunch ? prelaunchPositionProperty : fixed;
      } else if (type === "Sensor cone") {
        component.position = isPrelaunch ? prelaunchPositionProperty : fixed;
        component.orientation = new CallbackProperty((time) => {
          const position = this.props.position(time);
          const hpr = new HeadingPitchRoll(0, CesiumMath.toRadians(180), 0);
          return Transforms.headingPitchRollQuaternion(position, hpr);
        }, false);
      } else {
        // For prelaunch satellites, use CallbackProperty that checks for launch site override
        component.position = isPrelaunch ? prelaunchPositionProperty : fixed;
        component.orientation = new VelocityOrientationProperty(isPrelaunch ? prelaunchPositionProperty : fixed);
      }
    });
    // Request a single frame after satellite position updates when the clock is paused
    if (!this.viewer.clock.shouldAnimate) {
      const removeCallback = this.viewer.clock.onTick.addEventListener(() => {
        this.viewer.scene.requestRender();
        removeCallback();
      });
    }
  }

  createComponent(name) {
    switch (name) {
      case "Point":
        this.createPoint();
        break;
      case "Label":
        this.createLabel();
        break;
      case "Orbit":
        this.createOrbit();
        break;
      case "Smart Path":
        this.createSmartOrbitPath();
        break;
      case "Orbit track":
        this.createOrbitTrack();
        break;
      case "Visibility area":
        this.createGroundTrack();
        break;
      case "Height stick":
        this.createHeightStick();
        break;
      case "3D model":
        this.createModel();
        break;
      case "Ground station link":
        this.createGroundStationLink();
        break;
      default:
        console.error("Unknown component");
    }
  }

  createDescription() {
    this.description = DescriptionHelper.cachedCallbackProperty((time) => {
      // Update passes if needed when time changes significantly
      // Note: updatePasses is now async, but we're in a sync CallbackProperty context
      // The description will use cached passes data and trigger async updates in background
      if (this.props.groundStationAvailable) {
        this.props
          .updatePasses(time)
          .then(() => {
            // Request render after passes are calculated to update the description
            if (this.viewer && this.viewer.scene) {
              this.viewer.scene.requestRender();
            }
          })
          .catch((err) => {
            console.warn("Pass update failed in description callback:", err);
          });
      }
      // Use positionGeodetic for description (needs proper error handling)
      const cartographic = this.props.orbit.positionGeodetic(JulianDate.toDate(time), true);
      const content = DescriptionHelper.renderSatelliteDescription(time, cartographic, this.props);
      return content;
    });
  }

  createCesiumSatelliteEntity(entityName, entityKey, entityValue) {
    // Use CallbackProperty to allow pre-launch position override for initial entity creation
    // Note: updatedSampledPositionForComponents will set the actual position property later
    this.createCesiumEntity(entityName, entityKey, entityValue, this.props.name, this.description, this.props.sampledPosition.fixed, true);
  }

  createPoint() {
    const point = new PointGraphics({
      pixelSize: 6,
      color: Color.WHITE,
      outlineColor: Color.DIMGREY,
      outlineWidth: 1,
    });
    this.createCesiumSatelliteEntity("Point", "point", point);
  }

  createBox() {
    const size = 1000;
    const box = new BoxGraphics({
      dimensions: new Cartesian3(size, size, size),
      material: Color.WHITE,
    });
    this.createCesiumSatelliteEntity("Box", "box", box);
  }

  createModel() {
    const model = new ModelGraphics({
      uri: `./data/models/${this.props.name.split(" ").join("-")}.glb`,
      minimumPixelSize: 50,
      maximumScale: 10000,
    });
    this.createCesiumSatelliteEntity("3D model", "model", model);
  }

  createLabel() {
    // Create LOD calculator for distance-based optimization
    const lodCalculator = VisibilityCulling.createLODCalculator(this.viewer, (time) => this.props.position(time));

    const label = new LabelGraphics({
      text: new CallbackProperty((time) => {
        // Check LOD level for distance-based optimization
        const lod = lodCalculator(time);

        // LOD 3 (> 200,000 km): Skip label entirely (handled by distanceDisplayCondition)
        if (lod >= 3) {
          return this.props.name;
        }

        // LOD 2 (50,000-200,000 km): Static name only, no altitude calculation
        if (lod >= 2) {
          return this.props.name;
        }

        // LOD 0-1 (< 50,000 km): Full detail with altitude if height stick enabled
        // Only add elevation when height stick is enabled
        if (!this.components["Height stick"]) {
          return this.props.name;
        }

        // Only add elevation for satellites with orbital period under 120 minutes (same as height stick)
        if (this.props.orbit.orbitalPeriod > 120) {
          return this.props.name;
        }

        // Use cached position instead of recalculating with positionGeodetic
        const position = this.props.position(time);
        if (!position) {
          return this.props.name;
        }

        const cartographic = Cartographic.fromCartesian(position);
        const heightKm = Math.round(cartographic.height / 1000); // Round to nearest km
        return `${this.props.name} ${heightKm}km`;
      }, false),
      font: "15px Arial",
      style: LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Color.DIMGREY,
      outlineWidth: 2,
      horizontalOrigin: HorizontalOrigin.LEFT,
      pixelOffset: new Cartesian2(10, 0),
      distanceDisplayCondition: new DistanceDisplayCondition(2000, 8e7),
      translucencyByDistance: new NearFarScalar(6e7, 1.0, 8e7, 0.0),
    });
    this.createCesiumSatelliteEntity("Label", "label", label);
  }

  createOrbit() {
    if (this.usePathGraphicForOrbit) {
      this.createOrbitPath();
    } else {
      this.createOrbitPolylineGeometry();
    }
  }

  isCorrectOrbitComponent() {
    return this.usePathGraphicForOrbit ? this.components.Orbit instanceof Entity : this.components.Orbit instanceof Primitive;
  }

  get usePathGraphicForOrbit() {
    const sceneModeSupportsPrimitive = this.viewer.scene.mode === SceneMode.SCENE3D;
    if (this.isTracked || !sceneModeSupportsPrimitive) {
      // Use a path graphic to visualize the currently tracked satellite's orbit or when the scene mode doesn't support primitive modelmatrix updates
      return true;
    }
    // For all other satellites use a polyline geometry to visualize the orbit for significantly improved performance.
    // A polyline geometry is used instead of a polyline graphic as entities don't support adjusting the model matrix
    // in order to display the orbit in the inertial frame.
    return false;
  }

  createOrbitPath() {
    const path = new PathGraphics({
      leadTime: (this.props.orbit.orbitalPeriod * 60) / 2 + 5,
      trailTime: (this.props.orbit.orbitalPeriod * 60) / 2 + 5,
      material: Color.WHITE.withAlpha(0.15),
      resolution: 600,
      width: 2,
    });
    this.createCesiumEntity("Orbit", "path", path, this.props.name, this.description, this.props.sampledPosition.inertial, true);
  }

  createOrbitPolylinePrimitive() {
    const positions = this.props.getSampledPositionsForNextOrbit(this.viewer.clock.currentTime);
    // Need at least 2 positions for a polyline (e.g., pre-launch satellites may have no valid positions)
    if (!positions || positions.length < 2) {
      // Don't create component yet - it will be auto-created when positions become available
      // User intent to show orbit is preserved in componentNames
      return;
    }
    const primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new PolylineGeometry({
          positions,
          width: 2,
          arcType: ArcType.NONE,
          // granularity: CesiumMath.RADIANS_PER_DEGREE * 10,
          vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 1.0, 1.0, 0.15)),
        },
        id: this.props.name,
      }),
      appearance: new PolylineColorAppearance(),
      asynchronous: false,
    });
    const icrfToFixed = Transforms.computeIcrfToFixedMatrix(this.viewer.clock.currentTime);
    if (defined(icrfToFixed)) {
      // TODO: Cache the model matrix
      primitive.modelMatrix = Matrix4.fromRotationTranslation(icrfToFixed);
    }
    this.components.Orbit = primitive;
  }

  createOrbitPolylineGeometry() {
    // Currently unused
    const positions = this.props.getSampledPositionsForNextOrbit(this.viewer.clock.currentTime);
    // Need at least 2 positions for a polyline (e.g., pre-launch satellites may have no valid positions)
    if (!positions || positions.length < 2) {
      return;
    }
    const geometryInstance = new GeometryInstance({
      geometry: new PolylineGeometry({
        positions,
        width: 2,
        arcType: ArcType.NONE,
        // granularity: CesiumMath.RADIANS_PER_DEGREE * 10,
        vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(new Color(1.0, 1.0, 1.0, 0.15)),
      },
      id: this.props.name,
    });
    this.components.Orbit = geometryInstance;
  }

  createOrbitTrack(leadTime = this.props.orbit.orbitalPeriod * 60, trailTime = 0) {
    const path = new PathGraphics({
      leadTime,
      trailTime,
      material: Color.GOLD.withAlpha(0.15),
      resolution: 600,
      width: 2,
    });
    this.createCesiumSatelliteEntity("Orbit track", "path", path);
  }

  /**
   * Create smart orbital path with color coding based on visibility and lighting
   * - Cyan: Satellite visible from ground station (elevation > 0°)
   * - Yellow: Satellite visible AND in sunlight (not eclipsed)
   * - Alpha varies: 0.15 for 0-10° elevation, 0.6-0.8 for >10° elevation
   * - White (low alpha): Not visible from ground station (below horizon)
   */
  createSmartOrbitPath() {
    const deg2rad = Math.PI / 180;
    const minElevation = 0; // degrees - show from horizon
    const lowElevationThreshold = 10; // degrees - use reduced alpha below this

    // Get orbit positions (360 samples around the orbit for smooth visualization)
    const currentTime = this.viewer.clock.currentTime;
    const orbitalPeriod = this.props.orbit.orbitalPeriod * 60; // seconds
    const numSamples = 360;
    const timeStep = orbitalPeriod / numSamples; // seconds per sample

    // Sample the orbit and calculate colors
    const samples = [];

    for (let i = 0; i <= numSamples; i++) {
      const sampleTime = JulianDate.addSeconds(currentTime, i * timeStep, new JulianDate());
      const position = this.props.position(sampleTime);

      if (!position) continue;

      // Determine color state:
      // 0 = not visible (below horizon)
      // 1 = visible+eclipsed, low elevation (0-10°)
      // 2 = visible+sunlit, low elevation (0-10°)
      // 3 = visible+eclipsed, high elevation (>10°)
      // 4 = visible+sunlit, high elevation (>10°)
      let colorState = 0;

      // Check if ground station is available
      if (this.props.groundStationAvailable) {
        try {
          // Get satellite position in ECF for visibility calculation
          const date = JulianDate.toDate(sampleTime);
          const positionEcf = this.props.orbit.positionECF(date);

          if (positionEcf) {
            // Use the first ground station for visibility calculation
            const groundStation = {
              latitude: this.props.groundStations[0].position.latitude * deg2rad,
              longitude: this.props.groundStations[0].position.longitude * deg2rad,
              height: this.props.groundStations[0].position.height / 1000, // Convert to km
            };

            // Calculate look angles from ground station to satellite
            const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);
            const elevation = lookAngles.elevation / deg2rad; // Convert to degrees

            // Check if satellite is visible (elevation > minElevation)
            if (elevation > minElevation) {
              // Satellite is visible - check if it's also in sunlight
              const isEclipsed = this.props.orbit.isInEclipse(date);
              const isLowElevation = elevation <= lowElevationThreshold;

              if (isLowElevation) {
                // Low elevation (0-10°): use states 1 or 2
                colorState = isEclipsed ? 1 : 2;
              } else {
                // High elevation (>10°): use states 3 or 4
                colorState = isEclipsed ? 3 : 4;
              }
            }
          }
        } catch (error) {
          // If visibility calculation fails, use default (not visible)
          console.warn("Smart path visibility calculation failed:", error);
        }
      }

      samples.push({ position, colorState });
    }

    // Create polyline segments grouped by color
    const segments = [];
    let currentSegment = null;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];

      // Start a new segment if color changes or this is the first sample
      if (!currentSegment || currentSegment.colorState !== sample.colorState) {
        // Close previous segment if it exists
        if (currentSegment) {
          // Add current sample's position to close the segment
          currentSegment.positions.push(sample.position);
          segments.push(currentSegment);
        }

        // Start new segment
        currentSegment = {
          colorState: sample.colorState,
          positions: [sample.position],
        };
      } else {
        // Continue current segment
        currentSegment.positions.push(sample.position);
      }
    }

    // Close last segment
    if (currentSegment && currentSegment.positions.length > 0) {
      segments.push(currentSegment);
    }

    // Create entities for each segment
    const entities = [];
    for (const segment of segments) {
      if (segment.positions.length < 2) continue; // Need at least 2 points for a line

      // Determine color based on colorState
      let color;
      switch (segment.colorState) {
        case 4:
          // High elevation, visible and sunlit - yellow with high alpha
          color = Color.YELLOW.withAlpha(0.8);
          break;
        case 3:
          // High elevation, visible but eclipsed - cyan with medium alpha
          color = Color.CYAN.withAlpha(0.6);
          break;
        case 2:
          // Low elevation (0-10°), visible and sunlit - yellow with low alpha
          color = Color.YELLOW.withAlpha(0.3);
          break;
        case 1:
          // Low elevation (0-10°), visible but eclipsed - cyan with low alpha
          color = Color.CYAN.withAlpha(0.3);
          break;
        default:
          // Not visible (below horizon) - white with low alpha
          color = Color.WHITE.withAlpha(0.15);
      }

      const polyline = new PolylineGraphics({
        positions: segment.positions,
        width: 2,
        material: color,
        arcType: ArcType.NONE,
      });

      const entity = new Entity({
        polyline,
      });
      // Mark as non-selectable so clicking doesn't show infobox
      entity._nonSelectable = true;

      entities.push(entity);
      this.viewer.entities.add(entity);
    }

    // Store entities array as the component for cleanup
    this.components["Smart Path"] = { _entities: entities };

    // Update cache with current time and entities
    this._smartPathCache = {
      time: JulianDate.clone(currentTime),
      entities: entities,
    };
  }

  createGroundTrack() {
    // Only show ground tracks for Low Earth Orbit (LEO) satellites
    // Satellites with orbital periods > 2 hours are typically in higher orbits
    // where ground track visualization becomes less meaningful
    if (this.props.orbit.orbitalPeriod > 60 * 2) {
      return;
    }

    // Create LOD calculator for distance-based optimization
    const lodCalculator = VisibilityCulling.createLODCalculator(this.viewer, (time) => this.props.position(time));

    // Cache radius calculation to avoid repeated expensive calls
    let cachedRadius = null;
    let lastRadiusCalcTime = null;
    const radiusCacheTime = 2.0; // Cache for 2 seconds

    // Create a circle showing the satellite's visibility footprint on Earth's surface
    // This represents the area where the satellite can be observed above 10° elevation
    const visibilityCircle = new EllipseGraphics({
      // Semi-transparent dark red material for visibility without obscuring terrain
      material: Color.DARKRED.withAlpha(0.25),

      // Add a subtle outline to make the circle more visible
      outline: true,
      outlineColor: Color.DARKRED.withAlpha(0.8),
      outlineWidth: 2,

      // Elevate slightly above ground to avoid clipping at corners
      height: 5000, // 5km above surface
      heightReference: HeightReference.RELATIVE_TO_GROUND,

      // Dynamic radius based on satellite altitude and 10° minimum elevation
      // The radius represents the distance from subsatellite point to 10° horizon
      semiMajorAxis: new CallbackProperty((time) => {
        // Check LOD level - skip calculations for distant satellites
        const lod = lodCalculator(time);
        if (lod >= 2) {
          // Return cached value or approximate radius for distant satellites
          return cachedRadius || 2000000; // ~2000 km default radius
        }

        // Check cache
        const currentSeconds = time.dayNumber * 86400 + time.secondsOfDay;
        if (lastRadiusCalcTime && Math.abs(currentSeconds - lastRadiusCalcTime) < radiusCacheTime && cachedRadius) {
          return cachedRadius;
        }

        // Calculate fresh radius
        const visibleWidthKm = this.props.getVisibleAreaWidth(time);
        const radiusKm = visibleWidthKm / 2; // Convert diameter to radius
        const expandedRadiusKm = radiusKm * 1.15; // Expand by 15% for better visibility
        const radiusM = expandedRadiusKm * 1000; // Convert to meters

        // Update cache
        cachedRadius = radiusM;
        lastRadiusCalcTime = currentSeconds;

        return radiusM;
      }, false),

      semiMinorAxis: new CallbackProperty((time) => {
        // Use same cached radius calculation for minor axis (circular)
        const lod = lodCalculator(time);
        if (lod >= 2) {
          return cachedRadius || 2000000;
        }

        const currentSeconds = time.dayNumber * 86400 + time.secondsOfDay;
        if (lastRadiusCalcTime && Math.abs(currentSeconds - lastRadiusCalcTime) < radiusCacheTime && cachedRadius) {
          return cachedRadius;
        }

        const visibleWidthKm = this.props.getVisibleAreaWidth(time);
        const radiusKm = visibleWidthKm / 2;
        const expandedRadiusKm = radiusKm * 1.15;
        const radiusM = expandedRadiusKm * 1000;

        cachedRadius = radiusM;
        lastRadiusCalcTime = currentSeconds;

        return radiusM;
      }, false),
    });

    // Add the visibility circle to the Cesium scene
    this.createCesiumSatelliteEntity("Visibility area", "ellipse", visibilityCircle);
  }

  createHeightStick() {
    // Only show height stick for satellites with orbital period under 120 minutes
    if (this.props.orbit.orbitalPeriod > 120) {
      return;
    }

    // Create visibility checker for frustum culling
    const visibilityChecker = VisibilityCulling.createCachedVisibilityChecker(this.viewer, (time) => this.props.position(time), 0.5);

    // Create the main vertical line entity
    const entity = new Entity({
      polyline: new PolylineGraphics({
        positions: new CallbackProperty((time) => {
          // Skip expensive calculations if not visible
          if (!visibilityChecker(time)) {
            return [];
          }
          const satellitePosition = this.props.position(time);
          const cartographic = Cartographic.fromCartesian(satellitePosition);
          const surfacePosition = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
          return [surfacePosition, satellitePosition];
        }, false),
        followSurface: false,
        material: Color.CYAN,
        width: 1,
        distanceDisplayCondition: new DistanceDisplayCondition(2000, 8e7),
        translucencyByDistance: new NearFarScalar(6e7, 1.0, 8e7, 0.0),
      }),
    });

    // Create static tick marks (simplified approach to avoid clock interference)
    const tickEntities = [];
    const maxAltitude = 1000; // Max altitude in km for tick marks

    // Create tick marks every 100km up to maxAltitude
    for (let altitude = 100; altitude <= maxAltitude; altitude += 100) {
      const is500km = altitude % 500 === 0;
      const tickId = `heightstick-tick-${this.props.satnum}-${altitude}`;

      const tickEntity = new Entity({
        id: tickId,
        polyline: new PolylineGraphics({
          positions: new CallbackProperty((time) => {
            // Skip expensive calculations if parent satellite not visible
            if (!visibilityChecker(time)) {
              return [];
            }
            const satellitePosition = this.props.position(time);
            const cartographic = Cartographic.fromCartesian(satellitePosition);
            const currentHeight = cartographic.height / 1000;

            // Only show tick if satellite is above this altitude
            if (currentHeight < altitude) {
              return [];
            }

            const tickPosition = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, altitude * 1000);

            // Calculate eastward direction for tick
            const up = Cartesian3.normalize(satellitePosition, new Cartesian3());
            const east = Cartesian3.cross(Cartesian3.UNIT_Z, up, new Cartesian3());
            Cartesian3.normalize(east, east);

            const tickLength = is500km ? 8000 : 4000;
            const tickEnd = Cartesian3.add(tickPosition, Cartesian3.multiplyByScalar(east, tickLength, new Cartesian3()), new Cartesian3());

            return [tickPosition, tickEnd];
          }, false),
          followSurface: false,
          material: Color.CYAN,
          width: is500km ? 2 : 1,
          distanceDisplayCondition: new DistanceDisplayCondition(2000, 8e7),
          translucencyByDistance: new NearFarScalar(6e7, 1.0, 8e7, 0.0),
        }),
      });

      this.viewer.entities.add(tickEntity);
      tickEntities.push(tickEntity);
    }

    // Store tick entities for cleanup
    entity._tickEntities = tickEntities;
    this.components["Height stick"] = entity;
  }

  createCone(fov = 10) {
    if (this.props.orbit.orbitalPeriod > 60 * 2) {
      // Cone graphic unavailable for non-LEO satellites
      return;
    }
    const entity = new Entity();
    entity.addProperty("conicSensor");
    entity.conicSensor = new CesiumSensorVolumes.ConicSensorGraphics({
      radius: 1000000,
      innerHalfAngle: CesiumMath.toRadians(0),
      outerHalfAngle: CesiumMath.toRadians(fov),
      lateralSurfaceMaterial: Color.GOLD.withAlpha(0.15),
      intersectionColor: Color.GOLD.withAlpha(0.3),
      intersectionWidth: 1,
    });
    this.components["Sensor cone"] = entity;
  }

  createGroundStationLink() {
    if (!this.props.groundStationAvailable) {
      return;
    }

    // Create visibility checker for frustum culling
    const visibilityChecker = VisibilityCulling.createCachedVisibilityChecker(this.viewer, (time) => this.props.position(time), 0.5);

    const polyline = new PolylineGraphics({
      followSurface: false,
      material: new PolylineGlowMaterialProperty({
        glowPower: 0.5,
        color: Color.FORESTGREEN,
      }),
      positions: new CallbackProperty((time) => {
        // Skip if satellite not visible in frustum
        if (!visibilityChecker(time)) {
          return [];
        }
        const satPosition = this.props.position(time);
        const groundPosition = this.props.groundStationPosition.cartesian;
        const positions = [satPosition, groundPosition];
        return positions;
      }, false),
      show: new CallbackProperty((time) => this.props.passIntervals.contains(time), false),
      width: 5,
    });
    this.createCesiumSatelliteEntity("Ground station link", "polyline", polyline);
  }

  /**
   * Regenerate the Smart Path without changing the toggle state
   * This is used when time changes significantly or pass is selected
   */
  regenerateSmartPath() {
    // Only regenerate if Smart Path mode is currently active
    if (this.individualOrbitMode !== "Smart Path") {
      return;
    }

    // Directly recreate the smart path component
    // First clean up existing entities
    const component = this.components["Smart Path"];
    if (component && component._entities) {
      component._entities.forEach((entity) => {
        this.viewer.entities.remove(entity);
      });
      component._entities.length = 0;
    }

    // Remove the component from the components object
    delete this.components["Smart Path"];

    // Recreate the smart path
    this.createSmartOrbitPath();

    // Enable the component (since we deleted it, we need to re-enable it)
    super.enableComponent("Smart Path");

    // Request render to update the view
    if (this.viewer && this.viewer.scene) {
      this.viewer.scene.requestRender();
    }
  }

  /**
   * Cycle through individual path modes: null ↔ "Smart Path"
   * - null: Plain mode, functions as normal satellite
   * - "Smart Path": Colored orbital path showing visibility (cyan) and sunlit visibility (yellow)
   * This allows toggling path display for a single satellite when global orbit components are disabled
   * When Smart Path is enabled, the label is also enabled (unless globally disabled)
   * When Smart Path is disabled, the label respects the global setting
   */
  cyclePathMode() {
    // Disable current individual orbit mode if any
    if (this.individualOrbitMode) {
      this.disableComponent(this.individualOrbitMode);
    }

    // Toggle between null and "Smart Path": null → "Smart Path" → null
    if (this.individualOrbitMode === null) {
      this.individualOrbitMode = "Smart Path";
    } else {
      // "Smart Path" → null
      this.individualOrbitMode = null;
      // Clear cache when returning to plain mode
      this._smartPathCache = null;
    }

    // Enable the new individual orbit mode if not null
    if (this.individualOrbitMode) {
      this.enableComponent(this.individualOrbitMode);
      // Also enable label when showing path
      this.enableComponent("Label");
    } else {
      // When disabling Smart Path, only disable label if it's not globally enabled
      // Check if Label is globally enabled by looking at SatelliteManager's enabled components
      const isLabelGloballyEnabled = window.cc?.sats?.enabledComponents?.includes("Label");
      if (!isLabelGloballyEnabled) {
        this.disableComponent("Label");
      }
    }
  }

  set groundStations(groundStations) {
    // Always set ground stations, even for GEO satellites
    // This ensures groundStationAvailable returns true
    this.props.groundStations = groundStations;

    // Regenerate Smart Path immediately if it's currently enabled
    // This ensures the path updates to reflect visibility from the new ground station
    if (this.individualOrbitMode === "Smart Path") {
      this.regenerateSmartPath();
    }

    // No groundstation pass calculation for GEO satellites
    if (this.props.orbit.orbitalPeriod > 60 * 12) {
      return;
    }

    this.props.clearPasses();
    if (this.isSelected || this.isTracked) {
      this.props
        .updatePasses(this.viewer.clock.currentTime)
        .then(() => {
          if (this.isSelected) {
            // Filter passes based on current filter settings (sunlight/eclipse)
            const filteredPasses = filterAndSortPasses(this.props.passes, this.viewer.clock.currentTime);
            // Use baseName to match the name in pass objects (without asterisk for future epochs)
            CesiumTimelineHelper.updateHighlightRanges(this.viewer, filteredPasses, this.props.baseName);
          }
        })
        .catch((err) => {
          console.warn("Failed to update passes for ground station:", err);
        });
    }
    if (this.created) {
      this.createGroundStationLink();
    }
  }
}
