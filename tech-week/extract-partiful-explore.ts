/**
 * Pulls Partiful's public trending list (https://partiful.com/explore) and
 * emits the standard tech-week calendar envelope.
 *
 * Partiful doesn't expose a paginated public API — the explore page is a
 * Next.js app whose initial `__NEXT_DATA__` carries the full carousel data
 * for three hardcoded regions: NYC, LA, SF. Each region currently caps at
 * 5 trending events, so volume is small.
 *
 * Lat/lng is buried in `locationInfo.mapsInfo.appleMapsUrl`'s `sll=` query
 * param, truncated to 2 decimals (~1km precision). Good enough for the
 * itinerary's neighborhood-level routing.
 *
 * Usage:
 *   bun run extract-partiful-explore.ts --region NYC --city NYC \
 *     --out tech-week-partiful-nyc-calendar.json
 */

import { join, resolve } from "node:path";
import { DateTime } from "luxon";
import { getArg } from "./lib/cli.js";
import { fetchHtml } from "./lib/fetch.js";
import { fnv1a32 } from "./lib/hash.js";
import {
	buildNegativeMatcher,
	buildScorer,
	NEGATIVE_KEYWORDS_DEFAULT,
	PRIORITY_KEYWORDS_TECH,
} from "./lib/scoring.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type PartifulRegion = "NYC" | "LA" | "SF";

export interface RunOptions {
	/** Trending region. Partiful only exposes NYC, LA, SF. */
	region: PartifulRegion;
	/** Display city carried into events. Defaults to region. */
	city?: string;
	/** Output calendar.json path. */
	outPath?: string;
	/** Output geocoded.json path. */
	geocodeOutPath?: string;
	/** Drop events ending before this date (YYYY-MM-DD). */
	since?: string;
	/** Drop events starting after this date (YYYY-MM-DD). */
	until?: string;
	/** IANA zone used when an event doesn't ship one. */
	fallbackTz?: string;
}

export interface RunResult {
	outPath: string;
	geocodeOutPath?: string;
	rawEventCount: number;
	eventCount: number;
	withGeo: number;
	priorityScored: number;
	dropped: number;
}

// ---------------------------------------------------------------------------
// Embedded Partiful response shapes (only fields we touch)
// ---------------------------------------------------------------------------

interface PartifulEvent {
	id?: string;
	title?: string;
	description?: string;
	startDate?: string;
	endDate?: string | null;
	timezone?: string | null;
	isPublic?: boolean;
	locationInfo?: {
		neighborhood?: string;
		displayAddressLines?: string[];
		mapsInfo?: {
			name?: string;
			addressLines?: string[];
			approximateLocation?: string;
			appleMapsUrl?: string;
			googleMapsUrl?: string;
		};
	};
}

interface PartifulItem {
	id?: string;
	type?: string;
	event?: PartifulEvent;
}

interface PartifulSection {
	region?: string;
	items?: PartifulItem[];
}

interface PartifulPageData {
	props?: {
		pageProps?: {
			trendingSections?: Record<string, PartifulSection>;
		};
	};
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
	};
	description?: string | null;
	priorityScore?: number;
	priorityMatches?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const scorer = buildScorer(PRIORITY_KEYWORDS_TECH);
const negativeMatch = buildNegativeMatcher(NEGATIVE_KEYWORDS_DEFAULT);

function extractNextData(html: string): PartifulPageData | null {
	// Next.js embeds initial props in a script tag with id="__NEXT_DATA__".
	const match = html.match(
		/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
	);
	if (!match) return null;
	try {
		return JSON.parse(match[1]) as PartifulPageData;
	} catch {
		return null;
	}
}

