# galaxy_fetch  (Text DAT in /project1)
#
# Pulls every participant's handwriting image from the workshop server
# into this project's client_uploads folder, so folder1 picks them up.
# Downloads run in a background thread so TouchDesigner never freezes.
#
# Also keeps the folder in step with the server: a star removed on the
# server (Bin's admin page, or the reset) is deleted from client_uploads
# on the next fetch. Only files named like server stars (a UUID + .png)
# are ever deleted, so your own sample images in the folder are safe.
#
# Setup:
#   1. Paste this into a Text DAT named galaxy_fetch in /project1
#   2. Turn ON the Refresh parameter on folder1
#   3. Add an Execute DAT (code below) to call fetch() every few seconds
#
# Manual test from the Textport:
#   op('/project1/galaxy_fetch').module.fetch()

import json, os, re, ssl, threading, urllib.request

SERVER = 'https://cultural-text-galaxy.onrender.com'
TIMEOUT = 20

_busy = False
_STAR_FILE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$')


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'TouchDesigner'})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=_ssl_context()) as r:
        return r.read()


def _worker(folder, tmpdir):
    global _busy
    new = 0
    try:
        os.makedirs(folder, exist_ok=True)
        os.makedirs(tmpdir, exist_ok=True)
        data = json.loads(_get(SERVER + '/api/entries').decode('utf-8'))
        for entry in data.get('entries', []):
            url = entry.get('url', '')
            if url.startswith('/'):
                url = SERVER + url
            dest = os.path.join(folder, entry['id'] + '.png')
            if os.path.exists(dest):
                continue
            tmp = os.path.join(tmpdir, entry['id'] + '.part')
            with open(tmp, 'wb') as f:
                f.write(_get(url))
            os.replace(tmp, dest)
            new += 1
        on_server = {e['id'] + '.png' for e in data.get('entries', [])}
        removed = 0
        for name in os.listdir(folder):
            if _STAR_FILE.match(name) and name not in on_server:
                os.remove(os.path.join(folder, name))
                removed += 1
        print('[galaxy_fetch] {} on server, {} new, {} removed'.format(len(data.get('entries', [])), new, removed))
    except Exception as e:
        print('[galaxy_fetch] failed:', e)
    finally:
        _busy = False


def fetch():
    global _busy
    if _busy:
        return
    _busy = True
    folder = os.path.join(project.folder, 'client_uploads')
    tmpdir = os.path.join(project.folder, 'galaxy_tmp')
    threading.Thread(target=_worker, args=(folder, tmpdir), daemon=True).start()


# ---------------------------------------------------------------
# Execute DAT (separate DAT in /project1, turn on "Frame Start"):
#
# INTERVAL_SECONDS = 5
#
# def onFrameStart(frame):
#     if frame % int(project.cookRate * INTERVAL_SECONDS) == 0:
#         op('/project1/galaxy_fetch').module.fetch()
#     return
# ---------------------------------------------------------------
