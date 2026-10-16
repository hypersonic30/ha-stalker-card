from _server import *

C, O = "stalker-card >> ", ".stalker-card-overlay >> "
def close_sheet(pg):
    if pg.evaluate("() => document.querySelector('.stalker-card-overlay').shadowRoot.getElementById('sc-detail').open"):
        pg.locator(O + "[data-action=close_detail]").click()
        pg.wait_for_timeout(200)


PLAY_OK = "() => { const v = document.querySelector('.stalker-card-overlay').shadowRoot.querySelector('video'); return v && v.currentTime > %s }"

serve()
with sync_playwright() as p:
    b, pg, errors = browser_page(p)
    open_card(pg)
    tabs = pg.locator(C + ".sc-tab").all_inner_texts()
    check("tabs Live-TV/Programm/Filme/Serien", tabs == ["Live-TV", "Programm", "Filme", "Serien"], tabs)
    pg.wait_for_selector(C + ".sc-ch")
    check("glass card (blur) like the other cards", "blur" in pg.evaluate("() => getComputedStyle(card.shadowRoot.querySelector('ha-card')).backdropFilter"))
    rows = pg.locator(C + ".sc-ch").count()
    check("live list limited to 80 + Mehr", rows == 80 and pg.locator(C + "[data-action=more]").count() == 1, rows)
    pg.locator(C + "[data-action=more]").click()
    check("Mehr shows next 80", pg.locator(C + ".sc-ch").count() == 160)
    check("channel name is escaped", pg.locator(C + ".sc-ch b").count() == 0)
    check("now playing + progress shown for channels with a guide", "Tagesschau" in pg.inner_text(C + ".sc-ch[data-id='3']") and pg.locator(C + ".sc-ch[data-id='3'] .sc-meter").count() == 1)
    check("no now playing without a guide", pg.locator(C + ".sc-ch[data-id='4'] .sc-meter").count() == 0)
    pg.fill(C + "input[data-q]", "kanal 07")
    check("search filters (Kanal 070-079)", pg.locator(C + ".sc-ch").count() == 10, pg.locator(C + ".sc-ch").count())
    pg.fill(C + "input[data-q]", "")
    pg.locator(C + ".sc-chip", has_text="Sport").click()
    check("genre chip halves the list", pg.locator(C + ".sc-ch").count() == 80 and pg.locator(C + "[data-action=more]").count() == 1)
    pg.locator(C + ".sc-chip", has_text="Alle").click()

    # play live in the fullscreen player
    pg.locator(C + ".sc-ch", has_text="Kanal 003").click()
    pg.wait_for_function(PLAY_OK % "1.5", timeout=30000)
    check("video really plays (real Chrome)", True)
    check("player is a modal dialog in the body overlay", pg.evaluate("() => document.querySelector('.stalker-card-overlay').parentElement === document.body"))
    check("play request is by id only", ("POST", "play", {"kind": "live", "id": "3", "start": 0}) in calls(), calls()[-3:])
    pg.wait_for_function("() => document.querySelector('.stalker-card-overlay').shadowRoot.getElementById('sc-epg').textContent.includes('Tagesschau')", timeout=5000)
    check("EPG now/next shown", "danach" in pg.inner_text(O + "#sc-epg"))
    check("live has native controls, no seek bar", pg.locator(O + "input[data-seek]").count() == 0)
    pg.locator(O + "[data-action=chan][data-dir='1']").click()
    pg.wait_for_function(PLAY_OK % "1", timeout=30000)
    check("next channel button switches to the next channel", ("POST", "play", {"kind": "live", "id": "4", "start": 0}) in calls(), [c for c in calls() if c[1] == "play"])
    pg.locator(O + "[data-action=close_player]").click()
    pg.wait_for_timeout(300)
    check("close hides player and sends stop", not pg.evaluate("() => document.querySelector('.stalker-card-overlay').shadowRoot.getElementById('sc-player').open") and any(c[:2] == ("POST", "stop") for c in calls()), calls()[-2:])

    # Filme
    STATE["resume"] = [{"kind": "vod", "id": "m5", "title": "Film 005", "logo": "", "pos": 100, "dur": 300, "label": ""}]
    STATE["progress"]["vod:m5"] = {"pos": 100, "dur": 300, "done": False, "t": 1}
    pg.locator(C + ".sc-tab", has_text="Filme").click()
    pg.wait_for_selector(C + ".sc-grid .sc-tile")
    check("vod first page 60 + Mehr", pg.locator(C + ".sc-grid .sc-tile").count() == 60)
    pg.wait_for_selector(C + ".sc-row .sc-tile")
    check("continue-watching row", pg.locator(C + ".sc-row .sc-tile").count() == 1 and "ab 1:40" in pg.inner_text(C + ".sc-row .sc-tile"))
    check("vod title escaped (no XSS)", pg.evaluate("() => window.__xss") is None and pg.locator(C + ".sc-tile img[src='x']").count() == 0)
    pg.locator(C + "[data-action=morevod]").click()
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-grid .sc-tile').length === 120")
    pg.fill(C + "input[data-q]", "film 130")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-grid .sc-tile').length === 1")
    check("vod search goes to the server", any(c[1].startswith("vod?") and "q=film+130" in c[1] for c in calls()), calls()[-3:])
    pg.fill(C + "input[data-q]", "")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-grid .sc-tile').length === 60")
    pg.locator(C + ".sc-chip", has_text="Drama").click()
    pg.wait_for_function("() => card.shadowRoot.querySelector('[data-action=morevod]')?.textContent.includes('(5)')")
    check("vod group chip goes to the server", any("group=Drama" in c[1] for c in calls() if c[1].startswith("vod?")))
    pg.locator(C + ".sc-chip", has_text="Alle").click()
    pg.fill(C + "input[data-q]", "film 130")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-grid .sc-tile').length === 1")

    # movie sheet -> player with seek bar
    pg.locator(C + ".sc-grid .sc-tile").click()
    pg.wait_for_selector(O + ".sc-sheet")
    check("movie opens a glass sheet with Abspielen", "Abspielen" in pg.inner_text(O + ".sc-sheet") and "Von vorn" not in pg.inner_text(O + ".sc-sheet"))
    pg.locator(O + "[data-action=play_vod]").click()
    pg.wait_for_selector(O + "input[data-seek]")
    check("vod shows seek bar with duration", "5:00" in pg.inner_text(O + ".sc-pbar"))
    pg.wait_for_function(PLAY_OK % "1.6", timeout=30000)
    pg.evaluate("() => { const s = document.querySelector('.stalker-card-overlay').shadowRoot.querySelector('input[data-seek]'); s.value = 120; s.dispatchEvent(new Event('input', {bubbles:true})); s.dispatchEvent(new Event('change', {bubbles:true})); }")
    pg.wait_for_timeout(1200)
    check("seek restarts the stream at that second", ("POST", "play", {"kind": "vod", "id": "m130", "start": 120}) in calls(), [c for c in calls() if c[1] == "play"])
    pg.wait_for_function(PLAY_OK % "2", timeout=30000)
    pg.wait_for_timeout(600)

    # watch progress is reported (when closing) with the real position
    pg.locator(O + "[data-action=close_player]").click()
    pg.wait_for_timeout(500)
    prog = [c for c in calls() if c[0] == "POST" and c[1] == "progress" and c[2].get("id") == "m130" and "pos" in c[2]]
    check("progress is saved on close at the real position", prog and prog[-1][2]["kind"] == "vod" and prog[-1][2]["dur"] == 300 and prog[-1][2]["pos"] >= 121, prog[-2:])

    # a sheet remembers: Fortsetzen / Von vorn / gesehen markieren
    check("the sheet stays open under the player", pg.evaluate("() => document.querySelector('.stalker-card-overlay').shadowRoot.getElementById('sc-detail').open"))
    close_sheet(pg)
    pg.locator(C + ".sc-grid .sc-tile").click()
    pg.wait_for_selector(O + ".sc-sheet")
    txt = pg.inner_text(O + ".sc-sheet")
    check("sheet offers resume and restart", "Fortsetzen ab" in txt and "Von vorn" in txt, txt[-120:])
    pg.locator(O + "[data-action=play_vod][data-start='0']").click()
    pg.wait_for_function(PLAY_OK % "1", timeout=30000)
    check("Von vorn starts at 0", [c for c in calls() if c[1] == "play"][-1][2]["start"] == 0)
    pg.locator(O + "[data-action=close_player]").click()
    pg.wait_for_timeout(500)
    pg.locator(O + "[data-action=mark]").click()
    pg.wait_for_timeout(500)
    check("mark as watched is sent", any(c[:2] == ("POST", "progress") and c[2].get("done") is True and c[2]["id"] == "m130" for c in calls()), calls()[-3:])
    check("sheet shows Gesehen after marking", "Gesehen" in pg.inner_text(O + ".sc-sheet"))
    pg.locator(O + "[data-action=close_detail]").click()
    pg.wait_for_timeout(200)
    check("watched film gets a check badge", pg.locator(C + ".sc-grid .sc-badge.done").count() == 1)

    # transcoding note + resume at saved position
    STATE["transcoding"] = True
    close_sheet(pg)
    pg.fill(C + "input[data-q]", "film 005")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-grid .sc-tile').length === 1 && card.shadowRoot.querySelector('.sc-grid .sc-tile').textContent.includes('Film 005')")
    pg.locator(C + ".sc-grid .sc-tile").click()
    pg.wait_for_selector(O + ".sc-sheet")
    pg.locator(O + "[data-action=play_vod][data-start='95']").click()
    pg.wait_for_selector(O + ".sc-pbar")
    check("resume starts 5 s before the saved position", [c for c in calls() if c[1] == "play"][-1][2]["start"] == 95)
    check("re-encoded streams are labelled", "umkodiert" in pg.inner_text(O + ".sc-ptitle"))
    STATE["transcoding"] = False

    # server dropped the stream -> card restarts where the player was
    pg.wait_for_function(PLAY_OK % "2", timeout=30000)
    n = len([c for c in calls() if c[1] == "play"])
    FATAL = "() => { if (card._hls) card._hls.trigger(window.Hls.Events.ERROR, {type: 'networkError', details: 'x', fatal: true}); else document.querySelector('.stalker-card-overlay').shadowRoot.querySelector('video')?.dispatchEvent(new Event('error')); }"
    print("engine:", pg.evaluate("() => card._hls ? 'hls.js' : 'native HLS'"))
    pg.evaluate(FATAL)
    pg.wait_for_timeout(1000)
    plays = [c for c in calls() if c[1] == "play"]
    check("fatal stream error restarts at the current position", len(plays) == n + 1 and plays[-1][2]["start"] >= 95 + 2, plays[-2:])
    for _ in range(3):
        pg.evaluate(FATAL)
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(1200)
    check("repeated failures give up with a message instead of looping", "unterbrochen" in pg.inner_text(O + ".sc-spin"), len([c for c in calls() if c[1] == "play"]))
    pg.locator(O + ".sc-spin [data-action=close_player]").click()
    pg.wait_for_timeout(300)

    # HEVC capability is reported to the server (a player that can decode it gets the stream copied)
    check("no hevc flag when the browser cannot decode HEVC", "hevc" not in [c for c in calls() if c[1] == "play"][-1][2])
    pg.evaluate("() => { MediaSource.isTypeSupported = () => true; }")
    close_sheet(pg)
    pg.locator(C + ".sc-grid .sc-tile").click()
    pg.wait_for_selector(O + ".sc-sheet")
    pg.locator(O + "[data-action=play_vod]").first.click()
    pg.wait_for_timeout(600)
    check("hevc flag is sent when the browser can decode HEVC", [c for c in calls() if c[1] == "play"][-1][2].get("hevc") is True)
    pg.evaluate("() => { MediaSource.isTypeSupported = () => false; }")
    pg.locator(O + "[data-action=close_player]").click()
    pg.wait_for_timeout(300)

    # errors are shown inside the player, in German
    close_sheet(pg)
    pg.locator(C + ".sc-grid .sc-tile").click()
    pg.wait_for_selector(O + ".sc-sheet")
    STATE["play_error"] = "video_codec_unsupported"
    pg.locator(O + "[data-action=play_vod]").first.click()
    pg.wait_for_selector(O + ".sc-spin >> text=Videostream")
    check("German error text with a close button", pg.locator(O + ".sc-spin [data-action=close_player]").count() == 1)
    check("no page errors", not errors, errors)
    b.close()
finish()
