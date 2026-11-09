import { DataAdapter, normalizePath } from "obsidian";
import { logWarn } from "./log";

/**
 * Named apart from any earlier cache generation (favicon-keyed icons, full
 * page titles): both hold one small PNG per hostname with no expiry, so a
 * same-named directory would otherwise go on serving a stale favicon forever
 * under the new logo-based meaning instead of triggering a fresh fetch.
 */
const ICONS_SUBDIR = "logos";
const APP_NAMES_FILE = "app-names.json";

/** Long enough to collapse a 20-link grid's first render into one write. */
const APP_NAMES_SAVE_DEBOUNCE_MS = 500;

/**
 * Icons are cached per hostname — the service re-signs the same big icon on
 * every request, so caching lets a tile skip the download+re-encode on every
 * note open rather than skip the request outright. App names are cached per
 * full URL, since two pages on one hostname don't share one. No expiry and no
 * size cap, by design: the user clears this by hand from settings, and the
 * icon side is bounded anyway by one small PNG per distinct hostname ever
 * seen, not per link.
 */
export class AppGridCache {
	private appNames: Record<string, string> | null = null;
	private appNamesSaveTimer = 0;

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

	async getAppName(url: string): Promise<string | null> {
		const appNames = await this.loadAppNames();
		return appNames[url] ?? null;
	}

	/** Queues a debounced write rather than writing on every call — see the class doc. */
	async setAppName(url: string, appName: string): Promise<void> {
		const appNames = await this.loadAppNames();
		appNames[url] = appName;
		this.queueAppNamesSave();
	}

	/** Total bytes on disk, walked fresh each call — meant for an occasional settings-tab read, not a hot path. */
	async computeSize(): Promise<number> {
		const dir = this.getCacheDir();
		if (!(await this.adapter.exists(dir))) return 0;
		return this.sizeOf(dir);
	}

	/** Cancels any pending app-name save and deletes the whole cache directory. */
	async clear(): Promise<void> {
		window.clearTimeout(this.appNamesSaveTimer);
		this.appNamesSaveTimer = 0;
		this.appNames = null;
		const dir = this.getCacheDir();
		if (await this.adapter.exists(dir)) await this.adapter.rmdir(dir, true);
	}

	private iconsDir(): string {
		return normalizePath(`${this.getCacheDir()}/${ICONS_SUBDIR}`);
	}

	private appNamesPath(): string {
		return normalizePath(`${this.getCacheDir()}/${APP_NAMES_FILE}`);
	}

	private iconPath(hostname: string): string {
		return normalizePath(`${this.iconsDir()}/${sanitizeHostname(hostname)}.png`);
	}

	private async loadAppNames(): Promise<Record<string, string>> {
		if (this.appNames) return this.appNames;

		const path = this.appNamesPath();
		if (await this.adapter.exists(path)) {
			try {
				const parsed = JSON.parse(await this.adapter.read(path));
				this.appNames = isAppNameMap(parsed) ? parsed : {};
			} catch (error) {
				logWarn(`app-grid: ${APP_NAMES_FILE} could not be parsed — starting fresh`, error);
				this.appNames = {};
			}
		} else {
			this.appNames = {};
		}
		return this.appNames;
	}

	private queueAppNamesSave(): void {
		window.clearTimeout(this.appNamesSaveTimer);
		this.appNamesSaveTimer = window.setTimeout(() => {
			this.appNamesSaveTimer = 0;
			void this.saveAppNames();
		}, APP_NAMES_SAVE_DEBOUNCE_MS);
	}

	private async saveAppNames(): Promise<void> {
		if (!this.appNames) return;
		const dir = this.getCacheDir();
		if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
		await this.adapter.write(this.appNamesPath(), JSON.stringify(this.appNames));
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

function isAppNameMap(value: unknown): value is Record<string, string> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.values(value).every((entry) => typeof entry === "string")
	);
}
