import {
	App,
	Editor,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownView,
	Notice,
	setIcon,
} from "obsidian";
import { showContextMenu } from "./contextMenu";
import {
	AppGridConfig,
	AppGridEntry,
	buildAppGridInsertion,
	normalizeAppGridUrl,
	parseAppGridConfig,
	parseAppGridSource,
	removeAppGridLine,
	setAppGridEntryName,
	upsertAppGridConfigLine,
} from "./appGridScan";
import { AppGridCache } from "./appGridCache";
import { lookupFailureMessage, SiteLookup } from "./lookup";
import { fallbackIcon, fetchIconPngBytes, iconPlateColorOf } from "./favicon";
import { showAppAddPanel } from "./appGridAddPanel";
import { showAppConfigPanel } from "./appGridConfigPanel";
import { AppGridEditNameModal } from "./appGridEditNameModal";
import { t } from "./i18n";

const GRID_CLASS = "better-link-display-app-grid";
const GRID_BACKGROUND_CLASS = "better-link-display-app-grid-bg";
const TILE_CLASS = "better-link-display-app-tile";
const TILE_PENDING_CLASS = "better-link-display-app-tile-pending";
const TILE_BACKGROUND_CLASS = "better-link-display-app-tile-bg";
/** On the icon itself, not the tile: the plate colour is sampled per icon, see {@link syncIconBackground}. */
const ICON_BACKGROUND_CLASS = "better-link-display-app-icon-autobg";
const ADD_TILE_CLASS = "better-link-display-app-add";
/** Only shown once the grid already has tiles — see {@link buildAddTile}. */
const ADD_TILE_TRAILING_CLASS = "better-link-display-app-add-trailing";
const CONFIG_BUTTON_CLASS = "better-link-display-app-config-button";

/**
 * The resolution of the initial-letter placeholder a tile wears until (or, if
 * the lookup fails, instead of) its real icon. Bigger than the 48px an inline
 * bookmark's icon is written at: a tile draws it at up to 40px, so that size
 * was soft on every high-density display.
 */
const PLACEHOLDER_ICON_PX = 128;

/** Only unloads when its block's element leaves the DOM — the cue to stop updating tiles. */
class AppGridRenderChild extends MarkdownRenderChild {
	cancelled = false;

	onunload(): void {
		this.cancelled = true;
	}
}

/**
 * Renders a `link-grid` code block: one tile per URL, the site's big icon
 * (`logo`, falling back to `favicon`) as the app icon and its short app name
 * (`appName`, falling back to `title`) as the label. Registered as a Markdown code-block
 * processor, so it covers Reading view directly; Obsidian's Live Preview
 * renders any registered code-block language the same way once the cursor
 * leaves the block, with no separate CodeMirror widget needed on this side.
 *
 * An add tile always follows the real ones — see {@link buildAddTile} for why
 * it's the one thing both an empty grid and a non-empty one in Reading view
 * still render, just inert there.
 */
export function renderAppGrid(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	lookup: SiteLookup,
	cache: AppGridCache,
	app: App
): void {
	const child = new AppGridRenderChild(el);
	ctx.addChild(child);

	const config = parseAppGridConfig(source);
	const grid = el.createDiv({ cls: GRID_CLASS });
	applyAppearance(grid, config);
	const entries = parseAppGridSource(source);
	entries.forEach((entry, index) => {
		const tile = buildTile(grid, entry);
		applyTileAppearance(tile, config);
		void resolveTile(tile, entry, lookup, cache, child, config);
		attachContextMenu(tile, entry, index, { app, ctx, el, lookup, cache, child, config });
	});

	buildAddTile(grid, entries.length > 0, (tile) => openAddPanel(app, ctx, el, tile));
	attachConfigButton(el, child, (button) => openConfigPanel(button, app, ctx, el));
}

/**
 * The size/spacing/area-background options, applied to the grid container
 * itself: `--better-link-display-app-icon-size` and the two class-driven
 * properties cascade down to every tile in `styles.css` without each one
 * needing its own `setCssProps` call, unlike the per-icon plate colour in
 * {@link syncIconBackground}, which genuinely differs tile to tile.
 */
