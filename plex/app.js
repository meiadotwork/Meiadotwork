// Plex Downloader — sign in with Plex, pick a server, browse movies and shows,
// and download the original video files to this device. No server of our own:
// the browser talks straight to plex.tv and to your Plex Media Server.
"use strict";

const PRODUCT = "Meia Plex Downloader";
const VERSION = "1.0";

// ---------- small helpers ----------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}

const clientId = store.get("plexdl.clientId") || uuid();
store.set("plexdl.clientId", clientId);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const $main = document.getElementById("main");
const $title = document.getElementById("title");
const $back = document.getElementById("back");
const $signout = document.getElementById("signout");
const $toast = document.getElementById("toast");

let toastTimer;
function toast(msg, ms = 3500) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), ms);
}

function fmtBytes(b) {
  if (!b) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i >= 3 ? 2 : i ? 1 : 0)} ${u[i]}`;
}

function fmtDuration(ms) {
  if (!ms) return "";
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function baseName(path) {
  return (path || "").split(/[\\/]/).pop();
}

function plexHeaders(token) {
  const h = {
    Accept: "application/json",
    "X-Plex-Product": PRODUCT,
    "X-Plex-Version": VERSION,
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Platform": "Web",
    "X-Plex-Device-Name": PRODUCT,
  };
  if (token) h["X-Plex-Token"] = token;
  return h;
}

async function http(url, { token, method = "GET", timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers: plexHeaders(token), signal: ctl.signal });
    if (res.status === 401) throw new Error("Plex refused the sign-in (401). Sign in again.");
    if (!res.ok) throw new Error(`Plex answered ${res.status} ${res.statusText}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(t);
  }
}

// ---------- app state ----------

const state = {
  userToken: store.get("plexdl.userToken"),
  server: JSON.parse(store.get("plexdl.server") || "null"), // { name, uri, token }
  stack: [], // views: functions that render into $main
};

function saveServer(s) {
  state.server = s;
  if (s) store.set("plexdl.server", JSON.stringify(s));
  else store.del("plexdl.server");
}

function pms(path) {
  return http(state.server.uri + path, { token: state.server.token });
}

function mediaUrl(path, extra = {}) {
  const q = new URLSearchParams({ ...extra, "X-Plex-Token": state.server.token });
  return `${state.server.uri}${path}${path.includes("?") ? "&" : "?"}${q}`;
}

function thumbUrl(thumb, w = 240, h = 360) {
  if (!thumb) return null;
  return mediaUrl("/photo/:/transcode", { width: w, height: h, minSize: 1, upscale: 1, url: thumb });
}

function downloadUrl(part) {
  return mediaUrl(part.key, { download: 1 });
}

// ---------- navigation ----------

function go(view) {
  state.stack.push(view);
  render();
  window.scrollTo(0, 0);
}
function back() {
  if (state.stack.length > 1) state.stack.pop();
  render();
}
function reset(view) {
  state.stack = [view];
  render();
}

async function render() {
  const view = state.stack[state.stack.length - 1];
  $back.hidden = state.stack.length <= 1;
  $signout.hidden = !state.userToken && !state.server;
  $main.replaceChildren(el("div", { class: "spinner" }));
  try {
    const out = await view();
    if (state.stack[state.stack.length - 1] !== view) return; // user moved on
    $main.replaceChildren(...[].concat(out));
  } catch (err) {
    console.error(err);
    $main.replaceChildren(
      el("div", { class: "card" },
        el("h2", {}, "Something went wrong"),
        el("p", { class: "error" }, friendlyError(err)),
        el("div", { class: "actions" },
          el("button", { onclick: render }, "Try again"),
          el("button", { class: "ghost", onclick: () => reset(startView) }, "Start over"))));
  }
}

function friendlyError(err) {
  if (err.name === "AbortError") return "The server took too long to answer. Is it switched on and reachable from this device?";
  if (err instanceof TypeError) return "Could not reach the server. If you typed an http:// address, this page needs an https:// one (see the help below the sign-in button).";
  return err.message || String(err);
}

$back.addEventListener("click", back);
$signout.addEventListener("click", () => {
  state.userToken = null;
  store.del("plexdl.userToken");
  saveServer(null);
  reset(loginView);
});

// ---------- views ----------

