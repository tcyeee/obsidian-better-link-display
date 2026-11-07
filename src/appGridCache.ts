import { DataAdapter, normalizePath } from "obsidian";
import { logWarn } from "./log";

const ICONS_SUBDIR = "icons";
const TITLES_FILE = "titles.json";

/** Long enough to collapse a 20-link grid's first render into one write. */
const TITLES_SAVE_DEBOUNCE_MS = 500;

/**
 * Icons are cached per hostname — the service re-signs the same favicon on
 * every request, so caching lets a tile skip the download+re-encode on every
 * note open rather than skip the request outright. Titles are cached per full
 * URL, since two pages on one hostname don't share a title. No expiry and no
 * size cap, by design: the user clears this by hand from settings, and the
 * icon side is bounded anyway by one small PNG per distinct hostname ever
 * seen, not per link.
 */
export class AppGridCache {
	private titles: Record<string, string> | null = null;
	private titlesSaveTimer = 0;

	constructor(
		private readonly adapter: DataAdapter,
		private readonly getCacheDir: () => string
	) {}

	async getIconResourcePath(url: string): Promise<string | null> {
		const hostname = hostnameOf(url);
		if (!hostname) return null;
		const path = this.iconPath(hostname);
		if (!(await this.adapter.exists(path))) return null;
		return this.adapter.getResourcePath(path);
	}

	async writeIcon(url: string, bytes: ArrayBuffer): Promise<void> {
		const hostname = hostnameOf(url);
		if (!hostname) return;
		const dir = this.iconsDir();
		if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
		await this.adapter.writeBinary(this.iconPath(hostname), bytes);
	}

	async getTitle(url: string): Promise<string | null> {
		const titles = await this.loadTitles();
		return titles[url] ?? null;
	}

	/** Queues a debounced write rather than writing on every call — see the class doc. */
	async setTitle(url: string, title: string): Promise<void> {
		const titles = await this.loadTitles();
		titles[url] = title;
		this.queueTitlesSave();
	}

	/** Total bytes on disk, walked fresh each call — meant for an occasional settings-tab read, not a hot path. */
	async computeSize(): Promise<number> {
		const dir = this.getCacheDir();
		if (!(await this.adapter.exists(dir))) return 0;
		return this.sizeOf(dir);
	}

	/** Cancels any pending title save and deletes the whole cache directory. */
	async clear(): Promise<void> {
		window.clearTimeout(this.titlesSaveTimer);
		this.titlesSaveTimer = 0;
		this.titles = null;
		const dir = this.getCacheDir();
		if (await this.adapter.exists(dir)) await this.adapter.rmdir(dir, true);
	}

	private iconsDir(): string {
		return normalizePath(`${this.getCacheDir()}/${ICONS_SUBDIR}`);
	}

	private titlesPath(): string {
		return normalizePath(`${this.getCacheDir()}/${TITLES_FILE}`);
	}

	private iconPath(hostname: string): string {
		return normalizePath(`${this.iconsDir()}/${sanitizeHostname(hostname)}.png`);
	}

	private async loadTitles(): Promise<Record<string, string>> {
		if (this.titles) return this.titles;

		const path = this.titlesPath();
		if (await this.adapter.exists(path)) {
			try {
				const parsed = JSON.parse(await this.adapter.read(path));
				this.titles = isTitleMap(parsed) ? parsed : {};
			} catch (error) {
				logWarn("app-grid: titles.json could not be parsed — starting fresh", error);
				this.titles = {};
			}
		} else {
			this.titles = {};
		}
		return this.titles;
	}

	private queueTitlesSave(): void {
		window.clearTimeout(this.titlesSaveTimer);
		this.titlesSaveTimer = window.setTimeout(() => {
			this.titlesSaveTimer = 0;
			void this.saveTitles();
		}, TITLES_SAVE_DEBOUNCE_MS);
	}

	private async saveTitles(): Promise<void> {
		if (!this.titles) return;
		const dir = this.getCacheDir();
		if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
		await this.adapter.write(this.titlesPath(), JSON.stringify(this.titles));
	}

	private async sizeOf(dir: string): Promise<number> {
		const { files, folders } = await this.adapter.list(dir);
		let total = 0;
		for (const file of files) total += (await this.adapter.stat(file))?.size ?? 0;
		for (const folder of folders) total += await this.sizeOf(folder);
		return total;
	}
}

function hostnameOf(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/** Keeps the filename human-readable while defending against exotic hostnames. */
function sanitizeHostname(hostname: string): string {
	return hostname.replace(/[^a-z0-9.-]/g, "_");
}

function isTitleMap(value: unknown): value is Record<string, string> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.values(value).every((entry) => typeof entry === "string")
	);
}
