# Better Link Display

Turn a plain web link in your note into a bookmark with the site's real title and icon.

把笔记里的网址一键变成带网站标题和图标的书签。

![](./public/0.png)

It's still an ordinary Markdown link — the icon is inlined as text, so the bookmark keeps working with the plugin disabled, in another vault, or in any other Markdown app.

它依然是普通的 Markdown 链接——图标以文本形式内嵌，所以即使停用插件、换个库或换个 Markdown 应用，书签照样正常显示。



## How to use

**Option 1: Create a bookmark grid.** Right-click in a note and choose “Create bookmark view”, then add website links to display them in a grid.

方式一: 你可以通过在笔记中点击鼠标右键创建“书签视图”, 然后在其中添加网站链接, 网站链接将会呈现网格排布样式.

<img src="./public/1.gif" style="zoom:67%;" />



**Option 2: Format an existing link.** Hover over a website link and click “Format” to turn it into a bookmark with the site’s icon and title.

方式2: 鼠标悬浮在已有的网站链接上, 点击“格式化”, 即可将书签变为“图标+网站标题”样式.



<img src="./public/2.gif" style="zoom: 67%;" />



## Install

**Community plugins** → **Browse** → search *Better Link Display* → Install → Enable.

Requires Obsidian 1.13+, desktop and mobile.

## Setup

Titles come from a small online service, [Bookmarkify](https://bookmarkify.cc), so you need a free token once:

1. Sign in at [bookmarkify.cc](https://bookmarkify.cc) and create a token.
2. Paste it into **Settings → Better Link Display → Access token**.
3. Click **Test**.

The token is read-only — it can only look up a page's title and icon.



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
