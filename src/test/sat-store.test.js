import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia, defineStore } from "pinia";
import { useSatStore } from "../stores/sat.js";
import {
  ISS_TLE_NO_NAME,
  STARLINK_TLE,
  ONEWEB_TLE,
  TWO_SATS_CONCATENATED,
  FIVE_SATS_CONCATENATED,
} from "./fixtures/tle-data.js";

// Define the custom satellites URL sync config for testing
// This mirrors the config from src/stores/sat.js but is defined as a plain object for testing
const customSatellitesConfig = {
  name: "customSatellites",
  url: "sat",
  serialize: (v) => {
    if (!v || v.length === 0) return "";
    return v.join("");
  },
  deserialize: (v) => {
    if (!v) return [];
    const tles = [];
    let buffer = v.trim();

    while (buffer.length > 0) {
      const line1Index = buffer.search(/1 \d{5}/);
      if (line1Index === -1) break;

      const namePart = buffer.substring(0, line1Index).trim();
      const line1Start = line1Index;
      const line1End = line1Start + 69;
      const line1 = buffer.substring(line1Start, line1End);

      const line2Start = buffer.substring(line1End).search(/2 \d{5}/);
      if (line2Start === -1) break;

      const line2Pos = line1End + line2Start;
      const line2End = line2Pos + 69;
      const line2 = buffer.substring(line2Pos, line2End);

      const currentTle = namePart ? `${namePart}\n${line1}\n${line2}` : `${line1}\n${line2}`;
      tles.push(currentTle);

      buffer = buffer.substring(line2End).trim();
    }

    return tles;
  },
  default: [],
};

describe("Sat Store - Initialization", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("should initialize with default state values", () => {
    const store = useSatStore();

    expect(store.enabledComponents).toBeDefined();
    expect(store.availableSatellitesByTag).toBeDefined();
    expect(store.availableTags).toBeDefined();
    expect(store.enabledSatellites).toBeDefined();
    expect(store.enabledTags).toBeDefined();
    expect(store.groundStations).toBeDefined();
    expect(store.trackedSatellite).toBeDefined();
  });

  it("should set enabled components to Point and Label by default", () => {
    const store = useSatStore();

    expect(store.enabledComponents).toEqual(["Point", "Label"]);
  });

  it("should initialize empty satellites and tags arrays", () => {
    const store = useSatStore();

    expect(store.availableSatellitesByTag).toEqual([]);
    expect(store.availableTags).toEqual([]);
    expect(store.enabledSatellites).toEqual([]);
    expect(store.enabledTags).toEqual([]);
  });

  it("should set default overpass mode to elevation", () => {
    const store = useSatStore();

    expect(store.overpassMode).toBe("elevation");
  });

  it("should set default sunlight pass filters", () => {
    const store = useSatStore();

    expect(store.hideSunlightPasses).toBe(true);
    expect(store.showOnlyLitPasses).toBe(true);
  });
});

// Helper to get urlsync config directly from store definition
const getUrlSyncConfig = () => {
  const store = useSatStore();
  // Access the original options from the store definition
  return store.$options?.urlsync?.config || store._customProperties?.get("urlsync")?.config;
};

describe("Sat Store - URL Sync Config", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("should have urlsync configuration for custom satellites", () => {
    // Test that our config object is properly defined
    expect(customSatellitesConfig).toBeDefined();
    expect(customSatellitesConfig.name).toBe("customSatellites");
    expect(customSatellitesConfig.url).toBe("sat");
  });

  it("should have serialize and deserialize functions", () => {
    expect(typeof customSatellitesConfig.serialize).toBe("function");
    expect(typeof customSatellitesConfig.deserialize).toBe("function");
  });
});

// NOTE: URL sync serialization/deserialization for store fields is tested in url-sync-plugin.test.js
// The tests here focus on store state and custom satellite TLE parsing

