/**
 * Scrapes partiful.com event descriptions referenced by tech-week-calendar.json
 * and enriches the same JSON in place with:
 *   - description       : full event description (boilerplate stripped)
 *   - priorityScore     : count of PRIORITY_KEYWORDS matched in name+desc+hosts
 *   - priorityMatches   : list of matched keywords
 *
 * Also emits tech-week-priority.md — top events sorted by priorityScore.
 *
 * Idempotent: re-runs skip events that already have a non-null description.
 * To force a re-scrape pass `--refresh`.
 */

import { join, resolve } from "node:path";
import { z } from "zod";
import { getArg, hasFlag } from "./lib/cli.js";
import { fetchHtml } from "./lib/fetch.js";
import { pool } from "./lib/pool.js";
import { buildScorer } from "./lib/scoring.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunOptions {
	calendarPath?: string;
	priorityPath?: string;
	city?: string;
	/** Force re-fetch of events that already have a description. */
	refresh?: boolean;
}

export interface RunResult {
	calendarPath: string;
	priorityPath: string;
	totalEvents: number;
	partifulLinked: number;
	withDescription: number;
	rankedCount: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 15_000;
const PER_WORKER_DELAY_MS = 100;
const USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

// Edit this list to change what counts as "priority". Word-boundary matched,
// case-insensitive. Multi-word phrases match as written.
//
// Default starter set covers common tech-event signal vocabulary:
// founder/startup stage, investors/fundraising, AI/ML, deep tech / hardware,
// engineering, builder community. Tailor to your own interests.
const PRIORITY_KEYWORDS: string[] = [
    // --- Stage / fundraising ---
    "founder",
    "founders",
    "startup",
    "startups",
    "seed",
    "pre-seed",
    "series A",
    "early stage",
    "raising",
    "fund",
    "fundraise",
    "fundraising",
    "demo day",
    "pitch",
    "GTM",
// --- Investors ---
    "VC",
    "VCs",
    "venture capital",
    "investor",
    "investors",
    "angel",
    "LP",
    "GP",
// --- AI / ML ---
    "AI",
    "ML",
    "LLM",
    "machine learning",
    "deep learning",
    "agents",
    "agentic",
    "GenAI",
// --- Tech themes ---
    "deep tech",
    "frontier tech",
    "hardware",
    "robotics",
    "infrastructure",
    "infra",
// --- Engineering / builder ---
    "engineer",
    "engineering",
    "open source",
    "hackathon",
];
const TOP_N = 50;

// ---------------------------------------------------------------------------
// Schema (lenient — extra fields allowed and preserved on writeback)
// ---------------------------------------------------------------------------

const EventSchema = z
	.object({
		id: z.number(),
		name: z.string(),
		externalHref: z.string().nullable(),
		company: z.string().nullable().optional(),
		facets: z
			.object({
				hosts: z
					.array(z.object({ label: z.string() }).passthrough())
					.optional(),
			})
			.passthrough()
			.optional(),
		description: z.string().nullable().optional(),
		priorityScore: z.number().optional(),
		priorityMatches: z.array(z.string()).optional(),
	})
	.passthrough();

const FileSchema = z
	.object({
		events: z.array(EventSchema),
	})
	.passthrough();

type EnrichedEvent = z.infer<typeof EventSchema>;

// ---------------------------------------------------------------------------
// Description extraction
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
	return text
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#x27;|&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&mdash;/g, "—")
		.replace(/&ndash;/g, "–")
		.replace(/&hellip;/g, "…");
}

