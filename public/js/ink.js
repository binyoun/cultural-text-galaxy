// Lift Your Ink: removes the paper from a handwriting photo in the browser
// and saves the ink as a transparent PNG for TouchDesigner. Same idea as
// server/imageProcessor.js (contrast stretch + Otsu threshold), but it runs
// on the participant's device so nothing is uploaded.

const MAX_EDGE = 2000; // keeps detail for TD while staying fast on phones
const SOFT = 14; // luminance range of the soft edge around each stroke
const TRIM_PAD = 24; // px of empty space kept around the trimmed ink

const pick = document.getElementById('inkPick');
const result = document.getElementById('inkResult');
const cameraInput = document.getElementById('inkCameraInput');
const uploadInput = document.getElementById('inkUploadInput');
const canvas = document.getElementById('inkCanvas');
const strength = document.getElementById('inkStrength');
const colours = document.getElementById('inkColours');
const customColour = document.getElementById('inkCustomColour');
const trim = document.getElementById('inkTrim');
const saveBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');

let lum = null; // stretched luminance, one byte per pixel
let width = 0;
let height = 0;
let otsu = 128;
let colour = '#000000';
let pending = false;

document.getElementById('inkCameraBtn').addEventListener('click', () => cameraInput.click());
document.getElementById('inkUploadBtn').addEventListener('click', () => uploadInput.click());
document.getElementById('inkRetakeBtn').addEventListener('click', () => {
  result.hidden = true;
  pick.hidden = false;
  statusEl.textContent = '';
  cameraInput.value = '';
  uploadInput.value = '';
});
cameraInput.addEventListener('change', () => cameraInput.files[0] && load(cameraInput.files[0]));
uploadInput.addEventListener('change', () => uploadInput.files[0] && load(uploadInput.files[0]));

strength.addEventListener('input', schedule);
trim.addEventListener('change', schedule);
customColour.addEventListener('input', () => {
  colour = customColour.value;
  schedule();
});
colours.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  colours.querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b === btn));
  if (btn.dataset.colour === 'custom') {
    customColour.hidden = false;
    colour = customColour.value;
  } else {
    customColour.hidden = true;
    colour = btn.dataset.colour;
  }
  schedule();
});

function load(file) {
  statusEl.textContent = 'Reading your photo...';
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    prepare(img);
    pick.hidden = true;
    result.hidden = false;
    statusEl.textContent = '';
    render();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    statusEl.textContent =
      "This browser can't open this photo (often an iPhone HEIC file on a computer). Please use a JPG or PNG, or open this page on your phone.";
  };
  img.src = url;
}

// Downscale, convert to luminance and stretch contrast so uneven light and
// off-white paper don't wash out the ink. Then pick the Otsu cutoff.
function prepare(img) {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  width = Math.round(img.naturalWidth * scale);
  height = Math.round(img.naturalHeight * scale);

  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const ctx = work.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNG input reads as white paper
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;

  const raw = new Uint8ClampedArray(width * height);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < raw.length; i += 4, p++) {
    const v = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
    raw[p] = v;
    hist[v]++;
  }

  const lo = percentile(hist, raw.length, 0.01);
  const hi = percentile(hist, raw.length, 0.99);
  const span = Math.max(1, hi - lo);
  lum = new Uint8ClampedArray(raw.length);
  const stretched = new Uint32Array(256);
  for (let p = 0; p < raw.length; p++) {
    const v = ((raw[p] - lo) * 255) / span;
    lum[p] = v;
    stretched[lum[p]]++;
  }
  otsu = otsuThreshold(stretched, lum.length);
  strength.value = 0;
}

function percentile(hist, total, q) {
  const target = total * q;
  let sum = 0;
  for (let v = 0; v < 256; v++) {
    sum += hist[v];
    if (sum >= target) return v;
  }
  return 255;
}

function otsuThreshold(hist, total) {
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

function schedule() {
  if (pending || !lum) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    render();
  });
}

// Pixels darker than the cutoff become ink, with a soft edge so strokes
// don't look jagged. "More ink" raises the cutoff, "less ink" lowers it.
function render() {
  const cutoff = otsu + Number(strength.value);
  const r = parseInt(colour.slice(1, 3), 16);
  const g = parseInt(colour.slice(3, 5), 16);
  const b = parseInt(colour.slice(5, 7), 16);

  const out = new ImageData(width, height);
  const d = out.data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
    const a = Math.max(0, Math.min(1, (cutoff + SOFT - lum[p]) / (2 * SOFT)));
    if (a === 0) continue;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a * 255;
    if (a > 0.5) {
      const x = p % width;
      const y = (p / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  let sx = 0, sy = 0, sw = width, sh = height;
  if (trim.checked && maxX >= 0) {
    sx = Math.max(0, minX - TRIM_PAD);
    sy = Math.max(0, minY - TRIM_PAD);
    sw = Math.min(width, maxX + TRIM_PAD + 1) - sx;
    sh = Math.min(height, maxY + TRIM_PAD + 1) - sy;
  }
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d').putImageData(out, -sx, -sy);

  statusEl.textContent = maxX < 0 ? 'No ink found. Try sliding Ink strength towards "more ink".' : '';
}

saveBtn.addEventListener('click', () => {
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], 'my-ink.png', { type: 'image/png' });
    // On phones, the share sheet offers "Save Image"; elsewhere, download.
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'My ink' });
        statusEl.textContent = 'Saved. Use this PNG in the TouchDesigner starter file.';
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'my-ink.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    statusEl.textContent = 'Saved as my-ink.png. Use it in the TouchDesigner starter file.';
  }, 'image/png');
});
