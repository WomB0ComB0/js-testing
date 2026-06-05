/**
 * Pulls Luma's "Discover" feed for a given slug (e.g. "nyc", "sf") directly
 * from the public API and emits the standard tech-week calendar envelope.
 *
 * This is the "organic" Luma source — no manual console snippet, no HAR
 * capture. The Discover API paginates with `next_cursor` until exhausted.
 *
 *   GET https://api.lu.ma/discover/get-paginated-events?slug=<slug>[&cursor=<c>]
 *
 * Each entry carries pre-geocoded `coordinate.{latitude,longitude}` so we
 * write a sibling geocoded.json and skip Google Maps geocoding downstream.
 *
 * Usage:
 *   bun run extract-luma-discover.ts --discover-slug nyc --city NYC \
 *     --out tech-week-luma-nyc-calendar.json
 */

import { join, resolve } from "node:path";
import { DateTime } from "luxon";
import { getArg } from "./lib/cli.js";
import { fnv1a32 } from "./lib/hash.js";
import {
	buildNegativeMatcher,
	buildScorer,
	NEGATIVE_KEYWORDS_DEFAULT,
	PRIORITY_KEYWORDS_TECH,
} from "./lib/scoring.js";

const USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";
const API_BASE = "https://api.lu.ma/discover/get-paginated-events";
const REQUEST_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunOptions {
	/** Luma discover slug ("nyc", "sf", "london"). */
	discoverSlug: string;
	/** Display city carried into events. Defaults to the slug uppercased. */
	city?: string;
	/** Output calendar.json path. */
	outPath?: string;
	/** Output geocoded.json path. */
	geocodeOutPath?: string;
	/** Drop events ending before this date (YYYY-MM-DD). */
	since?: string;
	/** Drop events starting after this date (YYYY-MM-DD). */
	until?: string;
	/** Max pages to walk (safety cap; one page = 50 events). Default 20. */
	maxPages?: number;
}

export interface RunResult {
	outPath: string;
	geocodeOutPath?: string;
	pagesCaptured: number;
	rawEventCount: number;
	eventCount: number;
	withGeo: number;
	priorityScored: number;
	dropped: number;
}

// ---------------------------------------------------------------------------
// API response shape (only the fields we use)
// ---------------------------------------------------------------------------

interface LumaApiEvent {
	api_id?: string;
	name?: string;
	url?: string;
	start_at?: string;
	end_at?: string;
	timezone?: string | null;
	visibility?: string;
	event_type?: string;
	geo_address_info?: {
		city?: string;
		region?: string;
		full_address?: string;
		short_address?: string;
		sublocality?: string;
	};
	coordinate?: { latitude?: number; longitude?: number };
}

interface LumaApiEntry {
	api_id?: string;
	event?: LumaApiEvent;
	calendar?: { name?: string };
	hosts?: Array<{ name?: string }>;
}

interface LumaApiPage {
	entries?: LumaApiEntry[];
	has_more?: boolean;
	next_cursor?: string;
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

interface CalendarEvent {
	id: number;
	city: string;
	date: string;
	time: string;
	location: string | null;
	name: string;
	company: string | null;
	externalHref: string | null;
	isInviteOnly: boolean;
	facets: {
		locations?: Array<{ label: string }>;
		hosts?: Array<{ key: string; label: string; role: string }>;
	};
	description?: string | null;
	priorityScore?: number;
	priorityMatches?: string[];
}

// ---------------------------------------------------------------------------
// Fetch + paginate
// ---------------------------------------------------------------------------

async function fetchPage(
	slug: string,
	cursor: string | null,
): Promise<LumaApiPage> {
	const params = new URLSearchParams({ slug });
	if (cursor) params.set("cursor", cursor);
	const url = `${API_BASE}?${params}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "application/json",
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} for ${url}`);
		}
		return (await response.json()) as LumaApiPage;
	} finally {
		clearTimeout(timer);
	}
}

