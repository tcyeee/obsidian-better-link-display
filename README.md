# Bookmarkify

[中文](README.zh.md)

An Obsidian plugin that turns a bare URL in your notes into a proper bookmark — the site's title and favicon — with one click.

## What it does

Hover a bare URL while editing a note and a **格式化** button appears above it:

```
https://example.com
```

Click it and the link enters a loading state — a soft grey, gently pulsing highlight — for up to ten seconds while Bookmarkify looks the page up. On success the URL is rewritten in place as a markdown link with the site's favicon embedded directly in it:

```
[![](data:image/png;base64,iVBORw0…) Example Domain](https://example.com)
```

If the lookup fails or takes longer than ten seconds, the link flashes red, a notice explains what went wrong, and the note is left untouched.

The icon lives in the note, not in a cache: the bookmark keeps rendering when the note is copied into another vault, another app, or a plain markdown file, with no plugin and no network involved. Icons are re-encoded to 16×16 so they sit at text height and cost roughly 900 characters of base64 each.

Nothing happens without a click — opening a note never issues a single request.

## Requirements

- Obsidian desktop (this plugin is desktop-only).
- Access to a Bookmarkify service exposing the `/extension/site-info` endpoint. Defaults to the hosted service at `https://bookmarkify.cc/api`; point **Server URL** at your own instance (e.g. `http://127.0.0.1:8001` when running the API locally) if you'd rather not use it.
- An **access token** generated from that service, used to authenticate requests.

See [api.md](api.md) for the API contract (`GET /extension/site-info?url=...`, `X-Extension-Token` header).

The service hands back favicons as short-lived signed CDN links, so the plugin downloads the image once at format time and stores it inline. That is the only request it ever makes to a host other than the configured server.

## Setup

1. Install and enable the plugin in Obsidian.
2. Generate an access token from the Bookmarkify web service's token management page.
3. Open **Settings → Bookmarkify** and paste the token into the **Access token** field. If your service does not run on the default address, set **Server URL** as well.
4. Open a note in editing mode, hover a bare URL, and click **格式化**.

The access token is read-only: it can only be used to look up page titles/favicons for arbitrary URLs, and cannot read or modify your bookmarks or account data.

## Limitations

- The hover button only appears in editing mode (Live Preview or Source mode), on a URL that stands on its own — not inside code blocks, frontmatter, or an existing markdown link.
- The embedded base64 makes the line long in Source mode. That is the price of a note that renders anywhere; Live Preview and Reading view show only the icon and title.
- Only `https:` icons are downloaded, and only if they decode as an image, so a misconfigured endpoint can't turn a note into a tracking pixel.

## Development

```bash
npm install
npm run dev      # watch build with esbuild
npm run build    # type-check + production build
```

The build outputs `main.js`, which along with `manifest.json` and `styles.css` is loaded by Obsidian as the plugin.

## License

MIT
