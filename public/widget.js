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
    desiredSeek: 0,
    mode: "personal",
    listening: true,
    minimized: false,
    musicOnly: false,
    radioLocalPlaying: false,
    radioLocalSeek: 0,
    radioLocalStartedAt: 0,
    radioConnection: "connecting",
    radioState: null,
    radioVersion: "",
    radioEnded: false,
    localStartedAt: 0,
    dockedAt: 0
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
          animation: r96-scroll 36s linear infinite;
        }
        @keyframes r96-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-100%); }
        }
        .r96-modebar {
          display: grid;
          grid-template-columns: 1fr 1fr 1.1fr;
          gap: 3px;
          margin: 0 4px 3px;
        }
        .r96-modebar .r96-button { font-size: 10px; min-height: 22px; }
        .r96-modebar [aria-pressed="true"]:hover { background: #101070; color: #fff; }
        .r96-modebar [aria-pressed="true"] {
          background: #000080;
          color: white;
          border-color: #202060;
          box-shadow: inset 1px 1px #080840;
        }
        .r96-status {
          margin: 0 5px 3px;
          color: #343434;
          font: 10px/1.3 "MS Sans Serif", Tahoma, sans-serif;
        }
        .r96-marquee:hover span { animation-play-state: paused; }
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
        /* Music-only is an optional retro visual cover. The provider iframe
           remains mounted at normal size to preserve playback. */
        .r96-widget .r96-screen { position: relative; }
        .r96-music-curtain {
          position: absolute;
          inset: 0;
          z-index: 2;
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background: repeating-linear-gradient(0deg, #07100c 0 3px, #102017 3px 4px);
          box-shadow: inset 0 0 25px #000;
          color: #6cff9a;
          font: 700 13px/1.2 "Courier New", monospace;
          text-shadow: 0 0 6px #258a50;
          pointer-events: none;
        }
        .r96-widget.r96-music-only.r96-playing-media .r96-music-curtain { display: flex; }
        .r96-music-curtain small { color: #afffc8; font-size: 10px; letter-spacing: .16em; }
        .r96-widget.r96-playing-media .r96-screen .r96-eq { display: flex; width: auto; height: 44px; align-items: end; gap: 5px; }
        .r96-eq i { display: block; width: 12px; height: 15px; background: #46ff92;
          box-shadow: 0 0 5px #00a14b; animation: r96-eq-wave .9s ease-in-out infinite alternate; }
        .r96-eq i:nth-child(2) { animation-delay: -.3s; }
        .r96-eq i:nth-child(3) { animation-delay: -.6s; }
        .r96-eq i:nth-child(4) { animation-delay: -.2s; }
        .r96-eq i:nth-child(5) { animation-delay: -.5s; }
        @keyframes r96-eq-wave { from { height: 9px; } to { height: 39px; } }
        @media (prefers-reduced-motion: reduce) { .r96-eq i { animation: none; height: 19px; } }

        .r96-screen .r96-empty-art { display: grid; place-items: center; height: 100%; font-size: 22px; color: #52ff82; }
        /* Windows 95 radio display decorates inactive media only. */
        .r96-widget:not(.r96-playing-media) .r96-screen {
          background: repeating-linear-gradient(0deg, #030a0a 0 3px, #081710 3px 4px);
          box-shadow: inset 0 0 14px rgba(36, 255, 142, .14);
        }
        .r96-screen .r96-idle-radio-face {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          color: #76ffa8;
          font: bold 12px/1 "Courier New", monospace;
          letter-spacing: .02em;
          text-shadow: 0 0 5px #178743;
        }
        .r96-idle-radio-face span {
          font: 8px/1 "Courier New", monospace;
          color: #b4ffd0;
          letter-spacing: .08em;
        }
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
        .r96-widget.r96-compact { width: 238px; }
        .r96-widget.r96-compact:not(.r96-playing-media) .r96-stage { display: none; }
        .r96-widget.r96-compact .r96-extra { display: none; }
        .r96-widget.r96-compact .r96-controls { grid-template-columns: 34px 52px 34px; }
        /* YouTube playback must always retain a visible >=200x200 frame. */
        .r96-widget.r96-playing-media .r96-stage { display: grid; }
        .r96-widget.r96-playing-media .r96-screen iframe { min-width: 200px; min-height: 200px; }
        .r96-dock-button {
          display: none;
          width: 37px;
          height: 37px;
          border: 2px outset #fff;
          border-right-color: #555;
          border-bottom-color: #555;
          border-radius: 0;
          background: #c0c0c0;
          color: #000080;
          font-size: 20px;
          cursor: pointer;
          box-shadow: 3px 3px 0 rgba(0,0,0,.5);
        }
        .r96-widget.r96-docked {
          position: fixed !important;
          top: 10px !important;
          left: 10px !important;
          right: auto !important;
          bottom: auto !important;
          width: 37px !important;
        }
        .r96-widget.r96-docked .r96-shell { display: none; }
        .r96-widget.r96-docked .r96-dock-button { display: block; }
        @media (max-width: 560px) {
          .r96-widget {
            left: 10px;
            top: 12px;
            right: auto;
            bottom: auto;
            max-width: calc(100vw - 20px);
          }
        }
      </style>
      <button class="r96-dock-button" type="button" data-restore aria-label="Restore Retro 96 Radio" title="Restore Retro 96 Radio">♫</button>
      <div class="r96-shell">
        <div class="r96-topbar" data-drag>
          <span class="r96-grip" aria-hidden="true"></span>
          <span>Retro 96 Radio</span>
          <button class="r96-mini" type="button" data-minimize aria-label="Minimize player">_</button>
          <button class="r96-mini" type="button" data-close aria-label="Minimize to top-left music icon" title="Minimize to music icon">x</button>
        </div>
        <div class="r96-marquee"><span data-marquee>Loading mixtape...</span></div>
        <div class="r96-modebar" role="group" aria-label="Listening modes">
          <button class="r96-button" type="button" data-radio aria-pressed="false" title="Follow the Mixtap broadcast">Radio</button>
          <button class="r96-button" type="button" data-personal aria-pressed="false" title="Control your own playback independently">Personal</button>
          <button class="r96-button" type="button" data-music-only aria-pressed="false" title="Show or hide the retro audio view">Music Only</button>
        </div>
        <div class="r96-status" data-status aria-live="polite"></div>
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
    state.mode = state.sync && readModePreference() !== "personal" ? "radio" : "personal";
    state.listening = true;
    state.minimized = false;
    try { state.musicOnly = window.localStorage.getItem("retro96-music-only") === "true"; } catch (_) { state.musicOnly = false; }
    state.localStartedAt = 0;
    state.radioState = null;
    state.radioVersion = "";
    state.radioLocalPlaying = false;
    state.radioLocalSeek = 0;
    state.radioLocalStartedAt = 0;
    state.radioConnection = state.sync ? "connecting" : "local";
    // The radio controls require a connected hub, not a local-only preview.
    mount.querySelector("[data-radio]").disabled = !state.sync;

    bindControls(mount);
    renderTrack(mount);
    makeDraggable(mount);
    startRoomSync(mount);
    return mount;
  }

  function readModePreference() {
    try { return window.localStorage.getItem("retro96-listening-mode"); } catch (_) { return "radio"; }
  }

  function persistMode() {
    try { window.localStorage.setItem("retro96-listening-mode", state.mode); } catch (_) { /* Private browsing */ }
  }

  function currentTrack() {
    return state.playlist[state.index] || state.playlist[0];
  }

  function broadcastPlaying() {
    return state.mode === "radio" && state.sync;
  }

  function radioIsActive() {
    return state.playing || state.radioLocalPlaying;
  }

  function currentRadioLocalSeek() {
    return Math.max(0, state.radioLocalSeek + (state.radioLocalPlaying && state.radioLocalStartedAt
      ? (Date.now() - state.radioLocalStartedAt) / 1000 : 0));
  }

  function canRenderMedia() {
    return Boolean(currentTrack() && !state.minimized && (
      broadcastPlaying()
        ? radioIsActive() && state.listening && !state.radioEnded
        : state.playing
    ));
  }

  function currentPersonalSeek() {
    return Math.max(0, state.desiredSeek + (state.playing && state.localStartedAt
      ? (Date.now() - state.localStartedAt) / 1000 : 0));
  }

  function updateControls(root) {
    const track = currentTrack();
    const radio = broadcastPlaying();
    const active = canRenderMedia();
    root.classList.toggle("r96-playing-media", active);
    root.classList.toggle("r96-spotify-media", active && track?.provider === "spotify");
    root.classList.toggle("r96-docked", state.minimized);
    root.classList.toggle("r96-music-only", state.musicOnly);
    root.querySelector("[data-music-only]").setAttribute("aria-pressed", String(state.musicOnly));
    root.querySelector("[data-radio]").setAttribute("aria-pressed", String(radio));
    root.querySelector("[data-personal]").setAttribute("aria-pressed", String(!radio));
    root.querySelector("[data-prev]").disabled = !track || radio;
    root.querySelector("[data-next]").disabled = !track || radio;
    root.querySelector("[data-shuffle]").disabled = !track || radio;
    root.querySelector("[data-pop]").disabled = !track;
    root.querySelector("[data-play]").disabled = !track || (radio && !state.radioState);
    root.querySelector("[data-play]").textContent = radio
      ? (state.playing ? (state.listening ? "Mute" : "Listen") :
          state.radioLocalPlaying ? "Pause" : "Play")
      : state.playing ? "Pause" : "Play";
    root.querySelector("[data-status]").textContent = radio
      ? (state.radioConnection === "offline" ? "RADIO · Connection lost; retrying" :
          !state.radioState ? "RADIO · Connecting to Mixtap" :
          state.playing ? (!state.listening ? "RADIO · Muted on this PC" :
            state.radioEnded ? "RADIO · Waiting for next song" : "RADIO · Following DJ broadcast") :
          state.radioLocalPlaying ? "RADIO · Playing locally; DJ is paused" :
          "RADIO · DJ paused; press Play to listen")
      : "PERSONAL · Your controls only";
    root.querySelector("[data-restore]").title = state.minimized
      ? "Restore Retro 96 Radio (embedded YouTube playback pauses while minimized)"
      : "Restore Retro 96 Radio";
    root.querySelector("[data-restore]").setAttribute("aria-label", root.querySelector("[data-restore]").title);
  }

  function clearProviderPlayer(root) {
    if (state.ytMessageHandler) {
      window.removeEventListener("message", state.ytMessageHandler);
      state.ytMessageHandler = null;
    }
    root.querySelector("[data-screen]").replaceChildren();
    state.player = null;
    state.spotifyFrame = null;
  }

  function renderTrack(root) {
    const track = currentTrack();
    const screen = root.querySelector("[data-screen]");
    const marquee = root.querySelector("[data-marquee]");
    const provider = root.querySelector("[data-provider]");
    const title = root.querySelector("[data-title]");
    const author = root.querySelector("[data-author]");
    const link = root.querySelector("[data-link]");
    clearProviderPlayer(root);
    updateControls(root);

    if (!track) {
      marquee.textContent = "No songs published to Retro 96";
      provider.textContent = "EMPTY";
      title.textContent = "Mixtap queue is empty";
      author.textContent = "Publish songs from Mixtap Hub";
      author.hidden = false;
      link.href = state.hubUrl || "https://mixtap.ljas.ca";
      link.textContent = "open Mixtap Hub";
      screen.innerHTML = '<span class="r96-empty-art" aria-hidden="true">♫</span>';
      return;
    }

    marquee.textContent = `${canRenderMedia() ? "Playing" : "Ready"}: ${trackLabel(track)}`;
    provider.textContent = track.provider;
    title.textContent = track.title;
    author.textContent = track.author || "";
    author.hidden = !track.author;
    link.href = track.url || "#";
    link.textContent = "open original";

    if (!canRenderMedia()) {
      // A retro standby screen is allowed when the video isn't playing.
      // We never cover or hide any part of a playing YouTube iframe.
      if (broadcastPlaying()) {
        screen.innerHTML = '<div class="r96-idle-radio-face" role="img" aria-label="Retro 96 radio standby display">FM 96.0<span>● STANDBY</span></div>';
        return;
      }
      const cover = track.thumbnail || (track.provider === "youtube" && track.id
        ? `https://i.ytimg.com/vi/${encodeURIComponent(track.id)}/hqdefault.jpg` : "");
      // The retro radio fascia is shown only when the provider player is inactive.
      // YouTube video and controls must never be obscured while playing.
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
      if (window.crossOriginIsolated) iframe.setAttribute("credentialless", "");
      iframe.loading = "eager";
      iframe.src = parts.length === 2 ? `https://open.spotify.com/embed/${parts[0]}/${parts[1]}` : track.url;
      iframe.title = track.title;
      iframe.frameBorder = "0";
      screen.appendChild(iframe);
      state.spotifyFrame = iframe;
      return;
    }

    // Use the direct embed (no blocked iframe_api script under Retro Room COEP).
    // YouTube requires a visible >=200x200 video player during playback.
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
    if (window.crossOriginIsolated) iframe.setAttribute("credentialless", "");
    if (!/^[a-zA-Z0-9_-]{11}$/.test(String(track.id || ""))) {
      screen.textContent = "This YouTube link could not be embedded. Open the original link below.";
      if (!broadcastPlaying()) state.playing = false;
      else {
        state.listening = false;
        state.radioLocalPlaying = false;
      }
      updateControls(root);
      return;
    }
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${track.id}`);
    embed.searchParams.set("autoplay", "1");
    embed.searchParams.set("controls", "1");
    embed.searchParams.set("playsinline", "1");
    embed.searchParams.set("enablejsapi", "1");
    if (window.location.origin && window.location.origin !== "null") {
      embed.searchParams.set("origin", window.location.origin);
    }
    const seek = broadcastPlaying()
      ? (state.playing && state.radioState ? calculateSeek(state.radioState) : currentRadioLocalSeek())
      : state.desiredSeek;
    if (seek > 0) embed.searchParams.set("start", String(Math.floor(seek)));
    iframe.src = embed.toString();
    screen.appendChild(iframe);
    const cover = document.createElement("div");
    cover.className = "r96-music-curtain";
    cover.setAttribute("aria-hidden", "true");
    cover.innerHTML = '<small>RETRO 96 RADIO</small><div class="r96-eq"><i></i><i></i><i></i><i></i><i></i></div><span>♫ AUDIO MODE ♫</span>';
    screen.appendChild(cover);
    state.player = iframe;

    state.ytMessageHandler = function (event) {
      if (event.source !== iframe.contentWindow ||
          !["https://www.youtube.com", "https://www.youtube-nocookie.com"].includes(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) { return; }
      }
      if (!payload || typeof payload !== "object") return;
      if (payload.event === "onStateChange" && Number(payload.info) === 0) {
        if (broadcastPlaying()) {
          state.radioEnded = true;
          updateControls(root);
        } else next(root);
      }
      if (payload.event === "onError") {
        const code = Number(payload.info);
        let reason = "YouTube couldn't play this video inside Retro Room.";
        if (code === 101 || code === 150) reason = "The video owner has disabled embedded playback.";
        if (code === 153) reason = "YouTube rejected the embedded player identification.";
        clearProviderPlayer(root);
        screen.textContent = `${reason} Open the original link below.`;
        if (broadcastPlaying()) {
          state.listening = false;
          state.radioLocalPlaying = false;
        } else state.playing = false;
        updateControls(root);
      }
    };
    window.addEventListener("message", state.ytMessageHandler);
    iframe.addEventListener("load", () => {
      if (!iframe.isConnected) return;
      iframe.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: iframe.id }),
        "https://www.youtube-nocookie.com");
    });
  }

  function playPause(root) {
    if (!currentTrack()) return;
    if (broadcastPlaying()) {
      if (state.playing) {
        state.listening = !state.listening;
      } else if (state.radioLocalPlaying) {
        state.radioLocalSeek = currentRadioLocalSeek();
        state.radioLocalStartedAt = 0;
        state.radioLocalPlaying = false;
      } else {
        state.radioLocalStartedAt = Date.now();
        state.radioLocalPlaying = true;
        state.listening = true;
      }
      state.radioEnded = false;
    } else {
      if (state.playing) {
        state.desiredSeek = currentPersonalSeek();
        state.localStartedAt = 0;
      } else state.localStartedAt = Date.now();
      state.playing = !state.playing;
    }
    renderTrack(root);
  }

  function renderLabels(root) {
    updateControls(root);
    root.querySelector("[data-marquee]").textContent = `${canRenderMedia() ? "Playing" : "Ready"}: ${trackLabel(currentTrack())}`;
  }

  function choosePersonalTrack(root, index) {
    if (broadcastPlaying() || !state.playlist.length) return;
    state.index = index;
    state.desiredSeek = 0;
    state.localStartedAt = state.playing ? Date.now() : 0;
    renderTrack(root);
  }

  function prev(root) {
    if (!state.playlist.length) return;
    choosePersonalTrack(root, (state.index - 1 + state.playlist.length) % state.playlist.length);
  }

  function next(root) {
    if (!state.playlist.length) return;
    choosePersonalTrack(root, (state.index + 1) % state.playlist.length);
  }

  function shuffle(root) {
    if (broadcastPlaying() || state.playlist.length < 2) return;
    let nextIndex = state.index;
    while (nextIndex === state.index) nextIndex = Math.floor(Math.random() * state.playlist.length);
    choosePersonalTrack(root, nextIndex);
  }

  function setListeningMode(root, mode) {
    if (mode === "radio" && !state.sync) return;
    if (state.mode === mode) return;
    if (mode === "personal") {
      state.desiredSeek = broadcastPlaying() && state.radioState
        ? calculateSeek(state.radioState) : state.desiredSeek;
      state.localStartedAt = state.playing ? Date.now() : 0;
    }
    state.mode = mode;
    state.radioEnded = false;
    state.radioLocalPlaying = false;
    state.radioLocalSeek = 0;
    state.radioLocalStartedAt = 0;
    persistMode();
    if (mode === "radio") {
      state.listening = true;
      if (state.radioState) {
        applyRadioSnapshot(root);
        return;
      }
      fetchRoom(root);
    }
    renderTrack(root);
  }

  function toggleDock(root, shouldDock) {
    if (shouldDock === state.minimized) return;
    if (shouldDock) {
      state.savedPosition = { left: root.style.left, top: root.style.top,
        right: root.style.right, bottom: root.style.bottom };
      // Hidden YouTube video playback isn't permitted; removing the iframe
      // pauses local audio. Radio remains subscribed for future updates.
      if (!broadcastPlaying() && state.playing) {
        state.desiredSeek = currentPersonalSeek();
        state.playing = false;
        state.localStartedAt = 0;
      } else if (broadcastPlaying() && state.radioLocalPlaying) {
        state.radioLocalSeek = currentRadioLocalSeek();
        state.radioLocalPlaying = false;
        state.radioLocalStartedAt = 0;
      }
    }
    state.minimized = shouldDock;
    if (!shouldDock && state.savedPosition) {
      Object.assign(root.style, state.savedPosition);
    }
    renderTrack(root);
    if (!shouldDock) root.querySelector("[data-close]").focus();
  }

  function bindControls(root) {
    root.querySelector("[data-play]").addEventListener("click", () => playPause(root));
    root.querySelector("[data-prev]").addEventListener("click", () => prev(root));
    root.querySelector("[data-next]").addEventListener("click", () => next(root));
    root.querySelector("[data-shuffle]").addEventListener("click", () => shuffle(root));
    root.querySelector("[data-pop]").addEventListener("click", () => {
      if (currentTrack()?.url) window.open(currentTrack().url, "_blank", "noopener");
    });
    root.querySelector("[data-radio]").addEventListener("click", () => setListeningMode(root, "radio"));
    root.querySelector("[data-personal]").addEventListener("click", () => setListeningMode(root, "personal"));
    root.querySelector("[data-music-only]").addEventListener("click", () => {
      state.musicOnly = !state.musicOnly;
      try { window.localStorage.setItem("retro96-music-only", String(state.musicOnly)); } catch (_) { /* browser privacy */ }
      // Keep the mounted iframe and current audio uninterrupted.
      updateControls(root);
    });
    root.querySelector("[data-minimize]").addEventListener("click", () => {
      state.compact = !state.compact;
      root.classList.toggle("r96-compact", state.compact);
    });
    root.querySelector("[data-close]").addEventListener("click", () => toggleDock(root, true));
    root.querySelector("[data-restore]").addEventListener("click", () => toggleDock(root, false));
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
    state.pollTimer = window.setInterval(() => {
      // No background requests from a widget that has been removed by its host.
      if (!root.isConnected) { window.clearInterval(state.pollTimer); return; }
      fetchRoom(root);
    }, 2500);
  }

  async function fetchRoom(root) {
    try {
      const response = await fetch(roomEndpoint(), { cache: "no-store" });
      if (!response.ok) throw new Error(`Room unavailable (${response.status})`);
      const roomState = await response.json();
      if (state.radioConnection !== "connected") {
        state.radioConnection = "connected";
        updateControls(root);
      }
      applyRoomState(root, roomState);
    } catch (_) {
      state.radioConnection = "offline";
      renderLabels(root);
    }
  }

  function applyRadioSnapshot(root, previousState = null) {
    const data = state.radioState;
    if (!data || !broadcastPlaying()) return;
    const oldTrack = currentTrack();
    const oldId = oldTrack && `${oldTrack.provider}:${oldTrack.id}`;
    state.playlist = Array.isArray(data.playlist)
      ? data.playlist.map(normalizeTrack).filter((track) => track.id || track.url) : [];
    state.index = state.playlist.length
      ? Math.min(Math.max(Number(data.index || 0), 0), state.playlist.length - 1) : 0;
    const newTrack = currentTrack();
    const newId = newTrack && `${newTrack.provider}:${newTrack.id}`;
    const djChangedPlay = previousState && Boolean(previousState.playing) !== Boolean(data.playing);
    if (djChangedPlay) {
      // Real DJ transport changes always take priority over local listening.
      state.radioLocalPlaying = false;
      state.radioLocalSeek = 0;
      state.radioLocalStartedAt = 0;
    } else if (oldId !== newId) {
      // In locally started Radio, follow shared queue changes without writing to it.
      state.radioLocalSeek = 0;
      state.radioLocalStartedAt = state.radioLocalPlaying ? Date.now() : 0;
    }
    state.playing = Boolean(data.playing);
    state.desiredSeek = calculateSeek(data);
    state.radioEnded = false;
    renderTrack(root);
  }

  function applyRoomState(root, roomState) {
    if (!roomState || roomState.version === state.radioVersion) return;
    const previousState = state.radioState;
    state.radioVersion = roomState.version || String(Date.now());
    state.radioState = roomState;
    // Personal mode owns a frozen local queue and playback state. This update
    // never silently steals playback from someone listening independently.
    if (broadcastPlaying()) applyRadioSnapshot(root, previousState);
  }

  function calculateSeek(roomState) {
    const position = Math.max(0, Number(roomState?.position || 0));
    if (!roomState?.playing) return position;
    const startedAt = Number(roomState.startedAt || 0);
    if (!startedAt) return position;
    return Math.max(0, position + (Date.now() - startedAt) / 1000);
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
