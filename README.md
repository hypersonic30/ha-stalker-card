# Stalker Card

Lovelace-Karte im Glas-Design für die Integration [Stalker IPTV](https://github.com/hypersonic30/ha-stalker-integration):
Live-TV, Programmführer, Filme und Serien. Läuft auch in der Companion App.

```yaml
type: custom:stalker-card
title: Fernsehen
# portal: Zuhause   # optional: welches Portal zuerst gewählt ist (Name)
```

- **Live-TV**: Senderliste mit „läuft gerade“ und Fortschrittsbalken, Kategorien als Chips, Suche; im Player Sender vor/zurück.
- **Programm**: Zeitraster wie bei TiviMate (Sender links, Zeit oben, rote „Jetzt“-Linie); Sendung antippen für Beschreibung und „Sender ansehen“.
- **Filme**: Poster mit Suche und Kategorien; Antippen öffnet ein Fenster mit Abspielen, Fortsetzen, Von vorn, „gesehen“.
- **Serien**: Serie antippen öffnet ein Fenster mit Infos und Staffeln; eine Staffel antippen klappt die Folgen auf. Pro Folge Fortschritt und Häkchen.
- **Portale**: Hast du mehrere Portale eingerichtet, erscheint oben eine Auswahl zum Umschalten; die letzte Wahl wird gemerkt (`portal:` in der Konfiguration legt das Standardportal fest).
- **Favoriten**: Stern bei einem Sender (auch im Player), Chip „Favoriten“ in der Senderliste; Sender vor/zurück bleibt dann bei den Favoriten, im Programm stehen sie oben.
- **Weiterschauen** (Filme und Serien) und „gesehen“ gelten je Home-Assistant-Benutzer.
- Tabs „Filme“ und „Serien“ erscheinen nur, wenn die Integration die Listen kennt.
- Wiedergabe als HLS (nativ in Safari/iOS, sonst hls.js per CDN). Bei Filmen gibt es eine Zeitleiste; Spulen startet den Stream an der Stelle neu.
- Pausierst du lange, stoppt der Server den Stream; die Karte startet dann an der letzten Position neu.
- Braucht die Integration `stalker` ab 0.4.0 (mehrere Portale und Favoriten).
- Ohne Programmdaten (z. B. M3U ohne XMLTV) fehlt der Tab „Programm“.
