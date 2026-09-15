const sharp = require('sharp');

/**
 * Threshold/Crop TOP equivalent.
 * Takes a raw handwriting photo (paper + ink) and returns a PNG buffer where
 * the paper background is fully transparent and the ink strokes are tinted
 * with the participant's chosen RGB color. The cutoff is computed per photo
 * with Otsu's method on the normalized luminance histogram, since a fixed
 * cutoff falls apart under real phone-camera lighting (shadows, off-white
 * paper, color casts) even though it looks fine on a clean synthetic test.
 *
 * @param {Buffer} inputBuffer raw uploaded image
 * @param {{r:number,g:number,b:number}} color target tint
 * @param {number} maxSize longest edge to downscale to before processing
 * @returns {Promise<Buffer>} RGBA PNG buffer
 */
async function processHandwriting(inputBuffer, color, maxSize = 768) {
  const { r, g, b } = color;

  const { data, info } = await sharp(inputBuffer)
    .rotate() // respect EXIF orientation
    .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .normalize() // stretch contrast so uneven lighting doesn't wash out the ink
    .blur(0.6) // soften JPEG/sensor noise before thresholding
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixelCount = width * height;
  const out = Buffer.alloc(pixelCount * 4);

  const otsu = computeOtsuThreshold(data, pixelCount);

  // No usable dark/light split found (blank or near-uniform paper) -
  // treat the whole frame as background rather than guessing at noise.
  if (otsu === null) {
    return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
  }

  const RAMP = 28; // soft anti-aliased edge around the computed cutoff
  const whiteFloor = Math.min(255, otsu + RAMP);
  const blackCeil = Math.max(0, otsu - RAMP);

  for (let i = 0; i < pixelCount; i++) {
    const luminance = data[i];

    let alpha;
    if (luminance >= whiteFloor) {
      alpha = 0;
    } else if (luminance <= blackCeil) {
      alpha = 255;
    } else {
      const t = (whiteFloor - luminance) / (whiteFloor - blackCeil);
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

/**
 * Otsu's method: finds the luminance cutoff that best separates a bimodal
 * histogram (paper vs. ink) by maximizing between-class variance.
 * Returns null when the image has no meaningful dark/light split.
 */
function computeOtsuThreshold(greyscaleData, pixelCount) {
  const histogram = new Array(256).fill(0);
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    const v = greyscaleData[i];
    histogram[v]++;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (max - min < 20) return null; // effectively flat, no ink present

  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * histogram[t];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = -1;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;

    const weightF = pixelCount - weightB;
    if (weightF === 0) break;

    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;

    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
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
