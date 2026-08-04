import { Notice } from "obsidian";
import { fetchSiteInfo, SiteInfo } from "./api";

/**
 * The service documents a ~300ms rate limit per token. Requests are issued one
 * at a time with at least this much spacing, so a note full of bare links can't
 * burst past the limit and turn every link into a failed lookup.
 */
const MIN_REQUEST_INTERVAL_MS = 350;

export interface EnhancerConfig {
	apiBase: string;
	accessToken: string;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Obsidian percent-encodes the href of a link whose text contains characters
 * that aren't URL-safe, so a raw `https://例え.jp` renders with text and href
 * that differ. Compare on a decoded, trailing-slash-free form instead.
 */
function normalizeUrl(value: string): string {
	let decoded = value;
	try {
		decoded = decodeURI(value);
	} catch {
		// Malformed escape sequence — fall back to the raw value.
	}
	return decoded.replace(/\/+$/, "");
}

function isBareUrlLink(anchor: HTMLAnchorElement): boolean {
	const href = anchor.getAttribute("href");
	if (!href || !/^https?:\/\//i.test(href)) return false;
	const text = anchor.textContent?.trim() ?? "";
	return normalizeUrl(text) === normalizeUrl(href);
}

/**
 * The service is documented to return favicons as base64 data URLs. Reject
 * anything else so a compromised or misconfigured endpoint can't turn a note
 * into a set of tracking-pixel requests.
 */
function isSafeFaviconSrc(src: string): boolean {
	return /^data:image\/[a-z0-9.+-]+[;,]/i.test(src);
}

export class BookmarkEnhancer {
	private cache = new Map<string, SiteInfo | null>();
	private inflight = new Map<string, Promise<SiteInfo | null>>();
	/** Serial tail: every request chains onto this so only one is in flight. */
	private queue: Promise<unknown> = Promise.resolve();
	private lastRequestAt = 0;
	private authNoticeShown = false;

	constructor(private readonly getConfig: () => EnhancerConfig) {}

	/** Drop everything learned so far — on unload, or when the token/URL changes. */
	reset(): void {
		this.cache.clear();
		this.inflight.clear();
		this.authNoticeShown = false;
	}

	async enhance(el: HTMLElement): Promise<void> {
		const { apiBase, accessToken } = this.getConfig();
		if (!apiBase || !accessToken) return;

		const anchors = Array.from(
			el.querySelectorAll<HTMLAnchorElement>("a.external-link")
		).filter(isBareUrlLink);
		if (anchors.length === 0) return;

		await Promise.all(anchors.map((anchor) => this.enhanceAnchor(anchor)));
	}

	private async enhanceAnchor(anchor: HTMLAnchorElement): Promise<void> {
		const href = anchor.getAttribute("href");
		if (!href) return;

		const info = await this.getSiteInfo(href);
		if (!info) return;

		anchor.empty();
		if (info.favicon && isSafeFaviconSrc(info.favicon)) {
			const icon = anchor.createEl("img", { cls: "bookmarkify-favicon" });
			icon.src = info.favicon;
			icon.alt = "";
		}
		anchor.createSpan({ text: info.title || href });
	}

	private getSiteInfo(url: string): Promise<SiteInfo | null> {
		const cached = this.cache.get(url);
		if (cached !== undefined) return Promise.resolve(cached);

		const pending = this.inflight.get(url);
		if (pending) return pending;

		const promise = this.schedule(() => this.lookup(url)).finally(() => {
			this.inflight.delete(url);
		});
		this.inflight.set(url, promise);
		return promise;
	}

	private async lookup(url: string): Promise<SiteInfo | null> {
		const { apiBase, accessToken } = this.getConfig();
		const result = await fetchSiteInfo(apiBase, url, accessToken);

		if (result.ok) {
			this.cache.set(url, result.info);
			return result.info;
		}

		if (result.failure === "auth") {
			this.notifyAuthFailure();
		}
		// Only a definitive "the service could not resolve this page" is cached.
		// Auth and transient failures stay out, so fixing the token or restarting
		// the service takes effect on the next render instead of the next restart.
		if (result.failure === "unresolved") {
			this.cache.set(url, null);
		}
		return null;
	}

	/** Runs tasks one at a time, spaced by MIN_REQUEST_INTERVAL_MS. */
	private schedule<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(async () => {
			const wait = this.lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
			if (wait > 0) await delay(wait);
			this.lastRequestAt = Date.now();
			return task();
		});
		// Keep the chain alive even if a task rejects.
		this.queue = run.catch(() => undefined);
		return run;
	}

	private notifyAuthFailure(): void {
		if (this.authNoticeShown) return;
		this.authNoticeShown = true;
		new Notice("Bookmarkify: access token is invalid or has been revoked.");
	}
}