function applyAppearance(grid: HTMLElement, config: AppGridConfig): void {
	grid.setCssProps({
		"--better-link-display-app-icon-size": `${config.iconSize}px`,
		"--better-link-display-app-gap": `${config.gap}px`,
	});
	grid.toggleClass(GRID_BACKGROUND_CLASS, !!config.background);
	if (config.background) grid.setCssProps({ "--better-link-display-app-bg": `#${config.background}` });
}

/**
 * The two per-tile appearance options, as classes only — the fixed colour
 * behind a tile ("Bookmark background") is drawn entirely in `styles.css`,
 * since nothing about it varies tile to tile. The icon plate's colour does,
 * and arrives separately through {@link syncIconBackground}, which is why this
 * runs on first render while the colour lands whenever the sampling answers —
 * nothing about the icon's box changes either way.
 */
function applyTileAppearance(tile: Tile, config: AppGridConfig): void {
	tile.anchor.toggleClass(TILE_BACKGROUND_CLASS, config.appBackground);
	tile.icon.toggleClass(ICON_BACKGROUND_CLASS, config.iconBackground);
}

/**
 * The "Icon background colour" option: tints the plate behind one icon from
 * that icon's own dominant colour rather than any single value shared by the
 * whole grid, so unlike {@link applyAppearance} this runs per tile, and only
 * once a *real* icon exists — see the call sites in {@link resolveTile} and
 * {@link updateTile}, and {@link iconPlateColorOf} for why the bytes are what
 * gets sampled rather than the image already on screen.
 *
 * `readPng` is a callback rather than the bytes themselves so that nothing is
 * read off disk for a grid whose tiles aren't tinted at all: the cached-icon
 * path has only the resource path in hand and would otherwise have to fetch
 * the file back before finding out the option is off.
 */
async function syncIconBackground(
	tile: Tile,
	config: AppGridConfig,
	child: AppGridRenderChild,
	readPng: () => Promise<ArrayBuffer | null>
): Promise<void> {
	if (!config.iconBackground) return;

	const bytes = await readPng();
	if (child.cancelled || !bytes) return;

	const color = await iconPlateColorOf(bytes);
	if (child.cancelled || !color) return;
	tile.icon.setCssProps({ "--better-link-display-app-icon-bg": `#${color}` });
}

/**
 * The dashed "+" tile that lets a user add a link without touching the
 * block's Markdown by hand. Always rendered — a blank block would otherwise
 * be an invisible, undiscoverable code fence — but only wired up inside Live
 * Preview's `.cm-editor`: Reading view re-renders a static page from the same
 * Markdown on every open, so there is no editor to write the new line into,
 * and clicking has to be a no-op there rather than a dead modal. `trailing`
 * only controls *when* it shows: once the grid already has tiles, it is kept
 * out of Reading view entirely (`styles.css`), since Reading view's tiles are
 * already plain links a reader can follow — nothing there invites adding to
 * them. An empty grid has no such reading, so its tile stays visible (just
 * inert) everywhere, matching the hint that cursor affordance gives: `default`
 * outside `.cm-editor`, `pointer` inside it.
 */
function buildAddTile(grid: HTMLElement, trailing: boolean, onAdd: (tile: HTMLElement) => void): void {
	const tile = grid.createDiv({
		cls: trailing ? `${ADD_TILE_CLASS} ${ADD_TILE_TRAILING_CLASS}` : ADD_TILE_CLASS,
	});
	tile.setAttribute("role", "button");
	tile.setAttribute("tabindex", "0");
	tile.setAttribute("aria-label", t("appGrid.add.aria"));
	setIcon(tile.createDiv({ cls: `${ADD_TILE_CLASS}-icon` }), "plus");

	const trigger = (event: Event) => {
		// The only reliable way to tell Live Preview from Reading view here: the
		// tile is built once and reused by whichever view rendered it, so this
		// has to be checked at the moment of the click rather than at render
		// time, when the element may not even be attached to the real DOM yet.
		if (!tile.closest(".cm-editor")) return;
		event.preventDefault();
		onAdd(tile);
	};
	tile.addEventListener("click", trigger);
	tile.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") trigger(event);
	});
}

