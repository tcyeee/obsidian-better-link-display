import { arrayBufferToBase64, requestUrl } from "obsidian";
import { isSafeFaviconSrc } from "./urlScan";
import { logWarn } from "./log";
import { iconPlateColor } from "./iconColor";
import { siteInitial } from "./siteInitial";

/**
 * The size of an icon inlined into a note. That one is rendered at its natural
 * pixel size wherever the note ends up, so it is fixed rather than a cap: keep
 * three source pixels for each CSS pixel at the usual 16px body size so
 * high-density displays stay sharp; the rendered size is controlled separately
 * in styles.css.
 */
const ICON_PX = 48;

/**
 * The cap for an icon cached as a *file* for an app-grid tile. A tile draws its
 * icon at up to 40px through the config panel, and up to 96px if the block's
 * `icon=` is written by hand — so {@link ICON_PX}, sized for a 16px inline
 * bookmark, left every tile visibly soft on a high-density display.
 *
 * Unlike the inline path this is only an upper bound, and nothing pads the
 * result to it: a cached file's intrinsic size doesn't matter (styles.css fixes
 * the tile's `img` box either way), and stretching a small favicon up to the
 * cap would interpolate blur into it rather than add any detail.
 */
const CACHED_ICON_MAX_PX = 192;

/** Refuse to download something that clearly isn't a favicon. */
const MAX_SOURCE_BYTES = 512 * 1024;

/** Cap pathological output without rejecting normal 48px PNG favicons. */
const MAX_INLINE_LENGTH = 32 * 1024;

/**
 * A local PNG keeps the fallback portable just like a downloaded favicon.
 *
 * `px` defaults to the inline icon's size, which is the one that has to stay
 * exact — it is written into the note and rendered at its intrinsic size. An
 * app-grid tile passes its own, larger size instead: its placeholder is what a
 * link whose lookup failed keeps wearing, so it would otherwise be the one
 * blurry icon left in the grid. Every measurement below is a ratio of `px` so
 * the two only differ in resolution.
 */
export function fallbackIcon(url: string, px: number = ICON_PX): string {
	const canvas = createEl("canvas");
	canvas.width = px;
	canvas.height = px;
	const context = canvas.getContext("2d");
	if (!context) return "";
	context.fillStyle = "#808080";
	context.fillRect(0, 0, px, px);
	context.fillStyle = "#ffffff";
	context.font = `bold ${Math.round((px * 2) / 3)}px sans-serif`;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(siteInitial(url), px / 2, px / 2, px - px / 6);
	return canvas.toDataURL("image/png");
}

/**
 * Turn whatever the service returned into a self-contained `data:` URL.
 *
 * The service hands back short-lived signed CDN links, so the bytes have to be
 * pulled down while they are still reachable. Returns "" when no usable icon
 * could be produced — a bookmark without an icon is still worth writing.
 */
export async function toInlineIcon(src: string): Promise<string> {
	if (!src) return "";

	// A `data:` URL is used as delivered, but only once it is confirmed to be an
	// image: the decoder must never be handed `data:text/html,…` on the word of
	// whatever server happens to be configured.
	let source: string;
	if (src.startsWith("data:")) {
		source = isSafeFaviconSrc(src) ? src : "";
		if (!source) logWarn("favicon: inline data: URL rejected by isSafeFaviconSrc()");
	} else {
		source = await download(src);
	}
	if (!source) return "";

	const inlined = await encodeAtTargetResolution(source);
	if (inlined.length > MAX_INLINE_LENGTH) {
		logWarn(
			`favicon: encoded icon is ${inlined.length} bytes, over the ${MAX_INLINE_LENGTH} cap — dropped`
		);
		return "";
	}
	return inlined;
}

/**
 * Same download-and-resize pipeline as {@link toInlineIcon}, for a caller that
 * wants to write the PNG to a file instead of inlining it as a `data:` URL —
 * there is no `MAX_INLINE_LENGTH` cap here, since that limit exists only to
 * bound how much a *note* grows, and a standalone file has no such pressure.
 */
export async function fetchIconPngBytes(src: string): Promise<ArrayBuffer | null> {
	if (!src) return null;

	let source: string;
	if (src.startsWith("data:")) {
		source = isSafeFaviconSrc(src) ? src : "";
		if (!source) logWarn("favicon: inline data: URL rejected by isSafeFaviconSrc()");
	} else {
		source = await download(src);
	}
	if (!source) return null;

	return encodeAtTargetResolutionToBytes(source);
}

async function download(src: string): Promise<string> {
	if (!/^https:\/\//i.test(src)) {
		logWarn(`favicon: refusing to download a non-https source: ${src}`);
		return "";
	}

	try {
		const response = await requestUrl({ url: src, method: "GET", throw: false });
		if (response.status !== 200) {
			logWarn(`favicon: download returned HTTP ${response.status} for ${src}`);
			return "";
		}
		if (response.arrayBuffer.byteLength > MAX_SOURCE_BYTES) {
			logWarn(
				`favicon: download is ${response.arrayBuffer.byteLength} bytes, over the ${MAX_SOURCE_BYTES} cap — ${src}`
			);
			return "";
		}

		const mime = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
		if (!mime.startsWith("image/")) {
			logWarn(`favicon: download had a non-image content-type "${mime}" for ${src}`);
			return "";
		}

		return `data:${mime};base64,${arrayBufferToBase64(response.arrayBuffer)}`;
	} catch (error) {
		// A missing icon is never worth failing the whole lookup over.
		logWarn(`favicon: download threw for ${src}`, error);
		return "";
	}
}

