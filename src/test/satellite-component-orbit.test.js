import { describe, it, expect, vi, beforeEach } from "vitest";
import { SatelliteComponentCollection } from "../modules/SatelliteComponentCollection";
import { FUTURE_EPOCH_TLE, ISS_TLE } from "./fixtures/tle-data";
import { CallbackProperty, Entity, Primitive, GeometryInstance, SampledPositionProperty } from "@cesium/engine";

// Mock Cesium viewer for component testing
const createMockViewer = () => ({
  entities: {
    add: vi.fn((entity) => entity),
    remove: vi.fn(),
    removeAll: vi.fn(),
    values: [],
    contains: vi.fn(() => false),
  },
  trackedEntity: undefined,
  trackedEntityChanged: {
    addEventListener: vi.fn(() => vi.fn()), // Return unsubscribe function
  },
  selectedEntity: undefined,
  selectedEntityChanged: {
    addEventListener: vi.fn(() => vi.fn()),
  },
  clock: {
    currentTime: {
      dayNumber: 2459580,
      secondsOfDay: 0,
    },
    shouldAnimate: false,
    onTick: {
      addEventListener: vi.fn(() => vi.fn()),
    },
    onStop: {
      addEventListener: vi.fn(() => vi.fn()),
    },
    clockStep: 0,
    startTime: {},
    stopTime: {},
  },
  scene: {
    requestRender: vi.fn(),
    screenSpaceCameraController: {},
    mode: 3, // SceneMode.SCENE3D
    primitives: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    globe: {
      getHeight: vi.fn(() => 0),
    },
  },
  timeline: {
    container: document.createElement("div"),
    updateFromClock: vi.fn(),
    _highlightRanges: [],
  },
  animation: {
    container: document.createElement("div"),
  },
  screenSpaceEventHandler: {
    getInputAction: vi.fn(),
    setInputAction: vi.fn(),
  },
});

