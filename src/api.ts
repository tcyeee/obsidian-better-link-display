import { requestUrl } from "obsidian";
import { toInlineIcon } from "./favicon";
import { logError, logInfo, logWarn } from "./log";

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

/** Where a user signs in to generate the token `API_BASE` expects. */
export const SITE_URL = "https://bookmarkify.cc";

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

function isSiteInfo(value: unknown): value is {
	title: string;
	favicon?: string | null;
	logo?: string | null;
	appName?: string | null;
} {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SiteInfo> & { logo?: unknown; appName?: unknown };
	return typeof candidate.title === "string" &&
		(candidate.favicon == null || typeof candidate.favicon === "string") &&
		(candidate.logo == null || typeof candidate.logo === "string") &&
		(candidate.appName == null || typeof candidate.appName === "string");
}

/**
 * One call to the site-info endpoint, reduced to "the service answered sensibly,
 * here is its payload" or one of the failures the user can act on.
 */
async function siteInfoRequest(url: string, token: string): Promise<RequestOutcome> {
	const endpoint = `${API_BASE}/extension/site-info?url=${encodeURIComponent(url)}`;
	logInfo(`requesting ${endpoint}`);

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
	} catch (error) {
		// Nothing answered at all — almost always no network, or the service down.
		logError(`site-info request threw (no response) for ${endpoint}`, error);
		return { ok: false, failure: "unreachable" };
	}

	if (status === 401 || status === 403) {
		logWarn(`site-info rejected the token: HTTP ${status} for ${endpoint}`, body);
		return { ok: false, failure: "auth" };
	}
	if (status !== 200) {
		logError(`site-info returned an unexpected HTTP ${status} for ${endpoint}`, body);
		return { ok: false, failure: "server" };
	}
	if (!body || typeof body !== "object") {
		logError(`site-info returned a non-object body for ${endpoint}`, body);
		return { ok: false, failure: "server" };
	}

	const payload = body as Payload;
	if (payload.code === CODE_INVALID_TOKEN) {
		logWarn(
			`site-info reported an invalid token (code ${CODE_INVALID_TOKEN}) for ${endpoint}`,
			payload
		);
		return { ok: false, failure: "auth" };
	}
	return { ok: true, payload };
}

export async function fetchSiteInfo(url: string, token: string): Promise<FetchResult> {
	const outcome = await siteInfoRequest(url, token);
	if (!outcome.ok) return outcome;

	const { payload } = outcome;
	if (payload.ok === true && isSiteInfo(payload.data)) {
		const favicon = await toInlineIcon(payload.data.favicon ?? "");
		if (!favicon) logWarn(`site-info resolved ${url} but produced no usable favicon`);
		return { ok: true, info: { title: payload.data.title, favicon } };
	}

	// The service answered, but could not read the page behind the URL.
	logWarn(`site-info could not resolve ${url}`, payload);
	return { ok: false, failure: "unresolved" };
}

export interface SiteAppInfo {
	/** Short app/site name (`appName`, server-side falls back to `title` if the page has no manifest `short_name`). */
	appName: string;
	/** The service's short-lived signed CDN link to the big icon (`logo`, falling back to `favicon`), undownloaded — "" if it has neither. */
	iconSrc: string;
}

export type FetchAppInfoResult =
	| { ok: true; info: SiteAppInfo }
	| { ok: false; failure: FetchFailure };

/**
 * Same request as {@link fetchSiteInfo}, but for the big-icon/app-name scenario
 * (`logo` + `appName` rather than `favicon` + `title`), and stopping short of
 * downloading and re-encoding the icon — a caller that may already have that
 * domain's icon cached on disk needs to decide *before* spending a download on
 * it, which {@link fetchSiteInfo} (committed to always inlining one) does not
 * allow.
 */
export async function fetchSiteAppInfo(url: string, token: string): Promise<FetchAppInfoResult> {
	const outcome = await siteInfoRequest(url, token);
	if (!outcome.ok) return outcome;

	const { payload } = outcome;
	if (payload.ok === true && isSiteInfo(payload.data)) {
		return {
			ok: true,
			info: {
				appName: payload.data.appName ?? payload.data.title,
				iconSrc: payload.data.logo ?? payload.data.favicon ?? "",
			},
		};
	}

	logWarn(`site-info could not resolve ${url}`, payload);
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
