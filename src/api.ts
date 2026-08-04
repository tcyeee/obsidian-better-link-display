import { requestUrl } from "obsidian";

export interface SiteInfo {
	title: string;
	favicon: string;
}

/**
 * Why a lookup failed. The caller uses this to decide whether the outcome is
 * worth remembering: a "transient" failure must never be cached, or a single
 * outage would leave every link un-enhanced until Obsidian restarts.
 */
export type FetchFailure = "auth" | "unresolved" | "transient";

export type FetchResult =
	| { ok: true; info: SiteInfo }
	| { ok: false; failure: FetchFailure };

/** Response code the service returns for a revoked or invalid token. */
const CODE_INVALID_TOKEN = 125;

export const DEFAULT_API_BASE = "http://127.0.0.1:8001";

function isSiteInfo(value: unknown): value is SiteInfo {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SiteInfo>;
	return typeof candidate.title === "string" && typeof candidate.favicon === "string";
}

export async function fetchSiteInfo(
	apiBase: string,
	url: string,
	token: string
): Promise<FetchResult> {
	const base = apiBase.replace(/\/+$/, "");
	const endpoint = `${base}/extension/site-info?url=${encodeURIComponent(url)}`;

	let status: number;
	let body: unknown;
	try {
		const response = await requestUrl({
			url: endpoint,
			method: "GET",
			headers: { "X-Extension-Token": token },
			throw: false,
		});
		status = response.status;
		body = response.json;
	} catch {
		// Service unreachable, or a body that isn't JSON — always worth retrying.
		return { ok: false, failure: "transient" };
	}

	if (status === 401 || status === 403) return { ok: false, failure: "auth" };
	if (status !== 200) return { ok: false, failure: "transient" };

	if (!body || typeof body !== "object") return { ok: false, failure: "transient" };
	const payload = body as { code?: unknown; ok?: unknown; data?: unknown };

	if (payload.code === CODE_INVALID_TOKEN) return { ok: false, failure: "auth" };
	if (payload.ok === true && isSiteInfo(payload.data)) return { ok: true, info: payload.data };

	// The service answered but could not resolve the page — remembering this is safe.
	return { ok: false, failure: "unresolved" };
}
