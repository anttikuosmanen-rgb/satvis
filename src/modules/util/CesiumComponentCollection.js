import {
  Cartesian3,
  Entity,
  EntityView,
  GeometryInstance,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  PolylineColorAppearance,
  Primitive,
  Transforms,
  VelocityOrientationProperty,
  defined,
} from "@cesium/engine";

import { CesiumCallbackHelper } from "./CesiumCallbackHelper";

/** CesiumComponentCollection
 *
 * A wrapper class for Cesium entities and primitives that all belong to a common object being represented.
 * The individual entities or primitives are created on demand by the inheriting child class and are added
 * to a common entity collection or primitive collection shared between all ComponentCollections.
 */
export class CesiumComponentCollection {
  #components = {};

  static geometries = [];

  static primitive = undefined;

  static primitivePendingUpdate = false;

  static primitivePendingCreation = false;

  constructor(viewer, lazy = true) {
    this.viewer = viewer;
    // Create entities only when needed and delete them on disable
    this.lazy = lazy;
  }

  get components() {
    return this.#components;
  }

  get componentNames() {
    return Object.keys(this.components);
  }

  get created() {
    return this.componentNames.length > 0;
  }

  show(componentNames = this.componentNames) {
    componentNames.forEach((componentName) => {
      this.enableComponent(componentName);
    });
  }

  hide(componentNames = this.componentNames) {
    componentNames.forEach((componentName) => {
      this.disableComponent(componentName);
    });
  }

  enableComponent(name) {
    if (!(name in this.components)) {
      return;
    }
    const component = this.components[name];
    if (component instanceof Entity && !this.viewer.entities.contains(component)) {
      this.viewer.entities.add(component);
    } else if (component instanceof Primitive && !this.viewer.scene.primitives.contains(component)) {
      this.viewer.scene.primitives.add(component);
    } else if (component instanceof GeometryInstance) {
      this.constructor.geometries.push(component);
      this.recreateGeometryInstancePrimitive();
    }
    // Only set defaultEntity if component is actually an Entity (not a Primitive)
    if (!this.defaultEntity && component instanceof Entity) {
      this.defaultEntity = component;
    }
  }

  disableComponent(name) {
    if (!(name in this.components)) {
      return;
    }
    const component = this.components[name];
    if (component instanceof Entity) {
      this.viewer.entities.remove(component);
    } else if (component instanceof Primitive) {
      this.viewer.scene.primitives.remove(component);
    } else if (component instanceof GeometryInstance) {
      this.constructor.geometries = this.constructor.geometries.filter((geometry) => geometry !== component);
      this.recreateGeometryInstancePrimitive();
    }
    if (this.lazy) {
      delete this.components[name];
    }
  }

  recreateGeometryInstancePrimitive() {
    if (this.constructor.primitivePendingUpdate) {
      return;
    }
    this.constructor.primitivePendingUpdate = true;
    const removeCallback = CesiumCallbackHelper.createPeriodicTickCallback(this.viewer, 30, () => {
      if (this.constructor.primitivePendingCreation) {
        return;
      }
      this.constructor.primitivePendingUpdate = false;
      if (this.constructor.geometries.length === 0) {
        this.viewer.scene.primitives.remove(this.constructor.primitive);
        this.constructor.primitive = undefined;
        this.viewer.scene.requestRender();
        return;
      }
      this.constructor.primitivePendingCreation = true;
      const primitive = new Primitive({
        geometryInstances: this.constructor.geometries,
        appearance: new PolylineColorAppearance(),
      });
      // Force asyncrounous primitve creation before adding to scene
      let lastState = -1;
      const readyCallback = this.viewer.clock.onTick.addEventListener(() => {
        if (!primitive.ready) {
          const state = primitive._state;
          if (state !== lastState) {
            lastState = state;
            // Trigger primitive update to progress through creation states
            primitive.update(this.viewer.scene.frameState);
            return;
          }
          return;
        }
        // Update model matrix right before adding to scene
        const icrfToFixed = Transforms.computeIcrfToFixedMatrix(this.viewer.clock.currentTime);
        if (defined(icrfToFixed)) {
          primitive.modelMatrix = Matrix4.fromRotationTranslation(icrfToFixed);
        }
        if (this.constructor.primitive) {
          this.viewer.scene.primitives.remove(this.constructor.primitive);
        }
        this.viewer.scene.primitives.add(primitive);
        this.constructor.primitive = primitive;
        this.viewer.scene.requestRender();
        this.constructor.primitivePendingCreation = false;
        readyCallback();
      });
      removeCallback();
    });
  }

