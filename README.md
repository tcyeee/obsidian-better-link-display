# Bookmarkify

[中文](README.zh.md)

An Obsidian plugin that turns bare URL links in your notes into rich bookmarks — automatically fetching the site's favicon and title.

## What it does

When Obsidian renders a note in Reading view, Bookmarkify scans for "bare" links — links whose visible text is the raw URL itself, e.g.:

```
https://example.com
```

For each one, it queries a local Bookmarkify service for the page's title and favicon, then replaces the plain link text with the site's icon and title:

```
🌐 Example Domain
```

The underlying link still points to the original URL.

Lookups are issued one at a time, spaced to stay under the service's rate limit, and successful results are cached for the session so the same link is only looked up once. Failures caused by an outage or a bad token are *not* cached — fixing the problem takes effect on the next render.

## Requirements

- Obsidian desktop (this plugin is desktop-only).
- A running Bookmarkify service exposing the `/extension/site-info` endpoint. The default address is `http://127.0.0.1:8001`, configurable in settings.
- An **access token** generated from that service, used to authenticate requests.

See [api.md](api.md) for the API contract (`GET /extension/site-info?url=...`, `X-Extension-Token` header).

## Setup

1. Install and enable the plugin in Obsidian.
2. Generate an access token from the Bookmarkify web service's token management page.
3. Open **Settings → Bookmarkify** and paste the token into the **Access token** field. If your service does not run on the default address, set **Server URL** as well.
4. Open (or re-render) a note containing a bare URL link to see it enhanced automatically.

The access token is read-only: it can only be used to look up page titles/favicons for arbitrary URLs, and cannot read or modify your bookmarks or account data.

## Limitations

- Only Reading view is enhanced; Live Preview and Source mode show the raw URL.
- Favicons are only rendered when the service returns them as `data:` URLs, so that opening a note never issues requests to third-party hosts.

## Development

```bash
npm install
npm run dev      # watch build with esbuild
npm run build    # type-check + production build
```

The build outputs `main.js`, which along with `manifest.json` and `styles.css` is loaded by Obsidian as the plugin.

## License

MIT