/**
 * Opens the "Add an app" panel anchored to the add tile and, once submitted,
 * writes the URL into the block's own source line — right before its closing
 * fence, found through `getSectionInfo` on the same `el` the processor was
 * given (a child element won't resolve). The rewrite is all this does: Live
 * Preview re-renders the block from the changed document the same way it
 * would for an edit typed by hand, which is what gives the new tile its
 * pending icon/app name and, once the lookup answers, the real ones — see
 * {@link resolveTile}.
 */
function openAddPanel(
	app: App,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	tile: HTMLElement
): void {
	showAppAddPanel(tile, (url) => {
		const editor = findEditor(app, ctx.sourcePath);
		const info = ctx.getSectionInfo(el);
		if (!editor || !info) return;
		editor.replaceRange(`${url}\n`, { line: info.lineEnd, ch: 0 });
	});
}

/**
 * Inserts a settings (gear) button to the left of Obsidian's own "Edit this
 * block" button, inside the `.embed-actions` bar its generic code-block
 * widget builds in Live Preview — see `styles.css`'s note on `embed-actions`
 * for why that bar exists only there, never in Reading view. Reusing its
 * `embed-action` class rather than inventing one is what makes the new
 * button look and behave like Obsidian's own: `styles.css` has nothing to
 * add here, since the native rule already covers icon sizing and hover.
 *
 * The bar is not `el`'s sibling yet when this runs: the widget appends it to
 * `el.parentElement` right *after* calling the registered code-block
 * processor (us), in the same synchronous turn. A `MutationObserver` is what
 * waits for that rather than a plain query — cheaper than polling, and it
 * naturally does nothing in Reading view, where no such bar is ever added.
 * `child.register()` disconnects it either way once the block itself unloads.
 */
function attachConfigButton(
	el: HTMLElement,
	child: AppGridRenderChild,
	onOpen: (button: HTMLElement) => void
): void {
	const host = el.parentElement;
	if (!host) return;

	const insert = (bar: Element): void => {
		if (bar.querySelector(`.${CONFIG_BUTTON_CLASS}`)) return;
		const button = createDiv({ cls: `embed-action ${CONFIG_BUTTON_CLASS}` });
		button.setAttribute("aria-label", t("appGrid.config.aria"));
		setIcon(button, "settings");
		button.addEventListener("click", (event) => {
			event.preventDefault();
			onOpen(button);
		});
		bar.prepend(button);
	};

	const existing = host.querySelector(":scope > .embed-actions");
	if (existing) {
		insert(existing);
		return;
	}

	const observer = new MutationObserver(() => {
		const bar = host.querySelector(":scope > .embed-actions");
		if (!bar) return;
		insert(bar);
		observer.disconnect();
	});
	observer.observe(host, { childList: true });
	child.register(() => observer.disconnect());
}

/**
 * Opens the appearance panel for this block and, on every change, writes
 * the result back as the block's own first line — same `getSectionInfo`
 * lookup as {@link openAddPanel}, reading the body fresh at click time so
 * the panel starts from whatever the block actually holds rather than its
 * state when the block was last rendered. Each edit re-reads the body (and
 * re-finds the editor/section) rather than closing over the first lookup,
 * since the previous write already shifted line numbers and re-rendered the
 * block the panel's own anchor sits on top of.
 */
function openConfigPanel(
	button: HTMLElement,
	app: App,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement
): void {
	const editor = findEditor(app, ctx.sourcePath);
	const info = ctx.getSectionInfo(el);
	if (!editor || !info) return;
	const from = { line: info.lineStart + 1, ch: 0 };
	const to = { line: info.lineEnd, ch: 0 };
	const body = editor.getRange(from, to);

	showAppConfigPanel(button, parseAppGridConfig(body), (config) => {
		const freshEditor = findEditor(app, ctx.sourcePath);
		const freshInfo = ctx.getSectionInfo(el);
		if (!freshEditor || !freshInfo) return;
		const freshFrom = { line: freshInfo.lineStart + 1, ch: 0 };
		const freshTo = { line: freshInfo.lineEnd, ch: 0 };
		freshEditor.replaceRange(
			upsertAppGridConfigLine(freshEditor.getRange(freshFrom, freshTo), config),
			freshFrom,
			freshTo
		);
	});
}

