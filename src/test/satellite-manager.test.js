import { describe, it, expect, vi, beforeEach } from "vitest";
import { SatelliteManager } from "../modules/SatelliteManager.js";
import { ISS_TLE, STARLINK_TLE } from "./fixtures/tle-data.js";

// Mock Cesium viewer
const createMockViewer = () => ({
  entities: {
    add: vi.fn(),
    remove: vi.fn(),
    removeAll: vi.fn(),
    values: [],
    contains: vi.fn(() => false),
  },
  trackedEntity: undefined,
  trackedEntityChanged: {
    addEventListener: vi.fn(),
  },
  clock: {
    currentTime: {},
    onTick: {
      addEventListener: vi.fn(),
    },
    onStop: {
      addEventListener: vi.fn(),
    },
    clockStep: 0,
    startTime: {},
    stopTime: {},
  },
  scene: {
    requestRender: vi.fn(),
    screenSpaceCameraController: {},
  },
  timeline: {
    container: document.createElement("div"),
    updateFromClock: vi.fn(),
  },
  animation: {
    container: document.createElement("div"),
  },
  screenSpaceEventHandler: {
    getInputAction: vi.fn(),
    setInputAction: vi.fn(),
  },
});

describe("SatelliteManager - TLE Parsing and Loading", () => {
  let manager;
  let mockViewer;

  beforeEach(() => {
    mockViewer = createMockViewer();
    manager = new SatelliteManager(mockViewer);
  });

  it("should add satellite from 3-line TLE string", () => {
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);

    expect(manager.satellites.length).toBe(1);
    expect(manager.satellites[0].props.name).toContain("ISS");
  });

  it("should add satellite from 2-line TLE string", () => {
    // Add newline at start for 2-line format
    const twoLineTle = "\n" + ISS_TLE.split("\n").slice(1).join("\n");

    manager.addFromTle(twoLineTle, ["Space Stations"], false);

    expect(manager.satellites.length).toBe(1);
  });

  it("should merge tags for duplicate satellites (same NORAD number)", () => {
    // Add ISS with tag "Space Stations"
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);

    // Add ISS again with tag "Special Interest"
    manager.addFromTle(ISS_TLE, ["Special Interest"], false);

    // Should still have only 1 satellite
    expect(manager.satellites.length).toBe(1);

    // But with both tags
    const sat = manager.satellites[0];
    expect(sat.props.tags).toContain("Space Stations");
    expect(sat.props.tags).toContain("Special Interest");
  });

  it("should create satellite with correct name", () => {
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);

    const sat = manager.satellites[0];
    expect(sat.props.name).toBe("ISS (ZARYA)");
  });

  it("should create satellite with correct tags", () => {
    manager.addFromTle(ISS_TLE, ["Space Stations", "Active"], false);

    const sat = manager.satellites[0];
    expect(sat.props.tags).toContain("Space Stations");
    expect(sat.props.tags).toContain("Active");
  });

  it("should build tag list correctly", () => {
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);
    manager.addFromTle(STARLINK_TLE, ["Communications"], false);

    const tags = manager.tags;

    expect(tags).toContain("Space Stations");
    expect(tags).toContain("Communications");
  });

  it("should build satellite-by-tag index correctly", () => {
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);
    manager.addFromTle(STARLINK_TLE, ["Communications"], false);

    const taglist = manager.taglist;

    expect(taglist["Space Stations"]).toContain("ISS (ZARYA)");
    expect(taglist.Communications).toContain("STARLINK-1007");
  });
});

describe("SatelliteManager - Satellite Lookup", () => {
  let manager;
  let mockViewer;

  beforeEach(() => {
    mockViewer = createMockViewer();
    manager = new SatelliteManager(mockViewer);
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);
    manager.addFromTle(STARLINK_TLE, ["Communications"], false);
  });

  it("should find satellite by name using O(1) lookup", () => {
    const sat = manager.getSatellite("ISS (ZARYA)");

    expect(sat).toBeDefined();
    expect(sat.props.name).toBe("ISS (ZARYA)");
  });

  it("should return undefined for non-existent satellite", () => {
    const sat = manager.getSatellite("NONEXISTENT");

    expect(sat).toBeUndefined();
  });

  it("should return all satellite names", () => {
    const names = manager.satelliteNames;

    expect(names).toContain("ISS (ZARYA)");
    expect(names).toContain("STARLINK-1007");
    expect(names).toHaveLength(2);
  });

  it("should filter satellites by tag", () => {
    const spaceStations = manager.getSatellitesWithTag("Space Stations");

    expect(spaceStations).toHaveLength(1);
    expect(spaceStations[0].props.name).toBe("ISS (ZARYA)");
  });
});

describe("SatelliteManager - Satellite Counting", () => {
  let manager;
  let mockViewer;

  beforeEach(() => {
    mockViewer = createMockViewer();
    manager = new SatelliteManager(mockViewer);
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);
    manager.addFromTle(STARLINK_TLE, ["Communications"], false);
  });

  it("should count total satellites", () => {
    expect(manager.satellites.length).toBe(2);
  });

  it("should list all available tags", () => {
    const tags = manager.tags;

    expect(tags).toContain("Space Stations");
    expect(tags).toContain("Communications");
  });

  it("should count satellites per tag", () => {
    const spaceStations = manager.getSatellitesWithTag("Space Stations");
    const communications = manager.getSatellitesWithTag("Communications");

    expect(spaceStations).toHaveLength(1);
    expect(communications).toHaveLength(1);
  });

  it("should return empty array for non-existent tag", () => {
    const satellites = manager.getSatellitesWithTag("NonExistent");

    expect(satellites).toHaveLength(0);
  });

  it("should have correct available components", () => {
    expect(manager.availableComponents).toContain("Point");
    expect(manager.availableComponents).toContain("Label");
    expect(manager.availableComponents).toContain("Orbit");
  });
});
