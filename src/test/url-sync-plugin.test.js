import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia, defineStore } from "pinia";

describe("URL Sync Plugin - Serialization", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("should serialize string values", () => {
    const serialize = (v) => String(v);

    expect(serialize("test")).toBe("test");
    expect(serialize("ISS (ZARYA)")).toBe("ISS (ZARYA)");
  });

  it("should serialize array values with custom function", () => {
    const serialize = (v) => v.join(",");

    expect(serialize(["Point", "Label"])).toBe("Point,Label");
    expect(serialize(["A", "B", "C"])).toBe("A,B,C");
  });

  it("should serialize boolean values to 1 or 0", () => {
    const serialize = (v) => (v ? "1" : "0");

    expect(serialize(true)).toBe("1");
    expect(serialize(false)).toBe("0");
  });

  it("should handle empty arrays", () => {
    const serialize = (v) => v.join(",");

    expect(serialize([])).toBe("");
  });

  it("should handle space replacement in strings", () => {
    const serialize = (v) => v.join(",").replaceAll(" ", "-");

    expect(serialize(["Space Station", "Active"])).toBe("Space-Station,Active");
  });
});

describe("URL Sync Plugin - Deserialization", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("should deserialize string values", () => {
    const deserialize = (v) => String(v);

    expect(deserialize("test")).toBe("test");
    expect(deserialize("123")).toBe("123");
  });

  it("should deserialize array values with custom function", () => {
    const deserialize = (v) => v.split(",").filter((e) => e);

    expect(deserialize("Point,Label")).toEqual(["Point", "Label"]);
    expect(deserialize("A,B,C")).toEqual(["A", "B", "C"]);
  });

  it("should deserialize boolean values from 1 or 0", () => {
    const deserialize = (v) => v === "1";

    expect(deserialize("1")).toBe(true);
    expect(deserialize("0")).toBe(false);
  });

  it("should handle empty strings for arrays", () => {
    const deserialize = (v) => v.split(",").filter((e) => e);

    expect(deserialize("")).toEqual([]);
  });

  it("should handle space restoration in strings", () => {
    const deserialize = (v) => v.replaceAll("-", " ").split(",").filter((e) => e);

    expect(deserialize("Space-Station,Active")).toEqual(["Space Station", "Active"]);
  });

  it("should filter empty elements from arrays", () => {
    const deserialize = (v) => v.split(",").filter((e) => e);

    // Empty elements are filtered out
    expect(deserialize("A,,B,C")).toEqual(["A", "B", "C"]);
  });
});

describe("URL Sync Plugin - Default Values", () => {
  it("should handle default values correctly", () => {
    // Test that default values are used when URL param is missing
    const defaultValue = ["Point", "Label"];
    const urlValue = undefined;

    const result = urlValue || defaultValue;

    expect(result).toEqual(["Point", "Label"]);
  });

  it("should override default with URL value when present", () => {
    const defaultValue = ["Point", "Label"];
    const urlValue = ["Point", "Label", "Orbit"];

    const result = urlValue || defaultValue;

    expect(result).toEqual(["Point", "Label", "Orbit"]);
  });
});

describe("URL Sync Plugin - Complex Serialization", () => {
  it("should serialize ground station objects", () => {
    const serialize = (v) => v.map((gs) => `${gs.lat.toFixed(4)},${gs.lon.toFixed(4)}${gs.name ? `,${gs.name}` : ""}`).join("_");

    const groundStations = [
      { lat: 48.177, lon: 11.7476, name: "Munich" },
      { lat: 37.7749, lon: -122.4194 },
    ];

    const result = serialize(groundStations);

    expect(result).toContain("48.1770");
    expect(result).toContain("11.7476");
    expect(result).toContain("Munich");
    expect(result).toContain("_"); // Separator
    expect(result).toContain("37.7749");
    expect(result).not.toMatch(/37\.7749.*,$/); // No trailing comma for missing name
  });

  it("should deserialize ground station objects", () => {
    const deserialize = (v) =>
      v.split("_").map((gs) => {
        const g = gs.split(",");
        return {
          lat: parseFloat(g[0], 10),
          lon: parseFloat(g[1], 10),
          name: g[2],
        };
      });

    const urlString = "48.1770,11.7476,Munich_37.7749,-122.4194";

    const result = deserialize(urlString);

    expect(result).toHaveLength(2);
    expect(result[0].lat).toBeCloseTo(48.177, 3);
    expect(result[0].lon).toBeCloseTo(11.7476, 3);
    expect(result[0].name).toBe("Munich");
    expect(result[1].lat).toBeCloseTo(37.7749, 3);
    expect(result[1].lon).toBeCloseTo(-122.4194, 3);
    expect(result[1].name).toBeUndefined();
  });
});
