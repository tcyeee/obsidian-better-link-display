import { findMarkdownLinks, toLinkDestination } from "./urlScan";

const INLINE_ICON = /!\[[^\]]*\]\(data:image\/[^)]+\)/i;

function wholeLink(source: string) {
	const hit = findMarkdownLinks(source)[0];
	return hit?.from === 0 && hit.to === source.length ? hit : null;
}

export function currentLinkName(source: string): string {
	const hit = wholeLink(source);
	if (!hit) return "";
	return hit.text.replace(INLINE_ICON, "").trim()
		.replace(/\\([\\`*_{}[\]()#+.!|>~-])/g, "$1")
		.replace(/&#(\d+);|&(amp|lt|gt|quot);/g, (match, code: string, name: string) => {
			if (code) {
				const point = Number(code);
				return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
			}
			return ({ amp: "&", lt: "<", gt: ">", quot: '"' } as Record<string, string>)[name];
		});
}

/** Preserve the original destination (including its optional Markdown title). */
export function withCustomName(
	source: string, url: string, name: string, fallback: string, escapePipes = false
): string {
	const hit = wholeLink(source);
	const icon = hit?.text.match(INLINE_ICON)?.[0] ?? (fallback ? `![](${fallback})` : "");
	// Entities keep brackets literal without confusing bookmark range detection.
	let label = name.trim().replace(/\s+/g, " ")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/\[/g, "&#91;").replace(/\]/g, "&#93;")
		.replace(/[\\`*_~]/g, "\\$&");
	if (escapePipes) label = label.replace(/\|/g, "\\|");
	const destination = hit ? source.slice(hit.text.length + 2) : `(${toLinkDestination(url)})`;
	return `[${icon ? `${icon} ` : ""}${label}]${destination}`;
}