/** The open editor, if any, for a note at `path` — a `link-grid` block is only editable while one exists. */
function findEditor(app: App, path: string): Editor | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === path) return view.editor;
	}
	return null;
}

interface Tile {
	anchor: HTMLAnchorElement;
	icon: HTMLImageElement;
	label: HTMLElement;
}

function buildTile(grid: HTMLElement, entry: AppGridEntry): Tile {
	const { url } = entry;
	const anchor = grid.createEl("a", {
		cls: `external-link ${TILE_CLASS} ${TILE_PENDING_CLASS}`,
		href: url,
	});
	const icon = anchor.createEl("img", {
		attr: { src: fallbackIcon(url, PLACEHOLDER_ICON_PX), alt: "" },
	});
	const label = anchor.createDiv({
		cls: `${TILE_CLASS}-label`,
		text: entry.name ?? hostnameOf(url) ?? url,
	});
	return { anchor, icon, label };
}

/**
 * A name written into the block's own source line (`entry.name`) always wins
 * over the cached or looked-up one: it is the user's explicit override, and
 * silently replacing it with whatever the service answers next would make
 * `setAppGridEntryName`'s write pointless.
 */
async function resolveTile(
	tile: Tile,
	entry: AppGridEntry,
	lookup: SiteLookup,
	cache: AppGridCache,
	child: AppGridRenderChild,
	config: AppGridConfig
): Promise<void> {
	const { url } = entry;
	const [cachedIconPath, cachedAppName] = await Promise.all([
		cache.getIconResourcePath(url),
		cache.getAppName(url),
	]);
	if (child.cancelled) return;

	if (cachedIconPath) {
		tile.icon.src = cachedIconPath;
		void syncIconBackground(tile, config, child, () => cache.readIconBytes(url));
	}
	if (!entry.name && cachedAppName) tile.label.setText(cachedAppName);

	if (cachedIconPath && (entry.name || cachedAppName)) {
		tile.anchor.removeClass(TILE_PENDING_CLASS);
		return;
	}

	const outcome = await lookup.resolveAppInfo(url);
	if (child.cancelled) return;

	// A failed lookup keeps whatever placeholder or cached value the tile
	// already has — a missing app name or icon is still worth showing a link for.
	if (outcome.ok) {
		if (!entry.name && !cachedAppName) {
			tile.label.setText(outcome.info.appName);
			void cache.setAppName(url, outcome.info.appName);
		}

		if (!cachedIconPath) {
			const bytes = await fetchIconPngBytes(outcome.info.iconSrc);
			if (child.cancelled) return;
			if (bytes) {
				await cache.writeIcon(url, bytes);
				const freshPath = await cache.getIconResourcePath(url);
				if (!child.cancelled && freshPath) {
					tile.icon.src = freshPath;
					void syncIconBackground(tile, config, child, () => Promise.resolve(bytes));
				}
			}
		}
	}

	tile.anchor.removeClass(TILE_PENDING_CLASS);
}

interface TileContext {
	app: App;
	ctx: MarkdownPostProcessorContext;
	el: HTMLElement;
	lookup: SiteLookup;
	cache: AppGridCache;
	child: AppGridRenderChild;
	config: AppGridConfig;
}

interface RegisteredTile {
	tile: Tile;
	url: string;
	index: number;
	context: TileContext;
}

/**
 * Keyed by the tile's own anchor rather than kept in a per-tile closure: the
 * one `contextmenu` listener installed by {@link ensureContextMenuCapture}
 * looks tiles up here instead of each tile owning its own listener — see
 * that function for why one listener has to cover every tile. A `WeakMap`
 * needs no matching cleanup when a block unloads and its tiles are GC'd.
 */
const tileRegistry = new WeakMap<HTMLAnchorElement, RegisteredTile>();

/** One `contextmenu` capture listener is ever installed per window — see {@link ensureContextMenuCapture}. */
const captureInstalled = new WeakSet<Window>();

