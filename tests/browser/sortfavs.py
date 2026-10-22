from _server import *

C = "stalker-card >> "
serve()
with sync_playwright() as p:
    b, pg, errors = browser_page(p)
    STATE["favs"] = {"p1": ["5", "7", "3"]}
    open_card(pg)
    pg.wait_for_selector(C + ".sc-ch")
    pg.locator(C + ".sc-chip", has_text="Favoriten").click()
    ids = lambda: pg.locator(C + ".sc-ch").evaluate_all("els => els.map(e => e.dataset.id)")
    check("favourites are listed in the saved order, not the channel order", ids() == ["5", "7", "3"], ids())

    # a long press on a row starts the sort mode and does not play the channel
    box = pg.locator(C + ".sc-ch[data-id='7']").bounding_box()
    pg.mouse.move(box["x"] + 40, box["y"] + 20)
    pg.mouse.down()
    pg.wait_for_timeout(800)
    pg.mouse.up()
    pg.wait_for_selector(C + ".sc-grip")
    check("long press opens the sort mode with a grip per row", pg.locator(C + ".sc-grip").count() == 3)
    check("the long press does not start the stream", not any(c[:2] == ("POST", "play") for c in calls()))

    def drag(src, dst):
        g = pg.locator(C + f".sc-sortrow[data-id='{src}'] .sc-grip").bounding_box()
        t = pg.locator(C + f".sc-sortrow[data-id='{dst}']").bounding_box()
        pg.mouse.move(g["x"] + 10, g["y"] + 10)
        pg.mouse.down()
        pg.mouse.move(g["x"] + 10, (g["y"] + t["y"]) / 2, steps=5)
        pg.mouse.move(g["x"] + 10, t["y"] + 6 if t["y"] < g["y"] else t["y"] + t["height"] - 6, steps=8)
        pg.mouse.up()

    drag("3", "5")
    pg.wait_for_function("() => card._favs[0] === '3'")
    check("dragging the grip moves a channel up", pg.evaluate("() => card._favs") == ["3", "5", "7"], pg.evaluate("() => card._favs"))
    drag("3", "7")
    pg.wait_for_function("() => card._favs[2] === '3'")
    check("and down", pg.evaluate("() => card._favs") == ["5", "7", "3"], pg.evaluate("() => card._favs"))
    drag("3", "5")
    pg.wait_for_function("() => card._favs[0] === '3'")
    pg.wait_for_timeout(900)
    check("the whole order is saved", STATE["favs"]["p1"] == ["3", "5", "7"] and calls()[-1] == ("POST", "favorites", {"order": ["3", "5", "7"]}), calls()[-3:])

    pg.locator(C + "[data-action=sort_done]").click()
    pg.wait_for_selector(C + ".sc-fav")
    check("Fertig leaves the sort mode, order kept", ids() == ["3", "5", "7"], ids())

    # a short tap still plays
    pg.locator(C + ".sc-ch[data-id='5']").click()
    pg.wait_for_function("() => card._player && card._player.id === '5'")
    check("a normal tap still plays", True)
    pg.locator(".stalker-card-overlay >> [data-action=close_player]").click()
    pg.wait_for_timeout(300)

    # the Sortieren button does the same, and a search turns the mode off
    pg.locator(C + "[data-action=sort_start]").click()
    pg.wait_for_selector(C + ".sc-grip")
    pg.locator(C + "[data-q]").fill("zzz")
    pg.wait_for_timeout(300)
    check("searching leaves the sort mode", pg.locator(C + ".sc-grip").count() == 0)

    # failure rolls the order back
    pg.locator(C + "[data-q]").fill("")
    pg.wait_for_selector(C + "[data-action=sort_start]")
    STATE["fav_error"] = "too_many_favorites"
    pg.locator(C + "[data-action=sort_start]").click()
    drag("7", "3")
    pg.wait_for_selector(C + ".sc-error", timeout=5000)
    check("a refused order is rolled back", pg.evaluate("() => card._favs") == ["3", "5", "7"], pg.evaluate("() => card._favs"))
    check("no page errors", not errors, errors)
