(function () {
  const DEFAULT_PLAYLIST = [];
  // Inline pixel-art cassette icon avoids cross-origin image fetches under Retro Room COEP.
  const CASSETTE_ICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\" width=\"48\" height=\"48\"><g shape-rendering=\"crispEdges\"><path fill=\"#000\" d=\"M5 5h38v39H5z\"/><path fill=\"#e3e8ec\" d=\"M6 4h36v36H6z\"/><path fill=\"#25394a\" d=\"M9 8h30v31H9z\"/><path fill=\"#778491\" d=\"M12 11h24v4H12z\"/><path fill=\"#b9c4c6\" d=\"M11 17h26v15H11z\"/><path fill=\"#0a1024\" d=\"M13 19h22v11H13z\"/><path fill=\"#9ba6a8\" d=\"M15 21h7v7h-7z M26 21h7v7h-7z\"/><path fill=\"#e6e6e2\" d=\"M17 23h3v3h-3z M28 23h3v3h-3z\"/><path fill=\"#101629\" d=\"M18 24h1v1h-1z M29 24h1v1h-1z\"/><path fill=\"#b6c1c2\" d=\"M20 29h8v2h-8z\"/><path fill=\"#674ee6\" d=\"M12 34h4v4h-4z\"/><path fill=\"#00ea99\" d=\"M17 35h3v3h-3z M21 33h3v5h-3z\"/><path fill=\"#eac933\" d=\"M25 32h3v6h-3z\"/><path fill=\"#f38137\" d=\"M29 35h3v3h-3z\"/><path fill=\"#fa386a\" d=\"M33 34h3v4h-3z\"/><path fill=\"#fff\" d=\"M5 5h2v36H5zM5 5h36v2H5z\"/><path fill=\"#656f7d\" d=\"M41 7h2v35h-2zM7 40h35v2H7z\"/></g></svg>";

  const state = {
    playlist: [],
    index: 0,
    playing: false,
    compact: false,
    player: null,
    spotifyFrame: null,
    audioPlayer: null,
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
    dockedAt: 0,
    volume: 75,
    personalPlaylist: [],
    personalIndex: 0,
    personalPlaying: false,
    liveTrack: null,
    preferOwnPlaylist: false
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
      thumbnail: track.thumbnail || "",
      kind: track.kind || (String(id).startsWith("playlist:") ? "youtube-playlist" : "track"),
      listId: track.listId || (String(id).startsWith("playlist:") ? String(id).slice(9) : ""),
      duration: Number(track.duration) || 0
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
      if (embedMatch && embedMatch[1] !== "videoseries") return embedMatch[1];
      const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]{8,100})/i);
      if (listMatch) return `playlist:${listMatch[1]}`;
    }
    if (provider === "spotify") {
      const match = url.match(/spotify\.com\/(track|episode|playlist|album)\/([^?&#/]+)/i);
      return match ? `${match[1]}:${match[2]}` : "";
    }
    return "";
  }

  function buildUrl(provider, id) {
    if (provider === "youtube") return String(id).startsWith("playlist:") ? `https://www.youtube.com/playlist?list=${id.slice(9)}` : `https://www.youtube.com/watch?v=${id}`;
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
          width: var(--r96-user-width, 264px);
          min-width: 242px;
          max-width: calc(100vw - 20px);
          color: #000;
          font-family: "MS Sans Serif", Tahoma, Verdana, Arial, sans-serif;
          user-select: none;
          filter: drop-shadow(4px 4px 0 rgba(0, 0, 0, .45));
        }
        .r96-shell {
          position: relative;
          overflow: hidden;
          min-height: 0;
          height: auto;
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
          grid-template-columns: 1fr 1fr;
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
        .r96-options { display:flex; align-items:center; gap:7px; padding:2px 5px 5px; font:10px "MS Sans Serif",Tahoma,sans-serif; }
        .r96-check { display:inline-flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap; }
        .r96-check input { appearance:auto; accent-color:#000080; width:13px; height:13px; margin:0; }
        .r96-volume { display:inline-flex; align-items:center; gap:5px; flex:1; min-width:0; }
        .r96-volume input { flex:1; width:1px; min-width:28px; accent-color:#000080; cursor:pointer; }
        .r96-volume output { font:10px Consolas,monospace; min-width:26px; text-align:right; }
        .r96-track-drawer[hidden] { display: none !important; }
        .r96-track-drawer { margin:1px 4px 4px; border:2px inset #a0a0a0; background:#e4e4e4; color:#000; padding:4px; max-height:170px; overflow:auto; }
        .r96-track-drawer button { display:block; width:100%; text-align:left; border:0; background:transparent; color:#000; padding:4px 3px; font:11px "MS Sans Serif",Tahoma,sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .r96-track-drawer button[aria-current="true"] { background:#000080; color:white; }
        .r96-track-drawer button:hover { outline:1px dotted #404040; }
        .r96-list-empty { color:#414141; font:11px/1.5 Tahoma,sans-serif; padding:9px 5px; }
        .r96-track-tab { display:flex; margin:2px 4px 0; }
        .r96-track-tab .r96-button { border-bottom:0; min-height:23px; padding:3px 8px; }
        .r96-track-tab[hidden], .r96-track-drawer[hidden] { display:none; }
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
        .r96-widget.r96-compact { width: var(--r96-user-width, 264px); }
        .r96-resizer { position:absolute; right:2px; bottom:1px; z-index:9; width:23px; height:23px; padding:0; cursor:nwse-resize; touch-action:none; border:0; background:linear-gradient(135deg,transparent 0 42%,#888 43% 47%,#fafafa 48% 52%,transparent 53% 60%,#888 61% 65%,#fafafa 66% 70%,transparent 71%); }
        .r96-resizer:focus-visible { outline:2px solid #000080; outline-offset:-2px; }
        .r96-widget.r96-docked .r96-resizer { display:none; }
        .r96-widget.r96-compact:not(.r96-playing-media) .r96-stage { display: none; }
        .r96-widget.r96-compact .r96-extra { display: none; }
        .r96-widget.r96-compact .r96-controls { grid-template-columns: 34px 52px 34px; }
        .r96-widget.r96-audio-media .r96-screen { height:68px; display:flex; align-items:center; padding:2px; }
        .r96-widget.r96-audio-media .r96-screen audio { display:block; }
        /* YouTube playback must always retain a visible >=200x200 frame. */
        .r96-widget.r96-playing-media .r96-stage { display: grid; }
        .r96-widget.r96-playing-media .r96-screen iframe { min-width: 200px; min-height: 200px; }
        .r96-dock-button {
          display: none;
          width: 50px;
          height: 50px;
          border: 0;
          padding: 0;
          background: transparent;
          cursor: pointer;
          filter: drop-shadow(2px 2px 1px #0009);
        }
        .r96-dock-button img {width:48px;height:48px;display:block;image-rendering:pixelated;}
        .r96-widget.r96-docked {
          position: fixed !important;
          top: 12px !important;
          left: 12px !important;
          right: auto !important;
          bottom: auto !important;
          width: 50px !important;
          min-width: 50px !important;
          max-width: 50px !important;
          height: 50px !important;
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
      <button class="r96-dock-button" type="button" data-restore aria-label="Restore Retro 96 Radio" title="Restore Retro 96 Radio"></button>
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
          <button class="r96-button" type="button" data-personal aria-pressed="false" title="Control your own playback independently">Local</button>
        </div>
        <div class="r96-options">
          <label class="r96-check"><input type="checkbox" data-music-only> Music only</label>
          <label class="r96-volume" title="Volume on this device only">Vol <input type="range" min="0" max="100" step="5" value="75" data-volume aria-label="Local player volume"><output data-volume-label>75%</output></label>
        </div>
        <div class="r96-status" data-status aria-live="polite"></div>
        <div class="r96-track-tab" data-local-tab><button class="r96-button" data-track-toggle type="button" aria-expanded="false">▤ TRACK LIST ▾</button></div>
        <div class="r96-track-drawer" data-local-tracks hidden></div>
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
        <button type="button" class="r96-resizer" data-resize role="slider" aria-orientation="horizontal" aria-label="Resize player width by dragging the corner; arrow keys adjust width, up or down adjust height" title="Drag to resize width and height like Windows 3.1" aria-valuemin="242" aria-valuemax="560"></button>
      </div>
    `;

    document.body.appendChild(mount);
    const cassetteImage=document.createElement('img');cassetteImage.alt='';
    cassetteImage.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(CASSETTE_ICON);
    mount.querySelector('[data-restore]').append(cassetteImage);
    document.addEventListener('fullscreenchange',()=>{
      // Move the minimized launcher into Full TV, without reparenting a playing media iframe.
      if(state.minimized) (document.fullscreenElement || document.body).appendChild(mount);
    });
    state.playlist = (options.playlist || DEFAULT_PLAYLIST).map(normalizeTrack).filter((track) => track.id || track.url);
    // An empty published room must not display a demo video that is not in the queue.
    state.index = Math.min(Math.max(Number(options.startIndex || 0), 0), Math.max(0, state.playlist.length - 1));
    state.personalPlaylist = state.playlist.map(track => ({ ...track }));
    state.personalIndex = state.index;
    state.personalPlaying = false;
    state.liveTrack = null;
    state.preferOwnPlaylist = Boolean(options.preferOwnPlaylist);
    try { state.volume = Math.max(0, Math.min(100, Number(window.localStorage.getItem("retro96-volume") ?? 75))); }
    catch (_) { state.volume = 75; }
    mount.querySelector("[data-volume]").value = String(state.volume);
    state.room = options.room || "";
    state.hubUrl = options.hubUrl || "";
    state.sync = Boolean(options.sync && state.room && state.hubUrl);
    state.mode = options.initialMode === "personal" ? "personal"
      : options.initialMode === "radio" && state.sync ? "radio"
      : state.sync && readModePreference() !== "personal" ? "radio" : "personal";
    try {
      const savedWidth = Number(window.localStorage.getItem("retro96-widget-width"));
      // Height follows content automatically; only an optional manual width is persisted.
      if (Number.isFinite(savedWidth) && savedWidth >= 242) {
        mount.style.setProperty("--r96-user-width", `${Math.min(savedWidth, 560)}px`);
      }

    } catch (_) {}
    state.listening = true;
    state.minimized = Boolean(options.startMinimized);
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
    makeResizable(mount);
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
    return (broadcastPlaying() && state.radioState?.activeTrack?.id ? normalizeTrack(state.radioState.activeTrack) : null)
      || state.playlist[state.index] || state.playlist[0];
  }

  function renderLocalTrackList(root) {
    const drawer = root.querySelector("[data-local-tracks]");
    drawer.replaceChildren();
    if (!state.playlist.length) {
      const empty = document.createElement("div");
      empty.className = "r96-list-empty";
      empty.textContent = state.radioConnection === "connected" ? "No tracks in this station yet. Add a mix at Mixtap." : "Loading the song list…";
      drawer.appendChild(empty);
    }
    state.playlist.forEach((track, idx) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${String(idx + 1).padStart(2, "0")}. ${track.title}`;
      button.setAttribute("aria-current", String(idx === state.index));
      button.title = trackLabel(track);
      button.addEventListener("click", () => choosePersonalTrack(root, idx, true));
      drawer.appendChild(button);
    });
  }

  function setLocalVolume() {
    if (state.audioPlayer) state.audioPlayer.volume = state.volume / 100;
    if (state.player?.contentWindow) {
      state.player.contentWindow.postMessage(JSON.stringify({event: "command", func: "setVolume", args: [state.volume]}), "https://www.youtube-nocookie.com");
      if (state.volume === 0) state.player.contentWindow.postMessage(JSON.stringify({event: "command", func: "mute", args: []}), "https://www.youtube-nocookie.com");
      else state.player.contentWindow.postMessage(JSON.stringify({event: "command", func: "unMute", args: []}), "https://www.youtube-nocookie.com");
    }
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
    return Boolean(currentTrack() && (!state.minimized || currentTrack().provider === "upload") && (
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
    root.classList.toggle("r96-audio-media", active && track?.provider === "upload");
    root.classList.toggle("r96-docked", state.minimized);
    root.classList.toggle("r96-music-only", state.musicOnly);
    root.querySelector("[data-music-only]").checked = state.musicOnly;
    root.querySelector("[data-volume-label]").textContent = `${state.volume}%`;
    root.querySelector("[data-local-tab]").hidden = radio;
    root.querySelector("[data-local-tracks]").hidden = radio || root.querySelector("[data-track-toggle]").getAttribute("aria-expanded") !== "true";
    root.querySelector("[data-radio]").setAttribute("aria-pressed", String(radio));
    root.querySelector("[data-personal]").setAttribute("aria-pressed", String(!radio));
    root.querySelector("[data-prev]").disabled = !track || radio;
    root.querySelector("[data-next]").disabled = !track || radio;
    root.querySelector("[data-shuffle]").disabled = !track || radio;
    root.querySelector("[data-pop]").disabled = !track;
    root.querySelector("[data-play]").disabled = !track || (radio && (!state.radioState || !state.radioState.playing));
    root.querySelector("[data-play]").textContent = radio
      ? (state.playing ? (state.listening ? "Mute" : "Listen") : "Off air")
      : state.playing ? "Pause" : "Play";
    root.querySelector("[data-status]").textContent = radio
      ? (state.radioConnection === "offline" ? "RADIO · Connection lost; retrying" :
          !state.radioState ? "RADIO · Connecting to Mixtap" :
          state.playing ? (!state.listening ? "RADIO · Muted on this PC" :
            state.radioEnded ? "RADIO · Waiting for next song" : "RADIO · Following DJ broadcast") :
          "RADIO · DJ paused; no local control of the broadcast")
      : (state.playlist.length ? "LOCAL · Your music, your controls" : "LOCAL · No tracks yet · Add songs to your station");
    root.querySelector("[data-restore]").title = state.minimized
      ? "Restore Retro 96 Radio (media playback pauses while minimized)"
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
    state.audioPlayer = null;
  }

  function uploadedAudioUrl(track) {
    // The widget runs on retro.ljas.ca but audio lives on mixtap.ljas.ca.
    // Root-relative /api/audio URLs must resolve against the Mixtap hub, not the host page.
    const base = state.hubUrl || window.location.origin;
    try { return new URL(String(track.url || ""), base.replace(/\/+$/, "") + "/").href; }
    catch (_) { return ""; }
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
    if (!broadcastPlaying()) renderLocalTrackList(root);

    if (!track) {
      marquee.textContent = "♫ MIXTAP 96 · STANDBY · ADD YOUR FIRST TRACK ♫";
      provider.textContent = "EMPTY";
      title.textContent = "Mixtap queue is empty";
      author.textContent = "Add songs on mixtap.ljas.ca to start listening";
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
    link.href = track.provider === "upload" ? uploadedAudioUrl(track) : (track.url || "#");
    link.textContent = "open original";

    if (!canRenderMedia()) {
      // A retro standby screen is allowed when the video isn't playing.
      // We never cover or hide any part of a playing YouTube iframe.
      if (broadcastPlaying()) {
        screen.innerHTML = '<div class="r96-idle-radio-face" role="img" aria-label="Retro 96 radio standby display">FM 96.0<span>● STANDBY</span></div>';
        return;
      }
      const cover = track.thumbnail || (track.provider === "youtube" && /^[a-zA-Z0-9_-]{11}$/.test(String(track.id || ""))
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

    if (track.provider === "upload") {
      const audio = document.createElement("audio");
      audio.src = uploadedAudioUrl(track); audio.preload = "auto"; audio.controls = true; audio.autoplay = true;
      audio.volume = state.volume / 100;
      audio.setAttribute("aria-label", `Audio player: ${track.title}`);
      audio.style.width = "100%";
      audio.style.minHeight = "54px";
      audio.style.margin = "18px 0";
      const seek = broadcastPlaying() && state.radioState ? calculateSeek(state.radioState) : currentPersonalSeek();
      audio.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(seek)) audio.currentTime = Math.min(Math.max(0, seek), Math.max(0, audio.duration - .15));
        audio.play().catch(() => {
          root.querySelector("[data-status]").textContent = "Press play on the audio controls to start listening";
        });
      });
      audio.addEventListener("error", () => { root.querySelector("[data-status]").textContent = "Audio unavailable. Check the song on Mixtap."; });
      audio.addEventListener("ended", () => { if (!broadcastPlaying()) next(root); });
      screen.appendChild(audio);
      state.audioPlayer = audio;
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
    if (!/^[a-zA-Z0-9_-]{11}$/.test(String(track.id || "")) && !/^playlist:[a-zA-Z0-9_-]{8,100}$/.test(String(track.id || ""))) {
      screen.textContent = "This YouTube link could not be embedded. Open the original link below.";
      if (!broadcastPlaying()) state.playing = false;
      else {
        state.listening = false;
        state.radioLocalPlaying = false;
      }
      updateControls(root);
      return;
    }
    const isList = String(track.id).startsWith("playlist:");
    const embed = new URL(isList ? "https://www.youtube-nocookie.com/embed/videoseries" : `https://www.youtube-nocookie.com/embed/${track.id}`);
    if (isList) embed.searchParams.set("list", track.id.slice(9));
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
      if (payload.event === "infoDelivery" && payload.info?.videoData) {
        const video = payload.info.videoData;
        if (typeof video.title === "string" && video.title.trim() && isList) {
          const shown = video.title.trim().slice(0, 200);
          const by = String(video.author || "").slice(0, 200);
          root.querySelector("[data-title]").textContent = shown;
          root.querySelector("[data-author]").textContent = by;
          root.querySelector("[data-author]").hidden = !by;
          root.querySelector("[data-marquee]").textContent = `Playing: ${shown}${by ? " - " + by : ""}`;
          if (/^[a-zA-Z0-9_-]{11}$/.test(video.video_id || "")) {
            root.querySelector("[data-link]").href = `https://www.youtube.com/watch?v=${video.video_id}`;
          }
        }
      }
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
      setLocalVolume();
      iframe.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: iframe.id }),
        "https://www.youtube-nocookie.com");
    });
  }

  function playPause(root) {
    if (!currentTrack()) return;
    if (broadcastPlaying()) {
      // Listeners can mute/unmute their own audio, not start or move the DJ's broadcast.
      if (!state.radioState?.playing) return;
      state.listening = !state.listening;
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
    const track = currentTrack();
    updateControls(root);
    root.querySelector("[data-marquee]").textContent = track
      ? `${canRenderMedia() ? "Playing" : "Ready"}: ${trackLabel(track)}`
      : "♫ MIXTAP 96 · STANDBY · ADD YOUR FIRST TRACK ♫";
    // A renamed uploaded song keeps its audio element playing. Only its
    // displayed metadata and drawer labels need to change.
    if (track) {
      root.querySelector("[data-title]").textContent = track.title;
      root.querySelector("[data-author]").textContent = track.author || "";
      root.querySelector("[data-author]").hidden = !track.author;
      root.querySelector("[data-link]").href = track.provider === "upload" ? uploadedAudioUrl(track) : (track.url || "#");
    }
    if (!broadcastPlaying()) renderLocalTrackList(root);
  }

  function choosePersonalTrack(root, index, startPlayback = false) {
    if (broadcastPlaying() || !state.playlist.length) return;
    state.index = index;
    state.personalIndex = index;
    if (startPlayback) state.playing = true;
    state.personalPlaying = state.playing;
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
    if (state.mode === mode) {
      if (mode === "radio") { state.listening = true; state.radioEnded = false; if (state.radioState) applyRadioSnapshot(root, null, true); else fetchRoom(root); }
      else {
        const tab = root.querySelector("[data-track-toggle]");
        tab.setAttribute("aria-expanded", "true");
        tab.textContent = "▤ TRACK LIST ▴";
        renderLocalTrackList(root);
        updateControls(root);
      }
      return;
    }
    if (state.mode === "personal") {
      state.personalPlaylist = state.playlist.map(track => ({...track}));
      state.personalIndex = state.index;
      state.personalPlaying = state.playing;
    }
    if (mode === "personal") {
      // Radio's song catalogue is available to Local, but its live timestamp is not.
      if (!state.preferOwnPlaylist && state.radioState && Array.isArray(state.radioState.playlist)) {
        syncLocalCatalogue(state.radioState, root, false);
      }
      state.desiredSeek = 0;
      state.localStartedAt = state.personalPlaying ? Date.now() : 0;
      const toggle = root.querySelector("[data-track-toggle]");
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "▤ TRACK LIST ▴";
    }
    state.mode = mode;
    if (mode === "personal") {
      state.playlist = state.personalPlaylist.map(track => ({...track}));
      state.index = Math.min(state.personalIndex, Math.max(0, state.playlist.length - 1));
      state.playing = state.personalPlaying;
    }
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
      // Uploaded audio can continue playing when docked, while embedded
      // YouTube/Spotify media must be removed when no longer visible.
      const backgroundAudio = currentTrack()?.provider === "upload";
      if (!backgroundAudio && !broadcastPlaying() && state.playing) {
        state.desiredSeek = currentPersonalSeek();
        state.playing = false;
        state.localStartedAt = 0;
      } else if (!backgroundAudio && broadcastPlaying() && state.radioLocalPlaying) {
        state.radioLocalSeek = currentRadioLocalSeek();
        state.radioLocalPlaying = false;
        state.radioLocalStartedAt = 0;
      }
    }
    state.minimized = shouldDock;
    if (!shouldDock && state.savedPosition) {
      Object.assign(root.style, state.savedPosition);
    }
    if (currentTrack()?.provider === "upload" && state.audioPlayer) {
      updateControls(root);
      if (!shouldDock && canRenderMedia() && state.audioPlayer.paused) {
        state.audioPlayer.play().catch(() => {
          root.querySelector("[data-status]").textContent = "Press Play to hear the radio.";
        });
      }
    } else renderTrack(root);
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
    root.querySelector("[data-music-only]").addEventListener("change", (event) => {
      state.musicOnly = event.target.checked;
      try { window.localStorage.setItem("retro96-music-only", String(state.musicOnly)); } catch (_) { /* browser privacy */ }
      // Keep the mounted iframe and current audio uninterrupted.
      updateControls(root);
    });
    root.querySelector("[data-volume]").addEventListener("input", (event) => {
      state.volume = Math.min(100, Math.max(0, Number(event.target.value)));
      try { window.localStorage.setItem("retro96-volume", String(state.volume)); } catch (_) {}
      setLocalVolume(); updateControls(root);
    });
    root.querySelector("[data-track-toggle]").addEventListener("click", () => {
      const tab = root.querySelector("[data-track-toggle]");
      const expanded = tab.getAttribute("aria-expanded") !== "true";
      tab.setAttribute("aria-expanded", String(expanded));
      tab.textContent = expanded ? "▤ TRACK LIST ▴" : "▤ TRACK LIST ▾";
      updateControls(root);
    });
    root.querySelector("[data-minimize]").addEventListener("click", () => toggleDock(root, true));
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

  function makeResizable(root) {
    const grip = root.querySelector("[data-resize]");
    let initialX = 0, initialWidth = 264, resizing = false;
    function maxAllowed() {
      const parent = root.closest(".preview-shell");
      const parentLimit = parent ? parent.clientWidth - 24 : window.innerWidth - 24;
      return Math.max(242, Math.min(560, parentLimit));
    }
    function setWidth(width, persist = true) {
      const clamped = Math.round(Math.max(242, Math.min(maxAllowed(), width)));
      root.style.setProperty("--r96-user-width", `${clamped}px`);
      grip.setAttribute("aria-valuenow", String(clamped));
      if (persist) { try { window.localStorage.setItem("retro96-widget-width", String(clamped)); } catch (_) {} }
    }
    grip.addEventListener("pointerdown", event => {
      if (root.classList.contains("r96-docked")) return;
      event.preventDefault(); event.stopPropagation();
      resizing = true; initialX = event.clientX;
      initialWidth = root.getBoundingClientRect().width;
      grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener("pointermove", event => {
      if (!resizing) return;
      setWidth(initialWidth + event.clientX - initialX);
    });
    grip.addEventListener("pointerup", () => { resizing = false; });
    grip.addEventListener("pointercancel", () => { resizing = false; });
    grip.addEventListener("keydown", event => {
      if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return;
      event.preventDefault();
      setWidth(root.getBoundingClientRect().width + (event.key === "ArrowRight" ? 16 : -16));
    });
    grip.setAttribute("aria-valuenow", String(Math.round(root.getBoundingClientRect().width)));
    // A persisted width from another website may exceed this page's preview rail.
    window.requestAnimationFrame(() => { if (root.isConnected && root.closest(".preview-shell")) setWidth(root.getBoundingClientRect().width, false); });
  }

  function boot() {
    const script = document.currentScript || document.querySelector("script[data-retro96-player]");
    if (script && script.dataset.skipAuto === "true") return;
    const playlist = parseJson(script && script.dataset.playlist, DEFAULT_PLAYLIST);
    const startIndex = script && script.dataset.startIndex;
    const room = script && script.dataset.room;
    const hubUrl = script && script.dataset.hubUrl;
    const sync = script && script.dataset.sync === "true";
    // Retro Room always starts on the cassette launcher, even on radio.html.
    // Keep standalone Mixtap's player behavior unchanged.
    const startMinimized=script?.dataset?.startMinimized === 'true' || window.location.hostname.toLowerCase() === 'retro.ljas.ca';
    createPlayer({ playlist, startIndex, room, hubUrl, sync, startMinimized });
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

  function applyRadioSnapshot(root, previousState = null, force = false) {
    const data = state.radioState;
    if (!data || !broadcastPlaying()) return;
    const oldTrack = previousState?.activeTrack?.id ? normalizeTrack(previousState.activeTrack) : (previousState?.playlist?.[previousState.index || 0] || currentTrack());
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
    if (force || oldId !== newId || djChangedPlay || (!state.player && !state.audioPlayer && !state.spotifyFrame && canRenderMedia())) renderTrack(root);
    else renderLabels(root);
  }

  function syncLocalCatalogue(roomState, root, updateCurrent = true) {
    if (state.preferOwnPlaylist || !Array.isArray(roomState?.playlist)) return;
    const available = roomState.playlist.map(normalizeTrack).filter(track => track.id || track.url);
    const previous = state.personalPlaylist;
    const key = track => `${track.provider}:${track.id}`;
    const signature = track => `${key(track)}:${track.title}:${track.author}`;
    const oldKeys = previous.map(signature).join("|");
    const newKeys = available.map(signature).join("|");
    if (oldKeys === newKeys) return;
    const oldTrack = previous[state.personalIndex];
    const newIndex = oldTrack ? available.findIndex(track => key(track) === key(oldTrack)) : -1;
    state.personalPlaylist = available.map(track => ({...track}));
    state.personalIndex = newIndex >= 0 ? newIndex : 0;
    if (updateCurrent && !broadcastPlaying()) {
      // Never move a user's personal song to the live radio index or seek time.
      const sameTrack = newIndex >= 0;
      state.playlist = available.map(track => ({...track}));
      state.index = state.personalIndex;
      if (!sameTrack) { state.playing = false; state.personalPlaying = false; state.desiredSeek = 0; state.localStartedAt = 0; }
      if (sameTrack) renderLabels(root);
      else renderTrack(root);
    }
  }

  function applyRoomState(root, roomState) {
    if (!roomState || roomState.version === state.radioVersion) return;
    const previousState = state.radioState;
    state.radioVersion = roomState.version || String(Date.now());
    state.radioState = roomState;
    // Keep the same station catalogue available in both modes, but never
    // adopt the station's position or transport in Local.
    syncLocalCatalogue(roomState, root);
    if (broadcastPlaying()) applyRadioSnapshot(root, previousState);
    else if (state.preferOwnPlaylist) renderLabels(root);
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
    updatePlaylist: function (tracks, options = {}) {
      if (options.preferOwnPlaylist) state.preferOwnPlaylist = true;
      const root = document.querySelector(".r96-widget");
      if (!root) return;
      const nextList = (Array.isArray(tracks) ? tracks : []).map(normalizeTrack).filter(track => track.id || track.url);
      const oldTrack = state.personalPlaylist[state.personalIndex];
      const oldSignature = JSON.stringify(state.personalPlaylist);
      if (oldSignature === JSON.stringify(nextList)) return;
      const idx = oldTrack ? nextList.findIndex(track => track.provider === oldTrack.provider && track.id === oldTrack.id) : -1;
      state.personalPlaylist = nextList.map(track => ({...track}));
      state.personalIndex = idx >= 0 ? idx : 0;
      if (!broadcastPlaying()) {
        state.playlist = nextList.map(track => ({...track}));
        state.index = state.personalIndex;
        if (idx < 0) { state.playing = false; state.personalPlaying = false; state.desiredSeek = 0; state.localStartedAt = 0; }
        if (idx >= 0) renderLabels(root);
        else renderTrack(root);
      }
    },
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
