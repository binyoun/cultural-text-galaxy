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

## Things to remember on the day

- Yi Kee's fetch script (or WebSocket) must be running before participants send photos (about 12:55 GST).
- The reset empties the server but not Yi Kee's `client_uploads` folder. After the morning reset, she empties that folder too, or test words appear in the reveal.
- If her connection drops, nothing is lost: the stars stay on the server and are fetched again on reconnect.
- Never run the reset after 11:45 GST.

## Useful addresses

| What | Address |
|---|---|
| Participant hub (all links) | https://binyoun.github.io/counting-cultural-star |
| Send your star | https://cultural-text-galaxy.onrender.com/up |
| Shared galaxy (browser) | https://cultural-text-galaxy.onrender.com/galaxy |
| Server status | https://cultural-text-galaxy.onrender.com/api/health |
| List of stars (JSON) | https://cultural-text-galaxy.onrender.com/api/entries |
| TouchDesigner live link | wss://cultural-text-galaxy.onrender.com/td |

Reset (Bin's Mac, Terminal):

```
curl -X POST -H "x-admin-token: $(cat ~/.config/cultural-text-galaxy/admin_token)" https://cultural-text-galaxy.onrender.com/api/reset
```

## Known limits

- HEIC files uploaded from a computer fail on the server (the image library cannot decode them). Photos sent from a phone through /up arrive as JPEG and work.
- Uploads over 8 MB are refused.
- The free Render plan sleeps when idle; the first visit can take about a minute.
