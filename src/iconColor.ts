/**
 * The colour maths behind the bookmark grid's "Icon background colour"
 * option, kept apart from `favicon.ts` for the same reason the scanners are:
 * it imports nothing from `obsidian` and takes raw RGBA bytes rather than an
 * element, so it is exercised in iconColor.test.ts without a canvas. Getting
 * those bytes — decode, draw, `getImageData` — stays in `favicon.ts`, which
 * is the half that needs a DOM.
 */

/** Below this alpha a pixel is the icon's transparent padding, not its artwork. */
const MIN_ALPHA = 16;

/**
 * Channel spread (max − min) at which a pixel counts as coloured rather than
 * part of the black/white/grey scaffolding most icons are mostly made of.
 */
const MIN_CHROMA = 24;

/**
 * The share of opaque pixels that has to be coloured before the coloured ones
 * are allowed to decide the result on their own. Low on purpose: a wordmark
 * that is 95% white with a small coloured glyph should still be tinted by that
 * glyph, which is what a reader recognises the site by — but an icon that is
 * genuinely monochrome (a black `A` on white) has to stay grey rather than be
 * tinted by a handful of anti-aliasing fringe pixels, which is all that is
 * left once the greys are dropped.
 */
const MIN_CHROMATIC_SHARE = 0.05;

/**
 * Bits dropped from each channel when bucketing. 4 leaves 16 levels per
 * channel: coarse enough that one logo's worth of shading and anti-aliasing
 * lands in a single bucket instead of splintering across hundreds, fine
 * enough that two genuinely different brand colours never share one.
 */
const BUCKET_SHIFT = 4;
const BUCKET_LEVELS = 1 << (8 - BUCKET_SHIFT);

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

interface Bucket extends Rgb {
	count: number;
}

/**
 * The icon's dominant colour: the most populous coarse colour bucket, averaged
 * over the exact pixels that fell in it. Deliberately not the mean of every
 * pixel — averaging a red-and-white logo gives pink, and averaging a logo with
 * any two opposed hues gives mud, so the one thing a viewer would name as "the
 * colour of that icon" is the colour it has most of, not its centre of mass.
 *
 * `data` is RGBA, four bytes per pixel, as `getImageData` hands it over.
 * Returns `null` when there is nothing to sample (an empty or fully
 * transparent image).
 */
export function dominantColor(data: Uint8ClampedArray): Rgb | null {
	const all = new Map<number, Bucket>();
	const chromatic = new Map<number, Bucket>();
	let opaque = 0;

	for (let i = 0; i + 3 < data.length; i += 4) {
		if (data[i + 3] < MIN_ALPHA) continue;
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		opaque++;

		const key =
			((r >> BUCKET_SHIFT) * BUCKET_LEVELS + (g >> BUCKET_SHIFT)) * BUCKET_LEVELS +
			(b >> BUCKET_SHIFT);
		add(all, key, r, g, b);
		if (Math.max(r, g, b) - Math.min(r, g, b) >= MIN_CHROMA) add(chromatic, key, r, g, b);
	}

	if (opaque === 0) return null;

	const chromaticCount = countOf(chromatic);
	const buckets = chromaticCount / opaque >= MIN_CHROMATIC_SHARE ? chromatic : all;

	let winner: Bucket | null = null;
	for (const bucket of buckets.values()) {
		// `>` rather than `>=`: a tie keeps whichever bucket was seen first,
		// which is the first in scan order — stable for a given image, where
		// Map iteration order alone would make the result depend on which of
		// two equal colours happened to be inserted first.
		if (!winner || bucket.count > winner.count) winner = bucket;
	}
	if (!winner) return null;

	return {
		r: Math.round(winner.r / winner.count),
		g: Math.round(winner.g / winner.count),
		b: Math.round(winner.b / winner.count),
	};
}

function add(buckets: Map<number, Bucket>, key: number, r: number, g: number, b: number): void {
	const bucket = buckets.get(key);
	if (bucket) {
		bucket.count++;
		bucket.r += r;
		bucket.g += g;
		bucket.b += b;
		return;
	}
	buckets.set(key, { count: 1, r, g, b });
}

function countOf(buckets: Map<number, Bucket>): number {
	let total = 0;
	for (const bucket of buckets.values()) total += bucket.count;
	return total;
}

/**
 * How much of the dominant colour the icon plate keeps. The plate sits
 * directly behind the icon's own artwork, so anything close to the full colour
 * would swallow it — 30% composited over white is strong enough to read as
 * that site's colour and weak enough that a dark logo still has contrast
 * against it.
 */
const PLATE_STRENGTH = 0.3;

/** White, since the plate is composited over the note's page rather than over the tile's own colour. */
const PLATE_OVER = 255;

/**
 * The 6-digit hex (no `#`) for an icon plate sampled from `data`, or `null`
 * when {@link dominantColor} found nothing to sample. Flattened to an opaque
 * colour here rather than left to CSS `opacity`/`rgba()`: the value is written
 * into a custom property that `styles.css` uses as a plain `background-color`,
 * and a translucent plate would show whatever sits behind the tile through it
 * — including the grid's own area background, which is itself an option.
 */
export function iconPlateColor(data: Uint8ClampedArray): string | null {
	const color = dominantColor(data);
	if (!color) return null;
	return [color.r, color.g, color.b]
		.map((channel) => mix(channel).toString(16).padStart(2, "0"))
		.join("");
}

function mix(channel: number): number {
	const mixed = Math.round(channel * PLATE_STRENGTH + PLATE_OVER * (1 - PLATE_STRENGTH));
	return Math.min(255, Math.max(0, mixed));
}
