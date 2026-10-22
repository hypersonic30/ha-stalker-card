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
                 transcoding=False, progress={}, resume=[], long_season=False,
                 portals=[{"id": "p1", "title": "Zuhause", "source": "stalker"}], channels_by={}, info_by={}, favs={},
                 seen=[], delay={}, fav_error=None, progress_by={}, tracks=None, multi=False)


def calls():
    return list(STATE["calls"])


def make_multi_hls():
    d = os.path.join(HLS_DIR, "m")
    if os.path.exists(os.path.join(d, "index.m3u8")):
        return
    os.makedirs(d, exist_ok=True)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25",
                    "-f", "lavfi", "-i", "sine=frequency=440", "-f", "lavfi", "-i", "sine=frequency=880", "-t", "20",
                    "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "libx264", "-preset", "ultrafast", "-g", "25", "-c:a", "aac",
                    "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", "-hls_playlist_type", "vod", "-master_pl_name", "index.m3u8",
                    "-var_stream_map", "v:0,agroup:aud,name:v a:0,agroup:aud,name:a0,language:ger,default:yes a:1,agroup:aud,name:a1,language:eng",
                    "-hls_segment_filename", os.path.join(d, "seg_%v_%d.ts"), os.path.join(d, "%v.m3u8")], check=True)


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
            f = os.path.join(HLS_DIR, "m" if STATE.get("multi") else "", os.path.basename(p))
            ct = "application/vnd.apple.mpegurl" if f.endswith(".m3u8") else "video/mp2t"
            return self._send(200, open(f, "rb").read(), ct) if os.path.isfile(f) else self._send(404, {})
        if not p.startswith("/api/stalker/"):
            return self._send(404, {})
        r = p[len("/api/stalker/"):]
        raw = q.pop("portal", [""])[0]
        portal = raw or (STATE["portals"][0]["id"] if STATE["portals"] else "")
        rest = urllib.parse.urlencode({k: v[0] for k, v in q.items()})
        STATE["calls"].append(("GET", r + (("?" + rest) if rest else ""), None))
        STATE["seen"].append((r, raw))
        if r == "portals":
            return self._send(200, {"items": STATE["portals"]})
        if r == "info":
            return self._send(200, STATE["info_by"].get(portal, STATE["info"]))
        if r == "favorites":
            return self._send(200, {"ids": STATE["favs"].get(portal, [])})
        if r == "live":
            time.sleep(STATE["delay"].get(portal, 0))
            return self._send(200, {"genres": [{"id": "*", "title": "Alle"}, {"id": "1", "title": "News"}, {"id": "2", "title": "Sport"}], "channels": STATE["channels_by"].get(portal, CHANNELS)})
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
            return self._send(200, {"items": STATE["progress_by"].get(portal, STATE["progress"]), "resume": STATE["resume"] if portal in ("", "p1") else []})
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
        portal = body.pop("portal", None)
        STATE["calls"].append(("POST", r, body))
        STATE["seen"].append((r, portal))
        if r == "favorites":
            if STATE["fav_error"]:
                return self._send(409, {"code": STATE["fav_error"]})
            ids = STATE["favs"].setdefault(portal or STATE["portals"][0]["id"], [])
            if "order" in body:
                ids[:] = body["order"]
            elif body["fav"] and body["id"] not in ids:
                ids.append(body["id"])
            elif not body["fav"] and body["id"] in ids:
                ids.remove(body["id"])
            return self._send(200, {"ids": list(ids)})
        if r == "play":
            if STATE["play_error"]:
                return self._send(502, {"code": STATE["play_error"]})
            STATE["session"] += 1
            live = body["kind"] == "live"
            return self._send(200, {"session": f"sess{STATE['session']}", "live": live, "duration": None if live else 300.0,
                                    "start": body.get("start", 0), "transcoding": STATE["transcoding"], "url": "/api/stalker/hls/index.m3u8",
                                    **({"audio": STATE["tracks"]["audio"], "subs": STATE["tracks"]["subs"],
                                        "audio_index": body.get("audio", STATE["tracks"]["audio"][0]["index"]), "multi_audio": bool(STATE.get("multi"))} if STATE["tracks"] else {})})
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
    make_multi_hls()
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