function stripBoilerplate(description: string): string {
	return description
		.replace(/\s*This event is a part of #NYTechWeek[\s\S]*$/i, "")
		.trim();
}

function extractDescription(html: string): string | null {
	// The selector targets div.ptf-l-mWmFQ > span. The class name `mWmFQ` is
	// hashed by the build, so guard against drift by also accepting the
	// og:description meta as a fallback.
	const selectorMatch = html.match(
		/<div\s+class="ptf-l-mWmFQ[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
	);
	if (selectorMatch) {
		const cleaned = stripBoilerplate(decodeEntities(selectorMatch[1]));
		if (cleaned.length > 0) return cleaned;
	}

	const ogMatch = html.match(
		/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
	);
	if (ogMatch) return stripBoilerplate(decodeEntities(ogMatch[1]));

	const metaMatch = html.match(
		/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
	);
	if (metaMatch) return stripBoilerplate(decodeEntities(metaMatch[1]));

	return null;
}

interface PartifulLocationInfo {
	neighborhood?: string;
	mapsInfo?: {
		appleMapsUrl?: string;
		googleMapsUrl?: string;
		addressLines?: string[];
		approximateLocation?: string;
	};
}

/**
 * Pulls the structured location data Partiful embeds in `__NEXT_DATA__`.
 * Used to upgrade tech-week.com's borough-level labels ("Brooklyn",
 * "Midtown") to specific neighborhoods ("Hell's Kitchen", "DUMBO"), harvest
 * the 2-decimal `sll=` coords as a free fallback, and extract the full
 * street address so downstream geocoding can pin to building level.
 */
function extractPartifulLocation(html: string): {
	neighborhood: string | null;
	coords: { lat: number; lng: number } | null;
	address: string | null;
} {
	const result = {
		neighborhood: null as string | null,
		coords: null as { lat: number; lng: number } | null,
		address: null as string | null,
	};
	const m = html.match(
		/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
	);
	if (!m) return result;
	try {
		const data = JSON.parse(m[1]) as {
			props?: {
				pageProps?: { event?: { locationInfo?: PartifulLocationInfo } };
			};
		};
		const li = data.props?.pageProps?.event?.locationInfo;
		if (!li) return result;
		if (li.neighborhood && typeof li.neighborhood === "string") {
			result.neighborhood = li.neighborhood.trim();
		}
		const sll = li.mapsInfo?.appleMapsUrl?.match(
			/sll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
		);
		if (sll) {
			const lat = Number(sll[1]);
			const lng = Number(sll[2]);
			if (Number.isFinite(lat) && Number.isFinite(lng)) {
				result.coords = { lat, lng };
			}
		}
		// Address harvest — preferred over sll because Google Maps geocoding
		// against a real street address resolves to building-level (~10m)
		// vs partiful's truncated 2-decimal sll (~1km).
		const lines = li.mapsInfo?.addressLines;
		if (Array.isArray(lines) && lines.length > 0) {
			const joined = lines
				.filter((s) => typeof s === "string" && s.trim().length > 0)
				.join(", ")
				.trim();
			if (joined) result.address = joined;
		} else if (li.mapsInfo?.googleMapsUrl) {
			const q = li.mapsInfo.googleMapsUrl.match(/[?&]query=([^&]+)/);
			if (q) {
				try {
					const decoded = decodeURIComponent(q[1]).trim();
					if (decoded) result.address = decoded;
				} catch {
					// malformed url-encoding — skip
				}
			}
		}
	} catch {
		// malformed JSON — ignore
	}
	return result;
}

// ---------------------------------------------------------------------------
// Priority scoring — keeps its own broader keyword list (PRIORITY_KEYWORDS
// above) because tech-week.com is already filtered to tech events, so recall
// matters more than precision. Engine itself is shared via lib/scoring.ts.
// ---------------------------------------------------------------------------

const scorer = buildScorer(PRIORITY_KEYWORDS);

function scoreableText(event: EnrichedEvent): string {
	const parts = [
		event.name,
		event.description ?? "",
		event.company ?? "",
		...(event.facets?.hosts?.map((h) => h.label) ?? []),
	];
	return parts.filter(Boolean).join(" ");
}

function scoreEvent(event: EnrichedEvent): {
	score: number;
	matches: string[];
} {
	return scorer.score(scoreableText(event));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(options: RunOptions = {}): Promise<RunResult> {
	const scriptDir = import.meta.dir;
	const calendarPath = resolve(
		options.calendarPath ?? join(scriptDir, "tech-week-calendar.json"),
	);
	const priorityPath = resolve(
		options.priorityPath ?? join(scriptDir, "tech-week-priority.md"),
	);
	const cityLabel = options.city ?? "NYC";
	const refresh = options.refresh ?? false;

	const raw = await Bun.file(calendarPath).json();
	const parsed = FileSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Schema mismatch in ${calendarPath}: ${parsed.error}`);
	}
	const data = parsed.data;

	const partiful = data.events.filter((e) =>
		e.externalHref?.includes("partiful.com"),
	);
	const needsFetch = partiful.filter(
		(e) => refresh || e.description === undefined || e.description === null,
	);
	console.log(
		`Total events: ${data.events.length} | partiful-linked: ${partiful.length} | to fetch: ${needsFetch.length}`,
	);

	let done = 0;
	let ok = 0;
	let failed = 0;

	await pool(
		needsFetch,
		{ concurrency: CONCURRENCY, perWorkerDelayMs: PER_WORKER_DELAY_MS },
		async (event) => {
			if (!event.externalHref) return;
			const html = await fetchHtml(event.externalHref, {
				timeoutMs: REQUEST_TIMEOUT_MS,
				userAgent: USER_AGENT,
			});
			if (html) {
				const desc = extractDescription(html);
				event.description = desc;
				// Geo-refinement: upgrade tech-week.com's borough-level label
				// to Partiful's specific neighborhood and stamp exact coords
				// when the host published an address. Splits 357 "Midtown"
				// pins into distinct sub-neighborhood points.
				const loc = extractPartifulLocation(html);
				if (loc.neighborhood) {
					(event as { location?: string | null }).location = loc.neighborhood;
				}
				if (loc.coords) {
					(event as { coords?: { lat: number; lng: number } }).coords =
						loc.coords;
				}
				if (loc.address) {
					(event as { address?: string }).address = loc.address;
				}
				if (desc) ok += 1;
				else failed += 1;
			} else {
				event.description = null;
				failed += 1;
			}
			done += 1;
			if (done % 50 === 0 || done === needsFetch.length) {
				console.log(
					`  progress: ${done}/${needsFetch.length}  (ok=${ok} failed=${failed})`,
				);
			}
		},
	);

	// Score every event (cheap and idempotent, run on all events)
	for (const event of data.events) {
		const { score, matches } = scoreEvent(event);
		event.priorityScore = score;
		event.priorityMatches = matches;
	}

	// Write back, preserving extra top-level fields and adding metadata.
	const output = {
		...data,
		enrichedAt: new Date().toISOString(),
		priorityKeywords: PRIORITY_KEYWORDS,
	};
	await Bun.write(calendarPath, JSON.stringify(output, null, 2));
	console.log(`Wrote ${calendarPath}`);

	// Top-N markdown report
	const ranked = [...data.events]
		.filter((e) => (e.priorityScore ?? 0) > 0)
		.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
		.slice(0, TOP_N);

	let md = `# ${cityLabel} Tech Week 2026 — Top ${ranked.length} Events by Priority\n\n`;
	md += `Generated ${new Date().toISOString()}\n`;
	md += `Keywords: ${PRIORITY_KEYWORDS.join(", ")}\n\n`;
	md += `| Score | Date | Time | Name | Location | Matched | Link |\n`;
	md += `| ----- | ---- | ---- | ---- | -------- | ------- | ---- |\n`;
	for (const e of ranked) {
		const row = e as EnrichedEvent & {
			date?: string;
			time?: string;
			location?: string | null;
		};
		md += `| ${e.priorityScore} | ${row.date ?? ""} | ${row.time ?? ""} | ${row.name.replace(/\|/g, "\\|")} | ${row.location ?? ""} | ${(e.priorityMatches ?? []).join(", ")} | ${row.externalHref ?? ""} |\n`;
	}
	await Bun.write(priorityPath, md);
	console.log(`Wrote ${priorityPath} (${ranked.length} ranked events)`);

	const withDesc = data.events.filter((e) => !!e.description).length;
	console.log(
		`\nSummary: ${withDesc}/${data.events.length} events now have descriptions.`,
	);

	return {
		calendarPath,
		priorityPath,
		totalEvents: data.events.length,
		partifulLinked: partiful.length,
		withDescription: withDesc,
		rankedCount: ranked.length,
	};
}

if (import.meta.main) {
	run({
		calendarPath: getArg("--calendar"),
		priorityPath: getArg("--priority"),
		city: getArg("--city"),
		refresh: hasFlag("--refresh"),
	}).catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
