require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const { processHandwriting, hexToRgb } = require('./imageProcessor');
const persistence = require('./persistence');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_PARTICIPANTS_EXPECTED = 20; // used to normalize the density factor
const VALID_REGIONS = new Set(['asia', 'middle-east', 'africa', 'europe', 'americas', 'oceania']);

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
    const requestedRegion = (req.body.region || '').toString().trim().toLowerCase();
    const region = VALID_REGIONS.has(requestedRegion) ? requestedRegion : '';
    const place = (req.body.place || '').toString().trim().slice(0, 60);

    const pngBuffer = await processHandwriting(req.file.buffer, color);

    const id = crypto.randomUUID();
    const filename = `${id}.png`;

    let url;
    if (persistence.isConfigured) {
      url = await persistence.uploadImage(filename, pngBuffer);
    } else {
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), pngBuffer);
      url = `/uploads/${filename}`;
    }

    const entry = {
      id,
      url,
      color: req.body.color || '#ffffff',
      transparency,
      intensity,
      region,
      place,
      createdAt: Date.now(),
    };

    if (persistence.isConfigured) {
      await persistence.insertEntry(entry);
    }

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

async function start() {
  if (persistence.isConfigured) {
    const existing = await persistence.fetchAllEntries();
    entries.push(...existing);
    console.log(`Rehydrated ${existing.length} entries from Supabase.`);
  }

  server.listen(PORT, () => {
    console.log(`Cultural Text Galaxy server running:`);
    console.log(`  Display (venue screen): http://localhost:${PORT}/display.html`);
    console.log(`  Mobile client (share via QR): http://<your-lan-ip>:${PORT}/mobile.html`);
    console.log(`  Persistence: ${persistence.isConfigured ? 'Supabase' : 'in-memory only (local dev)'}`);
  });
}

start();
