from _server import *

serve()
with sync_playwright() as p:
    b, pg, errors = browser_page(p)
    STATE["info"] = {"vod": False, "series": False, "max_streams": 1}
    open_card(pg)
    check("only Live-TV tab when no playlists configured", pg.locator("stalker-card >> .tab").all_inner_texts() == ["Live-TV"])
    b.close()
    b, pg, errors = browser_page(p, width=360)
    reset()
    open_card(pg)
    pg.wait_for_selector("stalker-card >> .row")
    check("no horizontal scroll at phone width", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
    b.close()
finish()
