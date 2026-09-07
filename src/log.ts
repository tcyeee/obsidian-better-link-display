/**
 * Diagnostic logging for the lookup pipeline.
 *
 * Every request failure is collapsed to one of a handful of short reasons before
 * it reaches the user — enough to phrase a notice, never enough to tell *why* the
 * request failed. These calls keep the original error, HTTP status and URL in the
 * developer console so a bug report of "it says the service is unreachable" can
 * still be diagnosed.
 *
 * Messages are English and carry a fixed prefix so a user can paste the console
 * straight into an issue.
 */
const PREFIX = "[better-link-display]";

export function logError(message: string, detail?: unknown): void {
	if (detail === undefined) console.error(`${PREFIX} ${message}`);
	else console.error(`${PREFIX} ${message}`, detail);
}

export function logWarn(message: string, detail?: unknown): void {
	if (detail === undefined) console.warn(`${PREFIX} ${message}`);
	else console.warn(`${PREFIX} ${message}`, detail);
}

export function logInfo(message: string, detail?: unknown): void {
	if (detail === undefined) console.info(`${PREFIX} ${message}`);
	else console.info(`${PREFIX} ${message}`, detail);
}
