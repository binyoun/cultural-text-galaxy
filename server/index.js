const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const { processHandwriting, hexToRgb } = require('./imageProcessor');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_PARTICIPANTS_EXPECTED = 20; // used to normalize the density factor

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

// Table DAT equivalent: sequential inventory of current inputs,
// exactly 1 row = 1 full name image instance slot.
const entries = [];

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three')));

app.get('/api/entries', (req, res) => {
  res.json({ entries, count: entries.length, maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED });
});

app.post('/api/submit', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image file is required' });
    }

    const color = hexToRgb(req.body.color || '#ffffff');
    const transparency = clamp(parseFloat(req.body.transparency), 0.1, 1.0, 1.0);
    const intensity = clamp(parseFloat(req.body.intensity), 1.0, 5.0, 1.0);
    const origin = (req.body.origin || '').toString().trim().slice(0, 60);

    const pngBuffer = await processHandwriting(req.file.buffer, color);

    const id = crypto.randomUUID();
    const filename = `${id}.png`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), pngBuffer);

    const entry = {
      id,
      url: `/uploads/${filename}`,
      color: req.body.color || '#ffffff',
      transparency,
      intensity,
      origin,
      createdAt: Date.now(),
    };

    entries.push(entry);

    io.emit('newEntry', entry);
    io.emit('count', { count: entries.length, maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED });

    res.json({ ok: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'processing failed' });
  }
});

function clamp(value, min, max, fallback) {
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

io.on('connection', (socket) => {
  socket.emit('count', { count: entries.length, maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED });
});

server.listen(PORT, () => {
  console.log(`Cultural Text Galaxy server running:`);
  console.log(`  Display (venue screen): http://localhost:${PORT}/display.html`);
  console.log(`  Mobile client (share via QR): http://<your-lan-ip>:${PORT}/mobile.html`);
});
