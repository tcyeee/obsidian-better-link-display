import { requestUrl } from "obsidian";

export interface SiteInfo {
	title: string;
	favicon: string;
}

interface SiteInfoResponse {
	code: number;
	msg: string;
	data: SiteInfo | null;
	ok: boolean;
}

const API_BASE = "http://127.0.0.1:8001";

export async function fetchSiteInfo(url: string, token: string): Promise<SiteInfo | null> {
	const response = await requestUrl({
		url: `${API_BASE}/extension/site-info?url=${encodeURIComponent(url)}`,
		method: "GET",
		headers: { "X-Extension-Token": token },
		throw: false,
	});

	if (response.status !== 200) {
		return null;
	}

	const body = response.json as SiteInfoResponse;
	if (!body.ok || !body.data) {
		return null;
	}
	return body.data;
}
