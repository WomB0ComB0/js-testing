/**
 * Reads an iCalendar (RFC 5545) feed — over HTTP or from a local file — and
 * emits the same `{ events: [...] }` envelope consumed by tech-week-26.ts.
 *
 * Why this exists: most event sources (Luma, Meetup, Eventbrite, Google
 * Calendar, sched.com, etc.) expose a public ICS URL. Subscribing to ICS
 * replaces HAR captures and DOM console snippets with a single URL.
 *
 * Usage:
 *   bun run extract-calendar-from-ics.ts \
 *     --url https://example.com/calendar.ics \
 *     --city "New York City" \
 *     --out tech-week-foo-calendar.json
 *
 * Or from a local file:
 *   bun run extract-calendar-from-ics.ts --file foo.ics --city "NYC"
 *
 * Date filtering (optional):
 *   --since 2026-06-01    drop events ending before this date
 *   --until 2026-09-01    drop events starting after this date
 */

import { basename, dirname, join, resolve } from "node:path";
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunOptions {
	/** Remote ICS URL — either this or `file` is required. */
	url?: string;
	/** Local ICS file path — either this or `url` is required. */
	file?: string;
	/** Output calendar.json path. Defaults to tech-week-<city>-calendar.json. */
	outPath?: string;
	/** Output geocoded.json path (only written when ICS includes GEO). */
	geocodeOutPath?: string;
	/** Display name carried into events ("NYC", "Boston", "Luma NYC"). */
	city?: string;
	/** Drop events ending before this date (YYYY-MM-DD). */
	since?: string;
	/** Drop events starting after this date (YYYY-MM-DD). */
	until?: string;
	/** IANA zone used to interpret floating/UTC datetimes for display. */
	defaultTz?: string;
}

export interface RunResult {
	outPath: string;
	geocodeOutPath?: string;
	eventCount: number;
	withDescription: number;
	withGeo: number;
	priorityScored: number;
	dropped: number;
}

// ---------------------------------------------------------------------------
// Priority scoring — ICS feeds are usually general-audience (mixed event
// types) so we use the precision-first PRIORITY_KEYWORDS_TECH from
// lib/scoring.ts, paired with NEGATIVE_KEYWORDS_DEFAULT to drop obvious
// non-tech titles. Same profile as scrape-luma.ts.
// ---------------------------------------------------------------------------

const PRIORITY_KEYWORDS = PRIORITY_KEYWORDS_TECH;
const scorer = buildScorer(PRIORITY_KEYWORDS);
const negativeMatch = buildNegativeMatcher(NEGATIVE_KEYWORDS_DEFAULT);

// ---------------------------------------------------------------------------
// ICS parser (hand-rolled — RFC 5545 is line-oriented and the subset we need
// from VEVENTs is small enough that a dependency isn't justified.)
// ---------------------------------------------------------------------------

interface ParsedField {
	value: string;
	params: Record<string, string>;
}

interface RawVEvent {
	UID?: ParsedField;
	SUMMARY?: ParsedField;
	DESCRIPTION?: ParsedField;
	DTSTART?: ParsedField;
	DTEND?: ParsedField;
	LOCATION?: ParsedField;
	URL?: ParsedField;
	GEO?: ParsedField;
	ORGANIZER?: ParsedField;
}

