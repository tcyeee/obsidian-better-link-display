import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dominantColor, iconPlateColor } from "./iconColor";

/**
 * One RGBA buffer out of `[r, g, b, a]` tuples, in the layout `getImageData`
 * produces. Concatenated by hand rather than with `Array.prototype.flat()`,
 * which is ES2019 — past this project's `lib` (see tsconfig.json), and only
 * type-checks at all because `@types/node` pulls a newer lib in behind it.
 */
function pixels(...rgba: [number, number, number, number][]): Uint8ClampedArray {
	const bytes: number[] = [];
	for (const pixel of rgba) bytes.push(...pixel);
	return new Uint8ClampedArray(bytes);
}

/** `count` copies of one pixel — enough to make a colour the dominant one. */
function run(
	count: number,
	rgba: [number, number, number, number]
): [number, number, number, number][] {
	return Array.from({ length: count }, () => rgba);
}

test("dominantColor returns null for an empty buffer", () => {
	assert.equal(dominantColor(new Uint8ClampedArray(0)), null);
});

test("dominantColor returns null when every pixel is transparent", () => {
	assert.equal(dominantColor(pixels([255, 0, 0, 0], [0, 255, 0, 8])), null);
});

test("dominantColor reads one flat colour back exactly", () => {
	assert.deepEqual(dominantColor(pixels(...run(4, [18, 52, 86, 255]))), { r: 18, g: 52, b: 86 });
});

test("dominantColor averages the shades that share a bucket", () => {
	// Both land in the same coarse bucket (the low 4 bits are dropped), so the
	// result is their mean rather than either one of them.
	assert.deepEqual(dominantColor(pixels([32, 32, 32, 255], [34, 34, 34, 255])), {
		r: 33,
		g: 33,
		b: 33,
	});
});

test("dominantColor picks the most common colour, not the mean of all of them", () => {
	// Mostly red with some green: a mean would be a muddy olive, which is not a
	// colour anyone would name as this icon's.
	const data = pixels(...run(9, [200, 20, 20, 255]), ...run(3, [20, 200, 20, 255]));
	assert.deepEqual(dominantColor(data), { r: 200, g: 20, b: 20 });
});

test("dominantColor prefers a small coloured mark over a mostly white icon", () => {
	// 90% white, 10% brand blue — the wordmark case. The blue is what the icon
	// reads as, so it wins despite being outnumbered nine to one.
	const data = pixels(...run(90, [255, 255, 255, 255]), ...run(10, [20, 80, 220, 255]));
	assert.deepEqual(dominantColor(data), { r: 20, g: 80, b: 220 });
});

test("dominantColor stays grey for a monochrome icon", () => {
	// A black glyph on white with a couple of anti-aliasing fringe pixels: too
	// few coloured pixels to hand the icon a colour it doesn't have.
	const data = pixels(...run(60, [255, 255, 255, 255]), ...run(39, [0, 0, 0, 255]), [
		240, 200, 200, 255,
	]);
	assert.deepEqual(dominantColor(data), { r: 255, g: 255, b: 255 });
});

test("dominantColor ignores transparent padding around the artwork", () => {
	const data = pixels(...run(50, [0, 0, 0, 0]), ...run(3, [12, 180, 60, 255]));
	assert.deepEqual(dominantColor(data), { r: 12, g: 180, b: 60 });
});

test("iconPlateColor keeps 30% of the dominant colour over white", () => {
	// 0x20 = 32 → round(32 * 0.3 + 255 * 0.7) = 188 = 0xbc.
	assert.equal(iconPlateColor(pixels([32, 32, 32, 255])), "bcbcbc");
});

test("iconPlateColor leaves white white and pads every channel to two digits", () => {
	assert.equal(iconPlateColor(pixels([255, 255, 255, 255])), "ffffff");
	// round(0 * 0.3 + 255 * 0.7) = 179 = 0xb3, the darkest a plate ever gets.
	assert.equal(iconPlateColor(pixels([0, 0, 0, 255])), "b3b3b3");
});

test("iconPlateColor returns null when there is nothing to sample", () => {
	assert.equal(iconPlateColor(pixels([255, 0, 0, 0])), null);
});
