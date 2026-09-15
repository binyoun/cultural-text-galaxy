const sharp = require('sharp');

/**
 * Threshold/Crop TOP equivalent.
 * Takes a raw handwriting photo (paper + ink) and returns a PNG buffer where
 * the paper background is fully transparent and the ink strokes are tinted
 * with the participant's chosen RGB color. The alpha channel is driven by
 * how dark each pixel is (darker ink = more opaque), so soft pencil strokes
 * stay ghostly while heavy marker strokes read as solid.
 *
 * @param {Buffer} inputBuffer raw uploaded image
 * @param {{r:number,g:number,b:number}} color target tint
 * @param {number} maxSize longest edge to downscale to before processing
 * @returns {Promise<Buffer>} RGBA PNG buffer
 */
async function processHandwriting(inputBuffer, color, maxSize = 768) {
  const { r, g, b } = color;

  const image = sharp(inputBuffer).rotate(); // respect EXIF orientation
  const resized = image.resize({
    width: maxSize,
    height: maxSize,
    fit: 'inside',
    withoutEnlargement: true,
  });

  const { data, info } = await resized
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  // Luminance threshold: treat near-white paper as background,
  // map darker pixels to alpha so ink strokes become a soft mask.
  const WHITE_FLOOR = 235; // pixels lighter than this are fully transparent
  const BLACK_CEIL = 60; // pixels darker than this are fully opaque

  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * channels;
    const rr = data[srcIdx];
    const gg = data[srcIdx + 1];
    const bb = data[srcIdx + 2];
    const luminance = 0.299 * rr + 0.587 * gg + 0.114 * bb;

    let alpha;
    if (luminance >= WHITE_FLOOR) {
      alpha = 0;
    } else if (luminance <= BLACK_CEIL) {
      alpha = 255;
    } else {
      const t = (WHITE_FLOOR - luminance) / (WHITE_FLOOR - BLACK_CEIL);
      alpha = Math.round(t * 255);
    }

    const dstIdx = i * 4;
    out[dstIdx] = r;
    out[dstIdx + 1] = g;
    out[dstIdx + 2] = b;
    out[dstIdx + 3] = alpha;
  }

  return sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 255, g: 255, b: 255 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

module.exports = { processHandwriting, hexToRgb };