function startView() {
  if (state.server) return librariesView();
  if (state.userToken) return serversView();
  return loginView();
}

function loginView() {
  $title.textContent = "Plex Downloader";
  const status = el("p", { class: "muted small-text" });
  const signBtn = el("button", { onclick: () => signIn(signBtn, status) }, "Sign in with Plex");

  const urlIn = el("input", { type: "url", placeholder: "https://192-168-1-20.abc123.plex.direct:32400", autocomplete: "off" });
  const tokIn = el("input", { type: "password", placeholder: "X-Plex-Token", autocomplete: "off" });
  const manualErr = el("p", { class: "error small-text" });

  async function manual() {
    manualErr.textContent = "";
    const uri = urlIn.value.trim().replace(/\/+$/, "");
    const token = tokIn.value.trim();
    if (!uri || !token) { manualErr.textContent = "Fill in both the address and the token."; return; }
    if (location.protocol === "https:" && uri.startsWith("http:")) {
      manualErr.textContent = "Browsers block http:// servers from an https:// page. Use the server's https://…plex.direct address, or just use “Sign in with Plex”.";
      return;
    }
    try {
      const id = await http(uri + "/identity", { token, timeout: 8000 });
      const name = id.MediaContainer?.friendlyName || "My Plex server";
      saveServer({ name, uri, token });
      reset(librariesView);
    } catch (e) {
      manualErr.textContent = friendlyError(e);
    }
  }

  return el("div", {},
    el("div", { class: "card" },
      el("h2", {}, "Download your Plex videos"),
      el("p", { class: "muted" },
        "Sign in with your Plex account, pick your server, and save movies and episodes to this phone or computer as the original files — full quality, no conversion."),
      el("div", { class: "actions" }, signBtn),
      status),
    el("div", { class: "card" },
      el("details", {},
        el("summary", {}, "Connect with an address and token instead"),
        el("label", {}, "Server address"), urlIn,
        el("label", {}, "Plex token"), tokIn,
        el("div", { class: "actions" }, el("button", { onclick: manual }, "Connect")),
        manualErr)),
    el("div", { class: "card small-text muted" },
      el("p", {}, el("strong", {}, "Good to know")),
      el("ul", {},
        el("li", {}, "Your sign-in stays on this device. Nothing passes through any other server."),
        el("li", {}, "On iPhone/iPad, downloads land in the Files app → Downloads. On Android, in Downloads."),
        el("li", {}, "If you are browsing a server someone shared with you, its owner has to allow downloads for your account."),
        el("li", {}, "Big files download fastest on the same Wi-Fi as the server."))));
}

async function signIn(btn, status) {
  // Open the window right away, inside the tap, so the browser doesn't block it.
  const win = window.open("about:blank", "_blank");
  btn.disabled = true;
  status.textContent = "Starting sign-in…";
  try {
    const pin = await http("https://plex.tv/api/v2/pins?strong=true", { method: "POST" });
    const authUrl = "https://app.plex.tv/auth#?" + new URLSearchParams({
      clientID: clientId,
      code: pin.code,
      "context[device][product]": PRODUCT,
    });
    if (win) win.location.href = authUrl;
    status.replaceChildren(
      "Finish signing in on the Plex page, then come back here. ",
      win ? "" : el("a", { href: authUrl, target: "_blank", rel: "noopener" }, "Open the Plex sign-in page"));

    const until = Date.now() + 5 * 60 * 1000;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 2000));
      const p = await http(`https://plex.tv/api/v2/pins/${pin.id}`);
      if (p.authToken) {
        state.userToken = p.authToken;
        store.set("plexdl.userToken", p.authToken);
        try { win && win.close(); } catch {}
        reset(serversView);
        return;
      }
    }
    status.textContent = "Sign-in timed out. Tap the button to try again.";
  } catch (e) {
    try { win && win.close(); } catch {}
    status.textContent = friendlyError(e);
  } finally {
    btn.disabled = false;
  }
}

