import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import { parseAppGridSource } from "./appGridScan";
import { AppGridCache } from "./appGridCache";
import { SiteLookup } from "./lookup";
import { fallbackIcon, fetchIconPngBytes } from "./favicon";

const GRID_CLASS = "better-link-display-app-grid";
const TILE_CLASS = "better-link-display-app-tile";
const TILE_PENDING_CLASS = "better-link-display-app-tile-pending";

/** Only unloads when its block's element leaves the DOM — the cue to stop updating tiles. */
class AppGridRenderChild extends MarkdownRenderChild {
	cancelled = false;

	onunload(): void {
		this.cancelled = true;
	}
}

/**
 * Renders a `link-grid` code block: one tile per URL, favicon as the app icon
 * and site title as the app name. Registered as a Markdown code-block
 * processor, so it covers Reading view directly; Obsidian's Live Preview
 * renders any registered code-block language the same way once the cursor
 * leaves the block, with no separate CodeMirror widget needed on this side.
 */
export function renderAppGrid(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	lookup: SiteLookup,
	cache: AppGridCache
): void {
	const child = new AppGridRenderChild(el);
	ctx.addChild(child);

	const grid = el.createDiv({ cls: GRID_CLASS });
	for (const url of parseAppGridSource(source)) {
		const tile = buildTile(grid, url);
		void resolveTile(tile, url, lookup, cache, child);
	}
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
	const [cachedIconPath, cachedTitle] = await Promise.all([
		cache.getIconResourcePath(url),
		cache.getTitle(url),
	]);
	if (child.cancelled) return;

	if (cachedIconPath) tile.icon.src = cachedIconPath;
	if (cachedTitle) tile.label.setText(cachedTitle);

	if (cachedIconPath && cachedTitle) {
		tile.anchor.removeClass(TILE_PENDING_CLASS);
		return;
	}

	const outcome = await lookup.resolveTitleAndIconSrc(url);
	if (child.cancelled) return;

	// A failed lookup keeps whatever placeholder or cached value the tile
	// already has — a missing title or icon is still worth showing a link for.
	if (outcome.ok) {
		if (!cachedTitle) {
			tile.label.setText(outcome.info.title);
			void cache.setTitle(url, outcome.info.title);
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

function hostnameOf(url: string): string | null {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
}
