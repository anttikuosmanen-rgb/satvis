/**
 * Rasterize SVG images to canvases before handing them to Cesium billboards.
 *
 * Chrome on the Metal backend (seen with Chrome 154 on Apple Silicon) uploads SVG
 * images to WebGL textures as solid black. Since billboards share a texture atlas,
 * a single SVG billboard also blanks every other image in the same collection
 * (e.g. launch site rockets turned into dark squares and planet dots disappeared).
 * Canvases upload correctly, so SVGs are drawn to a canvas first.
 */

// Default replaced-element size browsers use for SVGs without width/height attributes
const DEFAULT_SIZE = 150;

const cache = new Map();

/**
 * Rasterize an SVG URL (or data URI) to a canvas
 * @param {string} url - SVG URL or data URI
 * @returns {Promise<HTMLCanvasElement>} Canvas with the rendered SVG, at the image's natural size
 */
export function rasterizeSvg(url) {
  if (!cache.has(url)) {
    const promise = (async () => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || DEFAULT_SIZE;
      canvas.height = image.naturalHeight || DEFAULT_SIZE;
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    })();
    // Allow retry after a failed load
    promise.catch(() => cache.delete(url));
    cache.set(url, promise);
  }
  return cache.get(url);
}
