from _server import *

C, O = "stalker-card >> ", ".stalker-card-overlay >> "
SECOND = [{"id": str(i), "name": f"Zweit {i}", "number": str(i), "genre_id": "1", "logo": "", "has_epg": False} for i in range(1, 6)]
PORTALS = [{"id": "p1", "title": "Zuhause", "source": "stalker"}, {"id": "p2", "title": "Anbieter <b>B</b>", "source": "xtream"}]


def ls(pg, key="sc-portal"):
    return pg.evaluate("(k) => localStorage.getItem(k)", key)


serve()
with sync_playwright() as p:
    # -- one portal: no switcher, every call still names the portal
    b, pg, errors = browser_page(p)
    open_card(pg)
    pg.wait_for_selector(C + ".sc-ch")
    check("one portal: no switcher", pg.locator(C + "#sc-portal").is_hidden())
    seen = [x for x in STATE["seen"] if x[0] != "portals"]
    check("every call names the portal", seen and all(raw == "p1" for _, raw in seen), seen[:5])
    b.close()

    # -- no portal at all
    b, pg, errors = browser_page(p)
    reset()
    STATE["portals"] = []
    pg.goto(f"http://127.0.0.1:{PORT}/")
    pg.evaluate("() => { const c = document.createElement('stalker-card'); c.setConfig({}); document.body.appendChild(c); c.hass = window.hassStub; window.card = c; }")
    pg.wait_for_selector(C + ".sc-error")
    check("no portal: friendly hint", "Portal" in pg.inner_text(C + ".sc-error"), pg.inner_text(C + ".sc-error"))
    b.close()

    # -- two portals
    b, pg, errors = browser_page(p)
    reset()
    STATE["portals"] = PORTALS
    STATE["channels_by"] = {"p2": SECOND}
    STATE["info_by"] = {"p2": {"vod": False, "series": False, "epg": False, "max_streams": 1}}
    open_card(pg)
    pg.wait_for_selector(C + ".sc-ch")
    sel = C + "#sc-portal"
    check("switcher shown with both portals (escaped)", pg.locator(sel).is_visible() and pg.locator(sel + " option").all_inner_texts() == ["Zuhause", "Anbieter <b>B</b>"], pg.locator(sel + " option").all_inner_texts())
    check("starts on the first portal", pg.locator(C + ".sc-ch").count() == 80 and pg.locator(C + ".sc-tab").all_inner_texts() == ["Live-TV", "Programm", "Filme", "Serien"])
    pg.locator(C + ".sc-tab", has_text="Filme").click()
    pg.wait_for_selector(C + ".sc-grid .sc-tile")
    # switch: channels, tabs and the remembered choice change; the old portal's data is gone
    pg.select_option(sel, "p2")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-ch').length === 5")
    check("switch shows the other portal's channels", pg.locator(C + ".sc-ch").first.inner_text().startswith("1") and "Zweit 1" in pg.inner_text(C + ".sc-ch"))
    check("tabs follow the new portal's capabilities (vod tab gone, back on Live-TV)", pg.locator(C + ".sc-tab").all_inner_texts() == ["Live-TV"] and pg.locator(C + ".sc-tab.active").inner_text() == "Live-TV")
    check("choice is remembered", ls(pg) == "p2")
    check("calls after the switch name p2", STATE["seen"][-1][1] == "p2" and any(x == ("live", "p2") for x in STATE["seen"]), STATE["seen"][-4:])
    pg.select_option(sel, "p1")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-ch').length === 80")
    check("back to the first portal", pg.locator(C + ".sc-tab").count() == 4)

    # -- switching while a stream plays stops it
    pg.locator(C + ".sc-ch", has_text="Kanal 003").click()
    pg.wait_for_function("() => { const v = document.querySelector('.stalker-card-overlay').shadowRoot.querySelector('video'); return v && v.currentTime > 1 }", timeout=30000)
    n = len([c for c in calls() if c[:2] == ("POST", "stop")])
    pg.evaluate("() => card._selectPortal('p2')")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-ch').length === 5")
    check("switching stops the running stream", len([c for c in calls() if c[:2] == ("POST", "stop")]) == n + 1, calls()[-4:])
    check("switching leaves no player open", not pg.evaluate("() => card._playerDialog.open") and pg.evaluate("() => card._player") is None)
    check("a play request carries the portal", any(c[:2] == ("POST", "play") for c in calls()) and ("play", "p1") in STATE["seen"], STATE["seen"][-6:])
    pg.evaluate("() => card._selectPortal('p1')")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-ch').length === 80")
    b.close()

    # -- saved choice wins; config 'portal' (by name) used when nothing is saved; unknown saved id is ignored
    b, pg, errors = browser_page(p)
    reset()
    STATE["portals"] = PORTALS
    STATE["channels_by"] = {"p2": SECOND}
    pg.goto(f"http://127.0.0.1:{PORT}/")
    pg.evaluate("() => localStorage.setItem('sc-portal', 'gone')")
    open_card(pg, portal="anbieter <b>b</b>")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-ch').length === 5")
    check("config portal (by title) is the default", pg.evaluate("() => card._portal") == "p2")
    b.close()

    # -- an answer from the portal left behind is ignored
    b, pg, errors = browser_page(p)
    reset()
    STATE["portals"] = PORTALS
    STATE["channels_by"] = {"p2": SECOND}
    STATE["delay"] = {"p1": 1.5}
    pg.goto(f"http://127.0.0.1:{PORT}/")
    pg.evaluate("() => localStorage.setItem('sc-portal', 'p1')")
    pg.evaluate("() => { const c = document.createElement('stalker-card'); c.setConfig({}); document.body.appendChild(c); c.hass = window.hassStub; window.card = c; }")
    pg.wait_for_selector(C + ".sc-tab")
    pg.select_option(C + "#sc-portal", "p2")
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-ch').length === 5")
    pg.wait_for_timeout(2200)  # the slow answer of p1 arrives now
    check("late answer of the old portal does not overwrite the list", pg.locator(C + ".sc-ch").count() == 5 and "Zweit" in pg.inner_text(C + ".sc-ch"))
    check("and shows no error", pg.locator(C + ".sc-error").count() == 0)
    b.close()
finish()