/**
 * Registers this tile's menu and makes sure its window's capture listener
 * exists. Shown through `showContextMenu()` (`contextMenu.ts`) rather than
 * Obsidian's own `Menu` API — the one place in the plugin that hand-builds a
 * menu instead of reusing Obsidian's markup, since that danger styling and
 * the separator grouping delete apart from the rest aren't expressible
 * through `Menu`.
 */
function attachContextMenu(
	tile: Tile,
	entry: AppGridEntry,
	index: number,
	context: TileContext
): void {
	tileRegistry.set(tile.anchor, { tile, url: entry.url, index, context });
	const win = tile.anchor.ownerDocument.defaultView;
	if (win) ensureContextMenuCapture(win);
}

/**
 * Obsidian has its own `contextmenu` handling for editor content
 * (spellcheck/link/image menus) that asks the main process for native menu
 * params over IPC and, once that reply lands, shows its own menu unless the
 * event was already marked `defaultPrevented`. By the time that check runs
 * it's too late for a listener on the tile itself to matter: Obsidian's own
 * listener sits on an ancestor and calls `stopImmediatePropagation()` before
 * a descendant's bubble-phase listener — or even a same-element capture
 * listener registered after it — ever gets a turn.
 *
 * The only node that's guaranteed to see the event *before* any listener
 * Obsidian could have put on `document` or deeper is `window` itself, in the
 * capture phase: capture order follows DOM depth, not registration time, and
 * nothing sits above `window`. So rather than each tile fighting that race
 * on its own, one capture listener per window intercepts every right-click
 * unconditionally and looks up what, if anything, it landed on:
 *
 * - inside a registered tile → open that tile's menu;
 * - inside one of this plugin's grids but not a tile (padding, the gap
 *   between tiles, the add tile) → swallow it rather than let it bubble
 *   into whatever Obsidian or another plugin would otherwise show;
 * - anywhere else → leave it alone entirely, since this listener covers
 *   every grid in every open note and must never touch an unrelated
 *   right-click.
 *
 * Installed once per window (tracked in {@link captureInstalled}, a
 * `WeakSet` so a closed popout window's entry is dropped on its own) rather
 * than once per tile, since a later tile's listener couldn't out-race an
 * earlier one already sitting on the same node — the fix has to be "there is
 * only ever one, as high as possible", not "every tile gets its own".
 */
function ensureContextMenuCapture(win: Window): void {
	if (captureInstalled.has(win)) return;
	captureInstalled.add(win);
	win.addEventListener(
		"contextmenu",
		(event) => {
			if (!(event.target instanceof Element)) return;

			const anchor = event.target.closest<HTMLAnchorElement>(`a.${TILE_CLASS}`);
			if (anchor) {
				// This menu is a Live Preview affordance; Reading view still swallows
				// the event (no native link menu on a grid tile either) but doesn't
				// open it, since Delete has no editor behind the tile there to write
				// through.
				if (!anchor.closest(".cm-editor")) {
					event.preventDefault();
					event.stopImmediatePropagation();
					return;
				}
				const entry = tileRegistry.get(anchor);
				if (!entry) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				openTileMenu(entry, event.clientX, event.clientY);
				return;
			}

			if (event.target.closest(`.${GRID_CLASS}`)) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		},
		{ capture: true }
	);
}

/** Only ever called from inside `.cm-editor` — see the guard in {@link ensureContextMenuCapture}. */
function openTileMenu(entry: RegisteredTile, x: number, y: number): void {
	const { tile, url, index, context } = entry;
	showContextMenu(
		[
			{
				icon: "pencil",
				label: t("appGrid.menu.editName"),
				onClick: () => openEditNameModal(context, index, tile),
			},
			{
				icon: "refresh-cw",
				label: t("appGrid.menu.update"),
				onClick: () => void updateTile(tile, url, index, context),
			},
			{
				icon: "trash-2",
				label: t("appGrid.menu.delete"),
				danger: true,
				separatorBefore: true,
				onClick: () => deleteTile(context, index),
			},
		],
		x,
		y
	);
}

