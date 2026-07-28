import { fetchSiteInfo, SiteInfo } from "./api";

const cache = new Map<string, SiteInfo | null>();
const inflight = new Map<string, Promise<SiteInfo | null>>();

function getSiteInfo(url: string, token: string): Promise<SiteInfo | null> {
	if (cache.has(url)) {
		return Promise.resolve(cache.get(url) ?? null);
	}
	let promise = inflight.get(url);
	if (!promise) {
		promise = fetchSiteInfo(url, token)
			.catch(() => null)
			.then((info) => {
				cache.set(url, info);
				inflight.delete(url);
				return info;
			});
		inflight.set(url, promise);
	}
	return promise;
}

function isBareUrlLink(anchor: HTMLAnchorElement): boolean {
	const href = anchor.getAttribute("href");
	if (!href || !/^https?:\/\//i.test(href)) return false;
	const text = anchor.textContent?.trim() ?? "";
	return text === href;
}

export function enhanceBareLinks(el: HTMLElement, token: string): Promise<void> {
	if (!token) return Promise.resolve();

	const anchors = Array.from(el.querySelectorAll<HTMLAnchorElement>("a.external-link")).filter(
		isBareUrlLink
	);
	if (anchors.length === 0) return Promise.resolve();

	return Promise.all(
		anchors.map(async (anchor) => {
			const href = anchor.getAttribute("href");
			if (!href) return;

			const info = await getSiteInfo(href, token);
			if (!info) return;

			anchor.empty();
			if (info.favicon) {
				const icon = anchor.createEl("img", { cls: "bookmarkify-favicon" });
				icon.src = info.favicon;
				icon.alt = "";
			}
			anchor.createSpan({ text: info.title || href });
		})
	).then(() => undefined);
}