  /**
   * Returns an array of all components that are added to the viewer.
   * If component creation is
   */
  get visibleComponents() {
    return Object.values(this.components).filter((component) => {
      if (component instanceof Entity) {
        return this.viewer.entities.contains(component);
      }
      if (component instanceof Primitive) {
        return this.viewer.scene.primitives.contains(component);
      }
      return false;
    });
  }

  get isSelected() {
    return Object.values(this.components).some((entity) => this.viewer.selectedEntity === entity);
  }

  get isTracked() {
    return Object.values(this.components).some((entity) => this.viewer.trackedEntity === entity);
  }

  track(animate = false) {
    if (!this.defaultEntity) {
      return;
    }
    if (!animate) {
      this.viewer.trackedEntity = this.defaultEntity;
      return;
    }

    this.viewer.trackedEntity = undefined;
    const clockRunning = this.viewer.clock.shouldAnimate;
    this.viewer.clock.shouldAnimate = false;

    this.viewer
      .flyTo(this.defaultEntity, {
        offset: new HeadingPitchRange(0, -CesiumMath.PI_OVER_FOUR, 1580000),
      })
      .then((result) => {
        if (result) {
          this.viewer.trackedEntity = this.defaultEntity;
          this.viewer.clock.shouldAnimate = clockRunning;
        }
      });
  }

  setSelectedOnTickCallback(onTickCallback = () => {}, onUnselectCallback = () => {}) {
    const onTickEventRemovalCallback = this.viewer.clock.onTick.addEventListener((clock) => {
      onTickCallback(clock);
    });
    const onSelectedEntityChangedRemovalCallback = this.viewer.selectedEntityChanged.addEventListener(() => {
      onTickEventRemovalCallback();
      onSelectedEntityChangedRemovalCallback();
      onUnselectCallback();
    });
  }

  setTrackedOnTickCallback(onTickCallback = () => {}, onUntrackCallback = () => {}) {
    const onTickEventRemovalCallback = this.viewer.clock.onTick.addEventListener((clock) => {
      onTickCallback(clock);
    });
    const onTrackedEntityChangedRemovalCallback = this.viewer.trackedEntityChanged.addEventListener(() => {
      onTickEventRemovalCallback();
      onTrackedEntityChangedRemovalCallback();
      onUntrackCallback();
    });
  }

  artificiallyTrack(onTickCallback = () => {}, onUntrackCallback = () => {}) {
    const cameraTracker = new EntityView(this.defaultEntity, this.viewer.scene, this.viewer.scene.globe.ellipsoid);
    this.setTrackedOnTickCallback(
      (clock) => {
        cameraTracker.update(clock.currentTime);
        onTickCallback();
      },
      () => {
        onUntrackCallback();
        // Restore default view angle if no new entity is tracked
        if (typeof this.viewer.trackedEntity === "undefined") {
          this.viewer.flyTo(this.defaultEntity, {
            offset: new HeadingPitchRange(0, CesiumMath.toRadians(-90.0), 2000000),
          });
        }
      },
    );
  }

  createCesiumEntity(componentName, entityKey, entityValue, name, description, position, moving) {
    const entity = new Entity({
      name,
      description,
      position,
      viewFrom: new Cartesian3(0, -3600000, 4200000),
    });

    if (moving) {
      entity.orientation = new VelocityOrientationProperty(position);
    }

    entity[entityKey] = entityValue;
    this.components[componentName] = entity;
  }
}
