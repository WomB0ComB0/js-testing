/**
 * Builds a tech-week-style calendar + geocode cache from a list of luma.com
 * event slugs.
 *
 * Input is the JSON file produced by the in-page console snippet that scrapes
 * card metadata from a Luma calendar page (e.g. https://luma.com/nyc). Each
 * entry must at minimum carry `slug`; everything else is overwritten from the
 * per-event detail page.
 *
 * Each luma.com/<slug> page embeds a `schema.org/Event` JSON-LD block with
 * startDate, endDate, full description, and pre-geocoded latitude/longitude.
 * That means we can skip Google Maps geocoding entirely — the script writes
 * a sibling geocoded.json so tech-week-26.ts sees cache hits for every
 * location and never calls the API.
 *
 * Usage:
 *   bun run scrape-luma.ts \
 *     --cards luma-nyc-cards.json \
 *     --out tech-week-luma-nyc-calendar.json \
 *     --geocode-out tech-week-luma-nyc-geocoded.json \
 *     --city "New York City"
 */

import { basename, dirname, join, resolve } from "node:path";
import { getArg } from "./lib/cli.js";
import { fetchHtml } from "./lib/fetch.js";
import { fnv1a32 } from "./lib/hash.js";
import { pool } from "./lib/pool.js";
import {
	buildNegativeMatcher,
	buildScorer,
	NEGATIVE_KEYWORDS_DEFAULT,
	PRIORITY_KEYWORDS_TECH,
} from "./lib/scoring.js";

const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 15_000;
const PER_WORKER_DELAY_MS = 150;
const USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunOptions {
	/** Path to the JSON file produced by the in-page card scraper. */
	cardsPath: string;
	/** Display city ("NYC", "Luma NYC"). Defaults to "New York City". */
	city?: string;
	/** Output calendar.json path. */
	outPath?: string;
	/** Output geocoded.json path. */
	geocodeOutPath?: string;
}

export interface RunResult {
	outPath: string;
	geocodeOutPath: string;
	eventCount: number;
	withDescription: number;
	withCoords: number;
	priorityScored: number;
	dropped: number;
}

// ---------------------------------------------------------------------------
// Priority scoring — Luma's general /nyc calendar generates false positives
// with broader keyword lists, so we use the precision-first
// PRIORITY_KEYWORDS_TECH from lib/scoring.ts and a NEGATIVE_KEYWORDS title
// filter to drop obviously non-tech events (cocktail parties, 5Ks, yoga,
// etc.). The keyword lists live in lib/scoring.ts so multiple scrapers stay
// in sync.
// ---------------------------------------------------------------------------

const PRIORITY_KEYWORDS = PRIORITY_KEYWORDS_TECH;
const scorer = buildScorer(PRIORITY_KEYWORDS);
const negativeMatch = buildNegativeMatcher(NEGATIVE_KEYWORDS_DEFAULT);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CardInput {
	slug: string;
	name?: string;
	time?: string;
	host?: string;
	location?: string;
	dateHeader?: string;
}

interface LumaJsonLd {
	"@type"?: string;
	name?: string;
	url?: string;
	startDate?: string;
	endDate?: string;
	description?: string;
	location?: {
		name?: string;
		address?: {
			addressLocality?: string;
			addressRegion?: string;
		};
		latitude?: number;
		longitude?: number;
		geo?: { latitude?: number; longitude?: number };
	};
	organizer?: Array<{ name?: string; url?: string }> | { name?: string };
}

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
		time?: { label: string };
		locations?: Array<{ label: string }>;
		hosts?: Array<{ key: string; label: string; role: string }>;
	};
	description?: string | null;
	priorityScore?: number;
	priorityMatches?: string[];
}

// ---------------------------------------------------------------------------
// JSON-LD extraction (fetch lives in lib/fetch.ts)
// ---------------------------------------------------------------------------

