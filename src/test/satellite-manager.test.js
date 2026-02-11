import { describe, it, expect, vi, beforeEach } from "vitest";
import { SatelliteManager } from "../modules/SatelliteManager";
import { ISS_TLE, ISS_TLE_FRESH, ISS_TLE_UPDATED, STARLINK_TLE, FUTURE_EPOCH_TLE } from "./fixtures/tle-data";

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

  it("should update TLE orbital data when reloading satellite with same NORAD number", () => {
    // Add ISS with original TLE data and "Space Stations" tag
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);

    const originalSat = manager.satellites[0];

    // Capture original TLE orbital elements from the orbit object
    const originalJulianDate = originalSat.props.orbit.julianDate; // Epoch as Julian date
    const originalMeanMotion = originalSat.props.orbit.satrec.no; // Mean motion in rad/min

    // Mock the hide() and invalidatePassCache() methods to verify cleanup
    originalSat.hide = vi.fn();
    originalSat.invalidatePassCache = vi.fn();

    // Add ISS again with UPDATED TLE data and "Active" tag
    // This simulates reloading TLE files with updated orbital elements
    manager.addFromTle(ISS_TLE_UPDATED, ["Active"], false);

    // Should still have only 1 satellite (not 2)
    expect(manager.satellites.length).toBe(1);

    const updatedSat = manager.satellites[0];

    // Verify the satellite object is actually a new instance (old one was replaced)
    expect(updatedSat).not.toBe(originalSat);

    // Verify cleanup methods were called on old satellite
    expect(originalSat.hide).toHaveBeenCalled();
    expect(originalSat.invalidatePassCache).toHaveBeenCalled();

    // Verify tags were merged (should have both old and new tags)
    expect(updatedSat.props.tags).toContain("Space Stations");
    expect(updatedSat.props.tags).toContain("Active");
    expect(updatedSat.props.tags).toHaveLength(2);

    // Verify satellite keeps same name and NORAD number
    expect(updatedSat.props.name).toBe("ISS (ZARYA)");
    expect(updatedSat.props.satnum).toBe("25544");

    // CRITICAL: Verify TLE orbital data was actually updated
    const updatedJulianDate = updatedSat.props.orbit.julianDate;
    const updatedMeanMotion = updatedSat.props.orbit.satrec.no;

    // Epoch (Julian date) should be different (original: 18342.69..., updated: 18350.12...)
    expect(updatedJulianDate).toBeDefined();
    expect(originalJulianDate).toBeDefined();
    expect(updatedJulianDate).not.toBe(originalJulianDate);

    // Mean motion should be different (verifies orbital elements were updated)
    expect(updatedMeanMotion).toBeDefined();
    expect(originalMeanMotion).toBeDefined();
    expect(updatedMeanMotion).not.toBe(originalMeanMotion);
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
    // Use fresh TLE to avoid staleness filtering
    manager.addFromTle(ISS_TLE_FRESH, ["Space Stations"], false);
    manager.addFromTle(STARLINK_TLE, ["Communications"], false);

    const taglist = manager.taglist;

    expect(taglist["Space Stations"]).toContain("ISS (ZARYA)");
    expect(taglist.Communications).toContain("STARLINK-1007");
  });

  it("should filter stale satellites from taglist", () => {
    // ISS_TLE has epoch from 2018 - should be flagged as stale (>1 year old)
    manager.addFromTle(ISS_TLE, ["Space Stations"], false);
    manager.addFromTle(STARLINK_TLE, ["Communications"], false);

    const taglist = manager.taglist;

    // Stale ISS should not appear in taglist
    expect(taglist["Space Stations"]).toBeUndefined();
    // Fresh Starlink should still appear
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

describe("SatelliteManager - Future Epoch Satellites", () => {
  let manager;
  let mockViewer;

  beforeEach(() => {
    mockViewer = createMockViewer();
    manager = new SatelliteManager(mockViewer);
  });

  it("should add asterisk suffix to satellite name when epoch is in future", () => {
    manager.addFromTle(FUTURE_EPOCH_TLE, ["Prelaunch"], false);

    const sat = manager.satellites[0];
    // Future epoch satellites get " *" appended to their name
    expect(sat.props.name).toBe("PRELAUNCH-SAT *");
  });

  it("should find future epoch satellite by name with asterisk suffix", () => {
    manager.addFromTle(FUTURE_EPOCH_TLE, ["Prelaunch"], false);

    const sat = manager.getSatellite("PRELAUNCH-SAT *");
    expect(sat).toBeDefined();
    expect(sat.props.name).toBe("PRELAUNCH-SAT *");
  });

  it("should find future epoch satellite by base name without asterisk (canonical lookup)", () => {
    manager.addFromTle(FUTURE_EPOCH_TLE, ["Prelaunch"], false);

    // Canonical lookup finds satellite regardless of * suffix
    const sat = manager.getSatellite("PRELAUNCH-SAT");
    expect(sat).toBeDefined();
    expect(sat.props.canonicalName).toBe("PRELAUNCH-SAT");
  });

  it("should not mark future epoch satellite as stale", () => {
    manager.addFromTle(FUTURE_EPOCH_TLE, ["Prelaunch"], false);

    const sat = manager.satellites[0];
    // Future epoch satellites should not be stale
    expect(sat.props.isStale).toBe(false);
  });
});

describe("SatelliteManager - Custom Satellite Naming", () => {
  let manager;
  let mockViewer;

  beforeEach(() => {
    mockViewer = createMockViewer();
    manager = new SatelliteManager(mockViewer);
  });

  it("should create satellite with [Custom] prefix when TLE name starts with [Custom]", () => {
    const customTle = `[Custom] MY SATELLITE
1 99999U 99999A   ${generateFreshEpochForTest()}  .00000000  00000-0  00000-0 0  9999
2 99999  45.0000 123.4567 0001234  67.8901 292.1234 15.12345678901234`;

    manager.addFromTle(customTle, ["Custom"], false);

    const sat = manager.satellites[0];
    expect(sat.props.name).toBe("[Custom] MY SATELLITE");
  });

  it("should create future epoch custom satellite with both [Custom] prefix and * suffix", () => {
    // Create a TLE with future epoch and [Custom] prefix
    const futureEpoch = generateFutureEpochForTest();
    const customFutureTle = `[Custom] FUTURE CUSTOM SAT
1 99999U 99999A   ${futureEpoch}  .00000000  00000-0  00000-0 0  9999
2 99999  45.0000 123.4567 0001234  67.8901 292.1234 15.12345678901234`;

    manager.addFromTle(customFutureTle, ["Custom"], false);

    const sat = manager.satellites[0];
    // Should have both [Custom] prefix and * suffix
    expect(sat.props.name).toBe("[Custom] FUTURE CUSTOM SAT *");
  });

  it("should find custom future epoch satellite by various name formats (canonical lookup)", () => {
    const futureEpoch = generateFutureEpochForTest();
    const customFutureTle = `[Custom] TEST SAT
1 99999U 99999A   ${futureEpoch}  .00000000  00000-0  00000-0 0  9999
2 99999  45.0000 123.4567 0001234  67.8901 292.1234 15.12345678901234`;

    manager.addFromTle(customFutureTle, ["Custom"], false);

    // Should be found by full name with asterisk
    const sat = manager.getSatellite("[Custom] TEST SAT *");
    expect(sat).toBeDefined();

    // Canonical lookup also finds satellite without asterisk
    const satWithoutAsterisk = manager.getSatellite("[Custom] TEST SAT");
    expect(satWithoutAsterisk).toBeDefined();

    // Canonical lookup finds satellite by base name only
    const satByBaseName = manager.getSatellite("TEST SAT");
    expect(satByBaseName).toBeDefined();
    expect(satByBaseName.props.canonicalName).toBe("TEST SAT");
  });
});

// Helper functions for generating TLE epochs in tests
function generateFreshEpochForTest() {
  const now = new Date();
  const year = now.getUTCFullYear() % 100;
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  return `${year.toString().padStart(2, "0")}${dayOfYear.toFixed(8).padStart(12, "0")}`;
}

function generateFutureEpochForTest() {
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const year = future.getUTCFullYear() % 100;
  const startOfYear = new Date(Date.UTC(future.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((future - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  return `${year.toString().padStart(2, "0")}${dayOfYear.toFixed(8).padStart(12, "0")}`;
}
