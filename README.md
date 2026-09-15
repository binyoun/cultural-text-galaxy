# Communal Volumetric Cultural Text Galaxy

**Live site: https://cultural-text-galaxy.onrender.com** (this is the link
to share, not the github.com repo page, which only shows code)

Participatory installation: ~20 participants photograph handwritten words in
their own script, tint and glow them, and watch them spiral into a shared 3D
vortex. Runs two ways:

- **Locally**, phones on the same wifi as a laptop, no internet dependency.
  Good for an in-person table or a quick test.
- **Deployed online** (Render + Supabase, see below), each participant opens
  the pages themselves over the internet. This is the setup for an online
  workshop.

Migrated from a TouchDesigner concept (Metaball/Force SOP + Geometry
Instancing) to a web stack.

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

## Deploying for an online workshop

Each participant opens `display.html` and `mobile.html` themselves over the
internet, so this needs a real public URL, not a LAN IP. Two pieces: Render
runs the server, Supabase makes entries and images survive a restart or
redeploy (Render's own disk is wiped on every deploy, so without this,
finishing a deploy mid-workshop would erase everyone's submissions).

### 1. Supabase (persistence)

In the [Supabase dashboard](https://supabase.com), create a project (or
reuse one), then in the SQL Editor run:

```sql
create table if not exists entries (
  id uuid primary key,
  url text not null,
  color text not null,
  transparency numeric not null,
  intensity numeric not null,
  region text default '',
  place text default '',
  created_at timestamptz not null default now()
);
```

Then Storage &rarr; New bucket &rarr; name it `handwriting-uploads` &rarr;
toggle **Public bucket** on (the display page loads images directly from
this bucket, so it needs to be publicly readable).

From Project Settings &rarr; API, copy the **Project URL** and the
**service_role key** (not the anon key, the server needs full write access).

### 2. Render (hosting)

1. [render.com](https://render.com) &rarr; sign in with GitHub &rarr; New +
   &rarr; Blueprint &rarr; pick the `cultural-text-galaxy` repo. Render reads
   `render.yaml` and configures the service automatically.
2. Before the first deploy (or after, then redeploy), add two environment
   variables under the service's Environment tab:
   - `SUPABASE_URL` = the Project URL from step 1
   - `SUPABASE_SERVICE_KEY` = the service_role key from step 1
3. Deploy. Render gives you a public `https://<something>.onrender.com` URL.
   Share `<that-url>/mobile.html` and `<that-url>/display.html` directly.

Without those two environment variables set, the app still runs fine, it
just falls back to in-memory entries and local disk, the original local-dev
behavior, so nothing breaks if you deploy before Supabase is ready, it just
won't persist yet.

Free tier notes: the server sleeps after ~15 minutes of no traffic and takes
about 30s to wake on the next request. For a live workshop, either keep a
tab open against the URL beforehand to keep it warm, or upgrade to Render's
paid "always on" tier for that session.

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
- Entries persist across restarts when `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`
  are set (see "Deploying for an online workshop"). Without them, entries
  are in-memory only and a restart clears the galaxy, fine for local dev,
  not for the actual event.
- No moderation/approval step between upload and display, add one if the
  audience is unvetted.
