import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSatStore, satStoreUrlSyncConfig } from "../stores/sat";
import { ISS_TLE_NO_NAME, STARLINK_TLE, ONEWEB_TLE, TWO_SATS_CONCATENATED, FIVE_SATS_CONCATENATED, SPACE_PADDED_NORAD_TLE } from "./fixtures/tle-data";

// Get the custom satellites config from the exported config
const customSatellitesConfig = satStoreUrlSyncConfig.find((c) => c.name === "customSatellites");

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

  it("should set default useLocalTime to false", () => {
    const store = useSatStore();

    expect(store.useLocalTime).toBe(false);
  });

  it("should initialize with empty groundStations array", () => {
    const store = useSatStore();

    expect(store.groundStations).toEqual([]);
  });
});

describe("Sat Store - Local Time", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("should allow toggling useLocalTime", () => {
    const store = useSatStore();

    expect(store.useLocalTime).toBe(false);

    store.useLocalTime = true;
    expect(store.useLocalTime).toBe(true);

    store.useLocalTime = false;
    expect(store.useLocalTime).toBe(false);
  });

  it("should persist useLocalTime state changes", () => {
    const store = useSatStore();

    store.useLocalTime = true;

    // Get store again - should retain the value
    const store2 = useSatStore();
    expect(store2.useLocalTime).toBe(true);
  });

  it("should have groundStations array for local time calculations", () => {
    const store = useSatStore();

    // Add a ground station
    store.groundStations = [{ lat: 60.17, lon: 24.94, name: "Helsinki" }];

    expect(store.groundStations).toHaveLength(1);
    expect(store.groundStations[0].lat).toBe(60.17);
    expect(store.groundStations[0].lon).toBe(24.94);
  });
});

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

  it("should deserialize TLE with space-padded NORAD ID (old satellites)", () => {
    const store = useSatStore();
    const config = customSatellitesConfig;

    // NORAD ID 694 has only 3 digits, formatted with leading spaces: "1   694U"
    const result = config.deserialize(SPACE_PADDED_NORAD_TLE);

    expect(result).toHaveLength(1);
    // Should contain the space-padded NORAD ID
    expect(result[0]).toContain("1   694U");
    expect(result[0]).toContain("2   694");
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

describe("Sat Store - URL Sync - Other Configs", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Get configs from exported config
  const enabledComponentsConfig = satStoreUrlSyncConfig.find((c) => c.name === "enabledComponents");
  const enabledSatellitesConfig = satStoreUrlSyncConfig.find((c) => c.name === "enabledSatellites");
  const enabledTagsConfig = satStoreUrlSyncConfig.find((c) => c.name === "enabledTags");
  const groundStationsConfig = satStoreUrlSyncConfig.find((c) => c.name === "groundStations");
  const hideSunlightPassesConfig = satStoreUrlSyncConfig.find((c) => c.name === "hideSunlightPasses");
  const showOnlyLitPassesConfig = satStoreUrlSyncConfig.find((c) => c.name === "showOnlyLitPasses");
  const useLocalTimeConfig = satStoreUrlSyncConfig.find((c) => c.name === "useLocalTime");

  describe("enabledComponents", () => {
    it("should serialize components array to comma-separated string with spaces replaced", () => {
      const result = enabledComponentsConfig.serialize(["Point", "Label", "Ground Track"]);
      expect(result).toBe("Point,Label,Ground-Track");
    });

    it("should deserialize comma-separated string back to array", () => {
      const result = enabledComponentsConfig.deserialize("Point,Label,Ground-Track");
      expect(result).toEqual(["Point", "Label", "Ground Track"]);
    });

    it("should filter empty values on deserialize", () => {
      const result = enabledComponentsConfig.deserialize("Point,,Label,");
      expect(result).toEqual(["Point", "Label"]);
    });
  });

  describe("enabledSatellites", () => {
    it("should serialize satellites array with tildes for spaces", () => {
      const result = enabledSatellitesConfig.serialize(["ISS (ZARYA)", "STARLINK-1007"]);
      expect(result).toBe("ISS~(ZARYA),STARLINK-1007");
    });

    it("should deserialize satellites string back to array", () => {
      const result = enabledSatellitesConfig.deserialize("ISS~(ZARYA),STARLINK-1007");
      expect(result).toEqual(["ISS (ZARYA)", "STARLINK-1007"]);
    });

    it("should filter empty values on deserialize", () => {
      const result = enabledSatellitesConfig.deserialize("ISS~(ZARYA),,STARLINK-1007,");
      expect(result).toEqual(["ISS (ZARYA)", "STARLINK-1007"]);
    });
  });

  describe("enabledTags", () => {
    it("should serialize tags array with dashes for spaces", () => {
      const result = enabledTagsConfig.serialize(["Space Stations", "Weather"]);
      expect(result).toBe("Space-Stations,Weather");
    });

    it("should deserialize tags string back to array", () => {
      const result = enabledTagsConfig.deserialize("Space-Stations,Weather");
      expect(result).toEqual(["Space Stations", "Weather"]);
    });

    it("should filter empty values on deserialize", () => {
      const result = enabledTagsConfig.deserialize("Space-Stations,,Weather");
      expect(result).toEqual(["Space Stations", "Weather"]);
    });
  });

  describe("groundStations", () => {
    it("should serialize ground stations array to underscore-separated string", () => {
      const result = groundStationsConfig.serialize([
        { lat: 60.1695, lon: 24.9354, name: "Helsinki" },
        { lat: 40.7128, lon: -74.006, name: "New York" },
      ]);
      expect(result).toBe("60.1695,24.9354,Helsinki_40.7128,-74.0060,New York");
    });

    it("should serialize ground station without name", () => {
      const result = groundStationsConfig.serialize([{ lat: 60.1695, lon: 24.9354 }]);
      expect(result).toBe("60.1695,24.9354");
    });

    it("should deserialize ground stations string back to array", () => {
      const result = groundStationsConfig.deserialize("60.1695,24.9354,Helsinki_40.7128,-74.0060,New York");
      expect(result).toHaveLength(2);
      expect(result[0].lat).toBeCloseTo(60.1695, 4);
      expect(result[0].lon).toBeCloseTo(24.9354, 4);
      expect(result[0].name).toBe("Helsinki");
      expect(result[1].lat).toBeCloseTo(40.7128, 4);
      expect(result[1].lon).toBeCloseTo(-74.006, 4);
      expect(result[1].name).toBe("New York");
    });
  });

  describe("hideSunlightPasses", () => {
    it("should serialize true to '1'", () => {
      const result = hideSunlightPassesConfig.serialize(true);
      expect(result).toBe("1");
    });

    it("should serialize false to '0'", () => {
      const result = hideSunlightPassesConfig.serialize(false);
      expect(result).toBe("0");
    });

    it("should deserialize '1' to true", () => {
      const result = hideSunlightPassesConfig.deserialize("1");
      expect(result).toBe(true);
    });

    it("should deserialize '0' to false", () => {
      const result = hideSunlightPassesConfig.deserialize("0");
      expect(result).toBe(false);
    });
  });

  describe("showOnlyLitPasses", () => {
    it("should serialize true to '1'", () => {
      const result = showOnlyLitPassesConfig.serialize(true);
      expect(result).toBe("1");
    });

    it("should serialize false to '0'", () => {
      const result = showOnlyLitPassesConfig.serialize(false);
      expect(result).toBe("0");
    });

    it("should deserialize '1' to true", () => {
      const result = showOnlyLitPassesConfig.deserialize("1");
      expect(result).toBe(true);
    });

    it("should deserialize '0' to false", () => {
      const result = showOnlyLitPassesConfig.deserialize("0");
      expect(result).toBe(false);
    });
  });

  describe("useLocalTime", () => {
    it("should serialize true to '1'", () => {
      const result = useLocalTimeConfig.serialize(true);
      expect(result).toBe("1");
    });

    it("should serialize false to '0'", () => {
      const result = useLocalTimeConfig.serialize(false);
      expect(result).toBe("0");
    });

    it("should deserialize '1' to true", () => {
      const result = useLocalTimeConfig.deserialize("1");
      expect(result).toBe(true);
    });

    it("should deserialize '0' to false", () => {
      const result = useLocalTimeConfig.deserialize("0");
      expect(result).toBe(false);
    });
  });
});