function extractJsonLdEvent(html: string): LumaJsonLd | null {
	// Match every ld+json script; pick the first one whose @type is "Event".
	const re =
		/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
	let match: RegExpExecArray | null = re.exec(html);
	while (match !== null) {
		try {
			const obj = JSON.parse(match[1]) as LumaJsonLd;
			if (obj?.["@type"] === "Event") return obj;
		} catch {
			// skip malformed block, try next
		}
		match = re.exec(html);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(options: RunOptions): Promise<RunResult> {
	const scriptDir = import.meta.dir;
	const cardsPath = resolve(options.cardsPath);
	const outPath = resolve(
		options.outPath ?? join(scriptDir, "tech-week-luma-nyc-calendar.json"),
	);
	const geocodeOutPath = resolve(
		options.geocodeOutPath ??
			join(dirname(outPath), "tech-week-luma-nyc-geocoded.json"),
	);
	const city = options.city ?? "New York City";

	const cards: CardInput[] = await Bun.file(cardsPath).json();
	const valid = cards.filter((c) => typeof c?.slug === "string" && c.slug);
	console.log(`Loaded ${valid.length} luma cards from ${cardsPath}`);

	const events: CalendarEvent[] = [];
	const geocode: Record<string, { lat: number; lng: number }> = {};
	const dropped: Array<{ url: string; name: string; reason: string }> = [];
	let ok = 0;
	let failed = 0;

	await pool(
		valid,
		{ concurrency: CONCURRENCY, perWorkerDelayMs: PER_WORKER_DELAY_MS },
		async (card) => {
		const url = `https://luma.com/${card.slug}`;
		const html = await fetchHtml(url, {
			timeoutMs: REQUEST_TIMEOUT_MS,
			userAgent: USER_AGENT,
		});
		if (!html) {
			failed += 1;
			return;
		}
		const ld = extractJsonLdEvent(html);
		if (!ld?.startDate) {
			failed += 1;
			console.warn(`  no JSON-LD Event for ${url}`);
			return;
		}

		const eventName = ld.name ?? card.name ?? card.slug;
		const negHit = negativeMatch(eventName);
		if (negHit) {
			dropped.push({ url, name: eventName, reason: negHit });
			return;
		}

		// startDate looks like "2026-06-26T18:00:00.000-04:00" — split on T.
		const startIso = ld.startDate;
		const date = startIso.slice(0, 10);
		const timeMatch = startIso.match(/T(\d{2}:\d{2}:\d{2})/);
		const time = timeMatch ? timeMatch[1] : "00:00:00";

		const lat = ld.location?.latitude ?? ld.location?.geo?.latitude;
		const lng = ld.location?.longitude ?? ld.location?.geo?.longitude;
		const cardLocation = card.location?.trim() || null;
		const ldLocality = ld.location?.address?.addressLocality;
		// Prefer the card's neighborhood label (matches what humans see in
		// listings); fall back to JSON-LD's addressLocality or name.
		const locationLabel =
			cardLocation || ldLocality || ld.location?.name || null;

		// Make the geocode cache key unique per event so two distinct venues in
		// the same neighborhood don't collapse onto the same point. Embedding
		// the slug keeps it short, stable, and human-debuggable.
		const cacheKey = locationLabel
			? `${locationLabel} (${card.slug})`
			: card.slug;

		if (typeof lat === "number" && typeof lng === "number") {
			geocode[cacheKey] = { lat, lng };
		}

		const organizers = Array.isArray(ld.organizer)
			? ld.organizer
			: ld.organizer
				? [ld.organizer]
				: [];
		const hosts = organizers
			.map((o) => o?.name)
			.filter((n): n is string => typeof n === "string" && n.length > 0)
			.map((name) => ({
				key: name.toLowerCase().replace(/\s+/g, "-"),
				label: name,
				role: "primary" as const,
			}));

		const company =
			hosts[0]?.label ?? card.host?.replace(/^By\s+/i, "") ?? null;
		const description = ld.description ?? null;
		const scoreText = [
			ld.name ?? card.name ?? "",
			description ?? "",
			company ?? "",
			...hosts.map((h) => h.label),
		].join(" ");
		const { score, matches } = scorer.score(scoreText);

		events.push({
			id: fnv1a32(card.slug),
			city,
			date,
			time,
			location: cacheKey,
			name: ld.name ?? card.name ?? card.slug,
			company,
			externalHref: url,
			isInviteOnly: false,
			facets: {
				time: card.time ? { label: card.time } : undefined,
				locations: locationLabel ? [{ label: locationLabel }] : undefined,
				hosts: hosts.length > 0 ? hosts : undefined,
			},
			description,
			priorityScore: score,
			priorityMatches: matches,
		});

		ok += 1;
		if ((ok + failed) % 20 === 0 || ok + failed === valid.length) {
			console.log(
				`  progress: ${ok + failed}/${valid.length}  (ok=${ok} failed=${failed})`,
			);
		}
		},
	);

	events.sort((a, b) => {
		const d = a.date.localeCompare(b.date);
		if (d !== 0) return d;
		return a.time.localeCompare(b.time);
	});

	const output = {
		events,
		source: basename(cardsPath),
		generatedAt: new Date().toISOString(),
		uniqueEventCount: events.length,
		priorityKeywords: PRIORITY_KEYWORDS,
	};

	await Bun.write(outPath, JSON.stringify(output, null, 2));
	await Bun.write(geocodeOutPath, JSON.stringify(geocode, null, 2));

	const withDesc = events.filter((e) => !!e.description).length;
	const withCoords = Object.keys(geocode).length;
	const scored = events.filter((e) => (e.priorityScore ?? 0) > 0).length;
	console.log(
		`\nWrote ${outPath}\n` +
			`Wrote ${geocodeOutPath}\n` +
			`Summary: events=${events.length} withDesc=${withDesc} withCoords=${withCoords} priorityScored=${scored} dropped=${dropped.length}`,
	);
	if (dropped.length > 0) {
		console.log("Dropped (NEGATIVE_KEYWORDS in name):");
		for (const d of dropped) console.log(`  [${d.reason}] ${d.name} (${d.url})`);
	}

	return {
		outPath,
		geocodeOutPath,
		eventCount: events.length,
		withDescription: withDesc,
		withCoords,
		priorityScored: scored,
		dropped: dropped.length,
	};
}

if (import.meta.main) {
	const scriptDir = import.meta.dir;
	run({
		cardsPath: getArg("--cards") ?? join(scriptDir, "luma-nyc-cards.json"),
		city: getArg("--city"),
		outPath: getArg("--out"),
		geocodeOutPath: getArg("--geocode-out"),
	}).catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
