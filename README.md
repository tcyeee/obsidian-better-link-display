# Better Link Display

Turn a plain web link in your note into a bookmark with the site's real title and icon.

把笔记里的网址一键变成带网站标题和图标的书签。

![](./public/0.gif)

It's still an ordinary Markdown link — the icon is inlined as text, so the bookmark keeps working with the plugin disabled, in another vault, or in any other Markdown app.

它依然是普通的 Markdown 链接——图标以文本形式内嵌，所以即使停用插件、换个库或换个 Markdown 应用，书签照样正常显示。

## Install

**Community plugins** → **Browse** → search *Better Link Display* → Install → Enable.

Requires Obsidian 1.13+, desktop and mobile.

## Setup

Titles come from a small online service, [Bookmarkify](https://bookmarkify.cc), so you need a free token once:

1. Sign in at [bookmarkify.cc](https://bookmarkify.cc) and create a token.
2. Paste it into **Settings → Better Link Display → Access token**.
3. Click **Test**.

The token is read-only — it can only look up a page's title and icon.

## Use

In editing mode, hover a link and pick **Format** from the little menu. Works with all three forms:

```
https://example.com
[Example](https://example.com)
<https://example.com>
```

No mouse (or on mobile)? Put the cursor in the link and run **Format link under cursor** from the command palette.

The menu on an already-formatted link offers **Reformat** (look it up again) and **Reset** (strip the icon, leaving `[Title](url)` — instant and offline).

Choose **Custom name** on any link to enter your own title, then **Save** (or press Enter). This works offline and keeps the existing icon. Reformat replaces the custom title with the site's title again.

When no icon is available, formatting or setting a custom name uses the root domain's first letter on a grey background as the logo.

If a lookup fails, a notice explains why and your note is left untouched.

## Bookmark grid

A `link-grid` code block renders a grid of bookmark tiles — one per URL, showing the site's app icon and name. Right-click in the editor and choose **Insert bookmark view**, or type it by hand:

    ```link-grid
    https://example.com
    https://github.com
    ```

Each line is a bare URL or `[Name](url)` to give a tile your own title.

In Live Preview:

- Click the **+** tile to add a link — enter a domain (`example.com`) or a full URL, then **Add**.
- Right-click a tile for **Edit name**, **Update bookmark** (re-fetch the icon and name), or **Delete bookmark**.
- Click the gear button beside the block for its appearance: icon size, spacing, area background, a card behind each tile, and a colour plate tinted from each icon.

Reading view shows the same grid as plain links — the editing controls only exist in Live Preview. Icons and titles are cached in your vault, so tiles load instantly after the first lookup; clear the cache from settings.

## Settings

| Setting | |
| --- | --- |
| **Language** | English / 中文, following Obsidian by default. |
| **Preview** | Live sample of the two options below. |
| **Background** | Soft grey card behind formatted links. Off by default. |
| **Border** | Light outline around formatted links. Off by default. |
| **Access token** | Your lookup key, with a **Test** button. |
| **Cache location** | Vault-relative folder where bookmark-grid icons and titles are cached. |
| **Cache** | Icons and titles already looked up for bookmark grids, with a **Clear cache** button. |

Background and Border are purely visual and change nothing in your notes.

## Notes

- No menu appears in Reading view, inside code blocks or frontmatter, or on image embeds.
- A bare URL containing brackets — `https://en.wikipedia.org/wiki/Foo_(bar)` — is skipped, since Markdown can't tell where it ends. Wrap it in `<…>` or write it as `[text](url)`.
- Because the icon is inlined, formatted lines look long in Source mode (~1,300–4,800 characters per icon). Live Preview and Reading view show only the icon and title.
- Nothing is sent anywhere until you click **Format**: one lookup request, one icon download (`https` images only).
- The **Format link under cursor** command name only changes language after a restart.


## License

MIT
