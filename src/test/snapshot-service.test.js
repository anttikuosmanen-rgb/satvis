import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import LZString from "lz-string";
import { SnapshotService } from "../modules/util/SnapshotService";

// Mock the Cesium imports
vi.mock("@cesium/engine", () => ({
  JulianDate: {
    toIso8601: (date) => date?.iso || "2025-06-15T12:00:00Z",
    fromIso8601: (iso) => ({ iso }),
    now: () => ({ iso: "2025-06-15T12:00:00Z" }),
    compare: () => -1, // Simulates "now" is before epoch
    addSeconds: (time) => time,
    addDays: (time) => time,
  },
  Cartesian3: class {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  },
  SampledPositionProperty: class {
    constructor() {
      this._property = { _times: [] };
    }
  },
  TimeIntervalCollection: class {
    constructor() {
      this._intervals = [];
    }
  },
  TimeInterval: class {},
  Ellipsoid: { WGS84: {} },
  ExtrapolationType: { HOLD: 0 },
  LagrangePolynomialApproximation: {},
  Matrix3: { multiplyByVector: () => ({}) },
  ReferenceFrame: { INERTIAL: 0 },
  Transforms: { computeTemeToPseudoFixedMatrix: () => ({}), computeFixedToIcrfMatrix: () => ({}) },
  defined: () => true,
}));

// Mock toast proxy
vi.mock("../composables/useToastProxy", () => ({
  useToastProxy: () => ({
    add: vi.fn(),
  }),
}));

// Mock SatelliteProperties to avoid Cesium import cascade
vi.mock("../modules/SatelliteProperties", () => ({
  SatelliteProperties: {
    extractCanonicalName: (name) =>
      name
        .replace(/^\[Snapshot\]\s*/i, "")
        .replace(/^\[Custom\]\s*/i, "")
        .replace(/\s*\*\s*$/, "")
        .trim(),
  },
}));

// Mock sat store
const mockSatStore = {
  enabledSatellites: [],
  groundStations: [],
};
vi.mock("../stores/sat", () => ({
  useSatStore: () => mockSatStore,
}));

