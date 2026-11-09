# Plex Downloader

A web page that downloads videos from your own Plex Media Server to the phone or computer you open it on. Files come down as the originals (no conversion, full quality). Nothing to install, and no server of its own: the browser talks straight to plex.tv and to your Plex server.

Open `/plex/` on the deployed site. It must be served over **HTTPS** (GitHub Pages, Vercel, Netlify all are).

## How to use

1. **Sign in with Plex.** A Plex page opens; approve it and come back.
2. **Pick a server.** The app tries every address Plex knows for it and keeps the first that answers. If only Plex Relay works, it warns you: relay is capped at a few Mbit/s, so turn on *Settings → Remote Access* in Plex for full speed.
3. **Browse** Movies / TV libraries, search by title.
4. **Download** a movie, an episode, or a whole season ("Download all"). "Copy link" gives a direct link for a download manager.

Where files land: iPhone/iPad → Files app → Downloads. Android → Downloads. Computer → your Downloads folder.

If you can't connect by sign-in, open *Connect with an address and token instead* and paste your server's `https://…plex.direct:32400` address and your X-Plex-Token.

## How it works

| Step | Plex API call |
|---|---|
| Sign-in | `POST plex.tv/api/v2/pins`, user approves at `app.plex.tv/auth`, poll `GET pins/{id}` for the token |
| Servers | `GET plex.tv/api/v2/resources?includeHttps=1&includeRelay=1` |
| Connection | `GET {uri}/identity` on all direct HTTPS connections in parallel, relay only as fallback |
| Libraries | `GET /library/sections` (movie and show types only) |
| Titles | `GET /library/sections/{key}/all`, then `/library/metadata/{id}/children` for seasons and episodes |
| File | `{uri}{Part.key}?download=1&X-Plex-Token=…` |

The Plex token is kept in this browser's local storage only. **Sign out** clears it.

## Limits

- An https page can't call an `http://` server address. The sign-in route uses Plex's `plex.direct` HTTPS addresses, which avoids this.
- On a server someone shared with you, the owner must allow downloads for your account.
- Browsers may ask permission before "Download all" starts several files.