async function serversView() {
  $title.textContent = "Your servers";
  const resources = await http("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", { token: state.userToken });
  const servers = resources.filter(r => (r.provides || "").split(",").includes("server"));
  if (!servers.length) {
    return el("div", { class: "card" },
      el("h2", {}, "No servers found"),
      el("p", { class: "muted" }, "This Plex account has no Plex Media Server and nothing shared with it."));
  }
  servers.sort((a, b) => (b.owned - a.owned) || (b.presence - a.presence));

  return el("div", { class: "list" }, servers.map(s => {
    const note = el("div", { class: "muted small-text" },
      [s.owned ? "Yours" : `Shared by ${s.sourceTitle || "a friend"}`, s.presence ? "online" : "offline"].join(" · "));
    const row = el("button", {
      class: "row",
      onclick: async () => {
        row.disabled = true;
        note.textContent = "Finding the fastest connection…";
        try {
          const uri = await pickConnection(s);
          saveServer({ name: s.name, uri, token: s.accessToken || state.userToken });
          go(librariesView);
        } catch (e) {
          note.textContent = e.message;
          note.className = "error small-text";
          row.disabled = false;
        }
      },
    }, el("div", { class: "grow" }, el("div", { class: "name" }, s.name), note), "›");
    return row;
  }));
}

// Try every way of reaching the server at once and keep the first that answers.
// Relay connections are capped at a few Mbit/s, so they are only a last resort.
async function pickConnection(server) {
  const pageHttps = location.protocol === "https:";
  const conns = (server.connections || []).filter(c => !pageHttps || c.protocol === "https");
  const token = server.accessToken || state.userToken;
  const probe = c => http(c.uri + "/identity", { token, timeout: 6000 }).then(() => c.uri);

  const direct = conns.filter(c => !c.relay);
  const relay = conns.filter(c => c.relay);
  try {
    if (direct.length) return await Promise.any(direct.map(probe));
  } catch {}
  try {
    if (relay.length) {
      const uri = await Promise.any(relay.map(probe));
      toast("Connected through Plex Relay — downloads will be slow. Turn on Remote Access in Plex for full speed.", 7000);
      return uri;
    }
  } catch {}
  throw new Error("Couldn't reach this server from here. Check that it's on and that Remote Access is enabled in Plex settings.");
}

async function librariesView() {
  $title.textContent = state.server.name;
  const data = await pms("/library/sections");
  const libs = (data.MediaContainer?.Directory || []).filter(d => d.type === "movie" || d.type === "show");
  const switchBtn = state.userToken
    ? el("button", { class: "ghost small", onclick: () => { saveServer(null); reset(serversView); } }, "Switch server")
    : null;
  if (!libs.length) {
    return el("div", { class: "card" }, el("h2", {}, "No video libraries"), el("p", { class: "muted" }, "This server has no Movies or TV Shows libraries."), switchBtn);
  }
  return [
    el("div", { class: "list" }, libs.map(l =>
      el("button", { class: "row", onclick: () => go(() => sectionView(l)) },
        el("div", { class: "grow" },
          el("div", { class: "name" }, l.title),
          el("div", { class: "muted small-text" }, l.type === "show" ? "TV shows" : "Movies & videos")),
        "›"))),
    switchBtn && el("div", { class: "actions" }, switchBtn),
  ];
}

async function sectionView(lib) {
  $title.textContent = lib.title;
  const data = await pms(`/library/sections/${lib.key}/all`);
  const items = data.MediaContainer?.Metadata || [];
  const grid = el("div", { class: "grid" });
  const search = el("input", { type: "search", class: "search", placeholder: `Search ${items.length} titles` });

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = q ? items.filter(i => i.title.toLowerCase().includes(q)) : items;
    grid.replaceChildren(...shown.map(item => {
      const img = thumbUrl(item.thumb);
      return el("button", {
        class: "tile",
        onclick: () => go(() => item.type === "show" ? showView(item) : itemView(item.ratingKey)),
      },
        img ? el("img", { src: img, loading: "lazy", alt: "" }) : el("div", { class: "noimg" }),
        el("div", { class: "t" }, item.title),
        el("div", { class: "y" }, item.year || ""));
    }));
  }
  search.addEventListener("input", draw);
  draw();
  return [search, grid];
}

async function showView(show) {
  $title.textContent = show.title;
  const data = await pms(`/library/metadata/${show.ratingKey}/children`);
  const seasons = data.MediaContainer?.Metadata || [];
  return el("div", { class: "list" }, seasons.map(s =>
    el("button", { class: "row", onclick: () => go(() => seasonView(show, s)) },
      el("div", { class: "grow" },
        el("div", { class: "name" }, s.title),
        el("div", { class: "muted small-text" }, `${s.leafCount || 0} episodes`)),
      "›")));
}

