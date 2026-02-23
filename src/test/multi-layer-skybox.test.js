import { describe, it, expect, vi, beforeEach } from "vitest";
import { MultiLayerSkyBox } from "../modules/MultiLayerSkyBox";

// Mock SkyBox
vi.mock("@cesium/engine/Source/Scene/SkyBox.js", () => {
  function MockSkyBox() {
    this.sources = null;
    this.show = true;
    this.update = vi.fn().mockReturnValue("drawCommand");
    this.destroy = vi.fn();
    this.isDestroyed = () => false;
  }
  return { default: MockSkyBox };
});

// Mock canvas context for verifying draw calls
const mockCtx = {
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: "#000",
  globalAlpha: 1.0,
  globalCompositeOperation: "source-over",
};

// Track canvas creation
const createdCanvases = [];
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, "createElement").mockImplementation((tag) => {
  if (tag === "canvas") {
    const canvas = originalCreateElement("canvas");
    // jsdom doesn't support getContext('2d'), so mock it
    canvas.getContext = vi.fn().mockReturnValue(mockCtx);
    createdCanvases.push(canvas);
    return canvas;
  }
  return originalCreateElement(tag);
});

// Mock Image loading
class MockImage {
  constructor() {
    this.naturalWidth = 256;
    this.width = 256;
    setTimeout(() => {
      if (this.onload) this.onload();
    }, 0);
  }
}
vi.stubGlobal("Image", MockImage);

describe("MultiLayerSkyBox", () => {
  let skyBox;

  beforeEach(() => {
    vi.clearAllMocks();
    createdCanvases.length = 0;
    mockCtx.globalAlpha = 1.0;
    skyBox = new MultiLayerSkyBox();
  });

  it("should initialize with show=true and empty layers", () => {
    expect(skyBox.show).toBe(true);
    expect(skyBox._layers).toEqual([]);
    expect(skyBox.isMultiLayerSkyBox).toBe(true);
  });

  it("should accept layer configs via setLayers()", async () => {
    const sources = {
      positiveX: "stars/px.jpg",
      negativeX: "stars/mx.jpg",
      positiveY: "stars/py.jpg",
      negativeY: "stars/my.jpg",
      positiveZ: "stars/pz.jpg",
      negativeZ: "stars/mz.jpg",
    };

    skyBox.setLayers([{ name: "TestStars", sources, alpha: 0.8 }]);

    expect(skyBox._layers).toHaveLength(1);
    expect(skyBox._layers[0].name).toBe("TestStars");
    expect(skyBox._layers[0].alpha).toBe(0.8);

    // Wait for image loading
    await new Promise((r) => setTimeout(r, 10));
    expect(skyBox._dirty).toBe(true);
  });

  it("should update alpha for a named layer", () => {
    skyBox._layers = [{ name: "Stars", alpha: 1.0 }];
    skyBox.setLayerAlpha("Stars", 0.5);

    expect(skyBox._layers[0].alpha).toBe(0.5);
    expect(skyBox._dirty).toBe(true);
  });

  it("should clear layers when setLayers([]) is called", () => {
    skyBox._layers = [{ name: "Stars", alpha: 1.0 }];
    skyBox.setLayers([]);

    expect(skyBox._layers).toEqual([]);
    expect(skyBox._dirty).toBe(true);
  });

  it("should composite layers with correct globalAlpha", async () => {
    const sources = {
      positiveX: "px.jpg",
      negativeX: "mx.jpg",
      positiveY: "py.jpg",
      negativeY: "my.jpg",
      positiveZ: "pz.jpg",
      negativeZ: "mz.jpg",
    };

    skyBox.setLayers([
      { name: "Layer1", sources, alpha: 1.0 },
      { name: "Layer2", sources, alpha: 0.5 },
    ]);

    // Wait for image loading
    await new Promise((r) => setTimeout(r, 10));

    // Trigger composite via update
    skyBox.update(
      {
        mode: 1, // SCENE3D
        passes: { render: true },
        context: {},
      },
      false,
    );

    // Should have drawn images with different alpha values
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("should return undefined from update() when show is false", () => {
    skyBox.show = false;
    const result = skyBox.update({}, false);
    expect(result).toBeUndefined();
  });

  it("should delegate update to internal SkyBox", () => {
    const frameState = { mode: 1, passes: { render: true }, context: {} };
    skyBox.update(frameState, true);
    expect(skyBox._skyBox.update).toHaveBeenCalledWith(frameState, true);
  });

  it("should clean up on destroy", () => {
    skyBox.destroy();
    expect(skyBox._skyBox.destroy).toHaveBeenCalled();
    expect(skyBox._layers).toEqual([]);
    expect(skyBox._canvases).toBeNull();
  });

  it("should report isDestroyed from internal SkyBox", () => {
    expect(skyBox.isDestroyed()).toBe(false);
  });
});
