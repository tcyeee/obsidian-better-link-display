import { requestUrl } from "obsidian";
import { toInlineIcon } from "./favicon";

export interface SiteInfo {
	title: string;
	favicon: string;
}

/**
 * Why a lookup failed. These are kept apart so the user is told which of the
 * three very different problems they actually have: the service isn't reachable,
 * the service is reachable but unhappy, or the page itself couldn't be resolved.
 */
export type FetchFailure = "auth" | "unresolved" | "unreachable" | "server";

export type FetchResult =
	| { ok: true; info: SiteInfo }
	| { ok: false; failure: FetchFailure };

export type VerifyResult =
	| { ok: true }
	| { ok: false; failure: Exclude<FetchFailure, "unresolved"> };

/** Response code the service returns for a revoked or invalid token. */
const CODE_INVALID_TOKEN = 125;

export const API_BASE = "https://bookmarkify.cc/api";

/** A stable, cheap page to ask about when all we want to know is "does the token work?". */
const PROBE_URL = "https://example.com";

interface Payload {
	code?: unknown;
	ok?: unknown;
	data?: unknown;
}

type RequestOutcome =
	| { ok: true; payload: Payload }
	| { ok: false; failure: Exclude<FetchFailure, "unresolved"> };

function isSiteInfo(value: unknown): value is SiteInfo {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SiteInfo>;
	return typeof candidate.title === "string" && typeof candidate.favicon === "string";
}

/**
 * One call to the site-info endpoint, reduced to "the service answered sensibly,
 * here is its payload" or one of the failures the user can act on.
 */
async function siteInfoRequest(url: string, token: string): Promise<RequestOutcome> {
	const endpoint = `${API_BASE}/extension/site-info?url=${encodeURIComponent(url)}`;

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
		// Nothing answered at all — almost always no network, or the service down.
		return { ok: false, failure: "unreachable" };
	}

	if (status === 401 || status === 403) return { ok: false, failure: "auth" };
	if (status !== 200) return { ok: false, failure: "server" };
	if (!body || typeof body !== "object") return { ok: false, failure: "server" };

	const payload = body as Payload;
	if (payload.code === CODE_INVALID_TOKEN) return { ok: false, failure: "auth" };
	return { ok: true, payload };
}

export async function fetchSiteInfo(url: string, token: string): Promise<FetchResult> {
	const outcome = await siteInfoRequest(url, token);
	if (!outcome.ok) return outcome;

	const { payload } = outcome;
	if (payload.ok === true && isSiteInfo(payload.data)) {
		const favicon = await toInlineIcon(payload.data.favicon);
		return { ok: true, info: { title: payload.data.title, favicon } };
	}

	// The service answered, but could not read the page behind the URL.
	return { ok: false, failure: "unresolved" };
}

/**
 * Check that a token is accepted, without caring what comes back. A page the
 * service cannot resolve still proves the credential is good, so anything short
 * of an authentication or transport failure counts as a pass.
 */
export async function verifyToken(token: string): Promise<VerifyResult> {
	const outcome = await siteInfoRequest(PROBE_URL, token);
	return outcome.ok ? { ok: true } : outcome;
}
