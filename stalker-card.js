/* Stalker Card – Live-TV, Filme und Serien aus einem Stalker-Portal (Integration "stalker"). */
const CARD_VERSION = "0.1.0";
const CARD_TAG = "stalker-card";
const HLS_URL = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js";
const PAGE = 60; // Filme je Seite (Server)
const SHOW_STEP = 80; // Kanäle/Serien je "Mehr"
const SEEK_DEBOUNCE_MS = 350;
const EPG_REFRESH_MS = 60000;

const ERRORS = {
  video_codec_unsupported: "Dieses Video nutzt einen Codec, den Home Assistant nicht ohne Neukodierung abspielen kann.",
  stream_timeout: "Der Stream hat nicht rechtzeitig gestartet. Das Portal erlaubt evtl. nur einen Stream gleichzeitig.",
  stream_failed: "Der Stream konnte nicht geöffnet werden.",
  probe_timeout: "Das Portal antwortet zu langsam.",
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
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

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
:host{display:block}
ha-card{overflow:hidden;position:relative}
.top{display:flex;align-items:center;gap:8px;padding:12px 16px 0}
.top h2{margin:0;font-size:18px;font-weight:500;flex:1}
.tabs{display:flex;gap:6px;padding:8px 16px}
.tab{border:0;border-radius:18px;padding:7px 14px;background:var(--secondary-background-color);color:var(--primary-text-color);cursor:pointer;font:inherit}
.tab[aria-selected=true]{background:var(--primary-color);color:var(--text-primary-color,#fff)}
.bar{display:flex;gap:8px;padding:0 16px 8px;flex-wrap:wrap}
.bar input,.bar select{flex:1;min-width:120px;padding:8px 10px;border-radius:10px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);font:inherit}
.list{padding:0 8px 8px;max-height:60vh;overflow:auto}
.row{display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px;cursor:pointer;border:0;background:none;width:100%;text-align:left;color:inherit;font:inherit}
.row:hover,.row.on{background:var(--secondary-background-color)}
.row img,.row .ph{width:44px;height:44px;object-fit:contain;border-radius:6px;background:var(--secondary-background-color);flex:none}
.row small{opacity:.6;display:block}
.num{opacity:.5;min-width:34px;text-align:right}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;padding:0 16px 8px}
.poster{border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left;padding:0}
.poster img,.poster .ph{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:8px;background:var(--secondary-background-color);display:block}
.poster span{display:block;font-size:12px;margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.more{display:block;margin:6px auto 12px;padding:8px 18px;border-radius:18px;border:0;background:var(--secondary-background-color);color:inherit;cursor:pointer;font:inherit}
.msg{padding:16px;opacity:.7}
.err{margin:8px 16px;padding:10px 12px;border-radius:10px;background:var(--error-color,#c33);color:#fff}
.back{margin:0 16px 8px;border:0;background:none;color:var(--primary-color);cursor:pointer;font:inherit;padding:0}
.season{padding:6px 16px;font-weight:500;opacity:.8}
#player{background:#000;position:relative}
#player[hidden]{display:none}
video{width:100%;max-height:60vh;display:block;background:#000}
.pbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--card-background-color)}
.pbar .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbar small{display:block;opacity:.7;overflow:hidden;text-overflow:ellipsis}
.pbar button{border:0;border-radius:50%;width:34px;height:34px;background:var(--secondary-background-color);color:inherit;cursor:pointer;flex:none}
.seek{display:flex;align-items:center;gap:8px;padding:0 12px 8px;background:var(--card-background-color)}
.seek input{flex:1}
.seek span{font-size:12px;opacity:.7;min-width:44px;text-align:center}
.spin{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(0,0,0,.5)}
`;

class StalkerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "live";
    this._info = null;
    this._live = null;
    this._genre = "";
    this._q = { live: "", vod: "", series: "" };
    this._show = SHOW_STEP;
    this._vod = { items: [], total: 0, page: 0, groups: [], group: "" };
    this._series = null;
    this._detail = null;
    this._player = null;
    this._error = "";
    this._hls = null;
    this._epgTimer = null;
    this._seekTo = debounce((v) => this._restartAt(v), SEEK_DEBOUNCE_MS);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this.isConnected) this._init();
  }
  get hass() { return this._hass; }
  setConfig(config) { this._config = { title: "Stalker TV", ...config }; if (this.isConnected) this._build(); }
  getCardSize() { return 8; }
  static getStubConfig() { return { title: "Stalker TV" }; }

  connectedCallback() {
    this._build();
    if (this._hass && !this._info) this._init();
  }
  disconnectedCallback() { this._closePlayer(); }

  // ── API ─────────────────────────────────────────────────────────────
  _api(method, path, body) { return this._hass.callApi(method, "stalker/" + path, body); }

  async _init() {
    try {
      this._info = await this._api("GET", "info");
      await this._loadTab();
    } catch (e) { this._error = errMessage(e); }
    this._render();
  }

  async _loadTab() {
    this._error = "";
    try {
      if (this._tab === "live" && !this._live) this._live = await this._api("GET", "live");
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

  // ── Layout (player stays; the body below is re-rendered) ─────────────
  _build() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
      <div class="top"><h2>${esc(this._config?.title || "Stalker TV")}</h2></div>
      <div id="player" hidden></div>
      <div id="tabs" class="tabs" role="tablist"></div>
      <div id="body"></div></ha-card>`;
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("input", (e) => this._onInput(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    this._render();
  }

  _render() {
    const root = this.shadowRoot;
    const tabs = root.getElementById("tabs");
    if (!tabs) return;
    const list = [["live", "Live-TV"]];
    if (this._info?.vod) list.push(["vod", "Filme"]);
    if (this._info?.series) list.push(["series", "Serien"]);
    tabs.innerHTML = list.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === this._tab}" data-action="tab" data-tab="${k}">${l}</button>`).join("");
    const body = root.getElementById("body");
    const keep = body.querySelector("input[data-q]");
    const hadFocus = keep && root.activeElement === keep;
    const pos = keep?.selectionStart;
    body.innerHTML = (this._error ? `<div class="err" role="alert">${esc(this._error)}</div>` : "") + this._bodyHtml();
    if (hadFocus) { const n = body.querySelector("input[data-q]"); n?.focus(); n?.setSelectionRange(pos, pos); }
  }

  _bodyHtml() {
    if (!this._info) return this._error ? "" : `<div class="msg">Lade …</div>`;
    if (this._tab === "live") return this._liveHtml();
    if (this._tab === "vod") return this._vodHtml();
    return this._seriesHtml();
  }

  _search(tab, placeholder) {
    return `<input data-q="${tab}" type="search" placeholder="${placeholder}" value="${esc(this._q[tab])}">`;
  }

  _liveHtml() {
    if (!this._live) return `<div class="msg">Lade Kanäle …</div>`;
    const q = this._q.live.toLowerCase();
    const all = this._live.channels.filter((c) => (!this._genre || c.genre_id === this._genre) && (!q || c.name.toLowerCase().includes(q)));
    const genres = this._live.genres.filter((g) => g.id !== "*");
    const rows = all.slice(0, this._show).map((c) => `<button class="row ${this._player?.id === c.id ? "on" : ""}" data-action="play" data-kind="live" data-id="${esc(c.id)}">
        ${c.logo ? `<img src="${esc(c.logo)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph'}))">` : `<div class="ph"></div>`}
        <span class="num">${esc(c.number ?? "")}</span><span>${esc(c.name)}${c.has_epg ? "" : ""}</span></button>`).join("");
    return `<div class="bar">${this._search("live", "Kanal suchen")}
      <select data-genre aria-label="Kategorie"><option value="">Alle Kategorien</option>${genres.map((g) => `<option value="${esc(g.id)}" ${g.id === this._genre ? "selected" : ""}>${esc(g.title)}</option>`).join("")}</select></div>
      <div class="list">${rows || `<div class="msg">Keine Kanäle gefunden.</div>`}
      ${all.length > this._show ? `<button class="more" data-action="more">Mehr (${all.length - this._show})</button>` : ""}</div>`;
  }

  _posters(items, kind) {
    return items.map((i) => `<button class="poster" data-action="${kind === "series" ? "series" : "play"}" data-kind="${kind}" data-id="${esc(i.id)}" data-title="${esc(i.title)}">
      ${i.logo ? `<img src="${esc(i.logo)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph'}))">` : `<div class="ph"></div>`}
      <span>${esc(i.title)}</span></button>`).join("");
  }

  _vodHtml() {
    const v = this._vod;
    if (!v.page) return `<div class="msg">Lade Filme …</div>`;
    return `<div class="bar">${this._search("vod", "Film suchen")}
      <select data-group aria-label="Kategorie"><option value="">Alle Kategorien</option>${v.groups.map((g) => `<option value="${esc(g)}" ${g === v.group ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
      <div class="grid">${this._posters(v.items, "vod") || `<div class="msg">Nichts gefunden.</div>`}</div>
      ${v.items.length < v.total ? `<button class="more" data-action="morevod">Mehr (${v.total - v.items.length})</button>` : ""}`;
  }

  _seriesHtml() {
    if (this._detail) {
      const d = this._detail;
      return `<button class="back" data-action="back">‹ Alle Serien</button><div class="season" style="font-size:16px">${esc(d.title)}</div>` +
        d.seasons.map((s) => `<div class="season">Staffel ${s.season}</div><div class="list" style="max-height:none">` +
          s.episodes.map((e) => `<button class="row ${this._player?.id === e.id ? "on" : ""}" data-action="play" data-kind="episode" data-id="${esc(e.id)}" data-title="${esc(d.title + " – Folge " + e.episode)}"><span class="num">${e.episode}</span><span>${esc(e.title)}</span></button>`).join("") + `</div>`).join("");
    }
    if (!this._series) return `<div class="msg">Lade Serien …</div>`;
    const q = this._q.series.toLowerCase();
    const items = this._series.filter((s) => !q || s.title.toLowerCase().includes(q));
    return `<div class="bar">${this._search("series", "Serie suchen")}</div><div class="grid">${this._posters(items, "series") || `<div class="msg">Keine Serien gefunden.</div>`}</div>`;
  }

  // ── Events ───────────────────────────────────────────────────────────
  _onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const fn = this["_a_" + el.dataset.action];
    if (fn) fn.call(this, el);
  }

  _onInput(e) {
    const t = e.target;
    if (t.dataset?.q) {
      this._q[t.dataset.q] = t.value;
      this._show = SHOW_STEP;
      if (t.dataset.q === "vod") this._searchVod(); else this._render();
    }
    if (t.dataset?.seek !== undefined) this._seekPreview(Number(t.value));
  }

  _onChange(e) {
    const t = e.target;
    if (t.dataset?.genre !== undefined) { this._genre = t.value; this._show = SHOW_STEP; this._render(); }
    if (t.dataset?.group !== undefined) { this._vod.group = t.value; this._searchVod(true); }
    if (t.dataset?.seek !== undefined) this._seekTo(Number(t.value));
  }

  _searchVod = debounce(async () => {
    try { await this._loadVod(true); } catch (e) { this._error = errMessage(e); }
    this._render();
  }, 300);

  async _a_tab(el) {
    this._tab = el.dataset.tab;
    this._detail = null;
    this._show = SHOW_STEP;
    this._render();
    await this._loadTab();
    this._render();
  }
  _a_more() { this._show += SHOW_STEP; this._render(); }
  async _a_morevod() {
    try { await this._loadVod(false); } catch (e) { this._error = errMessage(e); }
    this._render();
  }
  async _a_series(el) {
    try { this._detail = await this._api("GET", "series/" + encodeURIComponent(el.dataset.id)); } catch (e) { this._error = errMessage(e); }
    this._render();
  }
  _a_back() { this._detail = null; this._render(); }
  _a_play(el) {
    const name = el.dataset.title || el.querySelector("span:last-child")?.textContent || "";
    this._play(el.dataset.kind, el.dataset.id, name, 0);
  }
  _a_close() { this._closePlayer(); this._render(); }

  // ── Player ───────────────────────────────────────────────────────────
  async _play(kind, id, title, start) {
    this._error = "";
    this._teardownVideo();
    this._player = { kind, id, title, loading: true, start: start || 0 };
    this._renderPlayer();
    this._render();
    try {
      const r = await this._api("POST", "play", { kind, id, start: start || 0 });
      this._player = { ...this._player, session: r.session, url: r.url, live: r.live, duration: r.duration, start: r.start || 0, loading: false };
      this._renderPlayer();
      await this._attach(r.url);
      if (kind === "live") this._pollEpg(id);
    } catch (e) {
      this._error = errMessage(e);
      this._player = null;
      this._renderPlayer();
    }
    this._render();
  }

  async _attach(url) {
    const video = this.shadowRoot.querySelector("video");
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
    if (!p || p.loading) return;
    const now = Date.now();
    this._recoveries = (this._recoveries || []).filter((t) => now - t < 60000);
    if (this._recoveries.length >= 2) {
      this._error = "Wiedergabe unterbrochen.";
      this._closePlayer();
      this._render();
      return;
    }
    this._recoveries.push(now);
    const video = this.shadowRoot.querySelector("video");
    const pos = p.live === false ? p.start + (video?.currentTime || 0) : 0;
    this._play(p.kind, p.id, p.title, Math.floor(pos));
  }

  _renderPlayer() {
    const box = this.shadowRoot.getElementById("player");
    if (!box) return;
    const p = this._player;
    if (!p) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    const vod = p.live === false;
    box.innerHTML = `<video playsinline ${vod ? "" : "controls"} autoplay></video>
      ${p.loading ? `<div class="spin">Stream startet …</div>` : ""}
      <div class="pbar"><div class="t">${esc(p.title)}<small id="epg"></small></div>
        ${vod ? `<button data-action="toggle" aria-label="Pause/Weiter">⏯</button>` : ""}
        <button data-action="close" aria-label="Schließen">✕</button></div>
      ${vod && p.duration ? `<div class="seek"><span id="cur">${fmtTime(p.start)}</span>
        <input data-seek type="range" min="0" max="${Math.floor(p.duration)}" step="5" value="${Math.floor(p.start)}" aria-label="Position">
        <span>${fmtTime(p.duration)}</span></div>` : ""}`;
    const video = box.querySelector("video");
    if (vod) video.addEventListener("timeupdate", () => this._tick(video));
  }

  _tick(video) {
    const p = this._player;
    const slider = this.shadowRoot.querySelector("input[data-seek]");
    if (!p || !slider || this._dragging) return;
    const now = p.start + video.currentTime;
    slider.value = String(Math.floor(now));
    const cur = this.shadowRoot.getElementById("cur");
    if (cur) cur.textContent = fmtTime(now);
  }

  _seekPreview(v) {
    this._dragging = true;
    const cur = this.shadowRoot.getElementById("cur");
    if (cur) cur.textContent = fmtTime(v);
  }

  _a_toggle() {
    const v = this.shadowRoot.querySelector("video");
    if (v) v.paused ? v.play() : v.pause();
  }

  _restartAt(value) {
    this._dragging = false;
    const p = this._player;
    if (p) this._play(p.kind, p.id, p.title, value);
  }

  async _pollEpg(channelId) {
    clearTimeout(this._epgTimer);
    const ch = this._live?.channels.find((c) => c.id === channelId);
    const box = () => this.shadowRoot.getElementById("epg");
    if (!ch?.has_epg) { if (box()) box().textContent = ""; return; }
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
    const v = this.shadowRoot?.querySelector("video");
    if (v) { v.pause(); v.removeAttribute("src"); v.load?.(); }
  }

  _closePlayer() {
    this._teardownVideo();
    const p = this._player;
    this._player = null;
    this._dragging = false;
    if (p?.session && this._hass) this._api("POST", "stop", { session: p.session }).catch(() => {});
    this._renderPlayer();
  }
}

customElements.define(CARD_TAG, StalkerCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: "Stalker Card",
  description: "Live-TV, Filme und Serien aus einem Stalker-Portal",
  preview: false,
  documentationURL: "https://github.com/hypersonic30/ha-stalker-card",
});
console.info(`%c STALKER-CARD %c ${CARD_VERSION} `, "color:white;background:#0a84ff;font-weight:700", "color:#0a84ff"); // eslint-disable-line no-console