/** Re-encode to a `data:` URL, at the resolution {@link drawAtTargetResolution} fixes. */
async function encodeAtTargetResolution(dataUrl: string): Promise<string> {
	const canvas = await drawAtTargetResolution(dataUrl, ICON_PX, "exact");
	// The canvas is ICON_PX square by construction, so what it exports is too.
	return canvas ? canvas.toDataURL("image/png") : "";
}

/**
 * Same pipeline, for a caller that wants PNG bytes rather than a `data:` URL —
 * and at the larger {@link CACHED_ICON_MAX_PX}, since a file is only ever read
 * back by an app-grid tile, which draws it far bigger than 16px.
 */
async function encodeAtTargetResolutionToBytes(dataUrl: string): Promise<ArrayBuffer | null> {
	const canvas = await drawAtTargetResolution(dataUrl, CACHED_ICON_MAX_PX, "fit");
	if (!canvas) return null;

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png")
	);
	if (!blob) {
		logWarn("favicon: canvas.toBlob() produced nothing — icon dropped");
		return null;
	}
	return blob.arrayBuffer();
}

/**
 * Decode `dataUrl` and draw it onto a canvas sized by `target` and `mode`:
 *
 * - `"exact"` — always a `target`-square canvas, whatever size the site
 *   published, scaling the image up as well as down. Passing a small original
 *   through untouched would make the icon's resolution depend on the remote
 *   file, which is how 16px icons used to end up in notes that had been
 *   promised 48px.
 * - `"fit"` — the image's own resolution, shrunk only if it is bigger than
 *   `target`. For a consumer that sizes the icon in CSS anyway, an upscale buys
 *   nothing but a soft icon and a bigger file.
 */
async function drawAtTargetResolution(
	dataUrl: string,
	target: number,
	mode: "exact" | "fit"
): Promise<HTMLCanvasElement | null> {
	const image = await decodeImage(dataUrl);
	if (!image || image.naturalWidth < 1 || image.naturalHeight < 1) {
		logWarn("favicon: decoded image has no usable dimensions — dropped");
		return null;
	}

	// Preserve non-square icons rather than stretching them. In "exact" mode the
	// unused area of the square is left transparent, so the result still has an
	// exact target×target intrinsic resolution.
	const fitScale = Math.min(
		target / image.naturalWidth,
		target / image.naturalHeight
	);
	const scale = mode === "exact" ? fitScale : Math.min(1, fitScale);
	const width = Math.max(1, Math.round(image.naturalWidth * scale));
	const height = Math.max(1, Math.round(image.naturalHeight * scale));

	const canvas = createEl("canvas");
	canvas.width = mode === "exact" ? target : width;
	canvas.height = mode === "exact" ? target : height;
	const context = canvas.getContext("2d");
	if (!context) {
		logWarn("favicon: could not get a 2d canvas context — icon dropped");
		return null;
	}

	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";

	const x = Math.floor((canvas.width - width) / 2);
	const y = Math.floor((canvas.height - height) / 2);
	context.drawImage(image, x, y, width, height);

	return canvas;
}

async function decodeImage(dataUrl: string): Promise<HTMLImageElement | null> {
	const image = createEl("img");
	image.src = dataUrl;
	try {
		await image.decode();
		return image;
	} catch (error) {
		// Undecodable (a broken or exotic format) — better no icon than a blob
		// that renders as a broken image everywhere the note travels.
		logWarn("favicon: image failed to decode", error);
		return null;
	}
}

/**
 * The 6-digit hex (no `#`) for the plate behind one bookmark-grid icon, for
 * the "Icon background colour" option: this half turns the icon's PNG bytes
 * into pixels, and `iconColor.ts` turns those into the colour (see
 * {@link iconPlateColor}).
 *
 * Takes bytes rather than the `<img>` already on screen, which is the obvious
 * thing to reach for and cannot work, in two compounding ways. A tile's image
 * starts out holding the grey initial-letter placeholder {@link fallbackIcon}
 * draws, which samples perfectly well — as grey. And once the real icon
 * replaces it, that `src` is an `app://` resource path served from a different
 * host than the page, so the image taints any canvas it is drawn onto and
 * `getImageData()` throws instead of answering. Between the two, the plate
 * took the placeholder's grey and then kept it, whatever the icon looked like.
 * Decoding the bytes through a `data:` URL is same-origin, so nothing taints.
 */
export async function iconPlateColorOf(bytes: ArrayBuffer): Promise<string | null> {
	const image = await decodeImage(`data:image/png;base64,${arrayBufferToBase64(bytes)}`);
	if (!image) return null;

	const width = image.naturalWidth;
	const height = image.naturalHeight;
	if (width < 1 || height < 1) return null;

	const canvas = createEl("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) return null;

	try {
		context.drawImage(image, 0, 0);
		return iconPlateColor(context.getImageData(0, 0, width, height).data);
	} catch (error) {
		// Not reachable through a tainted canvas any more (see above), but a
		// pathological image shouldn't take the tile down with it: no plate is
		// a fine outcome, an unhandled rejection is not.
		logWarn("favicon: could not sample icon colour", error);
		return null;
	}
}
