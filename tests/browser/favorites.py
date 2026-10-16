from _server import *

C, O = "stalker-card >> ", ".stalker-card-overlay >> "
serve()
with sync_playwright() as p:
    b, pg, errors = browser_page(p)
    STATE["favs"] = {"p1": ["5"]}
    open_card(pg)
    pg.wait_for_selector(C + ".sc-ch")
    check("a favourite shows a filled star, others an empty one", pg.locator(C + ".sc-fav.on").count() == 1 and pg.locator(C + ".sc-fav.on").get_attribute("data-id") == "5")
    check("stars are separate buttons (no nested buttons)", pg.evaluate("() => card.shadowRoot.querySelectorAll('button button').length") == 0)
    pg.locator(C + ".sc-fav[data-id='7']").click()
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-fav.on').length === 2")
    check("tapping a star saves it", STATE["favs"]["p1"] == ["5", "7"] and ("POST", "favorites", {"id": "7", "fav": True}) in calls(), calls()[-2:])
    check("tapping the star does not start the stream", not any(c[:2] == ("POST", "play") for c in calls()))
    pg.locator(C + ".sc-chip", has_text="Favoriten").click()
    check("Favoriten chip lists only favourites", pg.locator(C + ".sc-ch").count() == 2, pg.locator(C + ".sc-ch").count())
    pg.locator(C + ".sc-fav[data-id='7']").click()
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-ch').length === 1")
    check("removing a favourite drops it from the Favoriten list", STATE["favs"]["p1"] == ["5"])
    pg.locator(C + ".sc-fav[data-id='5']").click()
    pg.wait_for_selector(C + ".sc-empty")
    check("empty Favoriten shows a hint", "Stern" in pg.inner_text(C + ".sc-empty"))
    pg.locator(C + ".sc-fav", has_text="").count()

    # zapping inside the favourites, star in the player
    pg.locator(C + ".sc-chip", has_text="Alle").click()
    for i in ("3", "9"):
        pg.locator(C + f".sc-fav[data-id='{i}']").click()
    pg.wait_for_function("() => card.shadowRoot.querySelectorAll('.sc-fav.on').length === 2")
    pg.locator(C + ".sc-chip", has_text="Favoriten").click()
    pg.locator(C + ".sc-ch[data-id='3']").click()
    pg.wait_for_selector(O + "#sc-pfav")
    check("player shows a filled star for a favourite", "mdi:star\"" in pg.inner_html(O + "#sc-pfav") or 'icon="mdi:star"' in pg.inner_html(O + "#sc-pfav"), pg.inner_html(O + "#sc-pfav"))
    pg.locator(O + "[data-action=chan][data-dir='1']").click()
    pg.wait_for_function("() => card._player && card._player.id === '9'")
    check("next channel zaps within the favourites only", True)
    pg.locator(O + "#sc-pfav").click()
    pg.wait_for_function("() => !card._favs.includes('9')")
    check("star in the player removes the favourite", STATE["favs"]["p1"] == ["3"] and 'icon="mdi:star-outline"' in pg.inner_html(O + "#sc-pfav"), STATE["favs"])
    pg.locator(O + "[data-action=close_player]").click()
    pg.wait_for_timeout(300)

    # guide: favourites first
    pg.locator(C + ".sc-chip", has_text="Alle").click()
    pg.locator(C + ".sc-fav[data-id='60']").click()
    pg.wait_for_function("() => card._favs.includes('60')")
    pg.locator(C + ".sc-tab", has_text="Programm").click()
    pg.wait_for_selector(C + ".sc-gch")
    firsts = pg.locator(C + ".sc-gch").evaluate_all("els => els.slice(0, 3).map(e => e.dataset.id)")
    check("guide lists favourites first", firsts[:2] == ["3", "60"] and firsts[2] == "6", firsts)

    # failure: stars roll back and say why
    STATE["fav_error"] = "too_many_favorites"
    pg.locator(C + ".sc-tab", has_text="Live-TV").click()
    pg.wait_for_selector(C + ".sc-fav[data-id='11']")
    pg.locator(C + ".sc-fav[data-id='11']").click()
    pg.wait_for_selector(C + ".sc-error")
    check("a refused favourite is rolled back with a message", pg.locator(C + ".sc-fav[data-id='11'].on").count() == 0 and "zu viele" in pg.inner_text(C + ".sc-error").lower(), pg.inner_text(C + ".sc-error"))
    check("no page errors", not errors, errors)
    b.close()
finish()
