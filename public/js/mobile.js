const photoInput = document.getElementById('photo-input');
const captureBox = document.querySelector('.capture-box');
const captureLabel = document.getElementById('capture-label');
const preview = document.getElementById('preview');
const colorInput = document.getElementById('color-input');
const transparencyInput = document.getElementById('transparency-input');
const intensityInput = document.getElementById('intensity-input');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');

let selectedFile = null;

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;

  selectedFile = file;
  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.hidden = false;
  captureLabel.hidden = true;
  submitBtn.disabled = false;
});

submitBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  submitBtn.disabled = true;
  statusEl.textContent = 'Sending...';

  const formData = new FormData();
  formData.append('image', selectedFile);
  formData.append('color', colorInput.value);
  formData.append('transparency', transparencyInput.value);
  formData.append('intensity', intensityInput.value);

  try {
    const res = await fetch('/api/submit', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('upload failed');

    statusEl.textContent = 'Your name is now in the galaxy.';
    resetForm();
  } catch (err) {
    statusEl.textContent = 'Something went wrong, please try again.';
    submitBtn.disabled = false;
  }
});

function resetForm() {
  selectedFile = null;
  photoInput.value = '';
  preview.hidden = true;
  captureLabel.hidden = false;
  submitBtn.disabled = true;
}

const socket = io();
socket.on('count', ({ count }) => {
  countEl.textContent = count;
});
