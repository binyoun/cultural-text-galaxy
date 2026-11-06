# How the website and TouchDesigner connect

Reference for the ISEA 2026 workshop *Counting Cultural Stars* (Bin Youn and Ng Yi Kee). Written 5 November 2026, after the ISEA tech check.

## The short version

There are two separate TouchDesigner things, and only one of them is connected to the website.

```
 PARTICIPANT'S PHONE
        |  photo of their handwriting
        v
  /up  (Send your star page)
        |
        v
  THE SERVER  (cultural-text-galaxy.onrender.com)
   1. removes the paper, keeps only the ink
   2. tints the ink in the colour they picked
   3. saves it as a PNG image (Supabase storage)
   4. adds it to the list of stars
        |
        +-------------------------+
        |                         |
        v                         v
  /galaxy web page        YI KEE'S TOUCHDESIGNER
  (3D sky in the          (the shared galaxy for
   browser, anyone         the reveal)
   can watch)              gets each new PNG and
                           puts it into a star

  PARTICIPANT'S OWN TOUCHDESIGNER (starter file)
   NOT connected to the website. They load their own photo
   from their computer and build their own constellation.
```

## How Yi Kee's TouchDesigner gets the stars

Either of these works.

1. **Folder (what Yi Kee uses).** `ELYAH_galaxy_fetch.py` asks the server for the list of stars (`/api/entries`) every few seconds. When a new star appears, it downloads the PNG into the `client_uploads` folder, and the TouchDesigner file loads every image in that folder as a star.
2. **Live link (WebSocket).** A WebSocket DAT connects to `wss://cultural-text-galaxy.onrender.com/td`. The server sends `init` (every star so far) on connect, `newEntry` for each new star, and `reset` when the stars are cleared. It pings every 25 seconds to keep the connection open.

## Removing one star

Bin's private page `https://cultural-text-galaxy.onrender.com/admin` (admin token required) lists every star, newest first, with its image, time, region and place. Tap **Remove**, then **Tap again to remove**. The star disappears from /galaxy straight away, the TouchDesigner live link receives `{"type":"removeEntry","id":...}`, and the fetch script deletes that image from `client_uploads` on its next run.

Get the latest fetch script from [`tools/ELYAH_galaxy_fetch.py`](../tools/ELYAH_galaxy_fetch.py). It only ever deletes files named like server stars (a UUID + `.png`), so sample images in the folder are safe. Because it mirrors the server, it also empties the folder after the morning reset.

## Things to remember on the day

- Yi Kee's fetch script (or WebSocket) must be running before participants send photos (about 12:55 GST).
- With the updated fetch script (tools/ELYAH_galaxy_fetch.py), the morning reset also clears Yi Kee's `client_uploads` folder on the next fetch. With the old script, she empties the folder by hand.
- If her connection drops, nothing is lost: the stars stay on the server and are fetched again on reconnect.
- Never run the reset after 11:45 GST.

## Useful addresses

| What | Address |
|---|---|
| Participant hub (all links) | https://binyoun.github.io/counting-cultural-star |
| Send your star | https://cultural-text-galaxy.onrender.com/up |
| Lift your ink (removes paper, saves PNG; runs on the device, sends nothing) | https://cultural-text-galaxy.onrender.com/ink |
| Shared galaxy (browser) | https://cultural-text-galaxy.onrender.com/galaxy |
| Server status | https://cultural-text-galaxy.onrender.com/api/health |
| Remove one star (Bin, admin token) | https://cultural-text-galaxy.onrender.com/admin |
| List of stars (JSON) | https://cultural-text-galaxy.onrender.com/api/entries |
| TouchDesigner live link | wss://cultural-text-galaxy.onrender.com/td |

Reset (Bin's Mac, Terminal):

```
curl -X POST -H "x-admin-token: $(cat ~/.config/cultural-text-galaxy/admin_token)" https://cultural-text-galaxy.onrender.com/api/reset
```

## Known limits

- iPhone HEIC files work from a phone or a computer: the server converts them to JPEG first (since 5 Nov, commit 7ab56f2).
- Uploads over 15 MB are refused with a clear message asking for a screenshot instead. Unreadable files get "Please send a JPG or PNG photo".
- The free Render plan sleeps when idle; the first visit can take about a minute.
