import { strict as assert } from "node:assert";
import { test } from "node:test";
import { siteInitial } from "./siteInitial";

test("fallback initials come from the root domain rather than a subdomain or public suffix", () => {
	for (const url of [
		"https://example.com", "https://www.example.com/page",
		"https://news.example.co.uk", "https://docs.example.com.cn",
		"https://a.b.example.com.au:8443/page", "https://www.Example.COM./",
	]) assert.equal(siteInitial(url), "E", url);
	assert.equal(siteInitial("https://en.wikipedia.org/wiki/Example"), "W");
});

test("fallback icons can also represent local hosts, IPs and invalid inputs", () => {
	assert.equal(siteInitial("http://localhost:8080"), "L");
	assert.equal(siteInitial("http://192.168.1.1"), "1");
	assert.equal(siteInitial("http://[2001:db8::1]"), "2");
	assert.equal(siteInitial("invalid"), "?");
});
