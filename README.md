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

- Landing page (concept, ISEA 2026 context): `http://localhost:3000/`
- Display (venue screen): `http://localhost:3000/display.html`
- Mobile client: `http://<your-laptop-lan-ip>:3000/mobile.html`, generate a
  QR code pointing at this URL for participants to scan.

Both laptop and phones must be on the same local network. Find your LAN IP
with `ipconfig getifaddr en0` (or `en1` on Wi-Fi) on macOS.

## Sharing a demo link with teammates

For the actual workshop, keep running it locally, phones on venue wifi
talking to the laptop directly, no internet dependency. But to let a
teammate see the working pages without being on the same network, deploy a
demo copy:

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. New + &rarr; Blueprint, pick the `cultural-text-galaxy` repo. Render reads
   `render.yaml` in this repo and configures the service automatically.
3. Deploy. Render gives you a public `https://<something>.onrender.com` URL,
   share that.

Free tier notes: the server sleeps after inactivity (first load after a
while takes ~30s to wake up), and the filesystem resets on every redeploy or
restart, so uploaded entries there are temporary, same limitation as the
in-memory entries list has locally. Fine for a demo link, not for the event
itself.

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

- The threshold is computed per photo with Otsu's method, so it adapts to
  uneven lighting, but still worth a dry run under actual venue lighting
  before the show.
- Entries live in memory only; restarting the server clears the galaxy. Swap
  in a JSON file or SQLite write-through if persistence across a restart
  matters.
- No moderation/approval step between upload and display, add one if the
  audience is unvetted.
