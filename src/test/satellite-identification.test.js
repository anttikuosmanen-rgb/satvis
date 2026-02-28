import { describe, it, expect, vi, beforeEach } from "vitest";
import { SatelliteProperties } from "../modules/SatelliteProperties";
import { SatelliteManager } from "../modules/SatelliteManager";

// Test TLE data
const BASE_TLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;

// Generate a future epoch TLE for prelaunch testing
function generateFutureEpochTle(name = "FUTURE SAT") {
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const year = future.getUTCFullYear() % 100;
  const startOfYear = new Date(Date.UTC(future.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((future - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const epoch = `${year.toString().padStart(2, "0")}${dayOfYear.toFixed(8).padStart(12, "0")}`;

  return `${name}
1 99999U 26001A   ${epoch}  .00000000  00000-0  00000-0 0  0000
2 99999  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678     0`;
}

// Mock Cesium viewer for SatelliteManager tests
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

describe("SatelliteProperties name identification", () => {
  describe("extractCanonicalName", () => {
    it("should return base name unchanged", () => {
      expect(SatelliteProperties.extractCanonicalName("ISS (ZARYA)")).toBe("ISS (ZARYA)");
    });

    it("should strip [Snapshot] prefix", () => {
      expect(SatelliteProperties.extractCanonicalName("[Snapshot] ISS (ZARYA)")).toBe("ISS (ZARYA)");
    });

    it("should strip [Custom] prefix", () => {
      expect(SatelliteProperties.extractCanonicalName("[Custom] My Satellite")).toBe("My Satellite");
    });

    it("should strip * suffix for prelaunch", () => {
      expect(SatelliteProperties.extractCanonicalName("STARLINK-G17-34 STACK *")).toBe("STARLINK-G17-34 STACK");
    });

    it("should strip both prefix and suffix", () => {
      expect(SatelliteProperties.extractCanonicalName("[Snapshot] STARLINK-G17-34 STACK *")).toBe("STARLINK-G17-34 STACK");
    });

    it("should be case-insensitive for prefixes", () => {
      expect(SatelliteProperties.extractCanonicalName("[SNAPSHOT] ISS")).toBe("ISS");
      expect(SatelliteProperties.extractCanonicalName("[snapshot] ISS")).toBe("ISS");
    });

    it("should handle extra whitespace", () => {
      expect(SatelliteProperties.extractCanonicalName("  [Snapshot]   ISS  *  ")).toBe("ISS");
    });
  });

  describe("extractPrefix", () => {
    it("should return empty string for no prefix", () => {
      expect(SatelliteProperties.extractPrefix("ISS (ZARYA)")).toBe("");
    });

    it("should extract [Snapshot] prefix", () => {
      expect(SatelliteProperties.extractPrefix("[Snapshot] ISS")).toBe("[Snapshot] ");
    });

    it("should extract [Custom] prefix", () => {
      expect(SatelliteProperties.extractPrefix("[Custom] My Sat")).toBe("[Custom] ");
    });

    it("should be case-insensitive", () => {
      expect(SatelliteProperties.extractPrefix("[SNAPSHOT] ISS")).toBe("[SNAPSHOT] ");
    });
  });

  describe("constructor sets identification properties", () => {
    it("should set canonicalName without decorations", () => {
      const snapshotTle = BASE_TLE.replace("ISS (ZARYA)", "[Snapshot] ISS (ZARYA)");
      const props = new SatelliteProperties(snapshotTle, ["Snapshot"]);

      expect(props.canonicalName).toBe("ISS (ZARYA)");
      expect(props.displayPrefix).toBe("[Snapshot] ");
      expect(props.name).toBe("[Snapshot] ISS (ZARYA)"); // Full display name
    });

    it("should set displaySuffix for prelaunch satellites", () => {
      // Create TLE with future epoch
      const futureEpochTle = generateFutureEpochTle("FUTURE SAT");

      const props = new SatelliteProperties(futureEpochTle, ["Prelaunch"]);

      expect(props.canonicalName).toBe("FUTURE SAT");
      expect(props.displaySuffix).toBe(" *");
      expect(props.name).toBe("FUTURE SAT *"); // Full display name with suffix
      expect(props.displayName).toBe("FUTURE SAT *"); // Same as name
    });

    it("should NOT have baseName property", () => {
      const props = new SatelliteProperties(BASE_TLE, []);
      expect(props.baseName).toBeUndefined();
    });

    it("should have displayName getter", () => {
      const props = new SatelliteProperties(BASE_TLE, []);
      expect(props.displayName).toBe("ISS (ZARYA)");
    });

    it("should handle [Custom] prefix correctly", () => {
      const customTle = BASE_TLE.replace("ISS (ZARYA)", "[Custom] TEST SAT");
      const props = new SatelliteProperties(customTle, ["Custom"]);

      expect(props.canonicalName).toBe("TEST SAT");
      expect(props.displayPrefix).toBe("[Custom] ");
      expect(props.name).toBe("[Custom] TEST SAT");
    });
  });

  describe("tleSignature for duplicate detection", () => {
    it("should generate same signature for same TLE lines", () => {
      const props1 = new SatelliteProperties(BASE_TLE, []);
      const props2 = new SatelliteProperties(BASE_TLE.replace("ISS (ZARYA)", "[Snapshot] ISS (ZARYA)"), ["Snapshot"]);

      // Same orbital elements = same signature
      expect(props1.tleSignature).toBe(props2.tleSignature);
    });

    it("should generate different signature for different TLE lines", () => {
      const props1 = new SatelliteProperties(BASE_TLE, []);

      const differentTle = `ISS (ZARYA)
1 25544U 98067A   24002.50000000  .00016717  00000-0  10270-3 0  9026
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426239`;
      const props2 = new SatelliteProperties(differentTle, []);

      expect(props1.tleSignature).not.toBe(props2.tleSignature);
    });

    it("should use lines 1 and 2 for signature", () => {
      const props = new SatelliteProperties(BASE_TLE, []);
      // Signature should contain the two orbital element lines separated by |
      expect(props.tleSignature).toContain("|");
      expect(props.tleSignature).toContain("1 25544U");
      expect(props.tleSignature).toContain("2 25544");
    });
  });
});

describe("SatelliteManager satellite lookup", () => {
  let manager;
  let mockViewer;

  beforeEach(() => {
    mockViewer = createMockViewer();
    manager = new SatelliteManager(mockViewer);
  });

  describe("getSatellite (canonical lookup)", () => {
    it("should find satellite by exact display name", () => {
      manager.addFromTle(BASE_TLE, [], false);

      expect(manager.getSatellite("ISS (ZARYA)")).toBeDefined();
    });

    it("should find satellite when searching with [Snapshot] prefix", () => {
      manager.addFromTle(BASE_TLE, [], false);

      // Search with [Snapshot] prefix should find the original
      const found = manager.getSatellite("[Snapshot] ISS (ZARYA)");
      expect(found?.props.canonicalName).toBe("ISS (ZARYA)");
    });

    it("should find satellite when searching with * suffix", () => {
      const futureTle = generateFutureEpochTle("STARLINK-G17-34 STACK");
      manager.addFromTle(futureTle, [], false);

      // The satellite was added with * suffix because epoch is in future
      // Search without * should still find it
      const found = manager.getSatellite("STARLINK-G17-34 STACK");
      expect(found?.props.canonicalName).toBe("STARLINK-G17-34 STACK");
    });

    it("should find satellite when searching with both prefix and suffix", () => {
      manager.addFromTle(BASE_TLE, [], false);

      const found = manager.getSatellite("[Snapshot] ISS (ZARYA) *");
      expect(found?.props.canonicalName).toBe("ISS (ZARYA)");
    });

    it("should prefer original satellite when both original and snapshot exist", () => {
      // Add original
      manager.addFromTle(BASE_TLE, [], false);

      // Add snapshot version with different epoch (different TLE signature)
      const snapshotTle = `[Snapshot] ISS (ZARYA)
1 25544U 98067A   24005.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;
      manager.addFromTle(snapshotTle, ["Snapshot"], false);

      // Default lookup should prefer non-snapshot version
      const found = manager.getSatellite("ISS (ZARYA)");
      expect(found?.props.displayPrefix).toBe("");
    });

    it("should return exact match when display name matches exactly", () => {
      // Add original
      manager.addFromTle(BASE_TLE, [], false);

      // Add snapshot with different TLE
      const snapshotTle = `[Snapshot] ISS (ZARYA)
1 25544U 98067A   24005.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;
      manager.addFromTle(snapshotTle, ["Snapshot"], false);

      // Exact match for snapshot version
      const found = manager.getSatellite("[Snapshot] ISS (ZARYA)");
      expect(found?.props.displayPrefix).toBe("[Snapshot] ");
    });

    it("should return undefined for unknown satellite", () => {
      const found = manager.getSatellite("UNKNOWN SAT");
      expect(found).toBeUndefined();
    });
  });

  describe("getSatelliteWithPrefix", () => {
    it("should find snapshot satellite specifically by canonical name", () => {
      // Add original
      manager.addFromTle(BASE_TLE, [], false);

      // Add snapshot with different TLE
      const snapshotTle = `[Snapshot] ISS (ZARYA)
1 25544U 98067A   24005.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;
      manager.addFromTle(snapshotTle, ["Snapshot"], false);

      const snapshot = manager.getSatelliteWithPrefix("ISS (ZARYA)", "[Snapshot] ");
      expect(snapshot).toBeDefined();
      expect(snapshot?.props.displayPrefix).toBe("[Snapshot] ");
    });

    it("should work with decorated search term", () => {
      const snapshotTle = `[Snapshot] ISS (ZARYA)
1 25544U 98067A   24005.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;
      manager.addFromTle(snapshotTle, ["Snapshot"], false);

      // Even if you pass decorated name, it should extract canonical
      const found = manager.getSatelliteWithPrefix("[Snapshot] ISS (ZARYA) *", "[Snapshot] ");
      expect(found?.props.canonicalName).toBe("ISS (ZARYA)");
    });

    it("should return undefined if prefix not found", () => {
      manager.addFromTle(BASE_TLE, [], false);

      const snapshot = manager.getSatelliteWithPrefix("ISS (ZARYA)", "[Snapshot] ");
      expect(snapshot).toBeUndefined();
    });
  });

  describe("getSatellitesByCanonical", () => {
    it("should return all satellites with same canonical name", () => {
      // Add original
      manager.addFromTle(BASE_TLE, [], false);

      // Add snapshot with different TLE
      const snapshotTle = `[Snapshot] ISS (ZARYA)
1 25544U 98067A   24005.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;
      manager.addFromTle(snapshotTle, ["Snapshot"], false);

      const all = manager.getSatellitesByCanonical("ISS (ZARYA)");
      expect(all.length).toBe(2);
    });

    it("should return empty array for unknown satellite", () => {
      const all = manager.getSatellitesByCanonical("UNKNOWN");
      expect(all).toEqual([]);
    });

    it("should work with decorated search term", () => {
      manager.addFromTle(BASE_TLE, [], false);

      // Pass decorated name - should still find by canonical
      const all = manager.getSatellitesByCanonical("[Snapshot] ISS (ZARYA) *");
      expect(all.length).toBe(1);
    });
  });

  describe("duplicate detection", () => {
    it("should allow satellites with same canonical name but different TLE", () => {
      const tle1 = BASE_TLE;
      const tle2 = `[Snapshot] ISS (ZARYA)
1 25544U 98067A   24005.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;

      manager.addFromTle(tle1, [], false);
      manager.addFromTle(tle2, ["Snapshot"], false);

      // Both should exist
      expect(manager.satellites.length).toBe(2);
    });

    it("should merge satellites with same canonical name AND same TLE", () => {
      manager.addFromTle(BASE_TLE, ["TagA"], false);
      manager.addFromTle(BASE_TLE, ["TagB"], false); // Same TLE, different tag

      // Should merge into one satellite
      expect(manager.satellites.length).toBe(1);
      expect(manager.satellites[0].props.tags).toContain("TagA");
      expect(manager.satellites[0].props.tags).toContain("TagB");
    });

    it("should not treat [Snapshot] version as duplicate if TLE differs", () => {
      const tle1 = BASE_TLE;
      const tle2 = `[Snapshot] ISS (ZARYA)
1 25544U 98067A   24005.50000000  .00016717  00000-0  10270-3 0  9025
2 25544  51.6400 208.9163 0006703  40.5536 319.5502 15.49815678426238`;

      manager.addFromTle(tle1, [], false);
      manager.addFromTle(tle2, ["Snapshot"], false);

      // Both should exist (different TLEs)
      expect(manager.satellites.length).toBe(2);
      expect(manager.getSatellitesByCanonical("ISS (ZARYA)").length).toBe(2);
    });
  });
});
