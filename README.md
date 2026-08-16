# Better Link Display

[中文](README.zh.md)

Turn a plain web link in your Obsidian note into a proper bookmark — the site's real title and its little icon — with one click.

**Before**

```
https://example.com
```

**After**

> 🌐 Example Domain

The bookmark is still just a normal link: click it and it opens the page.

---

## Contents

- [Installation](#installation)
- [First-time setup](#first-time-setup)
- [How to use it](#how-to-use-it)
- [Settings](#settings)
- [If something goes wrong](#if-something-goes-wrong)
- [Good to know](#good-to-know)
- [For developers](#for-developers)

---

## Installation

**From Obsidian (recommended)**

1. Open **Settings → Community plugins** and make sure *Restricted mode* is off.
2. Click **Browse**, search for **Better Link Display**, and click **Install**.
3. Click **Enable**.

**Manually**

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/tcyeee/obsidian-better-link-display/releases).
2. Put all three into `<your vault>/.obsidian/plugins/better-link-display/` (create the folder if it isn't there).
3. Restart Obsidian, then enable the plugin under **Settings → Community plugins**.

Works on Obsidian 1.13 and later, on desktop and mobile.

## First-time setup

The plugin can't read a web page's title on its own — it asks a small online service, [Bookmarkify](https://bookmarkify.cc), to do that. The service needs to know it's you asking, so you need a free **access token** once.

1. Go to [bookmarkify.cc](https://bookmarkify.cc), sign in, and open the token management page.
2. Create a token and copy it.
3. In Obsidian, open **Settings → Better Link Display**, paste the token into the **Access token** box.
4. Click **Test**. If it says *Success*, you're done.

The token is **read-only**. It can only be used to look up the title and icon of a web address — it cannot see or change your bookmarks or your account.

## How to use it

### With the mouse

Open a note **in editing mode**, hover over a web link, and a small **Format** button appears just above it.

Links can be written in any of these three ways:

```
https://example.com
[Example](https://example.com)
<https://example.com>
```

Click **Format**. The link glows softly while the plugin looks the page up — usually a second or two — and then the link turns into a bookmark with the site's name and icon.

If the lookup fails, the link flashes red, a message tells you why, and **your note is left exactly as it was**.

### With the keyboard (and on phones)

Put your cursor anywhere inside a link and run the command **Format link under cursor** from the command palette (`Cmd/Ctrl + P`). This does the same thing without a mouse — and it's how you use the plugin on a phone or tablet, where there is no hovering.

You can also give the command a hotkey under **Settings → Hotkeys**.

### Changing your mind

Hover over a link that's already been formatted and you get two buttons:

- **Reformat** — look the page up again and refresh the title and icon (handy if the site has since changed its name).
- **Reset** — take the icon back out, leaving a plain link with the title as its text:

  ```
  [Example Domain](https://example.com)
  ```

  Reset is instant and works offline — it just tidies up the text that's already in your note.

  One thing to expect: Reset goes back to *title + address*, not to whatever you originally typed. If you started with a bare `https://example.com`, that original text was already replaced by the site's title when you formatted it, and there's no way to bring it back.

## Settings

Open **Settings → Better Link Display**.

| Setting | What it does |
| --- | --- |
| **Language** | Switches the plugin's own settings and messages between English and 中文. Follows your Obsidian language by default. |
| **Preview** | A live sample bookmark so you can see the two options below before applying them. |
| **Background** | Gives formatted links a soft grey rounded background, like a little card. Off by default. |
| **Border** | Draws a light grey outline around formatted links. Off by default. |
| **Access token** | Your key to the lookup service. The **Test** button checks it right away. |

Background and Border are just looks — they change nothing in your notes, so you can turn them on and off freely, and they apply to every formatted link at once.

> One small quirk: the *name* of the **Format link under cursor** command only changes language after you restart Obsidian. Everything else switches immediately.

## If something goes wrong

Every message the plugin shows starts with "Better Link Display:". Here's what each one means:

| The message says | What to do |
| --- | --- |
| *Set the access token in settings first* | You haven't pasted a token yet — see [First-time setup](#first-time-setup). |
| *The access token is invalid or has been revoked* | Generate a fresh token on the service's website and paste it in again. |
| *No response from … Check your network connection* | You're offline, or the service is temporarily unreachable. Try again in a moment. |
| *… answered with an error* | The service itself is having trouble. Try again later. |
| *The service could not read this page's title* | That particular site is blocking automated readers. Nothing to fix — write the link's text yourself. |
| *No answer within 10 seconds* | The lookup took too long. Your note was not changed; just click **Format** again. |

**No Format button appears?** Check that you're in editing mode (Live Preview or Source mode) — the button doesn't exist in Reading view. Links inside code blocks and in a note's frontmatter are deliberately ignored, and so are image embeds like `![alt](…)`.

**A link with brackets in it won't format.** An address like `https://en.wikipedia.org/wiki/Foo_(bar)` gets no button, because Markdown itself can't tell where such an address ends. Wrap it in angle brackets — `<https://en.wikipedia.org/wiki/Foo_(bar)>` — or write it as `[text](address)` and it becomes formattable.

## Good to know

**Your notes stay yours.** What the plugin writes is ordinary Markdown, with the icon stored as text inside the link itself. Nothing plugin-specific is added. That means your formatted bookmarks keep working when you:

- disable or uninstall the plugin,
- copy the note into another vault, into a different app, or into a plain `.md` file,
- open the note with no internet connection.

**The trade-off:** because the icon is stored as text, that line looks very long in Source mode — a wall of random characters. In Live Preview and Reading view you only ever see the tidy icon and title. Each icon adds roughly 1,300–4,800 characters to the file. Icons are stored at 48×48 so they stay sharp on high-resolution screens while displaying at the height of your text.

**Nothing happens behind your back.** The plugin never contacts anything unless you click **Format** or run the command. Opening a note sends no requests. Formatting sends exactly two: one to the lookup service for the title and icon address, and one to download that icon. Only secure (`https`) icons are downloaded, and only if they really are images.

## For developers

The service contract is documented in [api.md](api.md).

```bash
npm install
npm run dev      # watch build
npm run build    # type-check + production build
npm test         # unit tests
```

The build produces `main.js`, which together with `manifest.json` and `styles.css` is what Obsidian loads.

## License

MIT