async function seasonView(show, season) {
  $title.textContent = `${show.title} · ${season.title}`;
  const data = await pms(`/library/metadata/${season.ratingKey}/children`);
  const eps = data.MediaContainer?.Metadata || [];
  const allParts = eps.flatMap(e => partsOf(e).slice(0, 1).map(p => ({ part: p, ep: e }))); // first version of each

  const totalSize = allParts.reduce((n, x) => n + (x.part.size || 0), 0);
  const allBtn = el("button", { onclick: () => downloadMany(allParts.map(x => x.part), allBtn) },
    `Download all ${allParts.length} (${fmtBytes(totalSize)})`);

  return [
    el("div", { class: "actions" }, allBtn),
    el("div", { class: "card" }, eps.map(ep => {
      const img = thumbUrl(ep.thumb, 320, 180);
      return el("div", { class: "file ep" },
        img ? el("img", { src: img, loading: "lazy", alt: "" }) : null,
        el("div", { class: "grow" },
          el("div", { class: "fname" }, `${ep.index != null ? ep.index + ". " : ""}${ep.title}`),
          el("div", { class: "muted small-text" }, fmtDuration(ep.duration)),
          partsOf(ep).map(p => fileRow(p, ep))));
    })),
  ];
}

async function itemView(ratingKey) {
  const data = await pms(`/library/metadata/${ratingKey}`);
  const item = data.MediaContainer?.Metadata?.[0];
  if (!item) throw new Error("This item is no longer on the server.");
  $title.textContent = item.title;
  const img = thumbUrl(item.thumb, 360, 540);
  const parts = partsOf(item);
  return el("div", { class: "card" },
    el("div", { class: "detail" },
      img ? el("img", { src: img, alt: "" }) : null,
      el("div", { class: "info" },
        el("h2", {}, item.title),
        el("p", { class: "muted" }, [item.year, fmtDuration(item.duration), item.contentRating].filter(Boolean).join(" · ")),
        item.summary ? el("p", { class: "small-text" }, item.summary) : null,
        parts.length ? parts.map(p => fileRow(p, item)) : el("p", { class: "muted" }, "No downloadable file found."))));
}

// Every file behind an item: a movie can have several versions (Media) and
// a long movie can be split into several files (Part).
function partsOf(item) {
  return (item.Media || []).flatMap(m => (m.Part || []).map(p => ({ ...p, media: m })));
}

function fileRow(part, item) {
  const m = part.media || {};
  const quality = [
    m.videoResolution && (/^\d+$/.test(m.videoResolution) ? m.videoResolution + "p" : m.videoResolution.toUpperCase()),
    m.videoCodec && m.videoCodec.toUpperCase(),
    (part.container || m.container || "").toUpperCase(),
    fmtBytes(part.size),
  ].filter(Boolean).join(" · ");
  const url = downloadUrl(part);
  const name = baseName(part.file) || `${item.title}.${part.container || "mp4"}`;

  return el("div", { class: "file" },
    el("div", { class: "meta" },
      el("div", { class: "fname" }, name),
      el("div", { class: "muted" }, quality)),
    el("a", { class: "btn small", href: url, download: name, rel: "noopener" }, "⬇ Download"),
    el("button", {
      class: "ghost small",
      onclick: async () => {
        try { await navigator.clipboard.writeText(url); toast("Link copied — paste it into a download manager."); }
        catch { prompt("Copy this link:", url); }
      },
    }, "Copy link"));
}

async function downloadMany(parts, btn) {
  btn.disabled = true;
  toast("Starting downloads… If the browser asks, allow multiple downloads.", 6000);
  for (let i = 0; i < parts.length; i++) {
    btn.textContent = `Starting ${i + 1} of ${parts.length}…`;
    const a = el("a", { href: downloadUrl(parts[i]), download: baseName(parts[i].file) || "" });
    document.body.append(a);
    a.click();
    a.remove();
    await new Promise(r => setTimeout(r, 1500));
  }
  btn.textContent = "All downloads started";
}

reset(startView);
