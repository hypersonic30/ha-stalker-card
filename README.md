# Stalker Card

Lovelace-Karte für die Integration [Stalker IPTV](https://github.com/hypersonic30/ha-stalker-integration): Live-TV mit
Programminfo, Filme (mit Suche und Kategorien) und Serien (Staffeln und Folgen). Läuft auch in der Companion App.

```yaml
type: custom:stalker-card
title: Fernsehen
```

- Tabs erscheinen nur, wenn die Integration Filme bzw. Serien kennt.
- Wiedergabe als HLS (nativ in Safari/iOS, sonst hls.js per CDN). Bei Filmen gibt es eine Zeitleiste; Spulen startet den Stream an der Stelle neu.
- Pausierst du lange, stoppt der Server den Stream; die Karte startet dann an der letzten Position neu.
- Braucht die Integration `stalker` ab 0.1.0.
