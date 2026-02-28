import SkyBox from "@cesium/engine/Source/Scene/SkyBox";

const FACE_NAMES = ["positiveX", "negativeX", "positiveY", "negativeY", "positiveZ", "negativeZ"];

/**
 * A sky box that composites multiple image layers with per-layer transparency
 * onto HTMLCanvasElements, then feeds those canvases to a single Cesium SkyBox.
 *
 * Cesium only supports one scene.skyBox at a time, so to stack multiple sky maps
 * (e.g. stars + constellation overlay), we composite them onto 6 offscreen canvases
 * (one per cube face) and use those as the SkyBox sources.
 */
export class MultiLayerSkyBox {
  constructor() {
    this.show = true;
    this._layers = []; // {name, sources, alpha, images}
    this._canvases = null; // {positiveX: canvas, ...}
    this._dirty = false;
    this._skyBox = new SkyBox({ sources: this._makeBlankSources(64) });
    this._faceSize = 0;
    this.isMultiLayerSkyBox = true; // marker for identification
    this.onLoad = null; // callback when images finish loading
  }

  /**
   * Set layers and begin loading images.
   * @param {Array<{name: string, sources: object, alpha: number}>} configs
   */
  setLayers(configs) {
    if (!configs || configs.length === 0) {
      this._layers = [];
      this._dirty = true;
      return;
    }

    this._layers = configs.map((cfg) => ({
      name: cfg.name,
      sources: cfg.sources,
      alpha: cfg.alpha ?? 1.0,
      images: null, // loaded later
    }));

    this._loadAllImages();
  }

  /**
   * Update the alpha for a named layer.
   * @param {string} name
   * @param {number} alpha 0-1
   */
  setLayerAlpha(name, alpha) {
    const layer = this._layers.find((l) => l.name === name);
    if (layer) {
      layer.alpha = alpha;
      this._dirty = true;
    }
  }

  /**
   * Load images for all layers, then mark dirty.
   */
  _loadAllImages() {
    const promises = this._layers.map((layer) => this._loadLayerImages(layer));
    Promise.all(promises).then(() => {
      this._dirty = true;
      if (this.onLoad) this.onLoad();
    });
  }

  /**
   * Load the 6 cube face images for a single layer.
   */
  _loadLayerImages(layer) {
    const facePromises = FACE_NAMES.map((face) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ face, img });
        img.onerror = () => {
          console.warn(`[MultiLayerSkyBox] Failed to load ${layer.sources[face]}`);
          resolve({ face, img: null });
        };
        img.src = layer.sources[face];
      });
    });

    return Promise.all(facePromises).then((results) => {
      layer.images = {};
      for (const { face, img } of results) {
        layer.images[face] = img;
      }
    });
  }

  /**
   * Composite all layers onto 6 canvases.
   */
  _composite() {
    // Use the largest face size from any loaded layer to avoid downscaling artifacts
    let faceSize = this._faceSize;
    for (const layer of this._layers) {
      if (layer.images) {
        const firstImg = layer.images[FACE_NAMES[0]];
        if (firstImg) {
          const size = firstImg.naturalWidth || firstImg.width || 64;
          if (size > faceSize) faceSize = size;
        }
      }
    }
    if (faceSize === 0) faceSize = 64;
    this._faceSize = faceSize;

    // Create or resize canvases
    if (!this._canvases || this._canvases[FACE_NAMES[0]].width !== faceSize) {
      this._canvases = {};
      for (const face of FACE_NAMES) {
        const canvas = document.createElement("canvas");
        canvas.width = faceSize;
        canvas.height = faceSize;
        this._canvases[face] = canvas;
      }
    }

    // Draw each face using additive blending ("lighter").
    // This makes black pixels (0,0,0) contribute nothing, so:
    // - Constellation overlays: black areas are transparent, white lines add on top
    // - Star maps: black space between stars is transparent for background layers
    //
    // After compositing, fill opaque black behind all content ("destination-over").
    // Canvas 2D uses premultiplied alpha internally, and Cesium's CubeMap un-premultiplies
    // on GPU upload (UNPACK_PREMULTIPLY_ALPHA_WEBGL=false for RGBA). Without opaque alpha,
    // un-premultiplication restores full brightness, making globalAlpha have no visible effect.
    for (const face of FACE_NAMES) {
      const canvas = this._canvases[face];
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, faceSize, faceSize);
      ctx.globalCompositeOperation = "lighter";

      for (const layer of this._layers) {
        if (!layer.images || !layer.images[face]) continue;
        ctx.globalAlpha = layer.alpha;
        ctx.drawImage(layer.images[face], 0, 0, faceSize, faceSize);
      }

      // Fill opaque black behind composited content to lock in the dimmed RGB values
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, faceSize, faceSize);
      ctx.globalCompositeOperation = "source-over";
    }

    // Assign canvases to the internal SkyBox with a new object reference
    // so that Cesium detects the change (SkyBox.js line 124: `this._sources !== this.sources`)
    this._skyBox.sources = { ...this._canvases };
  }

  /**
   * Create blank canvas sources for initial SkyBox construction.
   */
  _makeBlankSources(size) {
    const sources = {};
    for (const face of FACE_NAMES) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      sources[face] = canvas;
    }
    return sources;
  }

  /**
   * Called by Cesium each frame. Recomposites only when dirty.
   */
  update(frameState, useHdr) {
    if (!this.show) {
      return undefined;
    }

    // Check if any layer has loaded images
    const hasLoadedLayers = this._layers.some((l) => l.images !== null);

    if (this._dirty && (hasLoadedLayers || this._layers.length === 0)) {
      if (this._layers.length > 0) {
        this._composite();
      }
      this._dirty = false;
    }

    return this._skyBox.update(frameState, useHdr);
  }

  isDestroyed() {
    return this._skyBox.isDestroyed();
  }

  destroy() {
    this._skyBox.destroy();
    this._layers = [];
    this._canvases = null;
  }
}
