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

regionButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const isAlreadySelected = btn.classList.contains('selected');
    regionButtons.forEach((b) => b.classList.remove('selected'));
    if (isAlreadySelected) {
      selectedRegion = '';
    } else {
      btn.classList.add('selected');
      selectedRegion = btn.dataset.region;
    }
  });
});

function showPreCapture() {
  preCapture.hidden = false;
  cameraView.hidden = true;
  previewView.hidden = true;
}

function showPreview(file) {
  selectedFile = file;
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

  try {
    const res = await fetch('/api/submit', { method: 'POST', body: formData });
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
  selectedRegion = '';
  regionButtons.forEach((b) => b.classList.remove('selected'));
  submitBtn.disabled = true;
  showPreCapture();
}

const socket = io();
socket.on('count', ({ count }) => {
  countEl.textContent = count;
});
