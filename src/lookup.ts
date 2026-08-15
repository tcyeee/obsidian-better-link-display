import { fetchSiteInfo, SiteInfo, verifyToken } from "./api";

/**
 * The service documents a ~300ms rate limit per token. Requests are issued one
 * at a time with at least this much spacing, so several links formatted in
 * quick succession can't burst past the limit.
 */
const MIN_REQUEST_INTERVAL_MS = 350;

/** How long a link stays in its loading state before the attempt is abandoned. */
export const LOOKUP_TIMEOUT_MS = 10_000;

export interface LookupConfig {
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

export type VerifyOutcome =
	| { ok: true }
	| { ok: false; reason: Exclude<LookupFailure, "unresolved"> };

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
		const { accessToken } = this.getConfig();
		if (!accessToken) return { ok: false, reason: "unconfigured" };

		return this.withTimeout(() => this.request(url), { ok: false, reason: "timeout" });
	}

	/**
	 * Ask the service whether a token is accepted. Goes through the same queue as
	 * a real lookup so pressing Test while links are resolving cannot outrun the
	 * rate limit and fail for a reason that has nothing to do with the token.
	 */
	async verify(token: string): Promise<VerifyOutcome> {
		if (!token) return { ok: false, reason: "unconfigured" };

		return this.withTimeout(async (): Promise<VerifyOutcome> => {
			const result = await verifyToken(token);
			return result.ok ? { ok: true } : { ok: false, reason: result.failure };
		}, { ok: false, reason: "timeout" });
	}

	/** Run a queued task, resolving to `onTimeout` if it takes too long. */
	private async withTimeout<T>(task: () => Promise<T>, onTimeout: T): Promise<T> {
		let timer = 0;
		const timeout = new Promise<T>((resolve) => {
			timer = window.setTimeout(() => resolve(onTimeout), LOOKUP_TIMEOUT_MS);
		});
		try {
			return await Promise.race([this.schedule(task), timeout]);
		} finally {
			// A request that answered in 200ms must not leave a ten-second timer
			// behind it; those accumulate one per formatted link.
			window.clearTimeout(timer);
		}
	}

	private async request(url: string): Promise<LookupOutcome> {
		const { accessToken } = this.getConfig();
		const result = await fetchSiteInfo(url, accessToken);
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
