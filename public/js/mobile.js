const preCapture = document.getElementById('preCapture');
const cameraBtn = document.getElementById('cameraBtn');
const uploadBtn = document.getElementById('uploadBtn');

const cameraView = document.getElementById('cameraView');
const cameraStream = document.getElementById('cameraStream');
const captureBtn = document.getElementById('captureBtn');
const cancelCameraBtn = document.getElementById('cancelCameraBtn');
const captureCanvas = document.getElementById('captureCanvas');

const previewView = document.getElementById('previewView');
const preview = document.getElementById('preview');
const retakeBtn = document.getElementById('retakeBtn');

const cameraInput = document.getElementById('cameraInput'); // native camera app fallback
const uploadInput = document.getElementById('uploadInput'); // gallery / file picker

const regionButtons = document.querySelectorAll('.region-btn');
const regionWedges = document.querySelectorAll('.region-preview path[data-region]');
const placeInput = document.getElementById('place-input');
const colorInput = document.getElementById('color-input');
const transparencyInput = document.getElementById('transparency-input');
const intensityInput = document.getElementById('intensity-input');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');

let selectedFile = null;
let mediaStream = null;
let selectedRegion = '';
let selectedBehavior = '';

const behaviorButtons = document.querySelectorAll('.behavior-btn');

function setSelectedBehavior(behavior) {
  selectedBehavior = behavior;
  behaviorButtons.forEach((b) => b.classList.toggle('selected', b.dataset.behavior === behavior));
}

behaviorButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setSelectedBehavior(btn.classList.contains('selected') ? '' : btn.dataset.behavior);
  });
});

function setSelectedRegion(region) {
  selectedRegion = region;
  regionButtons.forEach((b) => b.classList.toggle('selected', b.dataset.region === region));
  regionWedges.forEach((w) => w.classList.toggle('selected', w.dataset.region === region));
}

regionButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const isAlreadySelected = btn.classList.contains('selected');
    setSelectedRegion(isAlreadySelected ? '' : btn.dataset.region);
  });
});

function showPreCapture() {
  preCapture.hidden = false;
  cameraView.hidden = true;
  previewView.hidden = true;
}

function showPreview(file) {
  selectedFile = file;
  // Some browsers (e.g. Chrome with .heic) can't show a preview; the photo
  // still sends fine, so say so rather than showing a broken image.
  preview.onerror = () => {
    preview.alt = 'Preview not available for this photo, but it can still be sent.';
  };
  preview.src = URL.createObjectURL(file);
  preCapture.hidden = true;
  cameraView.hidden = true;
  previewView.hidden = false;
  submitBtn.disabled = false;
}

function stopStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

async function startCamera() {
  const canUseLiveCamera =
    window.isSecureContext &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  if (!canUseLiveCamera) {
    // Insecure context (plain http:// LAN address) or unsupported browser,
    // fall back to the OS camera app via the file input's capture attribute.
    cameraInput.click();
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    cameraStream.srcObject = mediaStream;
    preCapture.hidden = true;
    cameraView.hidden = false;
  } catch (err) {
    // permission denied, no camera found, etc.
    cameraInput.click();
  }
}

cameraBtn.addEventListener('click', startCamera);

uploadBtn.addEventListener('click', () => {
  uploadInput.click();
});

captureBtn.addEventListener('click', () => {
  const width = cameraStream.videoWidth;
  const height = cameraStream.videoHeight;
  captureCanvas.width = width;
  captureCanvas.height = height;
  captureCanvas.getContext('2d').drawImage(cameraStream, 0, 0, width, height);

  captureCanvas.toBlob((blob) => {
    stopStream();
    showPreview(blob);
  }, 'image/jpeg', 0.92);
});

cancelCameraBtn.addEventListener('click', () => {
  stopStream();
  showPreCapture();
});

retakeBtn.addEventListener('click', () => {
  selectedFile = null;
  cameraInput.value = '';
  uploadInput.value = '';
  submitBtn.disabled = true;
  showPreCapture();
});

cameraInput.addEventListener('change', () => {
  const file = cameraInput.files[0];
  if (file) showPreview(file);
});

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0];
  if (file) showPreview(file);
});

submitBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  submitBtn.disabled = true;
  statusEl.textContent = 'Sending...';

  const formData = new FormData();
  formData.append('image', selectedFile, 'capture.jpg');
  formData.append('color', colorInput.value);
  formData.append('transparency', transparencyInput.value);
  formData.append('intensity', intensityInput.value);
  formData.append('region', selectedRegion);
  formData.append('place', placeInput.value);
  formData.append('behavior', selectedBehavior);

  try {
    const res = await fetch('/api/submit', { method: 'POST', body: formData });
    if (res.status === 409) {
      statusEl.textContent = 'The galaxy is full. Please send your photo to the organisers.';
      return;
    }
    if (res.status === 413) {
      statusEl.textContent = 'This photo is too large (over 15 MB). Please take a screenshot of it and send that instead.';
      submitBtn.disabled = false;
      return;
    }
    if (res.status === 415 || res.status === 422) {
      statusEl.textContent = "We couldn't read this photo. Please send a JPG or PNG photo instead.";
      submitBtn.disabled = false;
      return;
    }
    if (!res.ok) throw new Error('upload failed');

    statusEl.textContent = 'Your text is now in the galaxy.';
    resetForm();
  } catch (err) {
    statusEl.textContent = 'Something went wrong, please try again.';
    submitBtn.disabled = false;
  }
});

function resetForm() {
  selectedFile = null;
  cameraInput.value = '';
  uploadInput.value = '';
  placeInput.value = '';
  setSelectedRegion('');
  setSelectedBehavior('');
  submitBtn.disabled = true;
  showPreCapture();
}

const socket = io();
socket.on('count', ({ count }) => {
  countEl.textContent = count;
});