describe("SatelliteComponentCollection - Orbit Component Lifecycle", () => {
  let collection;
  let mockViewer;

  beforeEach(() => {
    mockViewer = createMockViewer();
  });

  describe("Pre-launch satellites with no initial positions", () => {
    beforeEach(() => {
      collection = new SatelliteComponentCollection(mockViewer, FUTURE_EPOCH_TLE, ["Prelaunch"]);
      // Mock init to skip initialization and avoid reference frame issues
      collection.init = vi.fn();
      collection.eventListeners = {
        sampledPosition: vi.fn(),
        selectedEntity: vi.fn(),
        trackedEntity: vi.fn(),
      };
      // Mock sampledPosition property
      collection.props.sampledPosition = {
        valid: false,
        fixed: null,
        inertial: null,
      };
    });

    it("should allow orbit component to be enabled even when positions unavailable", () => {
      // Mock getSampledPositionsForNextOrbit to return empty array (no positions available)
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => []);

      // Enable orbit component - should not throw error
      expect(() => {
        collection.enableComponent("Orbit");
      }).not.toThrow();

      // Component should be marked as enabled in componentNames
      expect(collection.componentNames).toContain("Orbit");
    });

    it("should not create Orbit component object when no positions available", () => {
      // Mock getSampledPositionsForNextOrbit to return empty array
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => []);

      collection.enableComponent("Orbit");

      // Component should be enabled but not created (not in components object)
      expect(collection.componentNames).toContain("Orbit");
      expect("Orbit" in collection.components).toBe(false);
    });

    it("should auto-create Orbit component when positions become available", () => {
      // Initially no positions
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => []);

      // Enable orbit - won't create component
      collection.enableComponent("Orbit");
      expect("Orbit" in collection.components).toBe(false);

      // Simulate positions becoming available
      const mockPositions = [
        { x: 1000000, y: 2000000, z: 3000000 },
        { x: 1100000, y: 2100000, z: 3100000 },
        { x: 1200000, y: 2200000, z: 3200000 },
      ];
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => mockPositions);
      collection.props.sampledPosition.valid = true;

      // Trigger update - should auto-create component
      collection.updatedSampledPositionForComponents(true);

      // Now component should exist
      expect("Orbit" in collection.components).toBe(true);
      expect(collection.components.Orbit).not.toBeNull();
    });

    it("should allow orbit track component to be enabled even when positions unavailable", () => {
      // Mock sampledPosition to be invalid
      collection.props.sampledPosition = {
        valid: false,
        fixed: null,
        inertial: null,
      };

      // Enable orbit track component - should not throw error
      expect(() => {
        collection.enableComponent("Orbit track");
      }).not.toThrow();

      // Component should be marked as enabled
      expect(collection.componentNames).toContain("Orbit track");
    });
  });

  describe("Orbit component recreation after time travel", () => {
    beforeEach(() => {
      collection = new SatelliteComponentCollection(mockViewer, ISS_TLE, ["Space Stations"]);
      // Mock init to skip initialization and avoid reference frame issues
      collection.init = vi.fn();
      collection.eventListeners = {
        sampledPosition: vi.fn(),
        selectedEntity: vi.fn(),
        trackedEntity: vi.fn(),
      };
      // Mock sampledPosition property
      collection.props.sampledPosition = {
        valid: true,
        fixed: null,
        inertial: null,
      };
    });

    it("should recreate Orbit primitive when positions change significantly", () => {
      // Mock initial positions
      const initialPositions = [
        { x: 1000000, y: 2000000, z: 3000000 },
        { x: 1100000, y: 2100000, z: 3100000 },
      ];
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => initialPositions);

      // Enable orbit
      collection.enableComponent("Orbit");
      const originalComponent = collection.components.Orbit;

      // Mock disable/enable to track recreation
      const disableSpy = vi.spyOn(collection, "disableComponent");
      const enableSpy = vi.spyOn(collection, "enableComponent");

      // Simulate positions changing after time travel
      const newPositions = [
        { x: 5000000, y: 6000000, z: 7000000 },
        { x: 5100000, y: 6100000, z: 7100000 },
      ];
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => newPositions);

      // Trigger update with update=true (indicates positions have changed)
      collection.updatedSampledPositionForComponents(true);

      // Should have recreated the component (if it was a Primitive)
      if (originalComponent instanceof Primitive || originalComponent instanceof GeometryInstance) {
        expect(disableSpy).toHaveBeenCalledWith("Orbit");
        expect(enableSpy).toHaveBeenCalledWith("Orbit");
      }
    });
  });

  describe("Component enable/disable state management", () => {
    beforeEach(() => {
      collection = new SatelliteComponentCollection(mockViewer, ISS_TLE, ["Space Stations"]);
      // Mock init to skip initialization and avoid reference frame issues
      collection.init = vi.fn();
      collection.eventListeners = {
        sampledPosition: vi.fn(),
        selectedEntity: vi.fn(),
        trackedEntity: vi.fn(),
      };
      // Mock sampledPosition property
      collection.props.sampledPosition = {
        valid: true,
        fixed: null,
        inertial: null,
      };
    });

    it("should preserve user intent to show orbit in componentNames", () => {
      // Mock positions available
      const positions = [
        { x: 1000000, y: 2000000, z: 3000000 },
        { x: 1100000, y: 2100000, z: 3100000 },
      ];
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => positions);

      // Enable orbit
      collection.enableComponent("Orbit");

      // User intent should be recorded in componentNames
      expect(collection.componentNames).toContain("Orbit");

      // Component should also be created
      expect("Orbit" in collection.components).toBe(true);
    });

    it("should remove orbit from componentNames when disabled", () => {
      // Mock positions available
      const positions = [
        { x: 1000000, y: 2000000, z: 3000000 },
        { x: 1100000, y: 2100000, z: 3100000 },
      ];
      collection.props.getSampledPositionsForNextOrbit = vi.fn(() => positions);

      // Enable then disable orbit
      collection.enableComponent("Orbit");
      expect(collection.componentNames).toContain("Orbit");

      collection.disableComponent("Orbit");

      // Should no longer be in componentNames
      expect(collection.componentNames).not.toContain("Orbit");
    });
  });

  describe("Orbit track position property for prelaunch satellites", () => {
    let collection;

    beforeEach(() => {
      collection = new SatelliteComponentCollection(mockViewer, FUTURE_EPOCH_TLE, ["Prelaunch"]);
      collection.init = vi.fn();
      collection.eventListeners = {
        sampledPosition: vi.fn(),
        selectedEntity: vi.fn(),
        trackedEntity: vi.fn(),
      };
    });

    it("should use SampledPositionProperty for Orbit track, not CallbackProperty", () => {
      // Create a mock SampledPositionProperty (has getValueInReferenceFrame)
      const mockFixed = new SampledPositionProperty();
      const mockInertial = new SampledPositionProperty();

      collection.props.sampledPosition = {
        valid: true,
        fixed: mockFixed,
        inertial: mockInertial,
      };

      // Enable Orbit track so component is created
      collection.enableComponent("Orbit track");

      // The component should exist
      expect("Orbit track" in collection.components).toBe(true);

      // Call updatedSampledPositionForComponents which assigns position properties
      collection.updatedSampledPositionForComponents();

      const orbitTrackEntity = collection.components["Orbit track"];
      // Orbit track must use SampledPositionProperty, not CallbackProperty
      // PathGraphics requires getValueInReferenceFrame which only SampledPositionProperty provides
      expect(orbitTrackEntity.position).toBe(mockFixed);
      expect(orbitTrackEntity.position).not.toBeInstanceOf(CallbackProperty);
    });

    it("should use CallbackProperty for non-PathGraphics prelaunch components", () => {
      const mockFixed = new SampledPositionProperty();
      const mockInertial = new SampledPositionProperty();

      collection.props.sampledPosition = {
        valid: true,
        fixed: mockFixed,
        inertial: mockInertial,
      };

      // Enable Point component (uses Entity, not PathGraphics)
      collection.enableComponent("Point");

      collection.updatedSampledPositionForComponents();

      const pointEntity = collection.components.Point;
      // Non-PathGraphics prelaunch components should use CallbackProperty
      // for launch site position override
      expect(pointEntity.position).toBeInstanceOf(CallbackProperty);
    });
  });

  describe("Dead code removal", () => {
    it("should not have createPassArc method (dead code removed)", () => {
      const collection = new SatelliteComponentCollection(mockViewer, ISS_TLE, ["Space Stations"]);
      expect(collection.createPassArc).toBeUndefined();
    });

    it("should not have Pass arc in createComponent switch", () => {
      const collection = new SatelliteComponentCollection(mockViewer, ISS_TLE, ["Space Stations"]);
      collection.init = vi.fn();
      collection.eventListeners = {
        sampledPosition: vi.fn(),
        selectedEntity: vi.fn(),
        trackedEntity: vi.fn(),
      };
      collection.props.sampledPosition = {
        valid: true,
        fixed: null,
        inertial: null,
      };

      // Enabling "Pass arc" should hit the default case (console.error)
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      collection.enableComponent("Pass arc");
      expect(consoleSpy).toHaveBeenCalledWith("Unknown component");
      consoleSpy.mockRestore();
    });
  });
});