function extractLatLng(
	appleMapsUrl: string | undefined,
): { lat: number; lng: number } | null {
	if (!appleMapsUrl) return null;
	const m = appleMapsUrl.match(/sll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
	if (!m) return null;
	const lat = Number(m[1]);
	const lng = Number(m[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	return { lat, lng };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(options: RunOptions): Promise<RunResult> {
	const scriptDir = import.meta.dir;
	const region = options.region;
	const city = options.city ?? region;
	const fallbackTz = options.fallbackTz ?? "America/New_York";
	const regionSlug = region.toLowerCase();
	const outPath = resolve(
		options.outPath ??
			join(scriptDir, `tech-week-partiful-${regionSlug}-calendar.json`),
	);
	const geocodeOutPath = resolve(
		options.geocodeOutPath ??
			join(scriptDir, `tech-week-partiful-${regionSlug}-geocoded.json`),
	);
	const since = options.since ? DateTime.fromISO(options.since) : null;
	const until = options.until ? DateTime.fromISO(options.until) : null;

	console.log(`Fetching partiful.com/explore for region="${region}" ...`);
	const html = await fetchHtml("https://partiful.com/explore");
	if (!html) throw new Error("Failed to fetch partiful.com/explore");

	const data = extractNextData(html);
	if (!data) throw new Error("No __NEXT_DATA__ found in /explore");

	const sections = data.props?.pageProps?.trendingSections ?? {};
	const section = sections[region];
	if (!section) {
		const available = Object.keys(sections).join(", ");
		throw new Error(
			`No trending section for "${region}". Available: ${available || "(none)"}`,
		);
	}
	const rawItems = section.items ?? [];
	console.log(`  ${rawItems.length} raw items in trending.${region}`);

	const events: CalendarEvent[] = [];
	const geocode: Record<string, { lat: number; lng: number }> = {};
	const dropped: Array<{ name: string; reason: string }> = [];
	const seen = new Set<number>();

	for (const item of rawItems) {
		const ev = item.event;
		if (!ev?.id || !ev.startDate || !ev.title) continue;
		if (ev.isPublic === false) continue;

		const zone = ev.timezone || fallbackTz;
		const startDt = DateTime.fromISO(ev.startDate, { zone: "utc" }).setZone(
			zone,
		);
		if (!startDt.isValid) continue;

		const endDt = ev.endDate
			? DateTime.fromISO(ev.endDate, { zone: "utc" }).setZone(zone)
			: null;
		if (since && (endDt ?? startDt) < since) continue;
		if (until && startDt > until) continue;

		const name = ev.title.trim();
		const negHit = negativeMatch(name);
		if (negHit) {
			dropped.push({ name, reason: negHit });
			continue;
		}

		const id = fnv1a32(ev.id);
		if (seen.has(id)) continue;
		seen.add(id);

		const li = ev.locationInfo;
		const locationLabel =
			li?.neighborhood ||
			li?.mapsInfo?.name ||
			li?.mapsInfo?.approximateLocation ||
			li?.displayAddressLines?.[0] ||
			null;

		// Cache key includes a slice of the event id so distinct venues in the
		// same neighborhood don't collide on the same point.
		const cacheKey = locationLabel
			? `${locationLabel} (${ev.id.slice(0, 8)})`
			: ev.id;

		const coords = extractLatLng(li?.mapsInfo?.appleMapsUrl);
		if (coords) geocode[cacheKey] = coords;

		const scoreText = [name, ev.description ?? ""].join(" ");
		const { score, matches } = scorer.score(scoreText);

		events.push({
			id,
			city,
			date: startDt.toFormat("yyyy-MM-dd"),
			time: startDt.toFormat("HH:mm:ss"),
			location: cacheKey,
			name,
			company: null,
			externalHref: `https://partiful.com/e/${ev.id}`,
			isInviteOnly: false,
			facets: {
				locations: locationLabel ? [{ label: locationLabel }] : undefined,
			},
			description: ev.description ?? null,
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
		source: `partiful-explore:${region}`,
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
			`Summary: raw=${rawItems.length} events=${events.length} ` +
			`withGeo=${withGeo} priorityScored=${scored} dropped=${dropped.length}`,
	);
	if (dropped.length > 0) {
		console.log("Dropped (NEGATIVE_KEYWORDS in title):");
		for (const d of dropped) console.log(`  [${d.reason}] ${d.name}`);
	}

	return {
		outPath,
		geocodeOutPath: writtenGeocodeOut,
		rawEventCount: rawItems.length,
		eventCount: events.length,
		withGeo,
		priorityScored: scored,
		dropped: dropped.length,
	};
}

if (import.meta.main) {
	const regionArg = (getArg("--region") ?? "NYC").toUpperCase();
	if (regionArg !== "NYC" && regionArg !== "LA" && regionArg !== "SF") {
		console.error(
			`Invalid --region "${regionArg}". Partiful only exposes NYC, LA, SF.`,
		);
		process.exit(1);
	}
	run({
		region: regionArg as PartifulRegion,
		city: getArg("--city"),
		outPath: getArg("--out"),
		geocodeOutPath: getArg("--geocode-out"),
		since: getArg("--since"),
		until: getArg("--until"),
		fallbackTz: getArg("--default-tz"),
	}).catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
