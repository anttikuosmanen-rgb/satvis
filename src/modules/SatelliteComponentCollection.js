import * as Cesium from "@cesium/engine";

import { SatelliteProperties } from "./SatelliteProperties";
import { CesiumComponentCollection } from "./util/CesiumComponentCollection";
import { CesiumTimelineHelper } from "./util/CesiumTimelineHelper";
import { DescriptionHelper } from "./util/DescriptionHelper";
import { CesiumCallbackHelper } from "./util/CesiumCallbackHelper";

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
        this.components.Label.label.pixelOffset = new Cesium.Cartesian2(20, 0);
      }
    } else if (name === "Height stick") {
      // Refresh label to show elevation text when height stick is enabled
      if (this.components.Label) {
        this.disableComponent("Label");
        this.enableComponent("Label");
      }
    } else if (name === "Orbit" && this.components[name] instanceof Cesium.Primitive) {
      // Update the model matrix periodically to keep the orbit in the inertial frame
      if (!this.orbitPrimitiveUpdater) {
        this.orbitPrimitiveUpdater = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 0.5, (time) => {
          if (!this.components.Orbit) {
            // Remove callback if orbit is disabled
            this.orbitPrimitiveUpdater();
            return;
          }
          const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(time);
          if (Cesium.defined(icrfToFixed)) {
            this.components.Orbit.modelMatrix = Cesium.Matrix4.fromRotationTranslation(icrfToFixed);
          }
        });
      }
    } else if (name === "Orbit" && this.components[name] instanceof Cesium.GeometryInstance) {
      // Update the model matrix of the primitive containing all orbit geometries periodically to keep the orbit in the inertial frame
      if (!this.constructor.geometryPrimitiveUpdater) {
        if (!this.components.Orbit) {
          // Remove callback if orbit is disabled
          this.geometryPrimitiveUpdater();
          return;
        }
        this.constructor.geometryPrimitiveUpdater = CesiumCallbackHelper.createPeriodicTimeCallback(this.viewer, 0.5, (time) => {
          const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(time);
          if (Cesium.defined(icrfToFixed) && this.constructor.primitive) {
            this.constructor.primitive.modelMatrix = Cesium.Matrix4.fromRotationTranslation(icrfToFixed);
          }
        });
      }
    }
  }

  disableComponent(name) {
    if (name === "Height stick") {
      const component = this.components[name];
      if (component) {
        // Clean up tick mark entities
        if (component.tickEntities) {
          component.tickEntities.forEach((tickEntity) => {
            this.viewer.entities.remove(tickEntity);
          });
          component.tickEntities.length = 0;
        }
      }
    }

    if (name === "3D model") {
      // Restore old label offset
      if (this.components.Label) {
        this.components.Label.label.pixelOffset = new Cesium.Cartesian2(10, 0);
      }
    }

    super.disableComponent(name);

    if (name === "Height stick") {
      // Refresh label to hide elevation text when height stick is disabled
      if (this.components.Label) {
        const wasEnabled = this.componentNames.includes("Label");
        if (wasEnabled) {
          this.disableComponent("Label");
          this.enableComponent("Label");
        }
      }
    }

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
        this.handleGroundStationHighlights(entity, "selected");
        return;
      }

      if (this.isSelected) {
        this.props.updatePasses(this.viewer.clock.currentTime);
        CesiumTimelineHelper.updateHighlightRanges(this.viewer, this.props.passes, this.props.name);
      }
    });

    this.eventListeners.trackedEntity = this.viewer.trackedEntityChanged.addEventListener(() => {
      // Handle ground station tracking (double-click to focus)
      const trackedEntity = this.viewer.trackedEntity;
      if (trackedEntity?.name?.includes("Groundstation")) {
        this.handleGroundStationHighlights(trackedEntity, "tracked");
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

  handleGroundStationHighlights(entity, eventType) {
    // Handle ground station selection/tracking - show all passes for that ground station
    // Find the ground station that owns this entity
    const groundStation = window.cc?.sats?.groundStations?.find(gs =>
      gs.components && Object.values(gs.components).includes(entity)
    );

    if (groundStation) {
      const passes = groundStation.passes(this.viewer.clock.currentTime);

      if (passes.length > 0) {
        // Show highlights for all passes from this ground station, grouped by satellite
        const passesBySatellite = passes.reduce((acc, pass) => {
          const satelliteName = pass.name || pass.satelliteName;
          if (!acc[satelliteName]) acc[satelliteName] = [];
          acc[satelliteName].push(pass);
          return acc;
        }, {});

        // Clear existing highlights and add new ones
        CesiumTimelineHelper.clearHighlightRanges(this.viewer);
        Object.entries(passesBySatellite).forEach(([satelliteName, satellitePasses]) => {
          CesiumTimelineHelper.addHighlightRanges(this.viewer, satellitePasses, satelliteName);
        });
      } else {
        CesiumTimelineHelper.clearHighlightRanges(this.viewer);
      }
    } else {
      CesiumTimelineHelper.clearHighlightRanges(this.viewer);
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
        if (update && (component instanceof Cesium.Primitive || component instanceof Cesium.GeometryInstance)) {
          // Primitives need to be recreated to update the geometry
          this.disableComponent("Orbit");
          this.enableComponent("Orbit");
        }
      } else if (type === "Height stick") {
        component.position = fixed;
      } else {
        component.position = fixed;
        component.orientation = new Cesium.VelocityOrientationProperty(fixed);
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
      const cartographic = this.props.orbit.positionGeodetic(Cesium.JulianDate.toDate(time), true);
      const content = DescriptionHelper.renderSatelliteDescription(time, cartographic, this.props);
      return content;
    });
  }

  createCesiumSatelliteEntity(entityName, entityKey, entityValue) {
    this.createCesiumEntity(entityName, entityKey, entityValue, this.props.name, this.description, this.props.sampledPosition.fixed, true);
  }

  createPoint() {
    const point = new Cesium.PointGraphics({
      pixelSize: 6,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.DIMGREY,
      outlineWidth: 1,
    });
    this.createCesiumSatelliteEntity("Point", "point", point);
  }

  createBox() {
    const size = 1000;
    const box = new Cesium.BoxGraphics({
      dimensions: new Cesium.Cartesian3(size, size, size),
      material: Cesium.Color.WHITE,
    });
    this.createCesiumSatelliteEntity("Box", "box", box);
  }

  createModel() {
    const model = new Cesium.ModelGraphics({
      uri: `./data/models/${this.props.name.split(" ").join("-")}.glb`,
      minimumPixelSize: 50,
      maximumScale: 10000,
    });
    this.createCesiumSatelliteEntity("3D model", "model", model);
  }

  createLabel() {
    const label = new Cesium.LabelGraphics({
      text: new Cesium.CallbackProperty((time) => {
        // Only add elevation when height stick is enabled
        if (!this.components["Height stick"]) {
          return this.props.name;
        }

        // Only add elevation for satellites with orbital period under 120 minutes (same as height stick)
        if (this.props.orbit.orbitalPeriod > 120) {
          return this.props.name;
        }

        const cartographic = this.props.orbit.positionGeodetic(Cesium.JulianDate.toDate(time), true);
        if (!cartographic) {
          return this.props.name;
        }

        const heightKm = Math.round(cartographic.height / 1000); // Round to nearest km
        return `${this.props.name} ${heightKm}km`;
      }, false),
      font: "15px Arial",
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Cesium.Color.DIMGREY,
      outlineWidth: 2,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      pixelOffset: new Cesium.Cartesian2(10, 0),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2000, 8e7),
      translucencyByDistance: new Cesium.NearFarScalar(6e7, 1.0, 8e7, 0.0),
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
    return this.usePathGraphicForOrbit ? this.components.Orbit instanceof Cesium.Entity : this.components.Orbit instanceof Cesium.Primitive;
  }

  get usePathGraphicForOrbit() {
    const sceneModeSupportsPrimitive = this.viewer.scene.mode === Cesium.SceneMode.SCENE3D;
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
    const path = new Cesium.PathGraphics({
      leadTime: (this.props.orbit.orbitalPeriod * 60) / 2 + 5,
      trailTime: (this.props.orbit.orbitalPeriod * 60) / 2 + 5,
      material: Cesium.Color.WHITE.withAlpha(0.15),
      resolution: 600,
      width: 2,
    });
    this.createCesiumEntity("Orbit", "path", path, this.props.name, this.description, this.props.sampledPosition.inertial, true);
  }

  createOrbitPolylinePrimitive() {
    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions: this.props.getSampledPositionsForNextOrbit(this.viewer.clock.currentTime),
          width: 2,
          arcType: Cesium.ArcType.NONE,
          // granularity: Cesium.Math.RADIANS_PER_DEGREE * 10,
          vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(new Cesium.Color(1.0, 1.0, 1.0, 0.15)),
        },
        id: this.props.name,
      }),
      appearance: new Cesium.PolylineColorAppearance(),
      asynchronous: false,
    });
    const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(this.viewer.clock.currentTime);
    if (Cesium.defined(icrfToFixed)) {
      // TODO: Cache the model matrix
      primitive.modelMatrix = Cesium.Matrix4.fromRotationTranslation(icrfToFixed);
    }
    this.components.Orbit = primitive;
  }

  createOrbitPolylineGeometry() {
    // Currently unused
    const geometryInstance = new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: this.props.getSampledPositionsForNextOrbit(this.viewer.clock.currentTime),
        width: 2,
        arcType: Cesium.ArcType.NONE,
        // granularity: Cesium.Math.RADIANS_PER_DEGREE * 10,
        vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(new Cesium.Color(1.0, 1.0, 1.0, 0.15)),
      },
      id: this.props.name,
    });
    this.components.Orbit = geometryInstance;
  }

  createOrbitTrack(leadTime = this.props.orbit.orbitalPeriod * 60, trailTime = 0) {
    const path = new Cesium.PathGraphics({
      leadTime,
      trailTime,
      material: Cesium.Color.GOLD.withAlpha(0.15),
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

    // Create a circle showing the satellite's visibility footprint on Earth's surface
    // This represents the area where the satellite can be observed above 10° elevation
    const visibilityCircle = new Cesium.EllipseGraphics({
      // Semi-transparent dark red material for visibility without obscuring terrain
      material: Cesium.Color.DARKRED.withAlpha(0.25),

      // Add a subtle outline to make the circle more visible
      outline: true,
      outlineColor: Cesium.Color.DARKRED.withAlpha(0.8),
      outlineWidth: 2,

      // Elevate slightly above ground to avoid clipping at corners
      height: 5000, // 5km above surface
      heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,

      // Dynamic radius based on satellite altitude and 10° minimum elevation
      // The radius represents the distance from subsatellite point to 10° horizon
      semiMajorAxis: new Cesium.CallbackProperty((time) => {
        const visibleWidthKm = this.props.getVisibleAreaWidth(time);
        const radiusKm = visibleWidthKm / 2; // Convert diameter to radius
        const expandedRadiusKm = radiusKm * 1.15; // Expand by 15% for better visibility
        const radiusM = expandedRadiusKm * 1000; // Convert to meters

        return radiusM;
      }, false),

      semiMinorAxis: new Cesium.CallbackProperty((time) => {
        const visibleWidthKm = this.props.getVisibleAreaWidth(time);
        const radiusKm = visibleWidthKm / 2; // Convert diameter to radius
        const expandedRadiusKm = radiusKm * 1.15; // Expand by 15% for better visibility
        return expandedRadiusKm * 1000; // Convert to meters
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

    // Create the main vertical line entity
    const entity = new Cesium.Entity({
      polyline: new Cesium.PolylineGraphics({
        positions: new Cesium.CallbackProperty((time) => {
          const satellitePosition = this.props.position(time);
          const cartographic = Cesium.Cartographic.fromCartesian(satellitePosition);
          const surfacePosition = Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            0,
          );
          return [surfacePosition, satellitePosition];
        }, false),
        followSurface: false,
        material: Cesium.Color.CYAN,
        width: 1,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2000, 8e7),
        translucencyByDistance: new Cesium.NearFarScalar(6e7, 1.0, 8e7, 0.0),
      }),
    });

    // Create static tick marks (simplified approach to avoid clock interference)
    const tickEntities = [];
    const maxAltitude = 1000; // Max altitude in km for tick marks

    // Create tick marks every 100km up to maxAltitude
    for (let altitude = 100; altitude <= maxAltitude; altitude += 100) {
      const is500km = altitude % 500 === 0;
      const tickId = `heightstick-tick-${this.props.satnum}-${altitude}`;

      const tickEntity = new Cesium.Entity({
        id: tickId,
        polyline: new Cesium.PolylineGraphics({
          positions: new Cesium.CallbackProperty((time) => {
            const satellitePosition = this.props.position(time);
            const cartographic = Cesium.Cartographic.fromCartesian(satellitePosition);
            const currentHeight = cartographic.height / 1000;

            // Only show tick if satellite is above this altitude
            if (currentHeight < altitude) {
              return [];
            }

            const tickPosition = Cesium.Cartesian3.fromRadians(
              cartographic.longitude,
              cartographic.latitude,
              altitude * 1000,
            );

            // Calculate eastward direction for tick
            const up = Cesium.Cartesian3.normalize(satellitePosition, new Cesium.Cartesian3());
            const east = Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, up, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(east, east);

            const tickLength = is500km ? 8000 : 4000;
            const tickEnd = Cesium.Cartesian3.add(
              tickPosition,
              Cesium.Cartesian3.multiplyByScalar(east, tickLength, new Cesium.Cartesian3()),
              new Cesium.Cartesian3(),
            );

            return [tickPosition, tickEnd];
          }, false),
          followSurface: false,
          material: Cesium.Color.CYAN,
          width: is500km ? 2 : 1,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2000, 8e7),
          translucencyByDistance: new Cesium.NearFarScalar(6e7, 1.0, 8e7, 0.0),
        }),
      });

      this.viewer.entities.add(tickEntity);
      tickEntities.push(tickEntity);
    }

    // Store tick entities for cleanup
    entity.tickEntities = tickEntities;
    this.components["Height stick"] = entity;
  }

  createGroundStationLink() {
    if (!this.props.groundStationAvailable) {
      return;
    }
    const polyline = new Cesium.PolylineGraphics({
      followSurface: false,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.5,
        color: Cesium.Color.FORESTGREEN,
      }),
      positions: new Cesium.CallbackProperty((time) => {
        const satPosition = this.props.position(time);
        const groundPosition = this.props.groundStationPosition.cartesian;
        const positions = [satPosition, groundPosition];
        return positions;
      }, false),
      show: new Cesium.CallbackProperty((time) => this.props.passIntervals.contains(time), false),
      width: 5,
    });
    this.createCesiumSatelliteEntity("Ground station link", "polyline", polyline);
  }

  set groundStations(groundStations) {
    // No groundstation calculation for GEO satellites
    if (this.props.orbit.orbitalPeriod > 60 * 12) {
      return;
    }

    this.props.groundStations = groundStations;
    this.props.clearPasses();
    if (this.isSelected || this.isTracked) {
      this.props.updatePasses(this.viewer.clock.currentTime);
      if (this.isSelected) {
        CesiumTimelineHelper.updateHighlightRanges(this.viewer, this.props.passes, this.props.name);
      }
    }
    if (this.created) {
      this.createGroundStationLink();
    }
  }
}