describe("SnapshotService - Serialization", () => {
  let mockCesiumController;

  beforeEach(() => {
    // Create mock CesiumController
    mockCesiumController = {
      viewer: {
        clock: {
          currentTime: { iso: "2025-06-15T12:00:00Z" },
          startTime: { iso: "2025-06-15T00:00:00Z" },
          stopTime: { iso: "2025-06-22T00:00:00Z" },
          multiplier: 1,
          shouldAnimate: true,
        },
        camera: {
          position: { x: 1000000, y: 2000000, z: 3000000 },
          heading: 0.5,
          pitch: -0.3,
          roll: 0,
        },
        trackedEntity: null,
        timeline: {
          updateFromClock: vi.fn(),
        },
      },
      sats: {
        activeSatellites: [],
        getSatellite: vi.fn(),
        addFromTle: vi.fn(),
        updateStore: vi.fn(),
        enabledComponents: ["Point", "Label"],
        isInZenithView: false,
      },
      captureTrackedEntityCameraOffset: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should serialize and deserialize snapshot round-trip correctly", () => {
    const service = new SnapshotService(mockCesiumController);

    const state = {
      v: 1,
      t: {
        c: "2025-06-15T12:00:00Z",
        s: "2025-06-15T00:00:00Z",
        e: "2025-06-22T00:00:00Z",
        m: 1,
        a: true,
      },
      cam: {
        p: [1000000, 2000000, 3000000],
        h: 0.5,
        i: -0.3,
        r: 0,
      },
    };

    const serialized = service.serializeSnapshot(state);
    expect(serialized).toMatch(/^z:/);

    const deserialized = service.deserializeSnapshot(serialized);
    expect(deserialized).toEqual(state);
  });

  it("should throw error for invalid snapshot format", () => {
    const service = new SnapshotService(mockCesiumController);

    expect(() => service.deserializeSnapshot("invalid")).toThrow("Unknown snapshot format");
  });

  it("should throw error for corrupted compressed data", () => {
    const service = new SnapshotService(mockCesiumController);

    expect(() => service.deserializeSnapshot("z:invaliddata")).toThrow("Failed to decompress snapshot data");
  });

  it("should handle special characters in satellite names", () => {
    const service = new SnapshotService(mockCesiumController);

    const state = {
      v: 1,
      t: {
        c: "2025-06-15T12:00:00Z",
        s: "2025-06-15T00:00:00Z",
        e: "2025-06-22T00:00:00Z",
        m: 1,
        a: true,
      },
      trk: {
        n: "ISS (ZARYA) *",
        v: [1000, 2000, 3000],
      },
    };

    const serialized = service.serializeSnapshot(state);
    const deserialized = service.deserializeSnapshot(serialized);

    expect(deserialized.trk.n).toBe("ISS (ZARYA) *");
  });

  it("should compress data significantly", () => {
    const service = new SnapshotService(mockCesiumController);

    const largeState = {
      v: 1,
      t: {
        c: "2025-06-15T12:00:00Z",
        s: "2025-06-15T00:00:00Z",
        e: "2025-06-22T00:00:00Z",
        m: 1,
        a: true,
      },
      tle: {
        "ISS (ZARYA)": "ISS (ZARYA)\n1 25544U 98067A   25166.50000000  .00000000  00000-0  00000-0 0  9999\n2 25544  51.6400   0.0000 0000000   0.0000   0.0000 15.50000000000000",
        STARLINK: "STARLINK\n1 12345U 20001A   25166.50000000  .00000000  00000-0  00000-0 0  9999\n2 12345  53.0000   0.0000 0000000   0.0000   0.0000 15.00000000000000",
      },
    };

    const uncompressedJson = JSON.stringify(largeState);
    const serialized = service.serializeSnapshot(largeState);

    // Compression should reduce size
    expect(serialized.length).toBeLessThan(uncompressedJson.length);
  });
});

describe("SnapshotService - Time State", () => {
  let mockCesiumController;

  beforeEach(() => {
    mockCesiumController = {
      viewer: {
        clock: {
          currentTime: { iso: "2025-06-15T12:00:00Z" },
          startTime: { iso: "2025-06-15T00:00:00Z" },
          stopTime: { iso: "2025-06-22T00:00:00Z" },
          multiplier: 2,
          shouldAnimate: false,
        },
        camera: {
          position: { x: 1000000, y: 2000000, z: 3000000 },
          heading: 0,
          pitch: 0,
          roll: 0,
        },
        trackedEntity: null,
        timeline: {
          updateFromClock: vi.fn(),
        },
      },
      sats: {
        activeSatellites: [],
        enabledComponents: ["Point", "Label"],
        isInZenithView: false,
      },
    };
  });

  it("should capture all clock properties", () => {
    const service = new SnapshotService(mockCesiumController);

    const timeState = service.captureTimeState();

    expect(timeState.c).toBe("2025-06-15T12:00:00Z");
    expect(timeState.s).toBe("2025-06-15T00:00:00Z");
    expect(timeState.e).toBe("2025-06-22T00:00:00Z");
    expect(timeState.m).toBe(2);
    expect(timeState.a).toBe(false);
  });

  it("should restore time state correctly (always paused)", () => {
    const service = new SnapshotService(mockCesiumController);

    const timeState = {
      c: "2025-07-01T18:30:00Z",
      s: "2025-07-01T00:00:00Z",
      e: "2025-07-08T00:00:00Z",
      m: 60,
      a: true, // Original was playing, but should restore as paused
    };

    service.restoreTimeState(timeState);

    expect(mockCesiumController.viewer.clock.currentTime).toEqual({ iso: "2025-07-01T18:30:00Z" });
    expect(mockCesiumController.viewer.clock.startTime).toEqual({ iso: "2025-07-01T00:00:00Z" });
    expect(mockCesiumController.viewer.clock.stopTime).toEqual({ iso: "2025-07-08T00:00:00Z" });
    expect(mockCesiumController.viewer.clock.multiplier).toBe(60);
    // Snapshots always restore in paused state for user control
    expect(mockCesiumController.viewer.clock.shouldAnimate).toBe(false);
    expect(mockCesiumController.viewer.timeline.updateFromClock).toHaveBeenCalled();
  });

  it("should handle paused state", () => {
    mockCesiumController.viewer.clock.shouldAnimate = false;
    mockCesiumController.viewer.clock.multiplier = 0;

    const service = new SnapshotService(mockCesiumController);
    const timeState = service.captureTimeState();

    expect(timeState.a).toBe(false);
    expect(timeState.m).toBe(0);
  });
});

describe("SnapshotService - Camera State", () => {
  let mockCesiumController;

  beforeEach(() => {
    mockCesiumController = {
      viewer: {
        clock: {
          currentTime: { iso: "2025-06-15T12:00:00Z" },
          startTime: { iso: "2025-06-15T00:00:00Z" },
          stopTime: { iso: "2025-06-22T00:00:00Z" },
          multiplier: 1,
          shouldAnimate: true,
        },
        camera: {
          position: { x: 10000000, y: 5000000, z: 3000000 },
          heading: 1.5708,
          pitch: -0.7854,
          roll: 0.1,
          setView: vi.fn(),
        },
        trackedEntity: null,
        timeline: {
          updateFromClock: vi.fn(),
        },
      },
      sats: {
        activeSatellites: [],
        enabledComponents: ["Point", "Label"],
        isInZenithView: false,
      },
    };
  });

  it("should capture globe camera position and orientation", () => {
    const service = new SnapshotService(mockCesiumController);

    const camState = service.captureGlobeCamera();

    expect(camState.p).toEqual([10000000, 5000000, 3000000]);
    expect(camState.h).toBe(1.5708);
    expect(camState.i).toBe(-0.7854);
    expect(camState.r).toBe(0.1);
  });

  it("should restore globe camera position", () => {
    const service = new SnapshotService(mockCesiumController);

    const camState = {
      p: [20000000, 10000000, 5000000],
      h: 0.5,
      i: -0.3,
      r: 0,
    };

    service.restoreGlobeCamera(camState);

    expect(mockCesiumController.viewer.camera.setView).toHaveBeenCalledWith({
      destination: expect.objectContaining({
        x: 20000000,
        y: 10000000,
        z: 5000000,
      }),
      orientation: {
        heading: 0.5,
        pitch: -0.3,
        roll: 0,
      },
    });
  });

  it("should capture tracked entity state with offset", () => {
    const mockEntity = {
      name: "ISS (ZARYA)",
    };
    mockCesiumController.viewer.trackedEntity = mockEntity;
    mockCesiumController.captureTrackedEntityCameraOffset = vi.fn().mockReturnValue({
      viewFrom: { x: 1000, y: -3600000, z: 4200000 },
      range: 5000000,
    });

    const service = new SnapshotService(mockCesiumController);
    const trkState = service.captureTrackedCamera();

    expect(trkState.n).toBe("ISS (ZARYA)");
    expect(trkState.v).toEqual([1000, -3600000, 4200000]);
  });

  it("should return null for tracked camera when no entity tracked", () => {
    mockCesiumController.viewer.trackedEntity = null;

    const service = new SnapshotService(mockCesiumController);
    const trkState = service.captureTrackedCamera();

    expect(trkState).toBeNull();
  });
});

describe("SnapshotService - TLE Handling", () => {
  let mockCesiumController;

  beforeEach(() => {
    mockCesiumController = {
      viewer: {
        clock: {
          currentTime: { iso: "2025-06-15T12:00:00Z" },
          startTime: { iso: "2025-06-15T00:00:00Z" },
          stopTime: { iso: "2025-06-22T00:00:00Z" },
          multiplier: 1,
          shouldAnimate: true,
        },
        camera: {
          position: { x: 1000000, y: 2000000, z: 3000000 },
          heading: 0,
          pitch: 0,
          roll: 0,
        },
        trackedEntity: null,
        timeline: {
          updateFromClock: vi.fn(),
        },
      },
      sats: {
        activeSatellites: [
          {
            props: {
              name: "ISS (ZARYA)",
              canonicalName: "ISS (ZARYA)",
              orbit: {
                tle: [
                  "ISS (ZARYA)",
                  "1 25544U 98067A   25166.50000000  .00000000  00000-0  00000-0 0  9999",
                  "2 25544  51.6400   0.0000 0000000   0.0000   0.0000 15.50000000000000",
                ],
              },
            },
          },
          {
            props: {
              name: "HUBBLE SPACE TELESCOPE",
              canonicalName: "HUBBLE SPACE TELESCOPE",
              orbit: {
                tle: [
                  "HUBBLE SPACE TELESCOPE",
                  "1 20580U 90037B   25166.50000000  .00000000  00000-0  00000-0 0  9999",
                  "2 20580  28.4700   0.0000 0000000   0.0000   0.0000 15.10000000000000",
                ],
              },
            },
          },
        ],
        getSatellite: vi.fn(),
        addFromTle: vi.fn(),
        updateStore: vi.fn(),
        enabledComponents: ["Point", "Label"],
        isInZenithView: false,
      },
    };
  });

  it("should capture TLE data for enabled satellites", () => {
    const service = new SnapshotService(mockCesiumController);

    const tles = service.captureTleSnapshot();

    expect(Object.keys(tles)).toHaveLength(2);
    expect(tles["ISS (ZARYA)"]).toContain("ISS (ZARYA)");
    expect(tles["ISS (ZARYA)"]).toContain("25544");
    expect(tles["HUBBLE SPACE TELESCOPE"]).toContain("HUBBLE");
  });

  it("should use canonical names (strip * suffix) for shorter URLs", () => {
    mockCesiumController.sats.activeSatellites = [
      {
        props: {
          name: "PRELAUNCH SAT *",
          canonicalName: "PRELAUNCH SAT", // * suffix stripped in canonical name
          orbit: {
            tle: [
              "PRELAUNCH SAT *",
              "1 99999U 25001A   25166.50000000  .00000000  00000-0  00000-0 0  9999",
              "2 99999  90.0000   0.0000 0000000   0.0000   0.0000 14.00000000000000",
            ],
          },
        },
      },
    ];

    const service = new SnapshotService(mockCesiumController);
    const tles = service.captureTleSnapshot();

    // Should use canonical name (without *) for shorter URLs
    expect(tles["PRELAUNCH SAT"]).toBeDefined();
    expect(tles["PRELAUNCH SAT *"]).toBeUndefined();
  });

  it("should use canonical names (strip [Snapshot] prefix) for shorter URLs", () => {
    mockCesiumController.sats.activeSatellites = [
      {
        props: {
          name: "[Snapshot] ISS (ZARYA)",
          canonicalName: "ISS (ZARYA)", // [Snapshot] prefix stripped in canonical name
          orbit: {
            tle: [
              "[Snapshot] ISS (ZARYA)",
              "1 25544U 98067A   25166.50000000  .00000000  00000-0  00000-0 0  9999",
              "2 25544  51.6400   0.0000 0000000   0.0000   0.0000 15.50000000000000",
            ],
          },
        },
      },
    ];

    const service = new SnapshotService(mockCesiumController);
    const tles = service.captureTleSnapshot();

    // Should use canonical name (without [Snapshot]) for shorter URLs
    expect(tles["ISS (ZARYA)"]).toBeDefined();
    expect(tles["[Snapshot] ISS (ZARYA)"]).toBeUndefined();
  });

  it("should preserve multiline TLE format", () => {
    const service = new SnapshotService(mockCesiumController);

    const tles = service.captureTleSnapshot();
    const issTle = tles["ISS (ZARYA)"];

    // Should be 3 lines joined by newlines
    expect(issTle.split("\n")).toHaveLength(3);
  });

  it("should handle empty satellite list", () => {
    mockCesiumController.sats.activeSatellites = [];

    const service = new SnapshotService(mockCesiumController);
    const tles = service.captureTleSnapshot();

    expect(Object.keys(tles)).toHaveLength(0);
  });
});

describe("SnapshotService - Snapshot Capture", () => {
  let mockCesiumController;

  beforeEach(() => {
    mockCesiumController = {
      viewer: {
        clock: {
          currentTime: { iso: "2025-06-15T12:00:00Z" },
          startTime: { iso: "2025-06-15T00:00:00Z" },
          stopTime: { iso: "2025-06-22T00:00:00Z" },
          multiplier: 1,
          shouldAnimate: true,
        },
        camera: {
          position: { x: 1000000, y: 2000000, z: 3000000 },
          heading: 0.5,
          pitch: -0.3,
          roll: 0,
        },
        trackedEntity: null,
        timeline: {
          updateFromClock: vi.fn(),
        },
      },
      sats: {
        activeSatellites: [],
        getSatellite: vi.fn(),
        enabledComponents: ["Point", "Label"],
        isInZenithView: false,
      },
      captureTrackedEntityCameraOffset: vi.fn(),
    };
  });

  it("should capture full snapshot without TLEs by default", () => {
    const service = new SnapshotService(mockCesiumController);

    const snapshot = service.captureSnapshot();

    expect(snapshot.v).toBe(1);
    expect(snapshot.t).toBeDefined();
    expect(snapshot.cam).toBeDefined();
    expect(snapshot.tle).toBeUndefined();
  });

  it("should capture snapshot with TLEs when requested", () => {
    mockCesiumController.sats.activeSatellites = [
      {
        props: {
          name: "TEST SAT",
          canonicalName: "TEST SAT",
          orbit: {
            tle: ["TEST SAT", "1 12345U 21001A   25166.50000000  .00000000  00000-0  00000-0 0  9999", "2 12345  51.6400   0.0000 0000000   0.0000   0.0000 15.50000000000000"],
          },
        },
      },
    ];

    const service = new SnapshotService(mockCesiumController);
    const snapshot = service.captureSnapshot({ includeTles: true });

    expect(snapshot.tle).toBeDefined();
    expect(snapshot.tle["TEST SAT"]).toBeDefined();
  });

  it("should capture tracked entity state instead of globe camera", () => {
    const mockEntity = { name: "ISS (ZARYA)" };
    mockCesiumController.viewer.trackedEntity = mockEntity;
    mockCesiumController.captureTrackedEntityCameraOffset = vi.fn().mockReturnValue({
      viewFrom: { x: 1000, y: 2000, z: 3000 },
    });

    const service = new SnapshotService(mockCesiumController);
    const snapshot = service.captureSnapshot();

    expect(snapshot.trk).toBeDefined();
    expect(snapshot.cam).toBeUndefined();
    expect(snapshot.trk.n).toBe("ISS (ZARYA)");
  });
});

describe("SnapshotService - Version Handling", () => {
  let mockCesiumController;

  beforeEach(() => {
    mockCesiumController = {
      viewer: {
        clock: {
          currentTime: { iso: "2025-06-15T12:00:00Z" },
          startTime: { iso: "2025-06-15T00:00:00Z" },
          stopTime: { iso: "2025-06-22T00:00:00Z" },
          multiplier: 1,
          shouldAnimate: true,
        },
        camera: {
          position: { x: 1000000, y: 2000000, z: 3000000 },
          heading: 0,
          pitch: 0,
          roll: 0,
          setView: vi.fn(),
        },
        trackedEntity: null,
        timeline: {
          updateFromClock: vi.fn(),
        },
      },
      sats: {
        activeSatellites: [],
        getSatellite: vi.fn(),
        addFromTle: vi.fn(),
        updateStore: vi.fn(),
        enabledComponents: ["Point", "Label"],
        isInZenithView: false,
      },
    };
  });

  it("should include version 1 in captured snapshots", () => {
    const service = new SnapshotService(mockCesiumController);

    const snapshot = service.captureSnapshot();

    expect(snapshot.v).toBe(1);
  });

  it("should reject snapshots with invalid version", async () => {
    const service = new SnapshotService(mockCesiumController);

    const invalidState = { v: 99, t: {}, cam: {} };

    await expect(service.applySnapshot(invalidState)).rejects.toThrow("Invalid snapshot version");
  });

  it("should reject snapshots with no version", async () => {
    const service = new SnapshotService(mockCesiumController);

    const invalidState = { t: {}, cam: {} };

    await expect(service.applySnapshot(invalidState)).rejects.toThrow("Invalid snapshot version");
  });
});

describe("SnapshotService - Ground Stations", () => {
  let mockCesiumController;

  beforeEach(() => {
    // Reset mock store
    mockSatStore.groundStations = [];
    mockSatStore.enabledSatellites = [];

    mockCesiumController = {
      viewer: {
        clock: {
          currentTime: { iso: "2025-06-15T12:00:00Z" },
          startTime: { iso: "2025-06-15T00:00:00Z" },
          stopTime: { iso: "2025-06-22T00:00:00Z" },
          multiplier: 1,
          shouldAnimate: true,
        },
        camera: {
          position: { x: 1000000, y: 2000000, z: 3000000 },
          heading: 0,
          pitch: 0,
          roll: 0,
          setView: vi.fn(),
        },
        trackedEntity: null,
        timeline: {
          updateFromClock: vi.fn(),
        },
      },
      sats: {
        activeSatellites: [],
        getSatellite: vi.fn(),
        addFromTle: vi.fn(),
        updateStore: vi.fn(),
        enabledComponents: ["Point", "Label"],
        isInZenithView: false,
      },
    };
  });

  it("should capture ground stations from store", () => {
    mockSatStore.groundStations = [
      { lat: 48.177, lon: 11.7476, name: "Munich" },
      { lat: 37.7749, lon: -122.4194 },
    ];

    const service = new SnapshotService(mockCesiumController);
    const gs = service.captureGroundStations();

    expect(gs).toHaveLength(2);
    expect(gs[0]).toEqual([48.177, 11.7476, "Munich"]);
    expect(gs[1]).toEqual([37.7749, -122.4194]); // No name
  });

  it("should handle empty ground stations", () => {
    mockSatStore.groundStations = [];

    const service = new SnapshotService(mockCesiumController);
    const gs = service.captureGroundStations();

    expect(gs).toEqual([]);
  });

  it("should restore ground stations to store", () => {
    const service = new SnapshotService(mockCesiumController);

    const gsArray = [
      [48.177, 11.7476, "Munich"],
      [37.7749, -122.4194],
    ];

    service.restoreGroundStations(gsArray);

    expect(mockSatStore.groundStations).toHaveLength(2);
    expect(mockSatStore.groundStations[0]).toEqual({
      lat: 48.177,
      lon: 11.7476,
      name: "Munich",
    });
    expect(mockSatStore.groundStations[1]).toEqual({
      lat: 37.7749,
      lon: -122.4194,
      name: undefined,
    });
  });

  it("should include ground stations in captured snapshot", () => {
    mockSatStore.groundStations = [{ lat: 60.1699, lon: 24.9384, name: "Helsinki" }];

    const service = new SnapshotService(mockCesiumController);
    const snapshot = service.captureSnapshot();

    expect(snapshot.gs).toBeDefined();
    expect(snapshot.gs).toHaveLength(1);
    expect(snapshot.gs[0]).toEqual([60.1699, 24.9384, "Helsinki"]);
  });

  it("should not include gs key when no ground stations", () => {
    mockSatStore.groundStations = [];

    const service = new SnapshotService(mockCesiumController);
    const snapshot = service.captureSnapshot();

    expect(snapshot.gs).toBeUndefined();
  });

  it("should serialize and deserialize ground stations correctly", () => {
    mockSatStore.groundStations = [
      { lat: 48.177, lon: 11.7476, name: "Munich" },
      { lat: 37.7749, lon: -122.4194 },
    ];

    const service = new SnapshotService(mockCesiumController);
    const snapshot = service.captureSnapshot();

    const serialized = service.serializeSnapshot(snapshot);
    const deserialized = service.deserializeSnapshot(serialized);

    expect(deserialized.gs).toEqual([
      [48.177, 11.7476, "Munich"],
      [37.7749, -122.4194],
    ]);
  });
});
