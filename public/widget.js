(function () {
  const DEFAULT_PLAYLIST = [];

  const state = {
    playlist: [],
    index: 0,
    playing: false,
    compact: false,
    player: null,
    spotifyFrame: null,
    ytMessageHandler: null,
    room: "",
    hubUrl: "",
    sync: false,
    version: "",
    pollTimer: 0,
    desiredSeek: 0
  };

  function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (_) {
      try {
        return JSON.parse(decodeURIComponent(value));
      } catch (__) {
        return fallback;
      }
    }
  }

  function normalizeTrack(track) {
    const provider = (track.provider || detectProvider(track.url) || "youtube").toLowerCase();
    const id = track.id || extractId(track.url, provider);
    return {
      title: track.title || track.url || "Untitled track",
      provider,
      id,
      url: track.url || buildUrl(provider, id),
      author: track.author || "",
      thumbnail: track.thumbnail || ""
    };
  }

  function detectProvider(url) {
    if (!url) return "";
    if (/youtu\.be|youtube\.com/i.test(url)) return "youtube";
    if (/spotify\.com/i.test(url)) return "spotify";
    return "";
  }

  function extractId(url, provider) {
    if (!url) return "";
    if (provider === "youtube") {
      const shortMatch = url.match(/youtu\.be\/([^?&#/]+)/i);
      if (shortMatch) return shortMatch[1];
      const watchMatch = url.match(/[?&]v=([^?&#]+)/i);
      if (watchMatch) return watchMatch[1];
      const embedMatch = url.match(/youtube\.com\/embed\/([^?&#/]+)/i);
      if (embedMatch) return embedMatch[1];
    }
    if (provider === "spotify") {
      const match = url.match(/spotify\.com\/(track|episode|playlist|album)\/([^?&#/]+)/i);
      return match ? `${match[1]}:${match[2]}` : "";
    }
    return "";
  }

  function buildUrl(provider, id) {
    if (provider === "youtube") return `https://www.youtube.com/watch?v=${id}`;
    if (provider === "spotify") {
      const parts = String(id || "").split(":");
      return parts.length === 2 ? `https://open.spotify.com/${parts[0]}/${parts[1]}` : "";
    }
    return "";
  }

  function trackLabel(track) {
    if (!track) return "Untitled track";
    if (track.author && !String(track.title || "").toLowerCase().includes(String(track.author).toLowerCase())) {
      return `${track.title} - ${track.author}`;
    }
    return track.title || track.url || "Untitled track";
  }

  function createPlayer(options) {
    const mount = document.createElement("div");
    mount.className = "r96-widget";
    mount.innerHTML = `
      <style>
        .r96-widget {
          position: fixed;
          left: var(--r96-left, 22px);
          top: var(--r96-top, 92px);
          z-index: 2147483000;
          width: 264px;
          color: #000;
          font-family: "MS Sans Serif", Tahoma, Verdana, Arial, sans-serif;
          user-select: none;
          filter: drop-shadow(4px 4px 0 rgba(0, 0, 0, .45));
        }
        .r96-shell {
          overflow: hidden;
          border: 2px solid #c0c0c0;
          border-right-color: #404040;
          border-bottom-color: #404040;
          border-radius: 0;
          background: #c0c0c0;
          box-shadow: inset 1px 1px 0 #fff, inset -1px -1px 0 #808080;
        }
        .r96-topbar {
          display: grid;
          grid-template-columns: 10px 1fr auto auto;
          gap: 4px;
          align-items: center;
          margin: 2px;
          padding: 3px 4px;
          cursor: grab;
          background: linear-gradient(90deg, #000080, #1084d0);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: none;
        }
        .r96-grip {
          width: 8px;
          height: 12px;
          background: repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 3px);
          opacity: .75;
        }
        .r96-mini {
          width: 18px;
          height: 16px;
          border: 1px solid #808080;
          border-top-color: #fff;
          border-left-color: #fff;
          border-radius: 0;
          padding: 0;
          color: #000;
          background: #c0c0c0;
          cursor: pointer;
          font: 700 11px/1 "MS Sans Serif", Tahoma, sans-serif;
        }
        .r96-marquee {
          overflow: hidden;
          white-space: nowrap;
          margin: 3px 4px;
          border: 2px solid #808080;
          border-right-color: #fff;
          border-bottom-color: #fff;
          background: #000;
          color: #39ff14;
          font: 12px/1.1 Consolas, "Courier New", monospace;
        }
        .r96-marquee span {
          display: inline-block;
          min-width: 100%;
          padding: 4px 0;
          animation: r96-scroll 15s linear infinite;
        }
        @keyframes r96-scroll {
          from { transform: translateX(100%); }
          to { transform: translateX(-100%); }
        }
        .r96-controls {
          display: grid;
          grid-template-columns: 34px 52px 34px 38px 38px;
          gap: 3px;
          padding: 3px 4px 4px;
        }
        .r96-button {
          min-height: 22px;
          border: 1px solid #808080;
          border-top-color: #fff;
          border-left-color: #fff;
          border-radius: 0;
          padding: 2px 3px;
          background: #c0c0c0;
          color: #000;
          cursor: pointer;
          font: 700 11px/1 "MS Sans Serif", Tahoma, sans-serif;
          box-shadow: inset 1px 1px 0 #dfdfdf, inset -1px -1px 0 #404040;
        }
        .r96-button:hover,
        .r96-mini:hover {
          background: #d8d8d8;
        }
        .r96-button:active,
        .r96-mini:active {
          border-color: #404040;
          border-top-color: #808080;
          border-left-color: #808080;
          box-shadow: inset 1px 1px 0 #404040;
        }
        .r96-stage {
          display: grid;
          grid-template-columns: 88px 1fr;
          gap: 5px;
          align-items: center;
          padding: 0 4px 4px;
        }
        .r96-widget.r96-playing-media .r96-stage { grid-template-columns: 1fr; }
        .r96-widget.r96-playing-media .r96-screen { height: 200px; width: 100%; }
        .r96-widget.r96-playing-media .r96-screen iframe,
        .r96-widget.r96-playing-media .r96-screen div { width: 100%; height: 200px; }
        .r96-screen img { width: 100%; height: 100%; object-fit: cover; }
        .r96-screen .r96-empty-art { display: grid; place-items: center; height: 100%; font-size: 22px; color: #52ff82; }
        .r96-widget.r96-playing-media .r96-meta { padding: 3px 1px; }

        .r96-screen {
          overflow: hidden;
          height: 50px;
          border: 2px solid #808080;
          border-right-color: #fff;
          border-bottom-color: #fff;
          border-radius: 0;
          background: #050510;
        }
        .r96-screen iframe,
        .r96-screen div {
          width: 88px;
          height: 50px;
        }
        .r96-meta {
          min-width: 0;
          font-size: 11px;
          line-height: 1.25;
          color: #000;
        }
        .r96-provider {
          display: inline-block;
          margin-bottom: 2px;
          border: 1px solid #808080;
          padding: 1px 4px;
          background: #e8e8e8;
          color: #000080;
          font-size: 10px;
          text-transform: uppercase;
        }
        .r96-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 800;
        }
        .r96-author {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #202020;
          font-size: 10px;
        }
        .r96-open {
          color: #000080;
          font-size: 10px;
        }
        .r96-widget.r96-compact {
          width: 210px;
        }
        .r96-widget.r96-compact .r96-stage {
          display: none;
        }
        .r96-widget.r96-compact .r96-controls {
          grid-template-columns: 34px 52px 34px;
        }
        .r96-widget.r96-compact .r96-extra {
          display: none;
        }
        @media (max-width: 560px) {
          .r96-widget {
            left: 10px;
            right: 10px;
            top: auto;
            bottom: 12px;
            width: auto;
          }
        }
      </style>
      <div class="r96-shell">
        <div class="r96-topbar" data-drag>
          <span class="r96-grip" aria-hidden="true"></span>
          <span>Retro 96 Radio</span>
          <button class="r96-mini" type="button" data-minimize aria-label="Minimize player">_</button>
          <button class="r96-mini" type="button" data-close aria-label="Close player">x</button>
        </div>
        <div class="r96-marquee"><span data-marquee>Loading mixtape...</span></div>
        <div class="r96-controls">
          <button class="r96-button" type="button" data-prev aria-label="Previous track">&lt;&lt;</button>
          <button class="r96-button" type="button" data-play aria-label="Play or pause">Play</button>
          <button class="r96-button" type="button" data-next aria-label="Next track">&gt;&gt;</button>
          <button class="r96-button r96-extra" type="button" data-shuffle aria-label="Shuffle">Mix</button>
          <button class="r96-button r96-extra" type="button" data-pop aria-label="Open track">Pop</button>
        </div>
        <div class="r96-stage">
          <div class="r96-screen" data-screen></div>
          <div class="r96-meta">
            <span class="r96-provider" data-provider>Source</span>
            <div class="r96-title" data-title>Track title</div>
            <div class="r96-author" data-author></div>
            <a class="r96-open" data-link target="_blank" rel="noopener">open original</a>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(mount);
    state.playlist = (options.playlist || DEFAULT_PLAYLIST).map(normalizeTrack).filter((track) => track.id || track.url);
    // An empty published room must not display a demo video that is not in the queue.
    state.index = Math.min(Math.max(Number(options.startIndex || 0), 0), state.playlist.length - 1);
    state.room = options.room || "";
    state.hubUrl = options.hubUrl || "";
    state.sync = Boolean(options.sync && state.room && state.hubUrl);

    bindControls(mount);
    renderTrack(mount);
    makeDraggable(mount);
    startRoomSync(mount);
    return mount;
  }

  function currentTrack() {
    return state.playlist[state.index] || state.playlist[0];
  }

  function renderTrack(root) {
    const track = currentTrack();
    const screen = root.querySelector("[data-screen]");
    const marquee = root.querySelector("[data-marquee]");
    const provider = root.querySelector("[data-provider]");
    const title = root.querySelector("[data-title]");
    const author = root.querySelector("[data-author]");
    const link = root.querySelector("[data-link]");
    const play = root.querySelector("[data-play]");

    // A previous YouTube frame may have registered for postMessage events.
    if (state.ytMessageHandler) {
      window.removeEventListener("message", state.ytMessageHandler);
      state.ytMessageHandler = null;
    }
    screen.innerHTML = "";
    state.player = null;
    state.spotifyFrame = null;
    root.classList.toggle("r96-playing-media", Boolean(track && state.playing));
    for (const action of ["data-play", "data-prev", "data-next", "data-shuffle", "data-pop"]) {
      root.querySelector(`[${action}]`).disabled = !track;
    }
    if (!track) {
      marquee.textContent = "No songs published to Retro 96";
      provider.textContent = "EMPTY";
      title.textContent = "Mixtap queue is empty";
      author.textContent = "Publish songs from Mixtap Hub";
      author.hidden = false;
      link.href = state.hubUrl || "https://mixtap.ljas.ca";
      link.textContent = "open Mixtap Hub";
      play.textContent = "Play";
      screen.innerHTML = '<span class="r96-empty-art" aria-hidden="true">♫</span>';
      return;
    }
    marquee.textContent = `${state.playing ? "Playing" : "Ready"}: ${trackLabel(track)}`;
    provider.textContent = track.provider;
    title.textContent = track.title;
    author.textContent = track.author || "";
    author.hidden = !track.author;
    link.href = track.url || "#";
    link.textContent = "open original";
    play.textContent = state.playing ? "Pause" : "Play";

    // Only create provider frames after Play. Tiny 88x50 iframe players can fail;
    // active YouTube/Spotify players get a >=200x200 visible media surface.
    if (!state.playing) {
      const cover = track.thumbnail || (track.provider === "youtube" && track.id
        ? `https://i.ytimg.com/vi/${encodeURIComponent(track.id)}/hqdefault.jpg` : "");
      if (cover) {
        const img = document.createElement("img");
        img.src = cover;
        img.alt = "Track thumbnail";
        img.loading = "lazy";
        screen.appendChild(img);
      } else {
        screen.innerHTML = '<span class="r96-empty-art" aria-hidden="true">♫</span>';
      }
      return;
    }

    if (track.provider === "spotify") {
      const parts = String(track.id || "").split(":");
      const iframe = document.createElement("iframe");
      iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      // Retro Room keeps cross-origin isolation for its emulator. An isolated
      // document can only show third-party frames via credentialless iframes.
      if (window.crossOriginIsolated) iframe.setAttribute("credentialless", "");
      iframe.loading = "eager";
      iframe.src = parts.length === 2 ? `https://open.spotify.com/embed/${parts[0]}/${parts[1]}` : track.url;
      iframe.title = track.title;
      iframe.frameBorder = "0";
      screen.appendChild(iframe);
      state.spotifyFrame = iframe;
      return;
    }

    // Avoid www.youtube.com/iframe_api here. That third-party script can be
    // blocked by Retro Room's COEP require-corp header. Use YouTube's normal
    // embed URL and its optional postMessage player protocol instead.
    const iframe = document.createElement("iframe");
    iframe.id = `r96-yt-${Date.now()}`;
    iframe.title = `YouTube: ${track.title}`;
    iframe.width = "224";
    iframe.height = "200";
    iframe.frameBorder = "0";
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    iframe.loading = "eager";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    // On Chromium this lets a COEP-isolated Retro Room embed YouTube while
    // keeping SharedArrayBuffer and game emulation security enabled.
    if (window.crossOriginIsolated) iframe.setAttribute("credentialless", "");
    const validId = /^[a-zA-Z0-9_-]{11}$/.test(String(track.id || ""));
    if (!validId) {
      screen.textContent = "This YouTube link could not be embedded. Open the original link below.";
      state.playing = false;
      root.querySelector("[data-play]").textContent = "Play";
      return;
    }
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${track.id}`);
    embed.searchParams.set("autoplay", "1");
    embed.searchParams.set("controls", "1"); // Fallback if browser blocks audible autoplay.
    embed.searchParams.set("playsinline", "1");
    embed.searchParams.set("enablejsapi", "1");
    if (window.location.origin && window.location.origin !== "null") {
      embed.searchParams.set("origin", window.location.origin);
    }
    const seek = Math.max(0, Math.floor(Number(state.desiredSeek) || 0));
    if (seek) embed.searchParams.set("start", String(seek));
    iframe.src = embed.toString();
    screen.appendChild(iframe);
    state.player = iframe;

    // The iframe still has its native YouTube Play button. The listener adds
    // auto-next and readable errors when YouTube sends an API event.
    state.ytMessageHandler = function (event) {
      if (event.source !== iframe.contentWindow ||
          !["https://www.youtube.com", "https://www.youtube-nocookie.com"].includes(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) { return; }
      }
      if (!payload || typeof payload !== "object") return;
      if (payload.event === "onStateChange" && Number(payload.info) === 0) next(root);
      if (payload.event === "onError") {
        const code = Number(payload.info);
        let reason = "YouTube couldn't play this video inside Retro Room.";
        if (code === 101 || code === 150) reason = "The video owner has disabled embedded playback.";
        if (code === 153) reason = "YouTube rejected the embedded player identification.";
        screen.textContent = `${reason} Open the original link below.`;
        state.playing = false;
        root.querySelector("[data-play]").textContent = "Play";
        state.player = null;
      }
    };
    window.addEventListener("message", state.ytMessageHandler);
    iframe.addEventListener("load", () => {
      if (!iframe.isConnected) return;
      // Register for state/error notifications without downloading iframe_api.
      iframe.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: iframe.id }),
        "https://www.youtube-nocookie.com");
    });
  }

  function playPause(root) {
    if (!currentTrack()) return;
    state.playing = !state.playing;
    renderTrack(root);
  }

  function renderLabels(root) {
    const track = currentTrack();
    root.querySelector("[data-play]").textContent = state.playing ? "Pause" : "Play";
    root.querySelector("[data-marquee]").textContent = `${state.playing ? "Playing" : "Ready"}: ${trackLabel(track)}`;
  }

  function prev(root) {
    if (!state.playlist.length) return;
    state.index = (state.index - 1 + state.playlist.length) % state.playlist.length;
    renderTrack(root);
  }

  function next(root) {
    if (!state.playlist.length) return;
    state.index = (state.index + 1) % state.playlist.length;
    renderTrack(root);
  }

  function shuffle(root) {
    if (state.playlist.length < 2) return;
    let nextIndex = state.index;
    while (nextIndex === state.index) {
      nextIndex = Math.floor(Math.random() * state.playlist.length);
    }
    state.index = nextIndex;
    renderTrack(root);
  }

  function bindControls(root) {
    root.querySelector("[data-play]").addEventListener("click", () => playPause(root));
    root.querySelector("[data-prev]").addEventListener("click", () => prev(root));
    root.querySelector("[data-next]").addEventListener("click", () => next(root));
    root.querySelector("[data-shuffle]").addEventListener("click", () => shuffle(root));
    root.querySelector("[data-pop]").addEventListener("click", () => window.open(currentTrack().url, "_blank", "noopener"));
    root.querySelector("[data-minimize]").addEventListener("click", () => {
      state.compact = !state.compact;
      root.classList.toggle("r96-compact", state.compact);
    });
    root.querySelector("[data-close]").addEventListener("click", () => root.remove());
  }

  function makeDraggable(root) {
    const handle = root.querySelector("[data-drag]");
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let dragging = false;

    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = root.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const nextX = Math.max(6, Math.min(window.innerWidth - root.offsetWidth - 6, originX + event.clientX - startX));
      const nextY = Math.max(6, Math.min(window.innerHeight - root.offsetHeight - 6, originY + event.clientY - startY));
      root.style.left = `${nextX}px`;
      root.style.top = `${nextY}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    });

    handle.addEventListener("pointerup", () => {
      dragging = false;
    });
  }

  function boot() {
    const script = document.currentScript || document.querySelector("script[data-retro96-player]");
    if (script && script.dataset.skipAuto === "true") return;
    const playlist = parseJson(script && script.dataset.playlist, DEFAULT_PLAYLIST);
    const startIndex = script && script.dataset.startIndex;
    const room = script && script.dataset.room;
    const hubUrl = script && script.dataset.hubUrl;
    const sync = script && script.dataset.sync === "true";
    createPlayer({ playlist, startIndex, room, hubUrl, sync });
  }

  function roomEndpoint() {
    const base = state.hubUrl.replace(/\/+$/, "");
    return `${base}/api/rooms/${encodeURIComponent(state.room)}`;
  }

  function startRoomSync(root) {
    if (!state.sync) return;
    window.clearInterval(state.pollTimer);
    fetchRoom(root);
    state.pollTimer = window.setInterval(() => fetchRoom(root), 2500);
  }

  async function fetchRoom(root) {
    try {
      const response = await fetch(roomEndpoint(), { cache: "no-store" });
      if (!response.ok) return;
      const roomState = await response.json();
      applyRoomState(root, roomState);
    } catch (_) {
      renderLabels(root);
    }
  }

  function applyRoomState(root, roomState) {
    if (!roomState || roomState.version === state.version) return;
    const incoming = Array.isArray(roomState.playlist) ? roomState.playlist.map(normalizeTrack).filter((track) => track.id || track.url) : [];
    state.playlist = incoming; // Explicitly reflect empty published rooms, too.
    state.index = Math.min(Math.max(Number(roomState.index || 0), 0), state.playlist.length - 1);
    state.playing = Boolean(roomState.playing);
    state.version = roomState.version || String(Date.now());
    state.desiredSeek = calculateSeek(roomState);
    renderTrack(root);
  }

  function calculateSeek(roomState) {
    if (!roomState.playing) return Number(roomState.position || 0);
    const startedAt = Number(roomState.startedAt || 0);
    const position = Number(roomState.position || 0);
    if (!startedAt) return position;
    return Math.max(0, position + ((Date.now() - startedAt) / 1000));
  }

  window.Retro96Player = {
    create: createPlayer,
    next: function () {
      const root = document.querySelector(".r96-widget");
      if (root) next(root);
    },
    previous: function () {
      const root = document.querySelector(".r96-widget");
      if (root) prev(root);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
