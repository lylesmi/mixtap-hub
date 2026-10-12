# Retro 96 Mixtape Hub for ljas.ca

This is the self-hosted handoff package for the Retro 96 floating music widget.

It includes:

- `public/index.html`: the main hub website where you build and broadcast the playlist.
- `public/widget.js`: the draggable Windows 95 style floating player for Retro Room 96.
- `server.mjs`: a tiny Node server with no npm dependencies.
- `data/rooms.json`: created automatically to persist the shared room state.
- `EMBED-CODE.html`: the snippet to paste into Retro Room 96.

## Requirements

- Node.js 18 or newer
- A public HTTPS hostname, for example `https://mixtap.ljas.ca`
- Nginx, Caddy, Apache, or another reverse proxy

## Recommended: LaunchDock-managed deployment

See `LAUNCHDOCK-SETUP.md`. **Do not run the manual systemd service and a LaunchDock Docker container at the same time.** Set `MIXTAP_ADMIN_TOKEN` only in LaunchDock environment variables, enable Persistent Storage, set container port 8787, and use the canonical hostname `mixtap.ljas.ca`.

## Optional manual Quick Start

```bash
cd /opt/retro96-mixtape-hub
npm install
MIXTAP_ADMIN_TOKEN=<set-a-private-long-key> MIXTAP_PUBLIC_ORIGIN=https://mixtap.ljas.ca PORT=8787 HOST=127.0.0.1 npm start
```

Open:

```text
http://127.0.0.1:8787
```

When it is behind your public reverse proxy, open:

```text
https://mixtap.ljas.ca
```

## Add It to Retro Room 96

Paste this before the closing `</body>` tag on Retro Room 96:

```html
<script
  src="https://mixtap.ljas.ca/widget.js"
  data-retro96-player
  data-sync="true"
  data-hub-url="https://mixtap.ljas.ca"
  data-room="retro96"
  data-playlist="[]">
</script>

<style>
  .r96-widget {
    --r96-left: 12px;
    --r96-top: 12px;
    position: fixed !important;
    z-index: 2147483000 !important;
  }
</style>
```

If you host it at a different URL, replace every `https://mixtap.ljas.ca` with your real hub URL.

## How Sync Works

The hub writes to:

```text
/api/rooms/retro96
```

Every embedded widget with:

```html
data-sync="true"
data-hub-url="https://mixtap.ljas.ca"
data-room="retro96"
```

polls that same room endpoint and follows the current playlist, track index, play/pause state, and YouTube timing. Spotify embeds show the same selected item, but Spotify still controls its own playback rules inside the embed.

## Metadata

When you paste a YouTube or Spotify URL, the hub calls:

```text
/api/metadata?url=...
```

The server uses public oEmbed/page metadata, so no YouTube or Spotify API keys are required.

## Legacy manual hosting (not needed in LaunchDock)

## systemd

Copy `deploy/systemd/retro96-mixtape-hub.service` to:

```text
/etc/systemd/system/retro96-mixtape-hub.service
```

Then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now retro96-mixtape-hub
sudo systemctl status retro96-mixtape-hub
```

## Nginx

Copy `deploy/nginx/retro96-mixtape-hub.conf` into your Nginx sites folder, update `server_name`, then reload Nginx.

After DNS points to the server, add HTTPS with Certbot or your normal TLS setup.

## Files to Back Up

Back up this file if you want to preserve the current room state in standalone mode. In LaunchDock the data is stored at `/var/data/rooms.json` in the persistent named Docker volume:

```text
data/rooms.json
```

The app will recreate it if missing.
