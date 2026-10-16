/* Stalker Card – Live-TV, Programm, Filme und Serien aus einem Stalker-Portal (Integration "stalker"). */
const CARD_VERSION = "0.3.0";
const CARD_TAG = "stalker-card";
const HLS_URL = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js";
const PAGE = 60; // Filme je Seite (Server)
const SHOW_STEP = 80; // Kanäle/Serien je "Mehr"
const GUIDE_ROWS = 25; // Kanäle je "Mehr" im Programm
const GUIDE_HOURS = 30; // Zeitfenster des Programms
const GUIDE_PX_PER_MIN = 4;
const SEEK_DEBOUNCE_MS = 350;
const EPG_REFRESH_MS = 60000;
const REPORT_EVERY_MS = 15000;
const RESUME_MIN_S = 30; // darunter: nur kurz angetippt
const RESUME_BACK_S = 5;

const ERRORS = {
  video_codec_unsupported: "Dieses Video enthält keinen abspielbaren Videostream.",
  transcode_disabled: "Dieses Video braucht Umkodierung, die in den Einstellungen der Integration ausgeschaltet ist.",
  stream_timeout: "Der Stream hat nicht rechtzeitig gestartet. Das Portal erlaubt evtl. nur einen Stream gleichzeitig.",
  stream_failed: "Der Stream konnte nicht geöffnet werden.",
  probe_timeout: "Das Portal antwortet zu langsam.",
  portal_busy: "Das Portal ist gerade ausgelastet. Bitte gleich noch einmal versuchen.",
  ffmpeg_missing: "ffmpeg ist in Home Assistant nicht verfügbar.",
  foreign_host: "Der Stream liegt auf einem nicht freigegebenen Server und wurde blockiert.",
  portal_auth: "Das Portal hat die MAC-Adresse abgelehnt.",
  portal_unreachable: "Das Portal ist nicht erreichbar.",
  not_found: "Eintrag nicht gefunden.",
  not_loaded: "Die Integration ist nicht geladen.",
};
const errMessage = (e) => ERRORS[e?.body?.code] || (e?.status === 401 ? "Bitte neu anmelden." : "Es ist ein Fehler aufgetreten.");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0");
};
const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (ts) => new Date(ts * 1000).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const pkey = (kind, id) => `${kind}:${id}`;

let hlsLoader = null;
const loadHls = () => hlsLoader || (hlsLoader = new Promise((resolve, reject) => {
  if (window.Hls) return resolve(window.Hls);
  const s = document.createElement("script");
  s.src = HLS_URL;
  s.onload = () => resolve(window.Hls);
  s.onerror = () => { hlsLoader = null; reject(new Error("hls.js")); };
  document.head.appendChild(s);
}));

