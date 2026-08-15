import { requestUrl } from "obsidian";
import { toInlineIcon } from "./favicon";

export interface SiteInfo {
	title: string;
	favicon: string;
}

/**
 * Why a lookup failed. These are kept apart so the user is told which of the
 * three very different problems they actually have: the service isn't running,
 * the service is running but unhappy, or the page itself couldn't be resolved.
 */
export type FetchFailure = "auth" | "unresolved" | "unreachable" | "server";

export type FetchResult =
	| { ok: true; info: SiteInfo }
	| { ok: false; failure: FetchFailure };

/** Response code the service returns for a revoked or invalid token. */
const CODE_INVALID_TOKEN = 125;

export const DEFAULT_API_BASE = "https://bookmarkify.cc/api";


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
		// Nothing answered on that address at all — almost always a service that
		// isn't running, or a wrong Server URL.
		return { ok: false, failure: "unreachable" };
	}

	if (status === 401 || status === 403) return { ok: false, failure: "auth" };
	if (status !== 200) return { ok: false, failure: "server" };

	if (!body || typeof body !== "object") return { ok: false, failure: "server" };
	const payload = body as { code?: unknown; ok?: unknown; data?: unknown };

	if (payload.code === CODE_INVALID_TOKEN) return { ok: false, failure: "auth" };
	if (payload.ok === true && isSiteInfo(payload.data)) {
		const favicon = await toInlineIcon(payload.data.favicon);
		return { ok: true, info: { title: payload.data.title, favicon } };
	}

	// The service answered but could not resolve the page — remembering this is safe.
	return { ok: false, failure: "unresolved" };
}
