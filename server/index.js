require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const { WebSocketServer, WebSocket } = require('ws');
const { processHandwriting, hexToRgb, toDecodableImage } = require('./imageProcessor');
const persistence = require('./persistence');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_PARTICIPANTS_EXPECTED = 20; // used to normalize the density factor
// Hard cap matching the 50 fixed slots in the TouchDesigner galaxy.
const MAX_ENTRIES = parseInt(process.env.MAX_ENTRIES, 10) || 50;
// Protects POST /api/reset. Unset = reset disabled.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const VALID_REGIONS = new Set(['asia', 'middle-east', 'africa', 'europe', 'americas', 'oceania']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Plain WebSocket feed for TouchDesigner's WebSocket DAT (Socket.IO's own
// protocol needs a handshake TD doesn't speak). Read-only: sends JSON text
// messages, ignores anything it receives.
const TD_WS_PATH = '/td';
const tdWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== TD_WS_PATH) return; // leave /socket.io/ to Socket.IO
  tdWss.handleUpgrade(req, socket, head, (ws) => tdWss.emit('connection', ws, req));
});

// TD needs full image URLs; local-dev uploads are relative paths.
function absoluteEntry(entry, origin) {
  return entry.url.startsWith('/') ? { ...entry, url: origin + entry.url } : entry;
}

function requestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host}`;
}

tdWss.on('connection', (ws, req) => {
  ws.origin = requestOrigin(req);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({
    type: 'init',
    entries: entries.map((e) => absoluteEntry(e, ws.origin)),
    count: entries.length,
    maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED,
    maxEntries: MAX_ENTRIES,
  }));
});

function broadcastToTD(entry) {
  for (const ws of tdWss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    ws.send(JSON.stringify({
      type: 'newEntry',
      entry: absoluteEntry(entry, ws.origin),
      count: entries.length,
      maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED,
      maxEntries: MAX_ENTRIES,
    }));
  }
}

function broadcastResetToTD() {
  const message = JSON.stringify({ type: 'reset', count: 0, maxEntries: MAX_ENTRIES });
  for (const ws of tdWss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  }
}

// Ping every 25s so Render's proxy doesn't drop an idle connection,
// and clean up clients that stopped answering.
setInterval(() => {
  for (const ws of tdWss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

const MAX_UPLOAD_MB = 15;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Some browsers send .heic with no type or as octet-stream; let those
    // through and let toDecodableImage decide whether it is a real image.
    const untyped = !file.mimetype || file.mimetype === 'application/octet-stream';
    if (!file.mimetype.startsWith('image/') && !untyped) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

// Table DAT equivalent: sequential inventory of current inputs,
// exactly 1 row = 1 full name image instance slot.
const entries = [];

// Short links for the workshop slides and QR codes.
const SHORT_LINKS = {
  '/up': '/mobile.html',
  '/galaxy': '/display.html',
  '/guide': '/writing-guide.html#instructions',
  '/template': '/writing-guide.html#template',
  '/starter': 'https://drive.google.com/drive/folders/1udeo0PnWwCmQ9vR3ww2siDUyJm2Hk_--?usp=sharing',
};
for (const [from, to] of Object.entries(SHORT_LINKS)) {
  app.get(from, (req, res) => res.redirect(302, to));
}

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    persistence: persistence.isConfigured ? 'supabase' : 'memory',
    supabaseEnvSet: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    supabaseError: persistence.lastError,
    supabaseHost: persistence.host,
    adminTokenSet: Boolean(ADMIN_TOKEN),
    adminTokenLength: ADMIN_TOKEN.length,
    count: entries.length,
    maxEntries: MAX_ENTRIES,
  });
});

app.get('/api/entries', (req, res) => {
  res.json({ entries, count: entries.length, maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED });
});

// Wraps multer so size and type errors come back as JSON the upload page
// can explain, instead of an HTML error page.
function receiveImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'too_large', maxMb: MAX_UPLOAD_MB });
    }
    return res.status(415).json({ error: 'not_image' });
  });
}

app.post('/api/submit', receiveImage, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image file is required' });
    }
    if (entries.length >= MAX_ENTRIES) {
      return res.status(409).json({ error: 'galaxy is full' });
    }

    const color = hexToRgb(req.body.color || '#ffffff');
    const transparency = clamp(parseFloat(req.body.transparency), 0.1, 1.0, 1.0);
    const intensity = clamp(parseFloat(req.body.intensity), 1.0, 5.0, 1.0);
    const requestedRegion = (req.body.region || '').toString().trim().toLowerCase();
    const region = VALID_REGIONS.has(requestedRegion) ? requestedRegion : '';
    const place = (req.body.place || '').toString().trim().slice(0, 60);

    let imageBuffer;
    try {
      // iPhone HEIC files sent from a computer need converting first.
      imageBuffer = await toDecodableImage(req.file.buffer);
    } catch (err) {
      console.error('unreadable image:', err.message);
      return res.status(422).json({ error: 'unreadable' });
    }

    const pngBuffer = await processHandwriting(imageBuffer, color);

    // Re-check: other uploads may have filled the last slots while this
    // image was processing.
    if (entries.length >= MAX_ENTRIES) {
      return res.status(409).json({ error: 'galaxy is full' });
    }

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
    broadcastToTD(entry);

    res.json({ ok: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'processing failed' });
  }
});

// Clears every entry (memory, Supabase or local uploads) so the galaxy
// starts empty, e.g. right before the live session to drop test uploads.
app.post('/api/reset', async (req, res) => {
  const token = req.get('x-admin-token') || '';
  if (!ADMIN_TOKEN || !safeEqual(token, ADMIN_TOKEN)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    if (persistence.isConfigured) {
      await persistence.deleteAllEntries();
    } else {
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        if (f.endsWith('.png')) fs.unlinkSync(path.join(UPLOAD_DIR, f));
      }
    }
    const removed = entries.length;
    entries.length = 0;

    io.emit('reset');
    io.emit('count', { count: 0, maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED });
    broadcastResetToTD();

    res.json({ ok: true, removed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'reset failed' });
  }
});

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function clamp(value, min, max, fallback) {
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

io.on('connection', (socket) => {
  socket.emit('count', { count: entries.length, maxParticipantsExpected: MAX_PARTICIPANTS_EXPECTED });
});

async function start() {
  if (persistence.isConfigured) {
    try {
      const existing = await persistence.fetchAllEntries();
      entries.push(...existing);
      console.log(`Rehydrated ${existing.length} entries from Supabase.`);
    } catch (err) {
      persistence.disable(err);
    }
  }

  server.listen(PORT, () => {
    console.log(`Cultural Text Galaxy server running:`);
    console.log(`  Display (venue screen): http://localhost:${PORT}/display.html`);
    console.log(`  Mobile client (share via QR): http://<your-lan-ip>:${PORT}/mobile.html`);
    console.log(`  TouchDesigner WebSocket: ws://localhost:${PORT}${TD_WS_PATH}`);
    console.log(`  Persistence: ${persistence.isConfigured ? 'Supabase' : 'in-memory only (local dev)'}`);
  });
}

start();
