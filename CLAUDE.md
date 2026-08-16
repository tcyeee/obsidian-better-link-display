# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                          # esbuild watch → main.js (inline sourcemap)
npm run build                        # tsc -noEmit -skipLibCheck, then production bundle
npm test                             # node:test via tsx over src/**/*.test.ts
npx tsx --test src/urlScan.test.ts   # one test file
npx tsx --test --test-name-pattern "bare external URL" "src/**/*.test.ts"
```

Only the pure-string modules (`src/urlScan.ts`, `src/verbatim.ts`, `src/bookmarkScan.ts`) have tests — they import nothing from `obsidian`, which is what makes them runnable outside the app. Keep new text/parsing logic there rather than inline in the editor extension so it stays testable.

To try a build inside a vault, the `/obsidian-dev` skill builds and copies `main.js` + `manifest.json` + `styles.css` into a local vault.

Releases: `npm version <x.y.z>` runs `version-bump.mjs` (syncs `manifest.json` + `versions.json`), then pushing an **annotated** tag triggers `.github/workflows/release.yml`, which uses the tag's annotation as the release notes and attaches the three plugin files.

## Architecture

An Obsidian plugin that rewrites an external link in a note into a Markdown bookmark carrying the site's title and a base64-inlined favicon.

**The central invariant: nothing plugin-specific is ever written into the user's note.** The output of `bookmarkMarkdown()` is ordinary Markdown — `[![](data:image/png;base64,…) Title](url)` — so notes keep rendering with the plugin disabled, uninstalled, or in another app. Two consequences ripple through the codebase:

- Nothing in the note tells `styles.css` which links are formatted, and `:has()` — the obvious way to select a link *containing* the inlined icon — is rejected by plugin review. `src/bookmarkMarks.ts` bridges that gap and is the only thing the stylesheet matches on. It works **four** ways, because the two views render the same Markdown differently and CodeMirror does not allow all of them:
  - Reading view nests the icon inside `a.external-link` → a Markdown post-processor adds `better-link-display-bookmark` to the anchor.
  - Live Preview renders the icon as an `.image-embed` next to a `.cm-link` inside one `.cm-line`. The embed is inside an Obsidian widget, which CodeMirror's mutation observer ignores, so `better-link-display-embed` is added to it in the DOM — from `requestMeasure`, since a `ViewPlugin`'s `update` runs *before* CodeMirror syncs its DOM.
  - The `.cm-line` itself belongs to CodeMirror, which wipes a foreign class off it on the next sync, so `better-link-display-line` is a `Decoration.line` computed from the document text (`](data:image/`), skipping lines that intersect the selection because Live Preview shows those as raw Markdown.
  - Live Preview has no single element holding one bookmark — the icon and the title are separate elements — so anything drawn *around* a whole bookmark (the background and border options) needs one of its own: `better-link-display-plate` is a `Decoration.mark` over the source range `src/bookmarkScan.ts` finds. Three details are load-bearing, and all three were wrong at some point before being checked against a real render:
    - The mark is `inclusive`, or it would not cover the icon widget, which starts where it does.
    - It is provided through `EditorView.outerDecorations`, **not** the ordinary `decorations` facet at any precedence. CodeMirror nests overlapping marks innermost-first by decoration-set order, and Obsidian's live-preview decorations are registered after a plugin's at the same precedence — so even `Prec.lowest` loses, and the plate ends up inside `.cm-link`, cut into one span per run of text. `updateDeco()` appends `outerDecorations` after every `decorations` value, so it wraps by construction. It is feature-detected (@codemirror/view 6.29+); without it no plate is drawn at all, which is better than a split one.
    - `styles.css` gives the embed `display: inline-block`. Obsidian renders it as a `div`, and a block-level box inside the inline plate splits the plate and drops the icon onto its own line.

  A styling change to one view almost always needs the mirrored rule for the other, and a new rule needs its mark added to that module rather than a `:has()`.
- There is no state to migrate. The hover button's **Reset** is not an undo either: `bookmarkScan.withoutInlineIcon()` rebuilds `[Title](url)` from the source range alone — it refuses anything that is not exactly one whole bookmark — so it can only reach the plain link, never whatever the line held before the first format.

**Flow of one format** (hover button or the `format-link-under-cursor` command, both entering `BetterLinkDisplayEditorFeature`):

1. `verbatim.inVerbatimBlock()` rejects fenced code blocks and frontmatter (cached per immutable `Text` doc version).
2. `urlScan.findExternalLinkAt()` — pure string work on a single line — returns the source range to replace for a Markdown link, autolink, or bare URL. It deliberately refuses truncated bare URLs (a bracket right after the match) and `![alt](url)` embeds.
3. `SiteLookup` (`src/lookup.ts`) serialises every request through one promise chain with ≥350 ms spacing and a 10 s timeout, shared with the settings **Test** button so the two can't race past the service's rate limit.
4. `api.fetchSiteInfo()` calls `GET {API_BASE}/extension/site-info` with an `X-Extension-Token` header and maps outcomes onto the distinct failure reasons (`auth` / `unresolved` / `unreachable` / `server`), which stay separate all the way to the user-facing notice because each implies a different fix. `src/api.ts` is the only description of the service contract.
5. `favicon.toInlineIcon()` downloads the short-lived signed CDN URL and re-encodes it through a canvas to a fixed 48×48 PNG (rendered at 16px by CSS). A missing icon degrades to a bookmark without one, never a failed lookup.
6. The rewrite is dispatched as a CodeMirror transaction.

**Position safety.** In-flight links are held as decorations in the `pendingField` `StateField`, so their offsets are mapped through any edit the user makes while the request runs. Before writing, `format()` re-checks that `sliceDoc(range)` still equals the exact source text the button was offered for — otherwise the mark is cleared and the note left alone. The same field powers the loading/failure highlights and prevents overlapping formats.

Security limits worth preserving when touching `favicon.ts` / `urlScan.ts`: only `https:` icons are downloaded, the response `content-type` must be `image/*`, `data:` sources must pass `isSafeFaviconSrc()`, and both source bytes and encoded output are capped.

**i18n** (`src/i18n.ts`): the `en` table is the source of truth and `zh` is typed as `Record<TranslationKey, string>`, so adding a key without translating it fails the type-check. The active language is module-level state set by `loadSettings()` and the settings dropdown. Obsidian reads a command's name once at load, so `command.formatLink` only follows a language change after a restart — the README says so; don't "fix" it by re-registering the command.

`loadSettings()` whitelists each field explicitly rather than spreading stored data, so an unknown key in `data.json` can't reach the settings object.

**Settings** (`src/settings.ts`) are declared through `getSettingDefinitions()` rather than `display()`, which is what puts them in Obsidian's settings search — the search index is built from each definition's `name`/`desc` without the tab ever being rendered. Every row is `render`-type (the framework hands over an empty `Setting` to hang controls on) rather than `control`-type, because a `control` is read and written through `getControlValue`/`setControlValue` keyed by string and none of these rows want that: the appearance toggles call `applyAppearance()` on the way past and the token field debounces its own writes. A language change needs `this.update()`, not `refreshDomState()` — the translated strings were evaluated once when the definitions were built, and only rebuilding them picks up the new language. The two calls split the rest of the tab's dynamic behaviour too: the **Lookup service** group moves to the top of the page while `accessToken` is empty, but that order is fixed when the definitions are built, so the group can't jump around while a token is being typed into it; the setup banner above the field is the part that has to follow the value, so it is a `visible` predicate the token's `onChange` re-runs through `refreshDomState()` — and only on the empty/non-empty transition. This is the reason `minAppVersion` is 1.13.0; don't reintroduce `display()` alongside it, since a plugin whose `getSettingDefinitions()` returns a non-empty array never has `display()` called.

## Conventions

Tabs, and comments that explain *why* a constraint exists rather than what the line does — match that density. Obsidian's plugin review rules apply: no `!important`, 6-digit hex colours, no `:has()`, no inline style assignment or created `<style>` elements (styling goes through classes in `styles.css`), no `innerHTML`, and no API newer than the manifest's `minAppVersion`, which is 1.13.0 — raised from 1.0.0 so the settings tab could move to `getSettingDefinitions()`. The `/obsidian-plugin-lint` skill checks these.

`README.md` is the only doc: the intro pairs each English line with its Chinese line, the rest is English, and there is no separate translation to keep in sync. It describes user-visible behaviour only; keep it short, and put screenshots in `public/`.
