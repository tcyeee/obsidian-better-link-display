import { App, Editor, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, setIcon } from "obsidian";
import { buildAppGridInsertion, normalizeAppGridUrl, parseAppGridSource } from "./appGridScan";
import { AppGridCache } from "./appGridCache";
import { SiteLookup } from "./lookup";
import { fallbackIcon, fetchIconPngBytes } from "./favicon";
import { AppGridAddModal } from "./appGridAddModal";
import { t } from "./i18n";

const GRID_CLASS = "better-link-display-app-grid";
const TILE_CLASS = "better-link-display-app-tile";
const TILE_PENDING_CLASS = "better-link-display-app-tile-pending";
const ADD_TILE_CLASS = "better-link-display-app-add";
/** Only shown once the grid already has tiles — see {@link buildAddTile}. */
const ADD_TILE_TRAILING_CLASS = "better-link-display-app-add-trailing";

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

	const grid = el.createDiv({ cls: GRID_CLASS });
	const urls = parseAppGridSource(source);
	for (const url of urls) {
		const tile = buildTile(grid, url);
		void resolveTile(tile, url, lookup, cache, child);
	}

	buildAddTile(grid, urls.length > 0, () => openAddModal(app, ctx, el));
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
function buildAddTile(grid: HTMLElement, trailing: boolean, onAdd: () => void): void {
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
		onAdd();
	};
	tile.addEventListener("click", trigger);
	tile.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") trigger(event);
	});
}

/**
 * Opens the "Add an app" dialog and, once submitted, writes the URL into the
 * block's own source line — right before its closing fence, found through
 * `getSectionInfo` on the same `el` the processor was given (a child element
 * won't resolve). The rewrite is all this does: Live Preview re-renders the
 * block from the changed document the same way it would for an edit typed by
 * hand, which is what gives the new tile its pending icon/app name and, once
 * the lookup answers, the real ones — see {@link resolveTile}.
 */
function openAddModal(app: App, ctx: MarkdownPostProcessorContext, el: HTMLElement): void {
	new AppGridAddModal(app, (url) => {
		const editor = findEditor(app, ctx.sourcePath);
		const info = ctx.getSectionInfo(el);
		if (!editor || !info) return;
		editor.replaceRange(`${url}\n`, { line: info.lineEnd, ch: 0 });
	}).open();
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

function buildTile(grid: HTMLElement, url: string): Tile {
	const anchor = grid.createEl("a", {
		cls: `external-link ${TILE_CLASS} ${TILE_PENDING_CLASS}`,
		href: url,
	});
	const icon = anchor.createEl("img", { attr: { src: fallbackIcon(url), alt: "" } });
	const label = anchor.createDiv({ cls: `${TILE_CLASS}-label`, text: hostnameOf(url) ?? url });
	return { anchor, icon, label };
}

async function resolveTile(
	tile: Tile,
	url: string,
	lookup: SiteLookup,
	cache: AppGridCache,
	child: AppGridRenderChild
): Promise<void> {
	const [cachedIconPath, cachedAppName] = await Promise.all([
		cache.getIconResourcePath(url),
		cache.getAppName(url),
	]);
	if (child.cancelled) return;

	if (cachedIconPath) tile.icon.src = cachedIconPath;
	if (cachedAppName) tile.label.setText(cachedAppName);

	if (cachedIconPath && cachedAppName) {
		tile.anchor.removeClass(TILE_PENDING_CLASS);
		return;
	}

	const outcome = await lookup.resolveAppInfo(url);
	if (child.cancelled) return;

	// A failed lookup keeps whatever placeholder or cached value the tile
	// already has — a missing app name or icon is still worth showing a link for.
	if (outcome.ok) {
		if (!cachedAppName) {
			tile.label.setText(outcome.info.appName);
			void cache.setAppName(url, outcome.info.appName);
		}

		if (!cachedIconPath) {
			const bytes = await fetchIconPngBytes(outcome.info.iconSrc);
			if (child.cancelled) return;
			if (bytes) {
				await cache.writeIcon(url, bytes);
				const freshPath = await cache.getIconResourcePath(url);
				if (!child.cancelled && freshPath) tile.icon.src = freshPath;
			}
		}
	}

	tile.anchor.removeClass(TILE_PENDING_CLASS);
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
