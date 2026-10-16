from _server import *

serve()
with sync_playwright() as p:
    b, pg, errors = browser_page(p)
    STATE["info"] = {"vod": False, "series": False, "max_streams": 1}
    open_card(pg)
    check("only Live-TV and Programm without playlists", pg.locator("stalker-card >> .sc-tab").all_inner_texts() == ["Live-TV", "Programm"])
    b.close()
    b, pg, errors = browser_page(p)
    reset()
    STATE["info"] = {"vod": True, "series": False, "epg": False, "max_streams": 1}
    open_card(pg)
    check("no Programm tab for sources without a guide", pg.locator("stalker-card >> .sc-tab").all_inner_texts() == ["Live-TV", "Filme"])
    b.close()
    b, pg, errors = browser_page(p, width=360)
    reset()
    open_card(pg)
    pg.wait_for_selector("stalker-card >> .sc-ch")
    check("no horizontal scroll at phone width", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
    check("tabs fit on a phone", pg.evaluate("() => { const t = card.shadowRoot.getElementById('sc-tabs'); return t.scrollWidth <= t.clientWidth + 1; }"))
    pg.locator("stalker-card >> .sc-tab", has_text="Programm").click()
    pg.wait_for_selector("stalker-card >> .sc-gp")
    check("guide does not widen the page (scrolls inside)", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
    b.close()
finish()
