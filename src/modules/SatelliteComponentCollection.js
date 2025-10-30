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
  }

  enableComponent(name) {
    if (!this.created) {
      this.init();
    }
    if (!this.props.sampledPosition.valid) {
      console.error(`No valid position data available for ${this.props.name}`);
      return;
    }
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
    if (name === "3D model") {
      // Restore old label offset
      if (this.components.Label) {
        this.components.Label.label.pixelOffset = new Cartesian2(10, 0);
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
        CesiumTimelineHelper.clearHighlightRanges(this.viewer);
        return;
      }

      if (entity?.name?.includes("Groundstation")) {
        this.handleGroundStationHighlights(entity);
        return;
      }

      if (this.isSelected) {
        // Force recalculation of passes when satellite is selected
        this.props.clearPasses();

        // Calculate passes asynchronously and update highlights when complete
        this.props.updatePasses(this.viewer.clock.currentTime).then(() => {
          // Filter passes based on current filter settings (sunlight/eclipse)
          const filteredPasses = filterAndSortPasses(this.props.passes, this.viewer.clock.currentTime);
          // Use baseName to match the name in pass objects (without asterisk for future epochs)
          CesiumTimelineHelper.updateHighlightRanges(this.viewer, filteredPasses, this.props.baseName);

          // Request a render to update the UI
          if (this.viewer && this.viewer.scene) {
            this.viewer.scene.requestRender();
          }
        }).catch((err) => {
          console.warn("Failed to calculate passes for selected satellite:", err);
        });
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
  }

  async handleGroundStationHighlights(entity) {
    // Handle ground station selection/tracking - show all passes for that ground station
    // Find the ground station that owns this entity
    const groundStation = window.cc?.sats?.groundStations?.find((gs) => gs.components && Object.values(gs.components).includes(entity));

    if (!groundStation) {
      CesiumTimelineHelper.clearHighlightRanges(this.viewer);
      return;
    }

    // Clear existing highlights immediately for responsive feedback
    CesiumTimelineHelper.clearHighlightRanges(this.viewer);

    // Yield to browser to keep UI responsive
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Calculate passes asynchronously
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
  }

  updatedSampledPositionForComponents(update = false) {
    const { fixed, inertial } = this.props.sampledPosition;

    Object.entries(this.components).forEach(([type, component]) => {
      if (type === "Orbit") {
        component.position = inertial;
        if (update && (component instanceof Primitive || component instanceof GeometryInstance)) {
          // Primitives need to be recreated to update the geometry
          this.disableComponent("Orbit");
          this.enableComponent("Orbit");
        }
      } else if (type === "Height stick") {
        component.position = fixed;
      } else if (type === "Sensor cone") {
        component.position = fixed;
        component.orientation = new CallbackProperty((time) => {
          const position = this.props.position(time);
          const hpr = new HeadingPitchRoll(0, CesiumMath.toRadians(180), 0);
          return Transforms.headingPitchRollQuaternion(position, hpr);
        }, false);
      } else {
        component.position = fixed;
        component.orientation = new VelocityOrientationProperty(fixed);
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
        this.props.updatePasses(time).then(() => {
          // Request render after passes are calculated to update the description
          if (this.viewer && this.viewer.scene) {
            this.viewer.scene.requestRender();
          }
        }).catch((err) => {
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
    const primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new PolylineGeometry({
          positions: this.props.getSampledPositionsForNextOrbit(this.viewer.clock.currentTime),
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
    const geometryInstance = new GeometryInstance({
      geometry: new PolylineGeometry({
        positions: this.props.getSampledPositionsForNextOrbit(this.viewer.clock.currentTime),
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

  createPassArc() {
    if (!this.props.groundStationAvailable || !this.isSelected) {
      return;
    }

    // Find current pass
    const getCurrentPass = (time) => {
      const currentTime = new Date(JulianDate.toDate(time));
      return this.props.passes.find((pass) => {
        const passStart = new Date(pass.start);
        const passEnd = new Date(pass.end);
        return currentTime >= passStart && currentTime <= passEnd;
      });
    };

    // Create dynamic material that changes color based on eclipse status
    const dynamicMaterial = new CallbackProperty((time) => {
      try {
        const isEclipsed = this.props.orbit.isInEclipse(JulianDate.toDate(time));
        return isEclipsed
          ? Color.DARKRED.withAlpha(0.8) // Dark red for eclipsed portions
          : Color.CYAN.withAlpha(0.9); // Bright cyan for sunlit portions during pass
      } catch {
        // Fallback to cyan if eclipse calculation fails
        return Color.CYAN.withAlpha(0.8);
      }
    }, false);

    const path = new PathGraphics({
      leadTime: new CallbackProperty((time) => {
        const currentPass = getCurrentPass(time);
        if (!currentPass) return 0;

        const currentTime = JulianDate.toDate(time);
        const passEnd = new Date(currentPass.end);
        return Math.max(0, (passEnd.getTime() - currentTime.getTime()) / 1000);
      }, false),
      trailTime: new CallbackProperty((time) => {
        const currentPass = getCurrentPass(time);
        if (!currentPass) return 0;

        const currentTime = JulianDate.toDate(time);
        const passStart = new Date(currentPass.start);
        return Math.max(0, (currentTime.getTime() - passStart.getTime()) / 1000);
      }, false),
      material: dynamicMaterial,
      resolution: 120, // Higher resolution for more detailed pass arc
      width: 4, // Wider to make it stand out
      show: new CallbackProperty((time) => {
        // Only show when satellite is selected and during a pass
        return this.isSelected && this.props.passIntervals.contains(time);
      }, false),
    });
    this.createCesiumSatelliteEntity("Pass arc", "path", path);
  }

  set groundStations(groundStations) {
    // Always set ground stations, even for GEO satellites
    // This ensures groundStationAvailable returns true
    this.props.groundStations = groundStations;

    // No groundstation pass calculation for GEO satellites
    if (this.props.orbit.orbitalPeriod > 60 * 12) {
      return;
    }

    this.props.clearPasses();
    if (this.isSelected || this.isTracked) {
      this.props.updatePasses(this.viewer.clock.currentTime).then(() => {
        if (this.isSelected) {
          // Filter passes based on current filter settings (sunlight/eclipse)
          const filteredPasses = filterAndSortPasses(this.props.passes, this.viewer.clock.currentTime);
          // Use baseName to match the name in pass objects (without asterisk for future epochs)
          CesiumTimelineHelper.updateHighlightRanges(this.viewer, filteredPasses, this.props.baseName);
        }
      }).catch((err) => {
        console.warn("Failed to update passes for ground station:", err);
      });
    }
    if (this.created) {
      this.createGroundStationLink();
    }
  }
}
