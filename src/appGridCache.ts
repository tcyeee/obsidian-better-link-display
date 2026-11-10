import { DataAdapter, normalizePath } from "obsidian";
import { logWarn } from "./log";

/**
 * Named apart from every earlier cache generation (favicon-keyed icons, full
 * page titles, and `logos`, which held the same icons re-encoded down to the
 * inline bookmark's 48px): each holds one PNG per hostname with no expiry, so
 * reusing a directory name would go on serving the old generation's file
 * forever instead of triggering a fresh fetch at the current resolution.
 */
const ICONS_SUBDIR = "logos-lg";
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

	/**
	 * Hostname → the vault resource path of that host's cached icon. Memoised so
	 * that a re-render of a grid (every tile is rebuilt from scratch whenever its
	 * block's source changes — deleting one tile, for example) can hand the
	 * remaining tiles their real icon in the same tick instead of re-reading disk
	 * with `adapter.exists` and leaving each one on the animated "pending"
	 * skeleton for a frame. See {@link getIconResourcePath} for how entries are
	 * added and refreshed.
	 */
	private iconResourcePaths = new Map<string, string>();

	constructor(
		private readonly adapter: DataAdapter,
		private readonly getCacheDir: () => string
	) {}

	async getIconResourcePath(url: string): Promise<string | null> {
		const hostname = hostnameOf(url);
		if (!hostname) return null;
		const cached = this.iconResourcePaths.get(hostname);
		if (cached) return cached;
		const path = this.iconPath(hostname);
		if (!(await this.adapter.exists(path))) return null;
		const resourcePath = this.adapter.getResourcePath(path);
		this.iconResourcePaths.set(hostname, resourcePath);
		return resourcePath;
	}

	/**
	 * The memoised icon path without touching disk: `null` until
	 * {@link getIconResourcePath} or {@link writeIcon} has cached it. Lets a
	 * re-rendered tile resolve its icon synchronously — see the fast path at the
	 * top of `resolveTile` in `appGrid.ts`, which uses this to drop the pending
	 * skeleton in the same tick instead of after an `await`.
	 */
	peekIconResourcePath(url: string): string | null {
		const hostname = hostnameOf(url);
		if (!hostname) return null;
		return this.iconResourcePaths.get(hostname) ?? null;
	}

	/**
	 * The cached PNG's own bytes, for the icon-plate colour sampling in
	 * `appGrid.ts`. Separate from {@link getIconResourcePath} because an
	 * `app://` resource path is all an `<img>` needs, but it is served from a
	 * different host than the page, so an image loaded from one *taints* any
	 * canvas it is drawn onto and `getImageData()` then throws — the colour
	 * has to come from the bytes instead.
	 */
	async readIconBytes(url: string): Promise<ArrayBuffer | null> {
		const hostname = hostnameOf(url);
		if (!hostname) return null;
		const path = this.iconPath(hostname);
		if (!(await this.adapter.exists(path))) return null;
		try {
			return await this.adapter.readBinary(path);
		} catch (error) {
			logWarn("app-grid: cached icon could not be read back for colour sampling", error);
			return null;
		}
	}

	async writeIcon(url: string, bytes: ArrayBuffer): Promise<void> {
		const hostname = hostnameOf(url);
		if (!hostname) return;
		const dir = this.iconsDir();
		if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
		const path = this.iconPath(hostname);
		await this.adapter.writeBinary(path, bytes);
		// Refresh the memoised path: `getResourcePath` can carry a cache-busting
		// version that changes once the bytes on disk do, so the stale path has to
		// be replaced or a re-render right after (add/update) would point the tile
		// at an outdated image.
		this.iconResourcePaths.set(hostname, this.adapter.getResourcePath(path));
	}

	async getAppName(url: string): Promise<string | null> {
		const appNames = await this.loadAppNames();
		return appNames[url] ?? null;
	}

	/**
	 * The in-memory app name without touching disk: `null` while app names are
	 * unloaded (or when this URL has none). The synchronous counterpart to
	 * {@link getAppName}, used by the same re-render fast path as
	 * {@link peekIconResourcePath} so a settled tile's label doesn't flash its
	 * pending skeleton again.
	 */
	peekAppName(url: string): string | null {
		return this.appNames?.[url] ?? null;
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
		this.iconResourcePaths.clear();
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
