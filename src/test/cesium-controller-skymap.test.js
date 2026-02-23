import { describe, it, expect, vi, beforeEach } from "vitest";
import SkyBox from "@cesium/engine/Source/Scene/SkyBox.js";
import { MultiLayerSkyBox } from "../modules/MultiLayerSkyBox";

// Mock SkyBox
vi.mock("@cesium/engine/Source/Scene/SkyBox.js", () => {
  function MockSkyBox(options) {
    this.sources = options?.sources ?? null;
    this.show = true;
    this.update = vi.fn();
    this.destroy = vi.fn();
    this.isDestroyed = () => false;
  }
  MockSkyBox.createEarthSkyBox = vi.fn(() => {
    const box = new MockSkyBox();
    box._isDefaultSkyBox = true;
    return box;
  });
  return { default: MockSkyBox };
});

/**
 * Test the sky map management logic that CesiumController uses.
 * Rather than mocking the entire CesiumController (which has many dependencies),
 * we test the skyMapLayers setter logic in isolation by simulating it.
 */
describe("Sky Map Management (CesiumController logic)", () => {
  let scene;
  let skyMapProviders;
  let _multiLayerSkyBox;
  let _savedSkyBox;

  // Replicate the CesiumController skyMapLayers setter
  function setSkyMapLayers(configs) {
    if (!configs || configs.length === 0) {
      if (_multiLayerSkyBox) {
        _multiLayerSkyBox.destroy();
        _multiLayerSkyBox = null;
      }
      scene.skyBox = SkyBox.createEarthSkyBox();
      return;
    }

    const layerConfigs = configs
      .filter((c) => skyMapProviders[c.name])
      .map((c) => ({
        name: c.name,
        sources: skyMapProviders[c.name].sources,
        alpha: c.alpha ?? 1.0,
      }));

    if (layerConfigs.length === 0) return;

    if (!_multiLayerSkyBox) {
      _multiLayerSkyBox = new MultiLayerSkyBox();
    }
    _multiLayerSkyBox.setLayers(layerConfigs);
    scene.skyBox = _multiLayerSkyBox;
  }

  // Replicate the background setter
  function setBackground(active) {
    if (!active) {
      _savedSkyBox = scene.skyBox;
      scene.skyBox = undefined;
    } else if (_savedSkyBox) {
      scene.skyBox = _savedSkyBox;
      _savedSkyBox = null;
    }
  }

  beforeEach(() => {
    scene = { skyBox: { show: true } };
    _multiLayerSkyBox = null;
    _savedSkyBox = null;
    skyMapProviders = {
      Tycho2K: {
        sources: {
          positiveX: "tycho/px.jpg",
          negativeX: "tycho/mx.jpg",
          positiveY: "tycho/py.jpg",
          negativeY: "tycho/my.jpg",
          positiveZ: "tycho/pz.jpg",
          negativeZ: "tycho/mz.jpg",
        },
      },
      Starmap8K: {
        sources: {
          positiveX: "starmap/px.jpg",
          negativeX: "starmap/mx.jpg",
          positiveY: "starmap/py.jpg",
          negativeY: "starmap/my.jpg",
          positiveZ: "starmap/pz.jpg",
          negativeZ: "starmap/mz.jpg",
        },
      },
    };
  });

  it("should return sky map provider names", () => {
    const names = Object.keys(skyMapProviders);
    expect(names).toContain("Tycho2K");
    expect(names).toContain("Starmap8K");
    expect(names).toHaveLength(2);
  });

  it("should create MultiLayerSkyBox when setting sky map layers", () => {
    setSkyMapLayers([{ name: "Tycho2K", alpha: 1.0 }]);

    expect(_multiLayerSkyBox).toBeDefined();
    expect(_multiLayerSkyBox.isMultiLayerSkyBox).toBe(true);
    expect(scene.skyBox).toBe(_multiLayerSkyBox);
  });

  it("should restore default SkyBox when clearing sky map layers", () => {
    setSkyMapLayers([{ name: "Tycho2K", alpha: 1.0 }]);
    expect(_multiLayerSkyBox).toBeDefined();

    setSkyMapLayers([]);
    expect(_multiLayerSkyBox).toBeNull();
    expect(scene.skyBox).toBeDefined();
    expect(scene.skyBox._isDefaultSkyBox).toBe(true);
  });

  it("should save and restore sky box when toggling background", () => {
    setSkyMapLayers([{ name: "Tycho2K", alpha: 1.0 }]);
    const customSkyBox = scene.skyBox;

    // Disable background
    setBackground(false);
    expect(scene.skyBox).toBeUndefined();
    expect(_savedSkyBox).toBe(customSkyBox);

    // Re-enable background
    setBackground(true);
    expect(scene.skyBox).toBe(customSkyBox);
  });

  it("should ignore unknown sky map names", () => {
    setSkyMapLayers([{ name: "NonExistent", alpha: 1.0 }]);
    expect(_multiLayerSkyBox).toBeNull();
  });

  it("should support multiple sky map layers", () => {
    setSkyMapLayers([
      { name: "Tycho2K", alpha: 1.0 },
      { name: "Starmap8K", alpha: 0.5 },
    ]);

    expect(_multiLayerSkyBox).toBeDefined();
    expect(_multiLayerSkyBox._layers).toHaveLength(2);
    expect(_multiLayerSkyBox._layers[0].name).toBe("Tycho2K");
    expect(_multiLayerSkyBox._layers[1].name).toBe("Starmap8K");
    expect(_multiLayerSkyBox._layers[1].alpha).toBe(0.5);
  });

  it("should reuse existing MultiLayerSkyBox when updating layers", () => {
    setSkyMapLayers([{ name: "Tycho2K", alpha: 1.0 }]);
    const firstInstance = _multiLayerSkyBox;

    setSkyMapLayers([{ name: "Starmap8K", alpha: 0.8 }]);
    expect(_multiLayerSkyBox).toBe(firstInstance);
  });
});
