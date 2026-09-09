import { getDomain } from "tldts";

/** Use the registrable domain, so news.example.co.uk gets E rather than N or C. */
export function siteInitial(url: string): string {
	try {
		const hostname = new URL(url).hostname.replace(/\.$/, "");
		const domain = getDomain(hostname) ?? hostname.replace(/^\[|\]$/g, "");
		return Array.from(domain)[0]?.toUpperCase() || "?";
	} catch {
		return "?";
	}
}
