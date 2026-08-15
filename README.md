# Better Link Display

[中文](README.zh.md)

An Obsidian plugin that turns an external link in your notes into a proper bookmark — the site's title and favicon — with one click.

## What it does

Hover an external link while editing a note and a **Format** button appears above it. Bare URLs, Markdown links, and autolinks are supported:

```
https://example.com
[Example](https://example.com)
<https://example.com>
```

Click it and the link enters a loading state — a gently pulsing highlight — for up to ten seconds while Better Link Display looks the page up. On success the URL is rewritten in place as a markdown link with the site's favicon embedded directly in it:

```
[![](data:image/png;base64,iVBORw0…) Example Domain](https://example.com)
```

If the lookup fails or takes longer than ten seconds, the link flashes red, a notice explains what went wrong, and the note is left untouched.

The same action is available from the command palette as **Format link under cursor**, which works without a pointer and is the way to use the plugin on mobile.

The icon lives in the note, not in a cache: the bookmark keeps rendering when the note is copied into another vault, another app, or a plain markdown file, with no plugin and no network involved. What gets written is ordinary Markdown — nothing plugin-specific is stored alongside it, so disabling or uninstalling the plugin leaves every formatted link intact.

Icons are re-encoded to 48×48 — three source pixels per CSS pixel, so they stay sharp on high-density displays while rendering at text height. That costs between about 1,300 and 4,800 characters of base64 per icon, measured across a handful of real favicons.

Nothing happens without a click — opening a note never issues a single request.

## Requirements

- Obsidian 1.0 or later. On mobile, use the command rather than the hover button.
- A connection to the hosted Bookmarkify service at `https://bookmarkify.cc/api`, which resolves page titles and icons.
- An **access token** generated from that service, used to authenticate requests.

See [api.md](api.md) for the API contract (`GET /extension/site-info?url=...`, `X-Extension-Token` header).

The service hands back favicons as short-lived signed CDN links, so the plugin downloads the image once at format time and stores it inline. That is the only request it ever makes to a host other than the service itself.

## Setup

1. Install and enable the plugin in Obsidian.
2. Generate an access token from the Bookmarkify web service's token management page.
3. Open **Settings → Better Link Display** and paste the token into the **Access token** field, then press **Test** to confirm the service accepts it.
4. Open a note in editing mode, hover an external link, and click **Format** — or put the caret on a link and run **Format link under cursor**.

Under **General**, the **Language** setting switches the plugin's own settings and messages between English and 中文; it defaults to your Obsidian interface language. The command name follows after Obsidian is restarted.

The access token is read-only: it can only be used to look up page titles/favicons for arbitrary URLs, and cannot read or modify your bookmarks or account data.

## Limitations

- Formatting only works in editing mode (Live Preview or Source mode). Code blocks, frontmatter, and external image embeds are ignored.
- The embedded base64 makes the line long in Source mode. That is the price of a note that renders anywhere; Live Preview and Reading view show only the icon and title.
- A bare URL containing a bracket — `https://en.wikipedia.org/wiki/Foo_(bar)` — is not offered a button, because Markdown cannot tell where such a URL ends. Wrap it in `<…>` or write it as `[text](…)` and it becomes formattable.
- Only `https:` icons are downloaded, and only if they decode as an image, so a misconfigured endpoint can't turn a note into a tracking pixel.
- There is no "unformat" action. The original bare URL is replaced by the site's title, so reverting would have to guess what the line looked like before.

## Development

```bash
npm install
npm run dev      # watch build with esbuild
npm run build    # type-check + production build
```

The build outputs `main.js`, which along with `manifest.json` and `styles.css` is loaded by Obsidian as the plugin.

## License

MIT
