/** Stored as the link title so every formatted link remains identifiable. */
export const FORMATTED_LINK_MARKER = "better-link-display-rich-link";

/**
 * Wrap rich links emitted by Better Link Display in a plugin-owned element so all
 * visual rules can stay scoped and cannot accidentally affect normal links or
 * links rendered by other plugins.
 */
export function wrapFormattedLinks(container: HTMLElement): void {
	const links = container.querySelectorAll<HTMLAnchorElement>(
		`a.external-link[title="${FORMATTED_LINK_MARKER}"]`
	);

	for (const link of Array.from(links)) {
		if (link.parentElement?.classList.contains("better-link-display-rich-link-wrapper")) continue;

		const wrapper = link.ownerDocument.createElement("span");
		wrapper.className = "better-link-display-rich-link-wrapper";
		link.removeAttribute("title");
		link.replaceWith(wrapper);
		wrapper.appendChild(link);
	}
}
