/**
 * HTTP fetch with a hard timeout, a desktop-Chrome UA, and a graceful
 * null-on-failure contract. Used by scrapers that walk many URLs in parallel
 * and need to treat fetch errors as skips rather than aborts.
 */

const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

export interface FetchHtmlOptions {
	timeoutMs?: number;
	userAgent?: string;
	accept?: string;
}

export async function fetchHtml(
	url: string,
	options: FetchHtmlOptions = {},
): Promise<string | null> {
	const {
		timeoutMs = 15_000,
		userAgent = DEFAULT_USER_AGENT,
		accept = "text/html",
	} = options;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": userAgent, Accept: accept },
			signal: controller.signal,
		});
		if (!response.ok) {
			console.warn(`  HTTP ${response.status} on ${url}`);
			return null;
		}
		return await response.text();
	} catch (error) {
		console.warn(`  fetch failed for ${url}:`, (error as Error).message);
		return null;
	} finally {
		clearTimeout(timer);
	}
}
