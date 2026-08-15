import { arrayBufferToBase64, requestUrl } from "obsidian";
import { isSafeFaviconSrc } from "./urlScan";

/**
 * Icons are written into the note itself, so they are rendered at their natural
 * pixel size wherever the note ends up. Keep three source pixels for each CSS
 * pixel at the usual 16px body size so high-density displays stay sharp; the
 * rendered size is controlled separately in styles.css.
 */
const ICON_PX = 48;

/** Refuse to download something that clearly isn't a favicon. */
const MAX_SOURCE_BYTES = 512 * 1024;

/** Cap pathological output without rejecting normal 48px PNG favicons. */
const MAX_INLINE_LENGTH = 32 * 1024;

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
	if (src.startsWith("data:")) source = isSafeFaviconSrc(src) ? src : "";
	else source = await download(src);
	if (!source) return "";

	const inlined = await encodeAtTargetResolution(source);
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
 * Re-encode to a PNG that is always {@link ICON_PX} square, whatever size the
 * site published. Passing a small original through untouched would make the
 * icon's resolution depend on the remote file, which is how 16px icons used to
 * end up in notes that had been promised 48px.
 */
async function encodeAtTargetResolution(dataUrl: string): Promise<string> {
	const image = await decodeImage(dataUrl);
	if (!image || image.naturalWidth < 1 || image.naturalHeight < 1) return "";

	const canvas = createEl("canvas");
	canvas.width = ICON_PX;
	canvas.height = ICON_PX;
	const context = canvas.getContext("2d");
	if (!context) return "";

	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";

	// Preserve non-square icons rather than stretching them. The unused area is
	// transparent, so the result still has an exact 48×48 intrinsic resolution.
	const scale = Math.min(ICON_PX / image.naturalWidth, ICON_PX / image.naturalHeight);
	const width = Math.max(1, Math.round(image.naturalWidth * scale));
	const height = Math.max(1, Math.round(image.naturalHeight * scale));
	const x = Math.floor((ICON_PX - width) / 2);
	const y = Math.floor((ICON_PX - height) / 2);
	context.drawImage(image, x, y, width, height);

	// The canvas is ICON_PX square by construction, so what it exports is too.
	return canvas.toDataURL("image/png");
}

async function decodeImage(dataUrl: string): Promise<HTMLImageElement | null> {
	const image = createEl("img");
	image.src = dataUrl;
	try {
		await image.decode();
		return image;
	} catch {
		// Undecodable (a broken or exotic format) — better no icon than a blob
		// that renders as a broken image everywhere the note travels.
		return null;
	}
}