/** Unfold lines per RFC 5545 §3.1 — continuation lines start with space/tab. */
function unfoldLines(text: string): string[] {
	const raw = text.split(/\r?\n/);
	const out: string[] = [];
	for (const line of raw) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

/** Parse one content line into `KEY`, params, and value. */
function parseLine(line: string): {
	key: string;
	params: Record<string, string>;
	value: string;
} | null {
	const colonIdx = line.indexOf(":");
	if (colonIdx < 0) return null;
	const left = line.slice(0, colonIdx);
	const value = line.slice(colonIdx + 1);
	const parts = left.split(";");
	const key = parts[0].toUpperCase();
	const params: Record<string, string> = {};
	for (let i = 1; i < parts.length; i++) {
		const eq = parts[i].indexOf("=");
		if (eq > 0)
			params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
	}
	return { key, params, value };
}

/** ICS escape sequences within TEXT values (RFC 5545 §3.3.11). */
function unescapeIcsText(s: string): string {
	return s
		.replace(/\\n/gi, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");
}

function parseIcs(text: string): RawVEvent[] {
	const lines = unfoldLines(text);
	const events: RawVEvent[] = [];
	let current: RawVEvent | null = null;
	for (const line of lines) {
		if (line === "BEGIN:VEVENT") {
			current = {};
			continue;
		}
		if (line === "END:VEVENT") {
			if (current) events.push(current);
			current = null;
			continue;
		}
		if (!current) continue;
		const parsed = parseLine(line);
		if (!parsed) continue;
		const field: ParsedField = { value: parsed.value, params: parsed.params };
		switch (parsed.key) {
			case "UID":
				current.UID = field;
				break;
			case "SUMMARY":
				current.SUMMARY = field;
				break;
			case "DESCRIPTION":
				current.DESCRIPTION = field;
				break;
			case "DTSTART":
				current.DTSTART = field;
				break;
			case "DTEND":
				current.DTEND = field;
				break;
			case "LOCATION":
				current.LOCATION = field;
				break;
			case "URL":
				current.URL = field;
				break;
			case "GEO":
				current.GEO = field;
				break;
			case "ORGANIZER":
				current.ORGANIZER = field;
				break;
		}
	}
	return events;
}

/**
 * Parse an ICS DATE-TIME value into a Luxon DateTime carrying its true zone.
 * Returns null when the value is unparseable.
 *
 * Forms handled:
 *   20260626T180000Z              → UTC
 *   20260626T180000               → floating (interpreted via fallback zone)
 *   TZID=Region/City:20260626T... → explicit zone via field params
 */
function parseIcsDateTime(
	field: ParsedField | undefined,
	fallbackTz: string,
): DateTime | null {
	if (!field) return null;
	const raw = field.value;
	const tz = field.params.TZID;
	let dt: DateTime;
	if (raw.endsWith("Z")) {
		dt = DateTime.fromFormat(raw, "yyyyMMdd'T'HHmmss'Z'", { zone: "utc" });
	} else if (tz) {
		dt = DateTime.fromFormat(raw, "yyyyMMdd'T'HHmmss", { zone: tz });
	} else {
		// Floating — assume the calendar's intended local zone.
		dt = DateTime.fromFormat(raw, "yyyyMMdd'T'HHmmss", { zone: fallbackTz });
	}
	// Normalize display zone — itineraries are for someone physically in one
	// place, so prefer consistent local time over honoring each event's
	// declared zone.
	return dt.setZone(fallbackTz);
}

// ---------------------------------------------------------------------------
// Output types
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
		time?: { label: string };
		locations?: Array<{ label: string }>;
		hosts?: Array<{ key: string; label: string; role: string }>;
	};
	description?: string | null;
	priorityScore?: number;
	priorityMatches?: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function fetchIcsText(opts: {
	url?: string;
	file?: string;
}): Promise<string> {
	if (opts.file) {
		return Bun.file(resolve(opts.file)).text();
	}
	if (!opts.url) throw new Error("Either url or file is required.");
	const response = await fetch(opts.url, {
		headers: { "User-Agent": USER_AGENT, Accept: "text/calendar, text/plain" },
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} fetching ${opts.url}`);
	}
	return response.text();
}

export async function run(options: RunOptions): Promise<RunResult> {
	const fallbackTz = options.defaultTz ?? "America/New_York";
	const city = options.city ?? "Unknown";
	const citySlug = city.toLowerCase().replace(/\s+/g, "-");
	const sourceLabel =
		options.url ?? (options.file ? basename(options.file) : "unknown");
	const scriptDir = import.meta.dir;
	const outPath = resolve(
		options.outPath ?? join(scriptDir, `tech-week-${citySlug}-calendar.json`),
	);
	const geocodeOutPath = resolve(
		options.geocodeOutPath ??
			join(dirname(outPath), `tech-week-${citySlug}-geocoded.json`),
	);

	const text = await fetchIcsText({ url: options.url, file: options.file });
	const raw = parseIcs(text);
	console.log(`Parsed ${raw.length} VEVENTs from ${sourceLabel}`);

	const since = options.since
		? DateTime.fromISO(options.since, { zone: fallbackTz })
		: null;
	const until = options.until
		? DateTime.fromISO(options.until, { zone: fallbackTz })
		: null;

	const events: CalendarEvent[] = [];
	const geocode: Record<string, { lat: number; lng: number }> = {};
	const dropped: Array<{ name: string; reason: string }> = [];
	const seen = new Set<number>();

	for (const ev of raw) {
		const start = parseIcsDateTime(ev.DTSTART, fallbackTz);
		if (!start || !start.isValid) continue;

		const end = parseIcsDateTime(ev.DTEND, fallbackTz);
		if (since && (end ?? start) < since) continue;
		if (until && start > until) continue;

		// Format date/time in the event's own zone so the timeline matches what
		// attendees would see locally.
		const date = start.toFormat("yyyy-MM-dd");
		const time = start.toFormat("HH:mm:ss");

		const name = ev.SUMMARY ? unescapeIcsText(ev.SUMMARY.value) : "(untitled)";

		// Negative filter on the title only.
		const negHit = negativeMatch(name);
		if (negHit) {
			dropped.push({ name, reason: negHit });
			continue;
		}

		const description = ev.DESCRIPTION
			? unescapeIcsText(ev.DESCRIPTION.value)
			: null;
		const location = ev.LOCATION ? unescapeIcsText(ev.LOCATION.value) : null;
		const externalHref = ev.URL?.value ?? null;
		const organizerLabel = ev.ORGANIZER?.params.CN
			? ev.ORGANIZER.params.CN
			: ev.ORGANIZER
				? ev.ORGANIZER.value.replace(/^mailto:/i, "")
				: null;

		const uid = ev.UID?.value ?? `${date}-${name}`;
		const id = fnv1a32(uid);
		if (seen.has(id)) continue;
		seen.add(id);

		const cacheKey = location ? `${location} (${uid.slice(0, 12)})` : uid;

		if (ev.GEO) {
			const [latStr, lngStr] = ev.GEO.value.split(";");
			const lat = Number(latStr);
			const lng = Number(lngStr);
			if (Number.isFinite(lat) && Number.isFinite(lng)) {
				geocode[cacheKey] = { lat, lng };
			}
		}

		const hosts = organizerLabel
			? [
					{
						key: organizerLabel.toLowerCase().replace(/\s+/g, "-"),
						label: organizerLabel,
						role: "primary" as const,
					},
				]
			: undefined;

		const scoreText = [name, description ?? "", organizerLabel ?? ""].join(" ");
		const { score, matches } = scorer.score(scoreText);

		events.push({
			id,
			city,
			date,
			time,
			location: cacheKey,
			name,
			company: organizerLabel,
			externalHref,
			isInviteOnly: false,
			facets: {
				locations: location ? [{ label: location }] : undefined,
				hosts,
			},
			description,
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
		source: sourceLabel,
		generatedAt: new Date().toISOString(),
		uniqueEventCount: events.length,
		priorityKeywords: PRIORITY_KEYWORDS,
	};

	await Bun.write(outPath, JSON.stringify(output, null, 2));
	const withGeo = Object.keys(geocode).length;
	let writtenGeocodeOutPath: string | undefined;
	if (withGeo > 0) {
		await Bun.write(geocodeOutPath, JSON.stringify(geocode, null, 2));
		writtenGeocodeOutPath = geocodeOutPath;
		console.log(`Wrote ${geocodeOutPath} (${withGeo} pre-geocoded)`);
	}

	const withDesc = events.filter((e) => !!e.description).length;
	const scored = events.filter((e) => (e.priorityScore ?? 0) > 0).length;
	console.log(
		`Wrote ${outPath}\n` +
			`Summary: events=${events.length} withDesc=${withDesc} ` +
			`withGeo=${withGeo} priorityScored=${scored} dropped=${dropped.length}`,
	);
	if (dropped.length > 0) {
		console.log("Dropped (NEGATIVE_KEYWORDS in title):");
		for (const d of dropped) console.log(`  [${d.reason}] ${d.name}`);
	}

	return {
		outPath,
		geocodeOutPath: writtenGeocodeOutPath,
		eventCount: events.length,
		withDescription: withDesc,
		withGeo,
		priorityScored: scored,
		dropped: dropped.length,
	};
}

if (import.meta.main) {
	const urlArg = getArg("--url");
	const fileArg = getArg("--file");
	if (!urlArg && !fileArg) {
		console.error(
			"Usage: extract-calendar-from-ics.ts (--url <url> | --file <path>) [--city <name>] [--out <out.json>] [--since YYYY-MM-DD] [--until YYYY-MM-DD]",
		);
		process.exit(1);
	}
	run({
		url: urlArg,
		file: fileArg,
		outPath: getArg("--out"),
		geocodeOutPath: getArg("--geocode-out"),
		city: getArg("--city"),
		since: getArg("--since"),
		until: getArg("--until"),
		defaultTz: getArg("--default-tz"),
	}).catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
