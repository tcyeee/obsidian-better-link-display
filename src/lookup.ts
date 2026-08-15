import { fetchSiteInfo, SiteInfo } from "./api";

/**
 * The service documents a ~300ms rate limit per token. Requests are issued one
 * at a time with at least this much spacing, so several links formatted in
 * quick succession can't burst past the limit.
 */
const MIN_REQUEST_INTERVAL_MS = 350;

/** How long a link stays in its loading state before the attempt is abandoned. */
export const LOOKUP_TIMEOUT_MS = 10_000;

export interface LookupConfig {
	apiBase: string;
	accessToken: string;
}

export type LookupFailure =
	| "unconfigured"
	| "auth"
	| "unresolved"
	| "unreachable"
	| "server"
	| "timeout";

export type LookupOutcome = { ok: true; info: SiteInfo } | { ok: false; reason: LookupFailure };

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class SiteLookup {
	/** Serial tail: every request chains onto this so only one is in flight. */
	private queue: Promise<unknown> = Promise.resolve();
	private lastRequestAt = 0;

	constructor(private readonly getConfig: () => LookupConfig) {}

	/**
	 * Resolve a URL's title and icon, giving up after {@link LOOKUP_TIMEOUT_MS}.
	 * The timer starts here rather than when the request leaves the queue, so
	 * the caller's loading state can never outlast the promised ten seconds.
	 */
	async resolve(url: string): Promise<LookupOutcome> {
		const { apiBase, accessToken } = this.getConfig();
		if (!apiBase || !accessToken) return { ok: false, reason: "unconfigured" };

		const timeout = delay(LOOKUP_TIMEOUT_MS).then(
			() => ({ ok: false, reason: "timeout" }) as LookupOutcome
		);
		return Promise.race([this.schedule(() => this.request(url)), timeout]);
	}

	private async request(url: string): Promise<LookupOutcome> {
		const { apiBase, accessToken } = this.getConfig();
		const result = await fetchSiteInfo(apiBase, url, accessToken);
		return result.ok
			? { ok: true, info: result.info }
			: { ok: false, reason: result.failure };
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
}
