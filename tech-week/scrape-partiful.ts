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

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
	const idx = process.argv.indexOf(flag);
	if (idx === -1) return undefined;
	const next = process.argv[idx + 1];
	if (!next || next.startsWith("--")) return undefined;
	return next;
}

// Paths resolve relative to this script so it works from any CWD.
const SCRIPT_DIR = import.meta.dir;
const CALENDAR_FILE = resolve(
	getArg("--calendar") ?? join(SCRIPT_DIR, "tech-week-calendar.json"),
);
const PRIORITY_FILE = resolve(
	getArg("--priority") ?? join(SCRIPT_DIR, "tech-week-priority.md"),
);
const CITY_LABEL = getArg("--city") ?? "NYC";

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

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchHtml(url: string): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
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

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PRIORITY_REGEXES = PRIORITY_KEYWORDS.map((kw) => ({
	kw,
	re: new RegExp(`\\b${escapeRegex(kw)}\\b`, "i"),
}));

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
	const text = scoreableText(event);
	const matches: string[] = [];
	for (const { kw, re } of PRIORITY_REGEXES) {
		if (re.test(text)) matches.push(kw);
	}
	return { score: matches.length, matches };
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function pool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const total = items.length;
	const runners = Array.from({ length: concurrency }, async (_, workerId) => {
		while (cursor < total) {
			const index = cursor;
			cursor += 1;
			if (PER_WORKER_DELAY_MS > 0 && workerId > 0) {
				await new Promise((r) => setTimeout(r, PER_WORKER_DELAY_MS));
			}
			await worker(items[index], index);
		}
	});
	await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
	const refresh = process.argv.includes("--refresh");

	const raw = await Bun.file(CALENDAR_FILE).json();
	const parsed = FileSchema.safeParse(raw);
	if (!parsed.success) {
		console.error("Schema mismatch:", parsed.error);
		process.exit(1);
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

	await pool(needsFetch, CONCURRENCY, async (event) => {
		if (!event.externalHref) return;
		const html = await fetchHtml(event.externalHref);
		if (html) {
			const desc = extractDescription(html);
			event.description = desc;
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
	});

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
	await Bun.write(CALENDAR_FILE, JSON.stringify(output, null, 2));
	console.log(`Wrote ${CALENDAR_FILE}`);

	// Top-N markdown report
	const ranked = [...data.events]
		.filter((e) => (e.priorityScore ?? 0) > 0)
		.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
		.slice(0, TOP_N);

	let md = `# ${CITY_LABEL} Tech Week 2026 — Top ${ranked.length} Events by Priority\n\n`;
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
	await Bun.write(PRIORITY_FILE, md);
	console.log(`Wrote ${PRIORITY_FILE} (${ranked.length} ranked events)`);

	const withDesc = data.events.filter((e) => !!e.description).length;
	console.log(
		`\nSummary: ${withDesc}/${data.events.length} events now have descriptions.`,
	);
})();
