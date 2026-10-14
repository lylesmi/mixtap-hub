# Mixtap Hub for LaunchDock

**Canonical URL:** https://mixtap.ljas.ca (the only supported hostname)

## Important deployment facts

LaunchDock's normal managed Docker apps use `--mount`/`-v` on `/var/data` when **Persistent storage** is enabled, and use the app slug for the volume name. Do not run this package with systemd as a *second* server if managing it with LaunchDock.

Set up as a separate app using LaunchDock's normal **Add app / New app** workflow, importing or copying this source as its application workspace. If your LaunchDock UI only accepts a Git repository, place this source in a private repo first. Do not paste SQL or manually alter the LaunchDock database. If the UI has no source ZIP import, source must be brought into its app workspace through a supported method.

App name: **Mixtap Hub**
Slug: **mixtap**
Hostname: **mixtap.ljas.ca**
Container port: **8787**
Health path: **/healthz**
Persistent storage: **ENABLED** (mounted at `/var/data`)
Dockerfile: included
Start command: default image CMD (`node server.mjs`)
Environment: **MIXTAP_ADMIN_TOKEN** = generate a strong unique secret; set only in LaunchDock environment settings. Set **MIXTAP_PUBLIC_ORIGIN=https://mixtap.ljas.ca**.

For **full YouTube playlist imports**, optionally set **YOUTUBE_API_KEY** to a YouTube Data API v3 key enabled in Google Cloud. Add it **only as a LaunchDock environment variable**, never in GitHub or the embedded widget. Individual YouTube links, Spotify links, saved playlists, and uploaded-music radio work without this API key. If the key is absent, importing a full YouTube playlist displays a clear configuration message instead of silently adding a single playlist placeholder.

Once deployed, the app should have a separate card, logs, build history, and Deploy controls in control.ljas.ca, subject to your LaunchDock configuration. Test /healthz, /widget.js, and a room GET from a guest browser before embedding in Retro Room. Publish uses a key entered into the hub page for each browser tab. Only the private key holder can update shared room state; reading and widget downloads are public.

## Persistent data

In LaunchDock managed Docker: `MIXTAP_DATA_DIR=/var/data`, stored in the named `launchdock-mixtap-data` volume when app slug is `mixtap` and persistent storage is enabled. The app does not write persistent files into /app. Ensure Deploy and rollback preserve that same named volume; reject any deployment where the mount is missing.

## Security

Do not put MIXTAP_ADMIN_TOKEN in the widget embed, source code, Git commits, or ChatGPT. Require TLS. The hub page is public but playlist writes are authenticated with Bearer key and constrained by Origin. The widget and room GET remain public to permit cross-origin guests on retro.ljas.ca. If you require all hub UI visitors to be authenticated, configure access at the reverse proxy separately but leave /widget.js and /api/rooms/retro96 GET public.

## Verification

1. Deploy Mixtap Hub and verify URL `https://mixtap.ljas.ca/healthz` returns service/version 1.2.4.
2. Visit `https://mixtap.ljas.ca/widget.js` in a logged-out browser: status 200.
3. Confirm `https://mixtap.ljas.ca/api/rooms/retro96` returns JSON and CORS/CORP headers.
4. Unlock publishing with the admin token in the hub interface and publish a test playlist.
5. Reload app/redeploy once; confirm the playlist is still available and the named volume didn't change.
6. Only then deploy the companion Retro Room patch which changes its widget URLs.


## Mixtap v1.2.4 playlist and radio workflow

1. **Playlists**: Choose a saved mix at the top or press **+** to clear the editor and start a new one. The stored mix is not deleted. Name it, add songs, and select **Save playlist** at the bottom.
2. **Music library**: Choose an uploaded song from the dropdown, add it to the current mix, or use the Music library tab to upload more songs. Such mixes are labelled **Music library**.
3. **YouTube / Spotify**: Add individual video/track links. A YouTube playlist URL is expanded into individual video entries using the YouTube Data API, fetching pages of up to 50 entries until complete or Mixtap's 500-item limit is reached. The editor tells you when the source list exceeds that limit. Private, deleted and unavailable videos cannot be imported.
4. **Radio Studio / Media library playlist**: Choose a saved playlist containing uploaded music, then **Start 24/7 Media library**. This uses the existing persisted server scheduler and does not require an open DJ browser.
5. **Radio Studio / Stream playlist**: Choose a saved playlist containing YouTube and/or Spotify links, then **Broadcast Stream playlist**. Embeds have provider restrictions: an open DJ page is needed for reliable track changes, visitors may have to press Play, and Spotify timing cannot be forced in sync.

**Safety:** The app continues to use `/var/data` for audio files, saved playlists, and radio state. Do not remove or rename the existing `launchdock-mixtap-data` volume. Updates should reuse the existing Mixtap app and existing volume, not create a second station. Verify a backup of `saved-playlists.json`, `audio-library.json`, and `rooms.json` before replacing a live build.

**Local validation without paid GitHub Actions:** Run `npm run check` (syntax and static UI regression tests), then `npm test` (starts a temporary local server, tests API authorization, playlist save/load, restart persistence and unavailable-key handling). `npm test` uses a temporary data directory and does not read or overwrite the live Mixtap volume.
