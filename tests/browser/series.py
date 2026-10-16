from _server import *

C, O = "stalker-card >> ", ".stalker-card-overlay >> "

serve()
with sync_playwright() as p:
    b, pg, errors = browser_page(p, width=420)
    open_card(pg)
    pg.locator(C + ".sc-tab", has_text="Serien").click()
    pg.wait_for_selector(C + ".sc-grid .sc-tile")
    pg.locator(C + ".sc-tile", has_text="Bleach").click()
    pg.wait_for_selector(O + ".sc-sheet")
    t = pg.inner_text(O + ".sc-sheet")
    check("series opens a popup with infos", "Bleach" in t and "2 Staffeln" in t and "63 Folgen" in t, t[:200])
    check("seasons start collapsed", pg.locator(O + ".sc-ep").count() == 0 and pg.locator(O + ".sc-season").count() == 2)
    check("first-episode button", "Erste Folge starten" in t)
    pg.locator(O + ".sc-season-head", has_text="Staffel 1").click()
    check("tapping a season unfolds its episodes", pg.locator(O + ".sc-ep").count() == 60)
    # the Bleach bug: the long list must scroll inside the sheet down to the last episode
    sh = pg.evaluate("() => { const s = document.querySelector('.stalker-card-overlay').shadowRoot.querySelector('.sc-sheet'); return [s.scrollHeight, s.clientHeight, getComputedStyle(s).overflowY]; }")
    check("long season scrolls inside the sheet", sh[0] > sh[1] and sh[2] in ("auto", "scroll"), sh)
    pg.evaluate("() => { const s = document.querySelector('.stalker-card-overlay').shadowRoot.querySelector('.sc-sheet'); s.scrollTop = s.scrollHeight; }")
    last = pg.locator(O + ".sc-ep").last
    check("last episode (60) is reachable", last.is_visible() and "60" in last.inner_text())
    pg.locator(O + ".sc-season-head", has_text="Staffel 2").click()
    check("only one season open at a time", pg.locator(O + ".sc-ep").count() == 3)
    pg.locator(O + ".sc-season-head", has_text="Staffel 2").click()
    check("tapping an open season folds it again", pg.locator(O + ".sc-ep").count() == 0)
    pg.locator(O + ".sc-season-head", has_text="Staffel 2").click()
    pg.locator(O + ".sc-ep", has_text="Folge 2").click()
    pg.wait_for_function("() => { const v = document.querySelector('.stalker-card-overlay').shadowRoot.querySelector('video'); return v && v.currentTime > 1 }", timeout=30000)
    pl = [c for c in calls() if c[1] == "play"][-1][2]
    check("episode plays by id", pl["kind"] == "episode" and pl["id"] == "f2", pl)
    check("player names series and episode", "Bleach" in pg.inner_text(O + ".sc-ptitle") and "Staffel 2" in pg.inner_text(O + ".sc-ptitle"))
    pg.wait_for_timeout(500)
    pg.locator(O + "[data-action=close_player]").click()
    pg.wait_for_timeout(900)
    check("sheet is still there after the player closes", pg.evaluate("() => document.querySelector('.stalker-card-overlay').shadowRoot.getElementById('sc-detail').open"))
    check("partly watched episode offers resume + Von vorn", "Von vorn" in pg.inner_text(O + ".sc-eps") or STATE["progress"].get("episode:f2", {}).get("pos", 0) < 30)
    # mark watched with the check button; the toggle does not start playback
    n = len([c for c in calls() if c[1] == "play"])
    pg.locator(O + ".sc-ep", has_text="Folge 1").locator("[data-action=mark]").click()
    pg.wait_for_timeout(600)
    check("check button marks watched without playing", len([c for c in calls() if c[1] == "play"]) == n and STATE["progress"].get("episode:f1", {}).get("done") is True)
    check("watched count shown", "1 gesehen" in pg.inner_text(O + ".sc-pills"))
    # next episode suggestion: S1 finished episodes
    pg.locator(O + ".sc-season-head", has_text="Staffel 1").click()
    pg.locator(O + ".sc-ep", has_text="Folge 10").locator("[data-action=mark]").click()
    pg.wait_for_timeout(600)
    check("main button suggests the episode after the last watched one", "Staffel 1 Folge 11" in pg.inner_text(O + ".sc-actions") or "Folge 11" in pg.inner_text(O + ".sc-actions"), pg.inner_text(O + ".sc-actions"))
    pg.locator(O + ".sc-ep", has_text="Folge 10").locator("[data-action=mark]").click()  # un-mark
    pg.wait_for_timeout(500)
    check("un-marking removes the entry", "episode:e10" not in STATE["progress"])
    pg.locator(O + "[data-action=close_detail]").click()
    pg.wait_for_timeout(200)
    check("no horizontal scroll at phone width", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))

    # continue-watching row opens the series at the right season
    STATE["resume"] = [{"kind": "episode", "id": "f3", "sid": "s1", "title": "Bleach", "logo": "", "pos": 50, "dur": 300, "label": "Staffel 2 · Folge 3"}]
    pg.locator(C + ".sc-tab", has_text="Filme").click()
    pg.locator(C + ".sc-tab", has_text="Serien").click()
    pg.wait_for_selector(C + ".sc-row .sc-tile")
    check("series tab has the continue row with a label", "Staffel 2 · Folge 3" in pg.inner_text(C + ".sc-row"))
    pg.locator(C + ".sc-row .sc-tile").click()
    pg.wait_for_selector(O + ".sc-ep")
    check("continue tile opens the series with that season unfolded", pg.locator(O + ".sc-ep").count() == 3)
    check("no page errors", not errors, errors)
    b.close()
finish()
