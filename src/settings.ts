import { App, PluginSettingTab, Setting } from "obsidian";
import type BookmarkifyPlugin from "../main";

export interface BookmarkifySettings {
	accessToken: string;
}

export const DEFAULT_SETTINGS: BookmarkifySettings = {
	accessToken: "",
};

export class BookmarkifySettingTab extends PluginSettingTab {
	plugin: BookmarkifyPlugin;

	constructor(app: App, plugin: BookmarkifyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Access token")
			.setDesc(
				"用于调用网页标题/图标查询接口的只读令牌，在网页端的令牌管理页面生成后粘贴到此处。该令牌只能查询网页信息，无法读写你的书签或账号数据。"
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.style.width = "100%";
				text
					.setPlaceholder("粘贴 AccessToken")
					.setValue(this.plugin.settings.accessToken)
					.onChange(async (value) => {
						this.plugin.settings.accessToken = value.trim();
						await this.plugin.saveSettings();
					});
			});
	}
}
