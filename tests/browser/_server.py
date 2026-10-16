"""Static server for the card + a fake stalker integration under /api/stalker/ (127.0.0.1:8323).

`from _server import *` in each test script. `calls()` lists every API request the card made.
Real HLS (h264+aac, made with ffmpeg) is served so Chrome really plays it.
"""
import http.server, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.parse
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
CARD = os.path.abspath(os.path.join(HERE, "..", "..", "stalker-card.js"))
PORT = 8323
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
HLS_DIR = tempfile.mkdtemp(prefix="stalker-hls-")

CHANNELS = [{"id": str(i), "name": f"Kanal {i:03d}", "number": str(i), "genre_id": "1" if i % 2 else "2",
             "logo": "", "has_epg": i % 3 == 0} for i in range(1, 201)]
CHANNELS[0]["name"] = "Das Erste <b>HD</b>"
STATE = {}


def reset():
    STATE.clear()
    STATE.update(calls=[], info={"vod": True, "series": True, "max_streams": 1}, play_error=None, session=0,
                 transcoding=False, progress={}, resume=[], long_season=False)


def calls():
    return list(STATE["calls"])


def make_hls():
    if os.path.exists(os.path.join(HLS_DIR, "index.m3u8")):
        return
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25",
                    "-f", "lavfi", "-i", "sine=frequency=440", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast",
                    "-g", "25", "-c:a", "aac", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
                    "-hls_playlist_type", "vod", "-hls_segment_filename", os.path.join(HLS_DIR, "seg%d.ts"),
                    os.path.join(HLS_DIR, "index.m3u8")], check=True)


VODS = [{"id": f"m{i}", "title": f"Film {i:03d}", "logo": "", "group": "Action" if i % 2 else "Drama"} for i in range(1, 131)]
VODS[0]["title"] = "<img src=x onerror=window.__xss=1>"


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        p = u.path
        if p == "/":
            return self._send(200, open(os.path.join(HERE, "page.html"), "rb").read(), "text/html")
        if p == "/stalker-card.js":
            return self._send(200, open(CARD, "rb").read(), "application/javascript")
        if p.startswith("/api/stalker/hls/"):
            f = os.path.join(HLS_DIR, os.path.basename(p))
            ct = "application/vnd.apple.mpegurl" if f.endswith(".m3u8") else "video/mp2t"
            return self._send(200, open(f, "rb").read(), ct) if os.path.isfile(f) else self._send(404, {})
        if not p.startswith("/api/stalker/"):
            return self._send(404, {})
        STATE["calls"].append(("GET", p[len("/api/stalker/"):] + (("?" + u.query) if u.query else ""), None))
        r = p[len("/api/stalker/"):]
        if r == "info":
            return self._send(200, STATE["info"])
        if r == "live":
            return self._send(200, {"genres": [{"id": "*", "title": "Alle"}, {"id": "1", "title": "News"}, {"id": "2", "title": "Sport"}], "channels": CHANNELS})
        if r == "nowplaying":
            now = int(time.time())
            return self._send(200, {"items": {c["id"]: {"t": "Tagesschau", "s": now - 600, "e": now + 600, "n": "Wetter", "ns": now + 600}
                                              for c in CHANNELS if c["has_epg"]}})
        if r == "guide":
            t0 = int(float(q["from"][0])); t1 = int(float(q["to"][0]))
            items = {}
            for cid in q["ids"][0].split(","):
                base = t0 // 3600 * 3600
                items[cid] = [{"t": f"Sendung {k} K{cid} <u>x</u>", "d": f"Beschreibung <b>{k}</b>", "s": base + k * 3600, "e": base + (k + 1) * 3600}
                              for k in range(0, (t1 - base) // 3600 + 1) if base + (k + 1) * 3600 > t0]
            return self._send(200, {"items": items})
        if r == "progress":
            return self._send(200, {"items": STATE["progress"], "resume": STATE["resume"]})
        if r.startswith("epg/"):
            return self._send(200, {"items": [{"title": "Tagesschau", "descr": "", "start": 0, "stop": 9999999999},
                                              {"title": "Wetter", "descr": "", "start": 9999999999, "stop": 9999999999 + 600}]})
        if r == "vod":
            items = [v for v in VODS if (not q.get("group") or v["group"] == q["group"][0]) and (not q.get("q") or q["q"][0].lower() in v["title"].lower())]
            page, size = int(q.get("page", ["1"])[0]), int(q.get("size", ["60"])[0])
            return self._send(200, {"groups": ["Action", "Drama"], "total": len(items), "page": page, "items": items[(page - 1) * size: page * size]})
        if r == "series":
            return self._send(200, {"items": [{"id": "s1", "title": "Bleach", "logo": "", "group": "ANIME", "episodes": 63}]})
        if r == "series/s1":
            return self._send(200, {"id": "s1", "title": "Bleach", "logo": "", "seasons": [
                {"season": 1, "episodes": [{"id": f"e{n}", "episode": n, "title": f"Bleach S01E{n:02d}"} for n in range(1, 61)]},
                {"season": 2, "episodes": [{"id": f"f{n}", "episode": n, "title": f"Bleach S02E{n:02d}"} for n in (1, 2, 3)]}]})
        return self._send(404, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        r = urllib.parse.urlparse(self.path).path[len("/api/stalker/"):]
        STATE["calls"].append(("POST", r, body))
        if r == "play":
            if STATE["play_error"]:
                return self._send(502, {"code": STATE["play_error"]})
            STATE["session"] += 1
            live = body["kind"] == "live"
            return self._send(200, {"session": f"sess{STATE['session']}", "live": live, "duration": None if live else 300.0,
                                    "start": body.get("start", 0), "transcoding": STATE["transcoding"], "url": "/api/stalker/hls/index.m3u8"})
        if r == "progress":
            key = f"{body['kind']}:{body['id']}"
            if "done" in body:
                if body["done"]:
                    old = STATE["progress"].get(key, {"dur": 100})
                    STATE["progress"][key] = {"pos": old["dur"], "dur": old["dur"], "done": True, "t": time.time()}
                else:
                    STATE["progress"].pop(key, None)
            else:
                STATE["progress"][key] = {"pos": int(body["pos"]), "dur": int(body["dur"]), "done": body["pos"] >= body["dur"] * 0.92, "t": time.time()}
            return self._send(200, {"ok": True})
        if r == "stop":
            return self._send(200, {"ok": True})
        return self._send(404, {})


def serve():
    make_hls()
    reset()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def browser_page(p, width=900):
    b = p.chromium.launch(channel="chrome", headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": width, "height": 900})
    if os.environ.get("STALKER_FORCE_HLSJS"):  # what Android WebView / Firefox report: no native HLS
        pg.add_init_script("HTMLMediaElement.prototype.canPlayType = function (t) { return /mpegurl|hvc1|hev1/i.test(t) ? '' : 'maybe'; }")
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    return b, pg, errors


def open_card(pg, **cfg):
    pg.goto(f"http://127.0.0.1:{PORT}/")
    pg.evaluate("""(cfg) => { const c = document.createElement('stalker-card'); c.setConfig(cfg); document.body.appendChild(c); c.hass = window.hassStub; window.card = c; }""", cfg)
    pg.wait_for_selector("stalker-card >> .sc-tab")
    return pg


FAILS = []


def check(name, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  [{extra}]" if (extra and not cond) else ""))
    if not cond:
        FAILS.append(name)


def finish():
    if FAILS:
        print(f"\n{len(FAILS)} FAILED: {FAILS}")
        sys.exit(1)
