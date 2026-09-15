# Communal Volumetric Cultural Text Galaxy

Participatory installation: ~20 participants photograph handwritten words in
their own script, tint and glow them, and watch them spiral into a shared 3D
vortex on the venue screen.

Migrated from a TouchDesigner concept (Metaball/Force SOP + Geometry
Instancing) to a web stack that runs on a laptop with no venue network
dependency beyond local wifi.

## Architecture mapping

| TouchDesigner | Web equivalent |
| --- | --- |
| Web Server DAT | `server/index.js` (Express + Socket.IO) |
| Table DAT | in-memory `entries` array, one row per submission |
| Threshold / Crop TOP | `server/imageProcessor.js` (sharp luminance threshold → tinted alpha PNG) |
| Metaball / Force / Noise SOP | `public/js/vortex.js` (per-particle orbital state, stepped in the render loop) |
| Render & Bloom TOP | `public/js/display.js` (Three.js `EffectComposer` + `UnrealBloomPass`) |

## Setup

```bash
npm install
npm start
```

- Display (venue screen): `http://localhost:3000/display.html`
- Mobile client: `http://<your-laptop-lan-ip>:3000/mobile.html` — generate a
  QR code pointing at this URL for participants to scan.

Both laptop and phones must be on the same local network. Find your LAN IP
with `ipconfig getifaddr en0` (or `en1` on Wi-Fi) on macOS.

## How it works

1. Participant photographs handwriting on the mobile page and picks color,
   transparency, and glow intensity.
2. The photo is uploaded to `/api/submit`. The server thresholds out the
   paper background, tints the ink strokes with the chosen color, and saves
   a transparent PNG.
3. The new entry is broadcast over Socket.IO to every connected display.
4. The display spawns the texture as a sprite at the edge of the vortex; it
   spirals inward, orbits, and drifts in depth, contributing to a background
   nebula haze that thickens as more participants join.

## Known trade-offs / next steps

- Threshold values (`WHITE_FLOOR` / `BLACK_CEIL` in `imageProcessor.js`) are
  tuned for plain white paper and dark ink — recalibrate on-site under venue
  lighting before the show.
- Entries live in memory only; restarting the server clears the galaxy. Swap
  in a JSON file or SQLite write-through if persistence across a restart
  matters.
- No moderation/approval step between upload and display — add one if the
  audience is unvetted.
