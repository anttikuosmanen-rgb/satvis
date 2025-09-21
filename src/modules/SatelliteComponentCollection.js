import * as Cesium from "@cesium/engine";
import CesiumSensorVolumes from "cesium-sensor-volumes";

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

  disableComponent(name) {
    super.disableComponent(name);
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
    if (name === "3D model") {
      // Restore old label offset
      if (this.components.Label) {
        this.components.Label.label.pixelOffset = new Cesium.Cartesian2(10, 0);
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
      if (!entity || entity?.name === "Ground station") {
        CesiumTimelineHelper.clearHighlightRanges(this.viewer);
        return;
      }
      if (this.isSelected) {
        this.props.updatePasses(this.viewer.clock.currentTime);
        CesiumTimelineHelper.updateHighlightRanges(this.viewer, this.props.passes);

        // Update Pass arc component if it exists
        if ("Pass arc" in this.components) {
          this.disableComponent("Pass arc");
          this.enableComponent("Pass arc");
        }
      } else {
        // Disable Pass arc when satellite is not selected
        if ("Pass arc" in this.components) {
          this.disableComponent("Pass arc");
        }
      }
    });

    this.eventListeners.trackedEntity = this.viewer.trackedEntityChanged.addEventListener(() => {
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
      } else if (type === "Sensor cone") {
        component.position = fixed;
        component.orientation = new Cesium.CallbackProperty((time) => {
          const position = this.props.position(time);
          const hpr = new Cesium.HeadingPitchRoll(0, Cesium.Math.toRadians(180), 0);
          return Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
        }, false);
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
      case "Sensor cone":
        this.createCone();
        break;
      case "3D model":
        this.createModel();
        break;
      case "Ground station link":
        this.createGroundStationLink();
        break;
      case "Pass arc":
        this.createPassArc();
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
      text: this.props.name,
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
      console.log(`[${this.props.name}] Visibility area skipped - orbital period ${this.props.orbit.orbitalPeriod.toFixed(1)} min > 120 min (non-LEO)`);
      return;
    }

    console.log(`[${this.props.name}] Creating visibility circle for LEO satellite (period: ${this.props.orbit.orbitalPeriod.toFixed(1)} min)`);

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
        const radiusM = radiusKm * 1000; // Convert to meters

        // Debug logging for circle radius updates
        console.log(`[${this.props.name}] Visibility circle radius: ${radiusKm.toFixed(1)} km (${radiusM.toFixed(0)} m)`);

        return radiusM;
      }, false),

      semiMinorAxis: new Cesium.CallbackProperty((time) => {
        const visibleWidthKm = this.props.getVisibleAreaWidth(time);
        const radiusKm = visibleWidthKm / 2; // Convert diameter to radius
        return radiusKm * 1000; // Convert to meters
      }, false),
    });

    // Debug logging for visibility circle parameters
    console.log(`[${this.props.name}] Visibility circle parameters:`, {
      height: '5000m above ground',
      heightReference: 'RELATIVE_TO_GROUND',
      material: 'DARKRED alpha 0.25',
      outline: 'DARKRED alpha 0.8',
      dynamicRadius: 'visible area calculation (10° elevation)',
      shape: 'circle (equal major/minor axes)'
    });

    // Add the visibility circle to the Cesium scene
    this.createCesiumSatelliteEntity("Visibility area", "ellipse", visibilityCircle);
  }

  createCone(fov = 10) {
    if (this.props.orbit.orbitalPeriod > 60 * 2) {
      // Cone graphic unavailable for non-LEO satellites
      return;
    }
    const entity = new Cesium.Entity();
    entity.addProperty("conicSensor");
    entity.conicSensor = new CesiumSensorVolumes.ConicSensorGraphics({
      radius: 1000000,
      innerHalfAngle: Cesium.Math.toRadians(0),
      outerHalfAngle: Cesium.Math.toRadians(fov),
      lateralSurfaceMaterial: Cesium.Color.GOLD.withAlpha(0.15),
      intersectionColor: Cesium.Color.GOLD.withAlpha(0.3),
      intersectionWidth: 1,
    });
    this.components["Sensor cone"] = entity;
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

  createPassArc() {
    if (!this.props.groundStationAvailable || !this.isSelected) {
      return;
    }

    // Find current pass
    const getCurrentPass = (time) => {
      const currentTime = new Date(Cesium.JulianDate.toDate(time));
      return this.props.passes.find(pass => {
        const passStart = new Date(pass.start);
        const passEnd = new Date(pass.end);
        return currentTime >= passStart && currentTime <= passEnd;
      });
    };

    // Create dynamic material that changes color based on eclipse status
    const dynamicMaterial = new Cesium.ColorMaterialProperty(
      new Cesium.CallbackProperty((time) => {
        try {
          const isEclipsed = this.props.orbit.isInEclipse(Cesium.JulianDate.toDate(time));
          return isEclipsed
            ? Cesium.Color.DARKRED.withAlpha(0.8)  // Dark red for eclipsed portions
            : Cesium.Color.CYAN.withAlpha(0.9);    // Bright cyan for sunlit portions during pass
        } catch (error) {
          // Fallback to cyan if eclipse calculation fails
          return Cesium.Color.CYAN.withAlpha(0.8);
        }
      }, false)
    );

    const path = new Cesium.PathGraphics({
      leadTime: new Cesium.CallbackProperty((time) => {
        const currentPass = getCurrentPass(time);
        if (!currentPass) return 0;

        const currentTime = Cesium.JulianDate.toDate(time);
        const passEnd = new Date(currentPass.end);
        return Math.max(0, (passEnd.getTime() - currentTime.getTime()) / 1000);
      }, false),
      trailTime: new Cesium.CallbackProperty((time) => {
        const currentPass = getCurrentPass(time);
        if (!currentPass) return 0;

        const currentTime = Cesium.JulianDate.toDate(time);
        const passStart = new Date(currentPass.start);
        return Math.max(0, (currentTime.getTime() - passStart.getTime()) / 1000);
      }, false),
      material: dynamicMaterial,
      resolution: 120, // Higher resolution for more detailed pass arc
      width: 4, // Wider to make it stand out
      show: new Cesium.CallbackProperty((time) => {
        // Only show when satellite is selected and during a pass
        return this.isSelected && this.props.passIntervals.contains(time);
      }, false),
    });
    this.createCesiumSatelliteEntity("Pass arc", "path", path);
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
        CesiumTimelineHelper.updateHighlightRanges(this.viewer, this.props.passes);
      }
    }
    if (this.created) {
      this.createGroundStationLink();
    }
  }
}
