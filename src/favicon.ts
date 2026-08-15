import { arrayBufferToBase64, requestUrl } from "obsidian";

/**
 * Icons are written into the note itself, so they are rendered at their natural
 * pixel size wherever the note ends up — including editors that know nothing
 * about Obsidian's `|16` size hint. Encoding at text height is what makes the
 * markdown portable, and it also keeps the embedded base64 short.
 */
const ICON_PX = 16;

/** Refuse to download something that clearly isn't a favicon. */
const MAX_SOURCE_BYTES = 512 * 1024;

/** A downscaled icon is ~1KB; anything far past that means downscaling failed. */
const MAX_INLINE_LENGTH = 8 * 1024;

/**
 * Turn whatever the service returned into a self-contained `data:` URL.
 *
 * The service hands back short-lived signed CDN links, so the bytes have to be
 * pulled down while they are still reachable. Returns "" when no usable icon
 * could be produced — a bookmark without an icon is still worth writing.
 */
export async function toInlineIcon(src: string): Promise<string> {
	if (!src) return "";

	const source = src.startsWith("data:") ? src : await download(src);
	if (!source) return "";

	const inlined = await downscale(source);
	return inlined.length <= MAX_INLINE_LENGTH ? inlined : "";
}

async function download(src: string): Promise<string> {
	if (!/^https:\/\//i.test(src)) return "";

	try {
		const response = await requestUrl({ url: src, method: "GET", throw: false });
		if (response.status !== 200) return "";
		if (response.arrayBuffer.byteLength > MAX_SOURCE_BYTES) return "";

		const mime = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
		if (!mime.startsWith("image/")) return "";

		return `data:${mime};base64,${arrayBufferToBase64(response.arrayBuffer)}`;
	} catch {
		// A missing icon is never worth failing the whole lookup over.
		return "";
	}
}

/**
 * Re-encode to {@link ICON_PX} square. The service returns icons at whatever
 * size the site published — 144px is common, which is nine times the pixels
 * actually needed and would bloat every note it is pasted into.
 */
async function downscale(dataUrl: string): Promise<string> {
	const image = createEl("img");
	image.src = dataUrl;
	try {
		await image.decode();
	} catch {
		// Undecodable (a broken or exotic format) — better no icon than a blob
		// that renders as a broken image everywhere the note travels.
		return "";
	}

	if (image.naturalWidth <= ICON_PX && image.naturalHeight <= ICON_PX) return dataUrl;

	const canvas = createEl("canvas");
	canvas.width = ICON_PX;
	canvas.height = ICON_PX;
	const context = canvas.getContext("2d");
	if (!context) return dataUrl;

	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(image, 0, 0, ICON_PX, ICON_PX);
	return canvas.toDataURL("image/png");
}