/**
 * Writes `transform(body)` back into the block's own source, where `body` is
 * the block's lines — everything between the fences, read fresh at the moment
 * of the write. The shared save path for every action that edits a block's
 * *body* rather than its config line (see {@link openConfigPanel}): the editor
 * and section are re-found each call rather than closed over, since a previous
 * write already shifted line numbers and re-rendered the block. `transform` is
 * handed the body the block actually holds and returns the whole replacement.
 */
function writeAppGridBody(context: TileContext, transform: (body: string) => string): void {
	const editor = findEditor(context.app, context.ctx.sourcePath);
	const info = context.ctx.getSectionInfo(context.el);
	if (!editor || !info) return;
	const from = { line: info.lineStart + 1, ch: 0 };
	const to = { line: info.lineEnd, ch: 0 };
	editor.replaceRange(transform(editor.getRange(from, to)), from, to);
}

/**
 * The "Edit name" dialog's save path. The name the user gives is written into
 * the block's own source line as `[Name](url)` — see {@link writeAppGridBody}
 * for the mechanics — rather than into the shared app-name cache, which is the
 * *looked-up* name every note with the same bare URL falls back to. The block
 * re-renders from the changed document, so there is no tile to update by hand:
 * {@link parseAppGridSource} hands the name straight back to {@link buildTile}
 * on the next pass. A name the user clears is reverted to a bare URL by
 * {@link setAppGridEntryName}, restoring the cached/looked-up name.
 */
function openEditNameModal(context: TileContext, index: number, tile: Tile): void {
	new AppGridEditNameModal(context.app, tile.label.textContent ?? "", (name) => {
		writeAppGridBody(context, (body) => setAppGridEntryName(body, index, name));
	}).open();
}

/**
 * The "Update app" action. Bypasses both caches on purpose — it is the one
 * action that re-asks the service for a page's name and icon — then writes the
 * freshly looked-up name back into the block's own source line as `[Name](url)`
 * (see {@link writeAppGridBody}), so the name becomes the user's explicit
 * override rather than something the next render re-falls back to the cache
 * for. The cache updates land first, so the re-render the write triggers shows
 * the fresh icon and name instead of the stale ones.
 */
async function updateTile(
	tile: Tile,
	url: string,
	index: number,
	context: TileContext
): Promise<void> {
	tile.anchor.addClass(TILE_PENDING_CLASS);
	const outcome = await context.lookup.resolveAppInfo(url);
	if (context.child.cancelled) return;
	tile.anchor.removeClass(TILE_PENDING_CLASS);

	if (!outcome.ok) {
		new Notice(lookupFailureMessage(outcome.reason));
		return;
	}

	tile.label.setText(outcome.info.appName);
	void context.cache.setAppName(url, outcome.info.appName);

	const bytes = await fetchIconPngBytes(outcome.info.iconSrc);
	if (context.child.cancelled || !bytes) return;
	await context.cache.writeIcon(url, bytes);
	const freshPath = await context.cache.getIconResourcePath(url);
	if (context.child.cancelled || !freshPath) return;
	tile.icon.src = freshPath;
	void syncIconBackground(tile, context.config, context.child, () => Promise.resolve(bytes));

	writeAppGridBody(context, (body) => setAppGridEntryName(body, index, outcome.info.appName));
}

/**
 * Removes this tile's line from the block's own source — see
 * {@link writeAppGridBody}. `index` is this tile's position among the block's
 * *valid* lines (see {@link removeAppGridLine}), not its raw line number, since
 * blank or commented-out lines would otherwise throw that off.
 */
function deleteTile(context: TileContext, index: number): void {
	writeAppGridBody(context, (body) => removeAppGridLine(body, index));
}

/**
 * "Insert APP view" from the editor's right-click menu. Appended at the end
 * of the cursor's line (see {@link buildAppGridInsertion}) rather than at the
 * cursor itself, so a click mid-line doesn't split that text around the block.
 */
export function insertAppGridBlock(editor: Editor): void {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const insertion = buildAppGridInsertion(line);
	const from = { line: cursor.line, ch: line.length };
	editor.replaceRange(insertion.text, from);
	editor.setCursor({
		line: from.line + insertion.cursorOffset.line,
		ch: insertion.cursorOffset.ch,
	});
}

function hostnameOf(url: string): string | null {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
}