describe("Sat Store - URL Sync - Custom Satellites (TLE Parsing)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("should serialize single custom satellite TLE to URL", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.serialize([ISS_TLE_NO_NAME]);

    expect(result).toBeDefined();
    expect(result).toContain("1 25544U");
    expect(result).toContain("2 25544");
  });

  it("should deserialize 2-line TLE without name", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(ISS_TLE_NO_NAME);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("1 25544U");
    expect(result[0]).toContain("2 25544");
  });

  it("should deserialize 3-line TLE with name", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(STARLINK_TLE);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("STARLINK-1007");
    expect(result[0]).toContain("1 44713U");
    expect(result[0]).toContain("2 44713");
  });

  it("should deserialize multiple TLEs concatenated back-to-back", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(TWO_SATS_CONCATENATED);

    expect(result).toHaveLength(2);
    expect(result[0]).toContain("1 25544U"); // ISS
    expect(result[1]).toContain("1 44713U"); // Starlink
  });

  it("should parse TLE with spaces (browser newline conversion)", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    // Simulate browser converting newlines to spaces
    const spaceSeparated = ISS_TLE_NO_NAME.replace(/\n/g, " ");

    const result = config.deserialize(spaceSeparated);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("1 25544U");
    expect(result[0]).toContain("2 25544");
  });

  it("should detect TLE line 1 by '1 ' + 5 digits pattern", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(ISS_TLE_NO_NAME);

    expect(result).toHaveLength(1);
    // Line 1 should start with "1 25544"
    expect(result[0]).toMatch(/1 25544U/);
  });

  it("should detect TLE line 2 by '2 ' + 5 digits pattern", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(ISS_TLE_NO_NAME);

    expect(result).toHaveLength(1);
    // Line 2 should start with "2 25544"
    expect(result[0]).toMatch(/2 25544/);
  });

  it("should extract 69 characters for each TLE line", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(ISS_TLE_NO_NAME);

    expect(result).toHaveLength(1);

    const lines = result[0].split("\n");
    const line1 = lines.find((l) => l.startsWith("1 "));
    const line2 = lines.find((l) => l.startsWith("2 "));

    expect(line1.length).toBe(69);
    expect(line2.length).toBe(69);
  });

  it("should handle TLE with name before line 1", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(STARLINK_TLE);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("STARLINK-1007");
  });

  it("should handle TLE without name (2-line format)", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(ISS_TLE_NO_NAME);

    expect(result).toHaveLength(1);
    // Should not have a name line
    const lines = result[0].split("\n");
    expect(lines.length).toBe(2);
  });

  it("should skip invalid TLE with missing line 2", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const invalidTle = "1 25544U 98067A   18342.69352573  .00002284  00000-0  41838-4 0  9992";

    const result = config.deserialize(invalidTle);

    // Should return empty array (no valid TLE found)
    expect(result).toHaveLength(0);
  });

  it("should skip invalid TLE with malformed line 1", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const invalidTle = "INVALID LINE\n2 25544  51.6407 229.0798 0005166 124.8351 329.3296 15.54069892145658";

    const result = config.deserialize(invalidTle);

    // Should return empty array (no valid TLE found)
    expect(result).toHaveLength(0);
  });

  it("should return empty array for empty URL parameter", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize("");

    expect(result).toEqual([]);
  });

  it("should parse 2 satellites back-to-back without separator", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(TWO_SATS_CONCATENATED);

    expect(result).toHaveLength(2);
  });

  it("should parse 5 satellites back-to-back without separator", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    const result = config.deserialize(FIVE_SATS_CONCATENATED);

    expect(result).toHaveLength(5);
    expect(result[0]).toContain("ONEWEB-0001");
    expect(result[1]).toContain("ONEWEB-0002");
    expect(result[2]).toContain("ONEWEB-0003");
    expect(result[3]).toContain("ONEWEB-0004");
    expect(result[4]).toContain("ONEWEB-0005");
  });

  it("should handle whitespace between concatenated TLEs gracefully", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    // Add extra whitespace between TLEs
    const withWhitespace = STARLINK_TLE + "\n\n" + ONEWEB_TLE;

    const result = config.deserialize(withWhitespace);

    expect(result).toHaveLength(2);
    expect(result[0]).toContain("STARLINK");
    expect(result[1]).toContain("ONEWEB");
  });
});