async function paginate(
	slug: string,
	maxPages: number,
): Promise<{ entries: LumaApiEntry[]; pages: number }> {
	const entries: LumaApiEntry[] = [];
	let cursor: string | null = null;
	let pages = 0;
	for (let i = 0; i < maxPages; i++) {
		const page = await fetchPage(slug, cursor);
		pages += 1;
		for (const e of page.entries ?? []) entries.push(e);
		if (!page.has_more || !page.next_cursor) break;
		cursor = page.next_cursor;
	}
	return { entries, pages };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const scorer = buildScorer(PRIORITY_KEYWORDS_TECH);
const negativeMatch = buildNegativeMatcher(NEGATIVE_KEYWORDS_DEFAULT);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(options: RunOptions): Promise<RunResult> {
	const scriptDir = import.meta.dir;
	const city =
		options.city ??
		options.discoverSlug.charAt(0).toUpperCase() +
			options.discoverSlug.slice(1);
	const outPath = resolve(
		options.outPath ??
			join(scriptDir, `tech-week-luma-${options.discoverSlug}-calendar.json`),
	);
	const geocodeOutPath = resolve(
		options.geocodeOutPath ??
			join(scriptDir, `tech-week-luma-${options.discoverSlug}-geocoded.json`),
	);
	const maxPages = options.maxPages ?? 20;
	const since = options.since ? DateTime.fromISO(options.since) : null;
	const until = options.until ? DateTime.fromISO(options.until) : null;

	console.log(`Fetching Luma /discover for slug="${options.discoverSlug}" ...`);
	const { entries, pages } = await paginate(options.discoverSlug, maxPages);
	console.log(`  paginated ${pages} page(s), ${entries.length} raw entries`);

	const events: CalendarEvent[] = [];
	const geocode: Record<string, { lat: number; lng: number }> = {};
	const dropped: Array<{ name: string; reason: string }> = [];
	const seen = new Set<number>();

	for (const entry of entries) {
		const ev = entry.event;
		if (!ev?.api_id || !ev.start_at) continue;
		if (ev.visibility && ev.visibility !== "public") continue;

		const startZone = ev.timezone || "America/New_York";
		const startDt = DateTime.fromISO(ev.start_at, { zone: "utc" }).setZone(
			startZone,
		);
		if (!startDt.isValid) continue;

		const endDt = ev.end_at
			? DateTime.fromISO(ev.end_at, { zone: "utc" }).setZone(startZone)
			: null;
		if (since && (endDt ?? startDt) < since) continue;
		if (until && startDt > until) continue;

		const name = ev.name?.trim() || "(untitled)";
		const negHit = negativeMatch(name);
		if (negHit) {
			dropped.push({ name, reason: negHit });
			continue;
		}

		const id = fnv1a32(ev.api_id);
		if (seen.has(id)) continue;
		seen.add(id);

		const geo = ev.geo_address_info;
		// Prefer a human-friendly short label for the sidebar; full address
		// only when nothing better is available.
		const locationLabel =
			geo?.sublocality ||
			geo?.short_address ||
			geo?.full_address ||
			geo?.city ||
			null;
		// Keep the cache key unique per event so identical neighborhood names
		// across distinct venues don't collide.
		const cacheKey = locationLabel
			? `${locationLabel} (${ev.api_id.slice(4, 12)})`
			: ev.api_id;

		const lat = ev.coordinate?.latitude;
		const lng = ev.coordinate?.longitude;
		if (typeof lat === "number" && typeof lng === "number") {
			geocode[cacheKey] = { lat, lng };
		}

		const hosts = (entry.hosts ?? [])
			.map((h) => h.name?.trim())
			.filter((n): n is string => !!n && n.length > 0)
			.map((label) => ({
				key: label.toLowerCase().replace(/\s+/g, "-"),
				label,
				role: "primary" as const,
			}));

		const calendarName = entry.calendar?.name?.trim() || null;
		const externalHref = ev.url
			? `https://luma.com/${ev.url}`
			: `https://luma.com/${ev.api_id}`;

		const scoreText = [
			name,
			calendarName ?? "",
			...hosts.map((h) => h.label),
		].join(" ");
		const { score, matches } = scorer.score(scoreText);

		events.push({
			id,
			city,
			date: startDt.toFormat("yyyy-MM-dd"),
			time: startDt.toFormat("HH:mm:ss"),
			location: cacheKey,
			name,
			company: calendarName ?? hosts[0]?.label ?? null,
			externalHref,
			isInviteOnly: false,
			facets: {
				locations: locationLabel ? [{ label: locationLabel }] : undefined,
				hosts: hosts.length > 0 ? hosts : undefined,
			},
			// Discover listing doesn't ship full descriptions — the title +
			// host + calendar are usually enough signal for tech filtering.
			description: null,
			priorityScore: score,
			priorityMatches: matches,
		});
	}

	events.sort((a, b) => {
		const d = a.date.localeCompare(b.date);
		if (d !== 0) return d;
		return a.time.localeCompare(b.time);
	});

	const output = {
		events,
		source: `luma-discover:${options.discoverSlug}`,
		generatedAt: new Date().toISOString(),
		uniqueEventCount: events.length,
		priorityKeywords: PRIORITY_KEYWORDS_TECH,
	};

	await Bun.write(outPath, JSON.stringify(output, null, 2));
	const withGeo = Object.keys(geocode).length;
	let writtenGeocodeOut: string | undefined;
	if (withGeo > 0) {
		await Bun.write(geocodeOutPath, JSON.stringify(geocode, null, 2));
		writtenGeocodeOut = geocodeOutPath;
	}

	const scored = events.filter((e) => (e.priorityScore ?? 0) > 0).length;
	console.log(
		`Wrote ${outPath}\n` +
			(writtenGeocodeOut
				? `Wrote ${writtenGeocodeOut} (${withGeo} pre-geocoded)\n`
				: "") +
			`Summary: pages=${pages} raw=${entries.length} events=${events.length} withGeo=${withGeo} priorityScored=${scored} dropped=${dropped.length}`,
	);
	if (dropped.length > 0) {
		console.log("Dropped (NEGATIVE_KEYWORDS in title):");
		for (const d of dropped) console.log(`  [${d.reason}] ${d.name}`);
	}

	return {
		outPath,
		geocodeOutPath: writtenGeocodeOut,
		pagesCaptured: pages,
		rawEventCount: entries.length,
		eventCount: events.length,
		withGeo,
		priorityScored: scored,
		dropped: dropped.length,
	};
}

if (import.meta.main) {
	const discoverSlug = getArg("--discover-slug");
	if (!discoverSlug) {
		console.error(
			"Usage: extract-luma-discover.ts --discover-slug <slug> [--city <name>] [--out <path>] [--geocode-out <path>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--max-pages N]",
		);
		process.exit(1);
	}
	run({
		discoverSlug,
		city: getArg("--city"),
		outPath: getArg("--out"),
		geocodeOutPath: getArg("--geocode-out"),
		since: getArg("--since"),
		until: getArg("--until"),
		maxPages: getArg("--max-pages") ? Number(getArg("--max-pages")) : undefined,
	}).catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
