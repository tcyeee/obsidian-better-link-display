import { moment } from "obsidian";

export type Language = "en" | "zh";

export const LANGUAGES: readonly Language[] = ["en", "zh"] as const;

/**
 * Every user-facing string in the plugin. English is the source of truth: the
 * other tables are typed against it, so a key added here fails to compile until
 * it has been translated everywhere.
 */
const en = {
	"general.heading": "General",
	"general.language.name": "Language",

	"language.en": "English",
	"language.zh": "中文",

	"appearance.heading": "Appearance",
	"appearance.preview.name": "Preview",
	"appearance.preview.desc": "How a formatted link looks in a note with the options below.",
	"appearance.preview.sample": "Example Site",
	"appearance.background.name": "Background",
	"appearance.background.desc":
		"Give formatted links a light grey rounded background in notes.",
	"appearance.border.name": "Border",
	"appearance.border.desc": "Give formatted links a light grey border in notes.",

	"service.heading": "Lookup service",
	"token.name": "Access token",
	"token.desc":
		"Read-only token used to query page titles and icons. Generate one on the service's token management page and paste it here. It cannot read or modify your bookmarks or account data.",
	"token.placeholder": "Paste your access token",
	"token.test": "Test",
	"token.testing": "Testing…",
	"token.success": "Success",
	"token.failure": "Failed",

	"test.empty": "Better Link Display: paste an access token before testing it.",
	"test.ok": "Better Link Display: the access token works.",
	"test.auth": "Better Link Display: the access token is invalid or has been revoked.",
	"test.unreachable":
		"Better Link Display: no response from {base}. Check your network connection.",
	"test.server": "Better Link Display: {base} answered with an error. Try again later.",
	"test.timeout": "Better Link Display: no answer within {seconds} seconds. Try again.",

	"command.formatLink": "Format link under cursor",
	"button.format": "Format",
	"button.reformat": "Reformat",
	"button.reset": "Reset",

	"failure.unconfigured":
		"Better Link Display: set the access token in Settings → Better Link Display first.",
	"failure.auth":
		"Better Link Display: the access token is invalid or has been revoked. Generate a new one and paste it into settings.",
	"failure.unreachable":
		"Better Link Display: no response from {base}. Check your network connection.",
	"failure.server": "Better Link Display: {base} answered with an error. Try again later.",
	"failure.unresolved":
		"Better Link Display: the service could not read this page's title. The site may be blocking it.",
	"failure.timeout":
		"Better Link Display: no answer within {seconds} seconds. The link was left unchanged.",
} as const;

export type TranslationKey = keyof typeof en;

const zh: Record<TranslationKey, string> = {
	"general.heading": "通用",
	"general.language.name": "语言",

	"language.en": "English",
	"language.zh": "中文",

	"appearance.heading": "外观",
	"appearance.preview.name": "预览",
	"appearance.preview.desc": "按下面的选项，格式化后的链接在笔记中的样子。",
	"appearance.preview.sample": "示例网站",
	"appearance.background.name": "背景",
	"appearance.background.desc": "为笔记中格式化后的链接添加浅灰色圆角背景。",
	"appearance.border.name": "边框",
	"appearance.border.desc": "为笔记中格式化后的链接添加浅灰色边框。",

	"service.heading": "解析服务",
	"token.name": "访问令牌",
	"token.desc":
		"用于查询页面标题和图标的只读令牌。在服务的令牌管理页生成后粘贴到这里。它无法读取或修改你的书签与账号数据。",
	"token.placeholder": "粘贴你的访问令牌",
	"token.test": "测试",
	"token.testing": "测试中…",
	"token.success": "成功",
	"token.failure": "失败",

	"test.empty": "Better Link Display：请先填写访问令牌再测试。",
	"test.ok": "Better Link Display：访问令牌可用。",
	"test.auth": "Better Link Display：访问令牌无效或已被吊销。",
	"test.unreachable": "Better Link Display：{base} 无响应，请检查网络连接。",
	"test.server": "Better Link Display：{base} 返回了错误，请稍后重试。",
	"test.timeout": "Better Link Display：{seconds} 秒内没有响应，请重试。",

	"command.formatLink": "格式化光标处的链接",
	"button.format": "格式化",
	"button.reformat": "重新格式化",
	"button.reset": "重置",

	"failure.unconfigured": "Better Link Display：请先在「设置 → Better Link Display」中填写访问令牌。",
	"failure.auth": "Better Link Display：访问令牌无效或已被吊销，请重新生成并填入设置。",
	"failure.unreachable": "Better Link Display：{base} 无响应，请检查网络连接。",
	"failure.server": "Better Link Display：{base} 返回了错误，请稍后重试。",
	"failure.unresolved": "Better Link Display：服务无法读取该页面的标题，可能被站点拦截了。",
	"failure.timeout": "Better Link Display：{seconds} 秒内没有响应，链接未做修改。",
};

const TABLES: Record<Language, Record<TranslationKey, string>> = { en, zh };

/**
 * Held module-wide rather than threaded through every call site: the language is
 * one value for the whole plugin, and the alternative is an argument on every
 * string in the codebase. The plugin sets it on load and on every change.
 */
let current: Language = "en";

export function isLanguage(value: unknown): value is Language {
	return value === "en" || value === "zh";
}

export function setLanguage(language: Language): void {
	current = language;
}

/** The language a first-time user should get: Obsidian's own, when we speak it. */
export function detectLanguage(): Language {
	// moment's locale tracks Obsidian's interface language, and is the only part
	// of that setting the plugin API exposes.
	return moment.locale().toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** Look up a string, substituting `{name}` placeholders with `vars`. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
	const template = TABLES[current][key] || en[key];
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in vars ? String(vars[name]) : match
	);
}