const STYLE = `
<style>
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  :host {
    display: block;
    --sc-radius-lg: 26px; --sc-radius-md: 16px; --sc-radius-sm: 10px;
    --sc-accent-rgb: 10, 132, 255;
    --sc-accent: var(--primary-color, rgb(var(--sc-accent-rgb)));
    --sc-soft: rgba(128, 128, 128, 0.10);
    --sc-line: rgba(128, 128, 128, 0.18);
    font-family: var(--paper-font-body1_-_font-family, -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif);
  }
  ha-card {
    position: relative; overflow: hidden; border-radius: var(--sc-radius-lg);
    background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 55%, transparent);
    backdrop-filter: blur(26px) saturate(160%); -webkit-backdrop-filter: blur(26px) saturate(160%);
    border: 1px solid color-mix(in srgb, var(--divider-color, #8e8e93) 55%, transparent);
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.16), inset 0 1px 1px rgba(255, 255, 255, 0.12);
  }
  ha-card::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.6;
    background: linear-gradient(120deg, rgba(255,255,255,0.30), rgba(255,255,255,0.05) 35%, transparent 60%); }
  .sc-root { position: relative; z-index: 1; display: flex; flex-direction: column; color: var(--primary-text-color); }
  .sc-header { padding: 18px 18px 6px; font-size: 1.35em; font-weight: 700; letter-spacing: -0.01em; }
  .sc-error { display: flex; align-items: center; gap: 8px; margin: 10px 16px 0; padding: 10px 14px; border-radius: var(--sc-radius-sm);
    color: white; font-size: 0.9em; background: color-mix(in srgb, var(--error-color, #db4437) 85%, transparent); }
  .sc-tabs { display: flex; gap: 4px; margin: 8px 16px 0; padding: 4px; border-radius: 999px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .sc-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; min-height: 40px; border: none; border-radius: 999px;
    background: none; cursor: pointer; font: inherit; font-size: 0.82em; font-weight: 600; color: var(--secondary-text-color); min-width: 0; padding: 0 4px; }
  .sc-tab.active { color: white; background: color-mix(in srgb, var(--sc-accent) 92%, transparent); box-shadow: 0 2px 8px rgba(var(--sc-accent-rgb), 0.4); }
  .sc-tab ha-icon { --mdc-icon-size: 18px; flex: none; }
  .sc-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-searchbar { display: flex; gap: 8px; padding: 12px 16px 0; }
  .sc-searchbar input { flex: 1; min-width: 0; min-height: 44px; padding: 10px 16px; border-radius: 999px; font: inherit; font-size: 16px;
    color: var(--primary-text-color); background: var(--sc-soft); border: 1px solid var(--sc-line); }
  .sc-searchbar input:focus { outline: 2px solid color-mix(in srgb, var(--sc-accent) 60%, transparent); }
  .sc-body { padding: 12px 16px 18px; display: flex; flex-direction: column; gap: 14px; }
  .sc-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
  .sc-chip { flex: 0 0 auto; min-height: 36px; padding: 6px 14px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 0.88em; font-weight: 600;
    border: 1px solid var(--sc-line); background: var(--sc-soft); color: var(--primary-text-color); }
  .sc-chip.active { background: color-mix(in srgb, var(--sc-accent) 90%, transparent); color: white; border-color: transparent; }
  .sc-section { font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--secondary-text-color); margin: 4px 2px 0; }
  .sc-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: none; }
  .sc-row .sc-tile { flex: 0 0 104px; }
  .sc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 14px 12px; }
  .sc-tile { cursor: pointer; min-width: 0; text-align: left; border: 0; background: none; padding: 0; color: inherit; font: inherit; -webkit-tap-highlight-color: transparent; }
  .sc-cover { position: relative; aspect-ratio: 2 / 3; border-radius: var(--sc-radius-sm); overflow: hidden; background: var(--sc-soft); box-shadow: 0 6px 16px rgba(0,0,0,0.22); }
  .sc-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .sc-cover-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 8px; text-align: center; font-size: 0.75em; color: var(--secondary-text-color); }
  .sc-badge { position: absolute; top: 6px; right: 6px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; z-index: 2;
    display: flex; align-items: center; justify-content: center; font-size: 0.72em; font-weight: 700; color: white; background: var(--sc-accent); }
  .sc-badge.done { background: #34c759; }
  .sc-progressbar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(0,0,0,0.35); z-index: 2; }
  .sc-progressbar > div { height: 100%; background: var(--sc-accent); }
  .sc-tile-title { margin-top: 6px; font-size: 0.82em; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .sc-tile-sub { font-size: 0.72em; color: var(--secondary-text-color); margin-top: 2px; }
  .sc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 18px; border: none; cursor: pointer;
    border-radius: 999px; font: inherit; font-size: 0.95em; font-weight: 600; color: white; transition: transform 0.1s ease;
    background: color-mix(in srgb, var(--sc-accent) 92%, transparent); box-shadow: 0 2px 8px rgba(var(--sc-accent-rgb), 0.35); }
  .sc-btn:active { transform: scale(0.96); }
  .sc-btn:disabled { opacity: 0.5; transform: none; box-shadow: none; }
  .sc-btn.secondary { color: var(--primary-text-color); background: var(--sc-soft); border: 1px solid var(--sc-line); box-shadow: none; }
  .sc-btn.round { width: 44px; min-width: 44px; padding: 0; }
  .sc-btn.small { min-height: 34px; padding: 0 14px; font-size: 0.85em; }
  .sc-btn ha-icon { --mdc-icon-size: 22px; }
  .sc-empty, .sc-loading { text-align: center; padding: 28px 12px; color: var(--secondary-text-color); font-size: 0.9em; line-height: 1.5; }
  .sc-more { align-self: center; }

  /* channel list */
  .sc-channels { display: flex; flex-direction: column; gap: 8px; }
  .sc-ch { display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: var(--sc-radius-md); cursor: pointer; width: 100%; text-align: left;
    background: var(--sc-soft); border: 1px solid var(--sc-line); color: inherit; font: inherit; }
  .sc-ch.on { background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-soft)); }
  .sc-logo { width: 46px; height: 46px; flex: none; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: 0.7em; color: var(--secondary-text-color); }
  .sc-logo img { width: 100%; height: 100%; object-fit: contain; }
  .sc-ch-main { flex: 1; min-width: 0; }
  .sc-ch-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-ch-num { color: var(--secondary-text-color); font-weight: 400; margin-right: 6px; }
  .sc-ch-now { font-size: 0.82em; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .sc-meter { height: 3px; border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 14%, transparent); margin-top: 6px; overflow: hidden; }
  .sc-meter > div { height: 100%; background: var(--sc-accent); }

  /* programme guide (TiviMate style: channels left, time axis on top) */
  .sc-guide-tools { display: flex; gap: 8px; align-items: center; }
  .sc-guide { overflow: auto; max-height: 68vh; border-radius: var(--sc-radius-md); border: 1px solid var(--sc-line); background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 70%, transparent); position: relative; }
  .sc-gin { position: relative; }
  .sc-gtime { position: sticky; top: 0; z-index: 4; height: 30px; background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 92%, transparent); border-bottom: 1px solid var(--sc-line); }
  .sc-gtick { position: absolute; top: 0; height: 30px; padding: 7px 6px 0; font-size: 0.75em; color: var(--secondary-text-color); border-left: 1px solid var(--sc-line); white-space: nowrap; }
  .sc-grow { position: relative; display: flex; height: 58px; border-bottom: 1px solid var(--sc-line); }
  .sc-gch { position: sticky; left: 0; z-index: 3; width: 92px; flex: none; display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; text-align: left;
    border: 0; border-right: 1px solid var(--sc-line); background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 94%, transparent); color: inherit; font: inherit; font-size: 0.72em; }
  .sc-gch .sc-logo { width: 28px; height: 28px; border-radius: 6px; }
  .sc-gch span { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.2; }
  .sc-gprogs { position: relative; flex: none; height: 100%; }
  .sc-gp { position: absolute; top: 4px; bottom: 4px; padding: 4px 8px; border-radius: 8px; overflow: hidden; text-align: left; cursor: pointer; color: inherit; font: inherit; font-size: 0.78em;
    border: 1px solid var(--sc-line); background: var(--sc-soft); }
  .sc-gp.now { background: color-mix(in srgb, var(--sc-accent) 22%, var(--sc-soft)); border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
  .sc-gp b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-gp small { display: block; color: var(--secondary-text-color); font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-gnow { position: absolute; top: 0; bottom: 0; width: 2px; z-index: 2; background: var(--error-color, #db4437); pointer-events: none; }

  /* dialogs live in an overlay on <body>: the detail is a glass sheet, the player fills the screen */
  dialog.sc-dialog { padding: 0; border: none; background: transparent; max-width: 100vw; max-height: 100dvh; color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif); }
  dialog.sc-dialog::backdrop { background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  dialog.sc-dialog.sc-full { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; background: #000; color: white; }
  dialog.sc-dialog.sc-full::backdrop { background: rgba(0, 0, 0, 0.7); }
  .sc-sheet { position: relative; width: min(560px, 100vw); max-height: 92dvh; overflow-y: auto; border-radius: var(--sc-radius-lg);
    background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 94%, transparent); box-shadow: 0 30px 60px rgba(0,0,0,0.45);
    padding: 56px 18px calc(22px + env(safe-area-inset-bottom)); }
  .sc-sheet::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 160px; pointer-events: none; opacity: 0.5;
    background: linear-gradient(to bottom, color-mix(in srgb, var(--sc-accent) 35%, transparent), transparent); }
  .sc-sheet > * { position: relative; }
  .sc-close { position: absolute; top: 10px; right: 12px; z-index: 5; }
  .sc-detail-top { display: flex; gap: 16px; align-items: flex-end; }
  .sc-detail-top .sc-cover { flex: 0 0 120px; }
  .sc-detail-top .sc-logo { flex: 0 0 72px; width: 72px; height: 72px; }
  .sc-detail-title { font-size: 1.25em; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .sc-detail-sub { color: var(--secondary-text-color); font-size: 0.9em; margin-top: 4px; }
  .sc-pills { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
  .sc-pill { font-size: 0.7em; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); }
  .sc-pill.ok { background: rgba(67,160,71,0.25); }
  .sc-actions { display: flex; flex-direction: column; gap: 10px; margin: 18px 0 14px; }
  .sc-actions-row { display: flex; gap: 10px; }
  .sc-actions-row .sc-btn { flex: 1; }
  .sc-summary { font-size: 0.9em; line-height: 1.55; color: var(--secondary-text-color); margin-bottom: 12px; white-space: pre-line; }
  .sc-seasons { display: flex; flex-direction: column; gap: 10px; }
  .sc-season { border-radius: var(--sc-radius-md); background: var(--sc-soft); border: 1px solid var(--sc-line); overflow: hidden; }
  .sc-season-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .sc-season-head b { flex: 1; }
  .sc-season-head small { color: var(--secondary-text-color); }
  .sc-season-head ha-icon { --mdc-icon-size: 22px; transition: transform 0.18s ease; }
  .sc-season.open .sc-season-head ha-icon { transform: rotate(180deg); }
  .sc-eps { display: flex; flex-direction: column; border-top: 1px solid var(--sc-line); }
  .sc-ep { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--sc-line); cursor: pointer; }
  .sc-ep:last-child { border-bottom: 0; }
  .sc-ep-num { flex: 0 0 2.2em; color: var(--secondary-text-color); text-align: right; }
  .sc-ep-main { flex: 1; min-width: 0; }
  .sc-ep-main small { color: var(--secondary-text-color); }
  .sc-ep.done .sc-ep-main { opacity: 0.6; }
  .sc-ep ha-icon { --mdc-icon-size: 20px; }
  .sc-ep .sc-mark { border: 0; background: none; color: var(--secondary-text-color); cursor: pointer; padding: 6px; border-radius: 50%; }
  .sc-ep.done .sc-mark { color: #34c759; }

  /* player */
  .sc-player { position: relative; width: 100vw; height: 100dvh; display: flex; flex-direction: column; background: #000; }
  .sc-player video { flex: 1; min-height: 0; width: 100%; background: #000; }
  .sc-ptop { position: absolute; top: 0; left: 0; right: 0; z-index: 3; display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top)) 12px 24px;
    background: linear-gradient(to bottom, rgba(0,0,0,0.75), transparent); }
  .sc-ptitle { flex: 1; min-width: 0; }
  .sc-ptitle b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-ptitle small { display: block; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc-pbtn { border: 0; border-radius: 50%; width: 44px; height: 44px; flex: none; cursor: pointer; color: white; background: rgba(255,255,255,0.18);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); display: inline-flex; align-items: center; justify-content: center; }
  .sc-pbtn ha-icon { --mdc-icon-size: 24px; }
  .sc-pbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px calc(12px + env(safe-area-inset-bottom)); background: rgba(0,0,0,0.85); }
  .sc-pbar input[type=range] { flex: 1; accent-color: var(--sc-accent); height: 26px; }
  .sc-pbar span { font-size: 0.8em; opacity: 0.85; min-width: 48px; text-align: center; }
  .sc-spin { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; text-align: center; padding: 24px; background: rgba(0,0,0,0.6); }
  .sc-spin small { opacity: 0.8; }
</style>`;

class StalkerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "live";
    this._info = null;
    this._live = null;
    this._now = {};
    this._genre = "";
    this._q = { live: "", guide: "", vod: "", series: "" };
    this._show = SHOW_STEP;
    this._gshow = GUIDE_ROWS;
    this._guide = { t0: 0, progs: {}, loading: false };
    this._vod = { items: [], total: 0, page: 0, groups: [], group: "" };
    this._series = null;
    this._prog = { items: {}, resume: [] };
    this._detail = null;
    this._player = null;
    this._error = "";
    this._hls = null;
    this._epgTimer = null;
    this._nowTimer = null;
    this._seekTo = debounce((v) => this._restartAt(v), SEEK_DEBOUNCE_MS);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this.isConnected) this._init();
  }
  get hass() { return this._hass; }
  setConfig(config) { this._config = { title: "Stalker TV", ...config }; if (this._skeletonReady) this._titleEl.textContent = this._config.title; }
  getCardSize() { return 8; }
  static getStubConfig() { return { title: "Stalker TV" }; }

  connectedCallback() {
    this._connected = true;
    this._ensureSkeleton();
    clearTimeout(this._overlayCleanupTimer);
    if (this._hass && !this._info) this._init();
    this._startNowTimer();
  }
  disconnectedCallback() {
    this._connected = false;
    clearInterval(this._nowTimer);
    // A re-insert comes back within the same frame; only a card that is really gone releases its overlay.
    clearTimeout(this._overlayCleanupTimer);
    this._overlayCleanupTimer = setTimeout(() => {
      if (!this._connected) { this._closePlayer(); this._overlay?.remove(); this._skeletonReady = false; }
    }, 30000);
  }

  // ── API ─────────────────────────────────────────────────────────────
  _api(method, path, body) { return this._hass.callApi(method, "stalker/" + path, body); }

  async _init() {
    try {
      this._info = await this._api("GET", "info");
      this._loadProgress();
      await this._loadTab();
    } catch (e) { this._error = errMessage(e); }
    this._render();
  }

  async _loadProgress() {
    try {
      this._prog = await this._api("GET", "progress");
      this._render();
      this._renderDetail();
    } catch (_) { /* progress is optional */ }
  }

  async _loadNow() {
    try { this._now = (await this._api("GET", "nowplaying")).items || {}; } catch (_) { /* guide is optional */ }
  }

  async _loadTab() {
    this._error = "";
    try {
      if ((this._tab === "live" || this._tab === "guide") && !this._live) this._live = await this._api("GET", "live");
      if (this._tab === "live" || this._tab === "guide") await this._loadNow();
      if (this._tab === "guide") {
        if (this._guide.t0 && Date.now() / 1000 - this._guide.t0 > 7200) this._guide = { t0: 0, progs: {}, loading: false };
        await this._loadGuide();
      }
      if (this._tab === "vod" && !this._vod.page) await this._loadVod(true);
      if (this._tab === "series" && !this._series) this._series = (await this._api("GET", "series")).items;
    } catch (e) { this._error = errMessage(e); }
  }

  async _loadVod(reset) {
    if (reset) this._vod = { ...this._vod, items: [], total: 0, page: 0 };
    const q = new URLSearchParams({ page: String(this._vod.page + 1), size: String(PAGE) });
    if (this._vod.group) q.set("group", this._vod.group);
    if (this._q.vod) q.set("q", this._q.vod);
    const r = await this._api("GET", "vod?" + q);
    this._vod = { ...this._vod, items: this._vod.items.concat(r.items), total: r.total, page: r.page, groups: r.groups };
  }

  // Programmes of the visible guide rows (only those not loaded yet).
  async _loadGuide() {
    const g = this._guide;
    if (!g.t0) g.t0 = Math.floor((Date.now() / 1000 - 3600) / 1800) * 1800;
    const missing = this._guideRows().map((c) => c.id).filter((id) => !(id in g.progs));
    for (let i = 0; i < missing.length; i += 60) {
      const ids = missing.slice(i, i + 60);
      const q = new URLSearchParams({ ids: ids.join(","), from: String(g.t0), to: String(g.t0 + GUIDE_HOURS * 3600) });
      const r = await this._api("GET", "guide?" + q);
      for (const id of ids) g.progs[id] = r.items?.[id] || [];
    }
  }

  _startNowTimer() {
    clearInterval(this._nowTimer);
    this._nowTimer = setInterval(async () => {
      if (!this._hass || !this._live || (this._tab !== "live") || this._detail) return;
      await this._loadNow();
      if (!this.shadowRoot.querySelector("input:focus")) this._render();
    }, EPG_REFRESH_MS);
  }

  // ── Skeleton ─────────────────────────────────────────────────────────
  _ensureSkeleton() {
    if (this._skeletonReady) return;
    this._skeletonReady = true;
    this.shadowRoot.innerHTML = `${STYLE}<ha-card><div class="sc-root">
      <div class="sc-header" id="sc-title"></div>
      <div id="sc-error"></div>
      <div class="sc-tabs" id="sc-tabs" role="tablist"></div>
      <div id="sc-search"></div>
      <div class="sc-body" id="sc-body"></div>
    </div></ha-card>`;
    this._titleEl = this.shadowRoot.getElementById("sc-title");
    this._titleEl.textContent = this._config?.title || "Stalker TV";

    // Dialogs live in an overlay attached to <body>: HA's dashboard layouts detach and re-insert cards,
    // and a modal <dialog> moved like that silently drops out of the top layer.
    this._overlay = document.createElement("div");
    this._overlay.className = "stalker-card-overlay";
    this._overlayRoot = this._overlay.attachShadow({ mode: "open" });
    this._overlayRoot.innerHTML = `${STYLE}<dialog class="sc-dialog" id="sc-detail"></dialog><dialog class="sc-dialog sc-full" id="sc-player"></dialog>`;
    document.body.appendChild(this._overlay);
    this._detailDialog = this._overlayRoot.getElementById("sc-detail");
    this._playerDialog = this._overlayRoot.getElementById("sc-player");
    this._detailDialog.addEventListener("close", () => { this._detail = null; });
    this._playerDialog.addEventListener("close", () => { if (this._player) this._closePlayer(); });
    this._detailDialog.addEventListener("click", (e) => { if (e.target === this._detailDialog) this._detailDialog.close(); });

    for (const root of this._rootBound ? [this._overlayRoot] : [this.shadowRoot, this._overlayRoot]) {
      root.addEventListener("click", (e) => this._onClick(e));
      root.addEventListener("input", (e) => this._onInput(e));
      root.addEventListener("change", (e) => this._onChange(e));
      root.addEventListener("submit", (e) => e.preventDefault());
    }
    this._rootBound = true;
    this._render();
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  _tabs() {
    const list = [["live", "Live-TV", "mdi:television-classic"]];
    if (this._info?.epg !== false) list.push(["guide", "Programm", "mdi:calendar-clock"]);
    if (this._info?.vod) list.push(["vod", "Filme", "mdi:movie-open"]);
    if (this._info?.series) list.push(["series", "Serien", "mdi:television-play"]);
    return list;
  }

  _render() {
    const root = this.shadowRoot;
    if (!this._skeletonReady) return;
    root.getElementById("sc-error").innerHTML = this._error ? `<div class="sc-error" role="alert">${esc(this._error)}</div>` : "";
    root.getElementById("sc-tabs").innerHTML = this._info
      ? this._tabs().map(([k, l, i]) => `<button class="sc-tab ${k === this._tab ? "active" : ""}" role="tab" aria-selected="${k === this._tab}" data-action="tab" data-tab="${k}"><ha-icon icon="${i}"></ha-icon><span>${l}</span></button>`).join("")
      : "";
    const holder = root.getElementById("sc-search");
    const ph = { live: "Kanal suchen", guide: "Kanal suchen", vod: "Film suchen", series: "Serie suchen" }[this._tab];
    let input = holder.querySelector("input");
    if (!input) {
      holder.innerHTML = `<form class="sc-searchbar" onsubmit="return false"><input type="search" data-q autocomplete="off" enterkeyhint="search"></form>`;
      input = holder.querySelector("input");
    }
    input.placeholder = ph || "";
    if (root.activeElement !== input && input.value !== this._q[this._tab]) input.value = this._q[this._tab] || "";
    holder.hidden = !this._info;

    const body = root.getElementById("sc-body");
    const scroller = body.querySelector(".sc-guide");
    const keep = scroller ? { l: scroller.scrollLeft, t: scroller.scrollTop } : this._gscroll;
    body.innerHTML = this._bodyHtml();
    const g = body.querySelector(".sc-guide");
    if (g) {
      if (keep) { g.scrollLeft = keep.l; g.scrollTop = keep.t; } else this._scrollGuideToNow(g);
    }
    this._gscroll = null;
  }

  _bodyHtml() {
    if (!this._info) return this._error ? "" : `<div class="sc-loading">Lade …</div>`;
    if (this._tab === "live") return this._liveHtml();
    if (this._tab === "guide") return this._guideHtml();
    if (this._tab === "vod") return this._vodHtml();
    return this._seriesHtml();
  }

  _img(src, cls = "") {
    return src
      ? `<img ${cls ? `class="${cls}"` : ""} src="${esc(src)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()">`
      : "";
  }

  _logo(c) { return `<div class="sc-logo">${this._img(c.logo)}</div>`; }

  _genreChips() {
    const genres = this._live.genres.filter((g) => g.id !== "*");
    return `<div class="sc-chips">
      <button class="sc-chip ${this._genre ? "" : "active"}" data-action="genre" data-id="">Alle</button>
      ${genres.map((g) => `<button class="sc-chip ${g.id === this._genre ? "active" : ""}" data-action="genre" data-id="${esc(g.id)}">${esc(g.title)}</button>`).join("")}</div>`;
  }

  _filteredChannels(onlyGuide = false) {
    const q = this._q[onlyGuide ? "guide" : "live"].toLowerCase();
    return (this._live?.channels || []).filter((c) =>
      (!this._genre || c.genre_id === this._genre) && (!q || c.name.toLowerCase().includes(q)) && (!onlyGuide || this._now[c.id]));
  }

  _liveHtml() {
    if (!this._live) return `<div class="sc-loading">Lade Kanäle …</div>`;
    const all = this._filteredChannels();
    const now = Date.now() / 1000;
    const rows = all.slice(0, this._show).map((c) => {
      const n = this._now[c.id];
      const cur = n && n.s <= now && now < n.e ? n : null;
      return `<button class="sc-ch ${this._player?.id === c.id ? "on" : ""}" data-action="play_live" data-id="${esc(c.id)}">
        ${this._logo(c)}<div class="sc-ch-main"><div class="sc-ch-name"><span class="sc-ch-num">${esc(c.number ?? "")}</span>${esc(c.name)}</div>
        ${cur ? `<div class="sc-ch-now">${hhmm(cur.s)} ${esc(cur.t)}</div><div class="sc-meter"><div style="width:${Math.min(100, Math.max(0, ((now - cur.s) / (cur.e - cur.s)) * 100)).toFixed(0)}%"></div></div>` : ""}</div></button>`;
    }).join("");
    return `${this._genreChips()}<div class="sc-channels">${rows || `<div class="sc-empty">Keine Kanäle gefunden.</div>`}</div>
      ${all.length > this._show ? `<button class="sc-btn secondary sc-more" data-action="more">Mehr (${all.length - this._show})</button>` : ""}`;
  }

  // ── Programm (TV guide) ──────────────────────────────────────────────
  _guideRows() { return this._filteredChannels(true).slice(0, this._gshow); }

  _guideHtml() {
    if (!this._live) return `<div class="sc-loading">Lade Kanäle …</div>`;
    const g = this._guide;
    const all = this._filteredChannels(true);
    if (!all.length) return `${this._genreChips()}<div class="sc-empty">${Object.keys(this._now).length ? "Keine Kanäle gefunden." : "Es sind keine Programminformationen verfügbar."}</div>`;
    if (!g.t0) g.t0 = Math.floor((Date.now() / 1000 - 3600) / 1800) * 1800;
    const t0 = g.t0;
    const px = GUIDE_PX_PER_MIN / 60;
    const width = Math.round(GUIDE_HOURS * 3600 * px);
    const now = Date.now() / 1000;
    const ticks = [];
    for (let t = t0; t < t0 + GUIDE_HOURS * 3600; t += 1800) ticks.push(`<div class="sc-gtick" style="left:${Math.round((t - t0) * px)}px;width:${Math.round(1800 * px)}px">${hhmm(t)}</div>`);
    const rows = this._guideRows().map((c) => {
      const progs = (g.progs[c.id] || []).map((p) => {
        const s = Math.max(p.s, t0), e = Math.min(p.e, t0 + GUIDE_HOURS * 3600);
        if (e <= s) return "";
        const w = Math.max(2, Math.round((e - s) * px) - 3);
        return `<button class="sc-gp ${p.s <= now && now < p.e ? "now" : ""}" style="left:${Math.round((s - t0) * px)}px;width:${w}px" data-action="programme" data-ch="${esc(c.id)}" data-s="${p.s}"><b>${esc(p.t)}</b><small>${hhmm(p.s)}–${hhmm(p.e)}</small></button>`;
      }).join("");
      return `<div class="sc-grow"><button class="sc-gch" data-action="play_live" data-id="${esc(c.id)}">${this._logo(c)}<span>${esc(c.name)}</span></button>
        <div class="sc-gprogs" style="width:${width}px">${progs}</div></div>`;
    }).join("");
    const nowX = Math.round((now - t0) * px);
    return `${this._genreChips()}
      <div class="sc-guide-tools"><button class="sc-btn secondary small" data-action="guide_now"><ha-icon icon="mdi:clock-outline"></ha-icon>Jetzt</button></div>
      <div class="sc-guide"><div class="sc-gin" style="width:${width + 92}px">
        <div class="sc-gtime"><div style="position:absolute;left:92px;top:0;width:${width}px;height:30px">${ticks.join("")}</div></div>
        ${rows}<div class="sc-gnow" style="left:${92 + nowX}px"></div></div></div>
      ${all.length > this._gshow ? `<button class="sc-btn secondary sc-more" data-action="gmore">Mehr Kanäle (${all.length - this._gshow})</button>` : ""}`;
  }

  _scrollGuideToNow(el) {
    const g = this._guide;
    if (!el || !g.t0) return;
    el.scrollLeft = Math.max(0, ((Date.now() / 1000 - g.t0) * GUIDE_PX_PER_MIN) / 60 - 20);
  }

  // ── Filme ────────────────────────────────────────────────────────────
  _tile(item, opts = {}) {
    const p = this._prog.items[pkey(opts.kind, item.id)];
    const pct = p?.dur ? Math.min(100, (p.pos / p.dur) * 100) : 0;
    return `<button class="sc-tile" data-action="${opts.action}" data-id="${esc(item.id)}" ${opts.sid ? `data-sid="${esc(opts.sid)}"` : ""} data-kind="${opts.kind}">
      <div class="sc-cover">${this._img(item.logo)}<div class="sc-cover-fallback">${esc(item.title)}</div>
        ${p?.done ? `<span class="sc-badge done">✓</span>` : ""}${!p?.done && pct > 0 ? `<div class="sc-progressbar"><div style="width:${pct.toFixed(0)}%"></div></div>` : ""}</div>
      <div class="sc-tile-title">${esc(item.title)}</div>${opts.sub ? `<div class="sc-tile-sub">${esc(opts.sub)}</div>` : ""}</button>`;
  }

  _resumeRow(kind) {
    const items = (this._prog.resume || []).filter((r) => r.kind === kind);
    if (!items.length) return "";
    return `<div class="sc-section">Weiterschauen</div><div class="sc-row">${items.map((r) => {
      const pct = r.dur ? Math.min(100, (r.pos / r.dur) * 100) : 0;
      return `<button class="sc-tile" data-action="${kind === "vod" ? "movie" : "resume_ep"}" data-id="${esc(r.id)}" data-sid="${esc(r.sid || "")}" data-kind="${kind}">
        <div class="sc-cover">${this._img(r.logo)}<div class="sc-cover-fallback">${esc(r.title)}</div>${pct ? `<div class="sc-progressbar"><div style="width:${pct.toFixed(0)}%"></div></div>` : ""}</div>
        <div class="sc-tile-title">${esc(r.title)}</div><div class="sc-tile-sub">${esc(r.label || (r.pos ? "ab " + fmtTime(r.pos) : ""))}</div></button>`;
    }).join("")}</div>`;
  }

  _vodHtml() {
    const v = this._vod;
    if (!v.page) return `<div class="sc-loading">Lade Filme …</div>`;
    const chips = `<div class="sc-chips"><button class="sc-chip ${v.group ? "" : "active"}" data-action="group" data-id="">Alle</button>
      ${v.groups.map((g) => `<button class="sc-chip ${g === v.group ? "active" : ""}" data-action="group" data-id="${esc(g)}">${esc(g)}</button>`).join("")}</div>`;
    const showResume = !v.group && !this._q.vod;
    return `${showResume ? this._resumeRow("vod") : ""}${chips}
      ${v.items.length ? `<div class="sc-grid">${v.items.map((i) => this._tile(i, { kind: "vod", action: "movie" })).join("")}</div>` : `<div class="sc-empty">Nichts gefunden.</div>`}
      ${v.items.length < v.total ? `<button class="sc-btn secondary sc-more" data-action="morevod">Mehr (${v.total - v.items.length})</button>` : ""}`;
  }

  // ── Serien ───────────────────────────────────────────────────────────
  _seriesHtml() {
    if (!this._series) return `<div class="sc-loading">Lade Serien …</div>`;
    const q = this._q.series.toLowerCase();
    const items = this._series.filter((s) => !q || s.title.toLowerCase().includes(q));
    return `${q ? "" : this._resumeRow("episode")}
      ${items.length ? `<div class="sc-grid">${items.map((s) => this._tile(s, { kind: "series", action: "series", sub: s.episodes ? `${s.episodes} Folgen` : "" })).join("")}</div>` : `<div class="sc-empty">Keine Serien gefunden.</div>`}`;
  }

  // ── Detail sheets (movie, series, programme) ──────────────────────────────
  _renderDetail() {
    const d = this._detail;
    if (!d || !this._detailDialog) return;
    const dlg = this._detailDialog;
    const keep = dlg.querySelector(".sc-sheet")?.scrollTop || 0;
    const body = d.type === "series" ? this._seriesSheet(d) : d.type === "movie" ? this._movieSheet(d) : this._programmeSheet(d);
    dlg.innerHTML = `<div class="sc-sheet"><button class="sc-btn secondary round sc-close" data-action="close_detail" aria-label="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>${body}</div>`;
    dlg.querySelector(".sc-sheet").scrollTop = keep;
    if (!dlg.open) dlg.showModal();
  }

  _cover(item) {
    return `<div class="sc-cover">${this._img(item.logo)}<div class="sc-cover-fallback">${esc(item.title)}</div></div>`;
  }

  _resumeStart(p) { return p && !p.done && p.pos >= RESUME_MIN_S ? Math.max(0, p.pos - RESUME_BACK_S) : 0; }

  _movieSheet(d) {
    const m = d.item;
    const p = this._prog.items[pkey("vod", m.id)];
    const start = this._resumeStart(p);
    return `<div class="sc-detail-top">${this._cover(m)}<div><div class="sc-detail-title">${esc(m.title)}</div>
        <div class="sc-pills">${m.group ? `<span class="sc-pill">${esc(m.group)}</span>` : ""}${p?.done ? `<span class="sc-pill ok">Gesehen</span>` : ""}</div></div></div>
      <div class="sc-actions">
        <button class="sc-btn" data-action="play_vod" data-id="${esc(m.id)}" data-start="${start}"><ha-icon icon="mdi:play"></ha-icon>${start ? "Fortsetzen ab " + fmtTime(start) : "Abspielen"}</button>
        <div class="sc-actions-row">
          ${start ? `<button class="sc-btn secondary" data-action="play_vod" data-id="${esc(m.id)}" data-start="0">Von vorn</button>` : ""}
          <button class="sc-btn secondary" data-action="mark" data-kind="vod" data-id="${esc(m.id)}" data-done="${p?.done ? "0" : "1"}">${p?.done ? "Als ungesehen markieren" : "Als gesehen markieren"}</button>
        </div></div>`;
  }

  _seriesSheet(d) {
    const s = d.data;
    const total = s.seasons.reduce((n, x) => n + x.episodes.length, 0);
    const seen = s.seasons.reduce((n, x) => n + x.episodes.filter((e) => this._prog.items[pkey("episode", e.id)]?.done).length, 0);
    const flat = s.seasons.flatMap((x) => x.episodes.map((e) => ({ ...e, season: x.season })));
    // The episode to offer: the unfinished one, else the one after the last finished, else the first.
    const mine = flat.map((e, i) => ({ e, i, p: this._prog.items[pkey("episode", e.id)] })).filter((x) => x.p);
    let target = flat[0], label = "Erste Folge starten";
    if (mine.length) {
      const last = mine.reduce((a, b) => ((b.p.t || 0) > (a.p.t || 0) ? b : a));
      const partial = mine.filter((x) => !x.p.done && x.p.pos >= RESUME_MIN_S).sort((a, b) => b.i - a.i)[0];
      if (partial) { target = partial.e; label = `Fortsetzen · Staffel ${partial.e.season} Folge ${partial.e.episode}`; }
      else if (flat[last.i + 1]) { target = flat[last.i + 1]; label = `Weiter · Staffel ${target.season} Folge ${target.episode}`; }
    }
    const seasons = s.seasons.map((x) => {
      const open = d.open === x.season;
      const done = x.episodes.filter((e) => this._prog.items[pkey("episode", e.id)]?.done).length;
      return `<div class="sc-season ${open ? "open" : ""}"><button class="sc-season-head" data-action="season" data-season="${x.season}">
          <b>Staffel ${x.season}</b><small>${done ? done + "/" : ""}${x.episodes.length} Folgen</small><ha-icon icon="mdi:chevron-down"></ha-icon></button>
        ${open ? `<div class="sc-eps">${x.episodes.map((e) => this._epRow(e, x.season)).join("")}</div>` : ""}</div>`;
    }).join("");
    return `<div class="sc-detail-top">${this._cover(s)}<div><div class="sc-detail-title">${esc(s.title)}</div>
        <div class="sc-pills"><span class="sc-pill">${s.seasons.length} ${s.seasons.length === 1 ? "Staffel" : "Staffeln"}</span><span class="sc-pill">${total} Folgen</span>
        ${seen ? `<span class="sc-pill ok">${seen} gesehen</span>` : ""}</div></div></div>
      ${target ? `<div class="sc-actions"><button class="sc-btn" data-action="play_ep" data-sid="${esc(s.id)}" data-id="${esc(target.id)}" data-start="${this._resumeStart(this._prog.items[pkey("episode", target.id)])}" data-title="${esc(s.title)}" data-sub="Staffel ${target.season} · Folge ${target.episode}"><ha-icon icon="mdi:play"></ha-icon>${esc(label)}</button></div>` : ""}
      <div class="sc-seasons">${seasons}</div>`;
  }

  _epRow(e, season) {
    const p = this._prog.items[pkey("episode", e.id)];
    const start = this._resumeStart(p);
    const pct = p?.dur && !p.done ? Math.min(100, (p.pos / p.dur) * 100) : 0;
    const s = this._detail.data;
    return `<div class="sc-ep ${p?.done ? "done" : ""}" data-action="play_ep" data-sid="${esc(s.id)}" data-id="${esc(e.id)}" data-start="${start}" data-title="${esc(s.title)}" data-sub="Staffel ${season} · Folge ${e.episode}">
      <span class="sc-ep-num">${e.episode}</span>
      <div class="sc-ep-main">Folge ${e.episode}${start ? `<small> · ab ${fmtTime(start)}</small>` : ""}${pct ? `<div class="sc-meter"><div style="width:${pct.toFixed(0)}%"></div></div>` : ""}</div>
      ${start ? `<button class="sc-btn secondary small" data-action="play_ep" data-sid="${esc(s.id)}" data-id="${esc(e.id)}" data-start="0" data-title="${esc(s.title)}" data-sub="Staffel ${season} · Folge ${e.episode}">Von vorn</button>` : ""}
      <button class="sc-mark" data-action="mark" data-kind="episode" data-sid="${esc(s.id)}" data-id="${esc(e.id)}" data-done="${p?.done ? "0" : "1"}" aria-label="${p?.done ? "Als ungesehen markieren" : "Als gesehen markieren"}"><ha-icon icon="${p?.done ? "mdi:check-circle" : "mdi:circle-outline"}"></ha-icon></button></div>`;
  }

  _programmeSheet(d) {
    const { ch, prog } = d;
    const now = Date.now() / 1000;
    return `<div class="sc-detail-top">${this._logo(ch)}<div><div class="sc-detail-title">${esc(prog.t)}</div>
        <div class="sc-detail-sub">${esc(ch.name)} · ${dayLabel(prog.s)} ${hhmm(prog.s)}–${hhmm(prog.e)}</div>
        <div class="sc-pills">${prog.s <= now && now < prog.e ? `<span class="sc-pill ok">Läuft jetzt</span>` : ""}<span class="sc-pill">${Math.round((prog.e - prog.s) / 60)} min</span></div></div></div>
      ${prog.d ? `<div class="sc-summary" style="margin-top:14px">${esc(prog.d)}</div>` : ""}
      <div class="sc-actions"><button class="sc-btn" data-action="play_live" data-id="${esc(ch.id)}"><ha-icon icon="mdi:play"></ha-icon>Sender ansehen</button></div>`;
  }

  // ── Events (data-action="x" → _a_x) ──────────────────────────────────
  _onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    // a button inside an actionable row wins (e.g. the watched toggle inside an episode)
    const fn = this["_a_" + el.dataset.action];
    if (fn) { e.preventDefault(); fn.call(this, el, e); }
  }

  _onInput(e) {
    const t = e.target;
    if (t.dataset?.q !== undefined) {
      this._q[this._tab] = t.value;
      this._show = SHOW_STEP;
      this._gshow = GUIDE_ROWS;
      if (this._tab === "vod") this._searchVod();
      else if (this._tab === "guide") this._searchGuide();
      else this._render();
    }
    if (t.dataset?.seek !== undefined) this._seekPreview(Number(t.value));
  }

  _onChange(e) {
    const t = e.target;
    if (t.dataset?.seek !== undefined) this._seekTo(Number(t.value));
  }

  _searchVod = debounce(async () => {
    try { await this._loadVod(true); } catch (e) { this._error = errMessage(e); }
    this._render();
  }, 300);

  _searchGuide = debounce(async () => {
    try { await this._loadGuide(); } catch (e) { this._error = errMessage(e); }
    this._gscroll = null;
    this._render();
  }, 200);

  async _a_tab(el) {
    this._tab = el.dataset.tab;
    this._show = SHOW_STEP;
    this._gshow = GUIDE_ROWS;
    this._render();
    await this._loadTab();
    this._render();
    if (this._tab === "vod" || this._tab === "series") this._loadProgress();
  }
  async _a_genre(el) {
    this._genre = el.dataset.id;
    this._show = SHOW_STEP;
    this._gshow = GUIDE_ROWS;
    if (this._tab === "guide") { try { await this._loadGuide(); } catch (e) { this._error = errMessage(e); } }
    this._render();
  }
  async _a_group(el) { this._vod.group = el.dataset.id; await this._searchVodNow(); }
  async _searchVodNow() {
    try { await this._loadVod(true); } catch (e) { this._error = errMessage(e); }
    this._render();
  }
  _a_more() { this._show += SHOW_STEP; this._render(); }
  async _a_gmore() {
    this._gshow += GUIDE_ROWS;
    try { await this._loadGuide(); } catch (e) { this._error = errMessage(e); }
    this._gscroll = null;
    const g = this.shadowRoot.querySelector(".sc-guide");
    this._gscroll = g ? { l: g.scrollLeft, t: g.scrollTop } : null;
    this._render();
  }
  _a_guide_now() { this._scrollGuideToNow(this.shadowRoot.querySelector(".sc-guide")); }
  async _a_morevod() {
    try { await this._loadVod(false); } catch (e) { this._error = errMessage(e); }
    this._render();
  }

  _a_close_detail() { this._detailDialog.close(); }

  _a_movie(el) {
    const id = el.dataset.id;
    const item = this._vod.items.find((i) => i.id === id) || (this._prog.resume || []).find((r) => r.kind === "vod" && r.id === id);
    if (!item) return;
    this._detail = { type: "movie", item: { id, title: item.title, logo: item.logo, group: item.group || "" } };
    this._renderDetail();
  }

  async _a_series(el) {
    try {
      const data = await this._api("GET", "series/" + encodeURIComponent(el.dataset.id));
      const meta = (this._series || []).find((s) => s.id === el.dataset.id);
      this._detail = { type: "series", data: { ...data, logo: data.logo || meta?.logo || "" }, open: null };
      this._renderDetail();
      this._loadProgress();
    } catch (e) { this._error = errMessage(e); this._render(); }
  }

  async _a_resume_ep(el) {
    await this._a_series({ dataset: { id: el.dataset.sid } });
    const d = this._detail;
    if (!d) return;
    d.open = d.data.seasons.find((x) => x.episodes.some((e) => e.id === el.dataset.id))?.season ?? null;
    this._renderDetail();
  }

  _a_season(el) {
    const n = Number(el.dataset.season);
    this._detail.open = this._detail.open === n ? null : n;
    this._renderDetail();
  }

  _a_programme(el) {
    const ch = this._live.channels.find((c) => c.id === el.dataset.ch);
    const prog = (this._guide.progs[el.dataset.ch] || []).find((p) => String(p.s) === el.dataset.s);
    if (!ch || !prog) return;
    this._detail = { type: "programme", ch, prog };
    this._renderDetail();
  }

  async _a_mark(el, ev) {
    ev.stopPropagation();
    const { kind, id, sid } = el.dataset;
    const done = el.dataset.done === "1";
    try {
      await this._api("POST", "progress", { kind, id, done, ...(sid ? { sid } : {}) });
      await this._loadProgress();
    } catch (e) { this._error = errMessage(e); this._render(); }
  }

  _a_play_live(el) {
    const c = this._live?.channels.find((x) => x.id === el.dataset.id);
    if (!c) return;
    const list = this._filteredChannels(this._tab === "guide").map((x) => x.id);
    this._detailDialog?.open && this._detailDialog.close();
    this._play("live", c.id, c.name, "", 0, { list, logo: c.logo });
  }
  _a_play_vod(el) {
    const m = this._detail?.item;
    this._play("vod", el.dataset.id, m?.title || "", "", Number(el.dataset.start) || 0, {});
  }
  _a_play_ep(el, ev) {
    ev.stopPropagation();
    this._play("episode", el.dataset.id, el.dataset.title, el.dataset.sub, Number(el.dataset.start) || 0, { sid: el.dataset.sid });
  }

  // ── Player ───────────────────────────────────────────────────────────
  async _play(kind, id, title, sub, start, extra = {}) {
    this._error = "";
    this._flushReport();
    this._teardownVideo();
    const keep = extra.list ? extra : { list: this._player?.list, logo: this._player?.logo };
    const sid = extra.sid ?? (this._player?.id === id ? this._player.sid : undefined);
    this._player = { kind, id, title, sub, sid, loading: true, start: start || 0, list: keep.list, logo: keep.logo };
    this._renderPlayer();
    if (!this._playerDialog.open) this._playerDialog.showModal();
    try {
      const r = await this._api("POST", "play", { kind, id, start: start || 0, ...(sid ? { sid } : {}), ...(this._canHevc() ? { hevc: true } : {}) });
      if (!this._player || this._player.id !== id) return;
      this._player = { ...this._player, session: r.session, url: r.url, live: r.live, duration: r.duration, start: r.start || 0, transcoding: r.transcoding, loading: false };
      this._renderPlayer();
      await this._attach(r.url);
      if (kind === "live") this._pollEpg(id);
    } catch (e) {
      if (!this._player || this._player.id !== id) return;
      this._player = { ...this._player, loading: false, error: errMessage(e) };
      this._renderPlayer();
    }
  }

  // Can this player decode HEVC itself (Safari/iOS, Chrome with hardware decoding)? Then the server copies it.
  _canHevc() {
    const t = 'video/mp4; codecs="hvc1.2.4.L150.B0"';
    try { return !!(window.MediaSource?.isTypeSupported?.(t) || document.createElement("video").canPlayType(t)); } catch (_) { return false; }
  }

  async _attach(url) {
    const video = this._overlayRoot.querySelector("video");
    if (!video) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url; // Safari / iOS companion app: native HLS
    } else {
      const Hls = await loadHls();
      if (!Hls.isSupported()) throw { body: { code: "stream_failed" } };
      const hls = new Hls({
        lowLatencyMode: false, backBufferLength: 30,
        manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 2, fragLoadingRetryDelay: 500,
      });
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) this._recover(); });
      hls.loadSource(url);
      hls.attachMedia(video);
      this._hls = hls;
    }
    video.addEventListener("error", () => this._recover());
    video.play?.().catch(() => {}); // autoplay may need a tap in some webviews
  }

  // The server stops idle streams (e.g. a long pause): start again where the player was.
  _recover() {
    const p = this._player;
    if (!p || p.loading || p.error) return;
    const now = Date.now();
    this._recoveries = (this._recoveries || []).filter((t) => now - t < 60000);
    if (this._recoveries.length >= 2) {
      this._player = { ...p, error: "Wiedergabe unterbrochen." };
      this._teardownVideo();
      this._renderPlayer();
      return;
    }
    this._recoveries.push(now);
    const video = this._overlayRoot.querySelector("video");
    const pos = p.live === false ? p.start + (video?.currentTime || 0) : 0;
    this._play(p.kind, p.id, p.title, p.sub, Math.floor(pos), { sid: p.sid });
  }

  _renderPlayer() {
    const dlg = this._playerDialog;
    const p = this._player;
    if (!p) { dlg.innerHTML = ""; return; }
    const vod = p.live === false || (p.kind !== "live");
    const live = p.kind === "live";
    const list = p.list || [];
    const idx = list.indexOf(p.id);
    dlg.innerHTML = `<div class="sc-player">
      <video playsinline ${live ? "controls" : ""} autoplay></video>
      <div class="sc-ptop">
        ${live && list.length > 1 ? `<button class="sc-pbtn" data-action="chan" data-dir="-1" aria-label="Voriger Sender"><ha-icon icon="mdi:skip-previous"></ha-icon></button>` : ""}
        <div class="sc-ptitle"><b>${esc(p.title)}</b><small id="sc-epg">${esc(p.sub || "")}${p.transcoding ? " · umkodiert (720p)" : ""}</small></div>
        ${live && list.length > 1 && idx >= 0 ? `<button class="sc-pbtn" data-action="chan" data-dir="1" aria-label="Nächster Sender"><ha-icon icon="mdi:skip-next"></ha-icon></button>` : ""}
        <button class="sc-pbtn" data-action="close_player" aria-label="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>
      </div>
      ${p.loading ? `<div class="sc-spin">Stream startet …${p.kind !== "live" ? `<small>Der erste Start kann bis zu einer halben Minute dauern.</small>` : ""}</div>` : ""}
      ${p.error ? `<div class="sc-spin">${esc(p.error)}<button class="sc-btn" data-action="close_player">Schließen</button></div>` : ""}
      ${vod && p.duration ? `<div class="sc-pbar"><button class="sc-pbtn" data-action="toggle" aria-label="Pause/Weiter"><ha-icon icon="mdi:play-pause"></ha-icon></button>
        <span id="sc-cur">${fmtTime(p.start)}</span>
        <input data-seek type="range" min="0" max="${Math.floor(p.duration)}" step="5" value="${Math.floor(p.start)}" aria-label="Position">
        <span>${fmtTime(p.duration)}</span></div>` : ""}</div>`;
    const video = dlg.querySelector("video");
    if (vod) {
      video.addEventListener("timeupdate", () => { this._tick(video); this._report(false); });
      video.addEventListener("pause", () => this._report(true));
      video.addEventListener("ended", () => this._report(true, true));
    }
  }

  _a_chan(el) {
    const p = this._player;
    if (!p?.list) return;
    const i = p.list.indexOf(p.id);
    const next = p.list[(i + Number(el.dataset.dir) + p.list.length) % p.list.length];
    const c = this._live?.channels.find((x) => x.id === next);
    if (c) this._play("live", c.id, c.name, "", 0, { list: p.list, logo: c.logo });
  }

  _a_close_player() { this._playerDialog.close(); }

  _tick(video) {
    const p = this._player;
    const slider = this._overlayRoot.querySelector("input[data-seek]");
    if (!p || !slider || this._dragging) return;
    const now = p.start + video.currentTime;
    slider.value = String(Math.floor(now));
    const cur = this._overlayRoot.getElementById("sc-cur");
    if (cur) cur.textContent = fmtTime(now);
  }

  _seekPreview(v) {
    this._dragging = true;
    const cur = this._overlayRoot.getElementById("sc-cur");
    if (cur) cur.textContent = fmtTime(v);
  }

  _a_toggle() {
    const v = this._overlayRoot.querySelector("video");
    if (v) v.paused ? v.play() : v.pause();
  }

  _restartAt(value) {
    this._dragging = false;
    const p = this._player;
    if (p) this._play(p.kind, p.id, p.title, p.sub, value, { sid: p.sid });
  }

  // Watch progress: every 15 s while playing, and when pausing, ending or closing.
  _report(force, ended = false) {
    const p = this._player;
    if (!p || p.loading || p.error || p.kind === "live" || !p.duration) return;
    const video = this._overlayRoot.querySelector("video");
    if (!video || (!ended && video.readyState < 2)) return;
    const now = Date.now();
    if (!force && now - (this._lastReport || 0) < REPORT_EVERY_MS) return;
    this._lastReport = now;
    const pos = ended ? p.duration : Math.min(p.duration, p.start + video.currentTime);
    if (!isFinite(pos)) return;
    this._sendProgress(p.kind, p.id, pos, p.duration, p.sid);
  }

  _flushReport() { this._report(true); }

  _sendProgress(kind, id, pos, dur, sid) {
    const key = pkey(kind, id);
    this._prog.items[key] = { pos: Math.floor(pos), dur: Math.floor(dur), done: dur > 0 && pos >= dur * 0.92 };
    this._api("POST", "progress", { kind, id, pos, dur, ...(sid ? { sid } : {}) }).catch(() => {});
  }

  async _pollEpg(channelId) {
    clearTimeout(this._epgTimer);
    const box = () => this._overlayRoot.getElementById("sc-epg");
    if (!this._now[channelId]) { return; }
    try {
      const { items } = await this._api("GET", "epg/" + encodeURIComponent(channelId));
      const now = Date.now() / 1000;
      const cur = items.find((i) => i.start <= now && now < i.stop) || items[0];
      const next = items.find((i) => i.start >= (cur?.stop || 0));
      if (box() && this._player?.id === channelId)
        box().textContent = cur ? `${hhmm(cur.start)} ${cur.title}${next ? ` · danach ${hhmm(next.start)} ${next.title}` : ""}` : "";
    } catch (_) { /* EPG is optional */ }
    if (this._player?.id === channelId) this._epgTimer = setTimeout(() => this._pollEpg(channelId), EPG_REFRESH_MS);
  }

  _teardownVideo() {
    clearTimeout(this._epgTimer);
    if (this._hls) { this._hls.destroy(); this._hls = null; }
    const v = this._overlayRoot?.querySelector("video");
    if (v) { v.pause(); v.removeAttribute("src"); v.load?.(); }
  }

  _closePlayer() {
    const p = this._player;
    if (!p) return;
    this._flushReport();
    this._teardownVideo();
    this._player = null;
    this._dragging = false;
    if (p.session && this._hass) this._api("POST", "stop", { session: p.session }).catch(() => {});
    if (this._playerDialog?.open) this._playerDialog.close();
    this._renderPlayer();
    if (p.kind !== "live") setTimeout(() => this._loadProgress(), 600); // let the last report arrive first
    this._render();
  }
}

customElements.define(CARD_TAG, StalkerCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: "Stalker Card",
  description: "Live-TV, Programm, Filme und Serien aus einem Stalker-Portal",
  preview: false,
  documentationURL: "https://github.com/hypersonic30/ha-stalker-card",
});
console.info(`%c STALKER-CARD %c ${CARD_VERSION} `, "color:white;background:#0a84ff;font-weight:700", "color:#0a84ff"); // eslint-disable-line no-console
