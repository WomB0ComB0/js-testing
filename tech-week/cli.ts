/**
 * Single entry point for the tech-week pipeline. Config-driven, no flag soup.
 *
 *   bun run tech-week/cli.ts <slug> <command> [extra args...]
 *
 * Commands
 * --------
 *   pull       Run the source extractor (HAR, ICS, Luma cards, or partiful)
 *              and write tech-week/out/<slug>/calendar.json
 *   enrich     Run scrape-partiful against the calendar (only for sources
 *              that need post-fetch description enrichment; no-op otherwise)
 *   itinerary  Build response.md + itinerary.html + itinerary.data.js
 *   push       Push selected events to the configured Google Calendar
 *   all        pull → enrich → itinerary → push (skips push if no google.calendarId)
 *
 * Examples
 * --------
 *   bun run tech-week/cli.ts luma-nyc pull
 *   bun run tech-week/cli.ts luma-nyc all
 *   bun run tech-week/cli.ts tech-week-nyc-26 itinerary
 *   bun run tech-week/cli.ts --list
 *
 * Configs live in tech-week/configs/<slug>.json. See lib/config.ts for the
 * schema.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { run as runHarExtract } from "./extract-calendar-from-har.js";
import { run as runIcsExtract } from "./extract-calendar-from-ics.js";
import { run as runLumaDiscover } from "./extract-luma-discover.js";
import { run as runPartifulExplore } from "./extract-partiful-explore.js";
import {
	CONFIGS_DIR,
	DEFAULTS,
	loadConfig,
	paths,
	resolveSourcePath,
	type TechWeekConfig,
} from "./lib/config.js";
import { run as runGCalPush } from "./push-to-google-calendar.js";
import { run as runLumaScrape } from "./scrape-luma.js";
import { run as runPartifulEnrich } from "./scrape-partiful.js";
import { run as runItinerary } from "./tech-week-26.js";

// ---------------------------------------------------------------------------
// Arg parsing — first positional is slug, second is command, rest pass through
// ---------------------------------------------------------------------------

const [, , slugOrFlag, command, ...extra] = process.argv;

if (!slugOrFlag || slugOrFlag === "--help" || slugOrFlag === "-h") {
	printUsage();
	process.exit(0);
}

if (slugOrFlag === "--list" || slugOrFlag === "-l") {
	listConfigs();
	process.exit(0);
}

if (!command) {
	console.error("Missing command. Run with --help for usage.\n");
	printUsage();
	process.exit(1);
}

const config = loadConfig(slugOrFlag);
const p = paths(config);
mkdirSync(p.outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Pipeline stages — each stage imports the relevant module's `run()` and
// invokes it directly, no subprocess hop. Stdio inherits naturally so
// progress streams through to the user's terminal.
// ---------------------------------------------------------------------------

function stageHeader(name: string): void {
	console.log(`\n→ ${name}\n`);
}

async function pull(): Promise<void> {
	const force = extra.includes("--force");
	await pullForConfig(config, p, force, new Set());
}

/**
 * Run the per-source pull for any config. Pulled OUT of `pull()` so the
 * "merge" source can recurse for each child.
 */
async function pullForConfig(
	cfg: TechWeekConfig,
	cfgPaths: ReturnType<typeof paths>,
	force: boolean,
	visited: Set<string>,
): Promise<void> {
	// Refuse to overwrite an existing calendar.json unless --force is passed.
	// Re-extraction wipes any partiful-enriched descriptions, which are
	// expensive to rebuild.
	if (existsSync(cfgPaths.calendarJson) && !force) {
		console.log(
			`(pull) ${cfgPaths.calendarJson} already exists — skipping. Pass --force to overwrite.`,
		);
		return;
	}

	if (visited.has(cfg.slug)) {
		throw new Error(`Cycle detected in merge sources at "${cfg.slug}"`);
	}
	visited.add(cfg.slug);
	mkdirSync(cfgPaths.outDir, { recursive: true });

	const source = cfg.source;
	const since = cfg.filter?.since;
	const until = cfg.filter?.until;
	const tz = cfg.timezone ?? DEFAULTS.timezone;

	switch (source.type) {
		case "har": {
			stageHeader(`extract-calendar-from-har [${cfg.slug}]`);
			await runHarExtract({
				harPath: resolveSourcePath(source.file),
				outPath: cfgPaths.calendarJson,
			});
			break;
		}
		case "ics": {
			if (!source.url && !source.file) {
				throw new Error(`ics source needs either "url" or "file"`);
			}
			stageHeader(`extract-calendar-from-ics [${cfg.slug}]`);
			await runIcsExtract({
				url: source.url,
				file: source.file ? resolveSourcePath(source.file) : undefined,
				city: cfg.city,
				outPath: cfgPaths.calendarJson,
				geocodeOutPath: cfgPaths.geocodedJson,
				defaultTz: tz,
				since,
				until,
			});
			break;
		}
		case "luma": {
			stageHeader(`scrape-luma [${cfg.slug}]`);
			await runLumaScrape({
				cardsPath: resolveSourcePath(source.cards),
				city: cfg.city,
				outPath: cfgPaths.calendarJson,
				geocodeOutPath: cfgPaths.geocodedJson,
			});
			break;
		}
		case "luma-discover": {
			stageHeader(`extract-luma-discover [${cfg.slug}]`);
			await runLumaDiscover({
				discoverSlug: source.discoverSlug,
				city: cfg.city,
				outPath: cfgPaths.calendarJson,
				geocodeOutPath: cfgPaths.geocodedJson,
				since,
				until,
			});
			break;
		}
		case "partiful-explore": {
			stageHeader(`extract-partiful-explore [${cfg.slug}]`);
			await runPartifulExplore({
				region: source.region,
				city: cfg.city,
				outPath: cfgPaths.calendarJson,
				geocodeOutPath: cfgPaths.geocodedJson,
				since,
				until,
				fallbackTz: tz,
			});
			break;
		}
		case "partiful": {
			// "Partiful" source means a pre-existing tech-week calendar.json
			// that just needs description-enrichment. Pull stage copies it in.
			const src = resolveSourcePath(source.calendar);
			await Bun.write(cfgPaths.calendarJson, await Bun.file(src).text());
			console.log(`Copied ${src} → ${cfgPaths.calendarJson}`);
			break;
		}
		case "merge": {
			await pullMerge(cfg, cfgPaths, source.sources, force, visited);
			break;
		}
	}
}

interface MergedEvent {
	id: number;
	city: string;
	date: string;
	time: string;
	location: string | null;
	name: string;
	company: string | null;
	externalHref: string | null;
	isInviteOnly: boolean;
	facets?: unknown;
	description?: string | null;
	priorityScore?: number;
	priorityMatches?: string[];
	/** Slugs of the source configs this event came from. */
	sources?: string[];
}

async function pullMerge(
	cfg: TechWeekConfig,
	cfgPaths: ReturnType<typeof paths>,
	childSlugs: string[],
	force: boolean,
	visited: Set<string>,
): Promise<void> {
	stageHeader(`merge [${cfg.slug}] ← ${childSlugs.join(", ")}`);

	// Ensure each child calendar exists; auto-pull missing ones. NOTE: we
	// intentionally do NOT cascade `--force` into children — re-pulling
	// children would wipe any partiful-enriched descriptions etc. To refresh
	// a child, pull it explicitly: `cli.ts <child-slug> pull --force`.
	const childCalendars: Array<{
		slug: string;
		data: { events: MergedEvent[] };
	}> = [];
	for (const childSlug of childSlugs) {
		const childCfg = loadConfig(childSlug);
		const childPaths = paths(childCfg);
		if (!existsSync(childPaths.calendarJson)) {
			console.log(`  ↳ auto-pulling missing child ${childSlug}`);
			await pullForConfig(childCfg, childPaths, false, visited);
		} else {
			console.log(
				`  ↳ reusing child ${childSlug} (${childPaths.calendarJson})`,
			);
		}
		const text = await Bun.file(childPaths.calendarJson).text();
		const data = JSON.parse(text) as { events: MergedEvent[] };
		childCalendars.push({ slug: childSlug, data });
	}

	// Dedupe by (lowercased trimmed name + date). Conflicting events from
	// distinct sources collapse into one with a `sources: []` tag listing
	// every contributor.
	const dedupeKey = (e: MergedEvent): string =>
		`${e.name.trim().toLowerCase()}|${e.date}`;
	const merged = new Map<string, MergedEvent>();
	let totalIn = 0;
	for (const { slug, data } of childCalendars) {
		for (const ev of data.events ?? []) {
			totalIn += 1;
			const key = dedupeKey(ev);
			const existing = merged.get(key);
			if (!existing) {
				merged.set(key, { ...ev, sources: [slug] });
			} else {
				// Dedupe slugs — an event repeated within one source shouldn't
				// inflate the cross-source diagnostic.
				if (!existing.sources?.includes(slug)) {
					existing.sources = [...(existing.sources ?? []), slug];
				}
				// Prefer richer data: existing wins on description if non-null,
				// otherwise take incoming. Keep highest priorityScore.
				if (!existing.description && ev.description) {
					existing.description = ev.description;
				}
				if ((ev.priorityScore ?? 0) > (existing.priorityScore ?? 0)) {
					existing.priorityScore = ev.priorityScore;
					existing.priorityMatches = ev.priorityMatches;
				}
			}
		}
	}

	const events = [...merged.values()].sort((a, b) => {
		const d = a.date.localeCompare(b.date);
		if (d !== 0) return d;
		return a.time.localeCompare(b.time);
	});

	const crossSourceDups = events.filter((e) => (e.sources?.length ?? 0) > 1);
	const intraDups = totalIn - events.length - crossSourceDups.length;
	console.log(
		`  merged: input=${totalIn} unique=${events.length} cross-source-duplicates=${crossSourceDups.length} intra-source-duplicates=${intraDups}`,
	);
	if (crossSourceDups.length > 0) {
		console.log("  Cross-source duplicates (same event in 2+ feeds):");
		for (const d of crossSourceDups) {
			console.log(`    [${d.sources?.join(" + ")}] ${d.date} ${d.name}`);
		}
	}

	const output = {
		events,
		source: `merge:${childSlugs.join("+")}`,
		generatedAt: new Date().toISOString(),
		uniqueEventCount: events.length,
		mergedFrom: childSlugs,
		duplicateCount: crossSourceDups.length,
	};
	await Bun.write(cfgPaths.calendarJson, JSON.stringify(output, null, 2));

	// Also merge each child's geocoded.json so tech-week-26 skips Google API.
	const mergedGeo: Record<string, { lat: number; lng: number }> = {};
	for (const { slug } of childCalendars) {
		const childCfg = loadConfig(slug);
		const childPaths = paths(childCfg);
		if (existsSync(childPaths.geocodedJson)) {
			const childGeo = JSON.parse(
				await Bun.file(childPaths.geocodedJson).text(),
			) as Record<string, { lat: number; lng: number }>;
			for (const [k, v] of Object.entries(childGeo)) {
				mergedGeo[k] = v;
			}
		}
	}
	if (Object.keys(mergedGeo).length > 0) {
		await Bun.write(cfgPaths.geocodedJson, JSON.stringify(mergedGeo, null, 2));
		console.log(
			`  Wrote merged geocode cache (${Object.keys(mergedGeo).length} entries)`,
		);
	}
}

async function enrich(): Promise<void> {
	// Description-fetching pass. Only meaningful when events point at
	// partiful.com URLs (the original tech-week.com extractor case).
	const needs =
		config.source.type === "har" || config.source.type === "partiful";
	if (!needs) {
		console.log(
			`(enrich) skipped — ${config.source.type} source ships descriptions inline`,
		);
		return;
	}
	stageHeader("scrape-partiful");
	await runPartifulEnrich({
		calendarPath: p.calendarJson,
		priorityPath: p.priorityMd,
		city: config.city,
	});
}

async function itinerary(): Promise<void> {
	stageHeader("tech-week-26");
	await runItinerary({
		city: config.city,
		title: config.title,
		calendarPath: p.calendarJson,
		geocodeCachePath: p.geocodedJson,
		responsePath: p.responseMd,
		htmlPath: p.itineraryHtml,
		dataPath: p.itineraryDataJs,
		minPriorityScore: config.filter?.minPriorityScore ?? DEFAULTS.minPriorityScore,
		avgSpeedKmh: config.itinerary?.avgSpeedKmh ?? DEFAULTS.avgSpeedKmh,
		futureOnly: config.itinerary?.futureOnly,
		greedyNonOverlap: config.itinerary?.greedyNonOverlap,
		noOpen: true,
	});
}

async function view(): Promise<void> {
	// Open the generated itinerary.html in the default browser.
	if (!existsSync(p.itineraryHtml)) {
		console.log(
			`(view) ${p.itineraryHtml} doesn't exist yet — run \`itinerary\` first.`,
		);
		return;
	}
	console.log(`Opening ${p.itineraryHtml} ...`);
	Bun.spawn({
		cmd: ["/bin/sh", "-c", `xdg-open "${p.itineraryHtml}"`],
		stdout: "inherit",
		stderr: "inherit",
	});
}

async function push(): Promise<void> {
	const gcalId = config.google?.calendarId;
	if (!gcalId) {
		console.log(`(push) skipped — config has no google.calendarId`);
		return;
	}
	stageHeader("push-to-google-calendar");
	await runGCalPush({
		calendarFile: p.calendarJson,
		gcalId,
		minPriorityScore:
			config.filter?.minPriorityScore ?? DEFAULTS.minPriorityScore,
		durationMin: config.google?.durationMin ?? DEFAULTS.gcalDurationMin,
		timezone: config.timezone ?? DEFAULTS.timezone,
		dryRun: extra.includes("--dry-run"),
		serviceAccountPath: extractFlag(extra, "--service-account"),
	});
}

/** Pull `--flag <value>` out of a string[] flat-arg list. */
function extractFlag(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	if (i === -1) return undefined;
	const v = args[i + 1];
	if (!v || v.startsWith("--")) return undefined;
	return v;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	switch (command) {
		case "pull":
			await pull();
			break;
		case "enrich":
			await enrich();
			break;
		case "itinerary":
			await itinerary();
			break;
		case "view":
			await view();
			break;
		case "push":
			await push();
			break;
		case "all":
			await pull();
			await enrich();
			await itinerary();
			await push();
			break;
		default:
			console.error(`Unknown command: ${command}`);
			printUsage();
			process.exit(1);
	}

	console.log(`\n✓ ${command} complete for ${config.slug}`);
	console.log(`  Output dir: ${p.outDir}`);
}

function printUsage(): void {
	console.log(`Usage:
  bun run tech-week/cli.ts <slug> <command> [extra args...]

Commands:
  pull       Extract events from the source into calendar.json
  enrich     Fetch event descriptions (only when needed)
  itinerary  Build response.md + itinerary.html + itinerary.data.js
  view       Open itinerary.html in the default browser
  push       Push to Google Calendar
  all        pull → enrich → itinerary → push

Examples:
  bun run tech-week/cli.ts luma-nyc all
  bun run tech-week/cli.ts tech-week-nyc-26 itinerary
  bun run tech-week/cli.ts luma-nyc push --dry-run

Discover configs:
  bun run tech-week/cli.ts --list
`);
}

function listConfigs(): void {
	let entries: string[] = [];
	try {
		entries = readdirSync(CONFIGS_DIR);
	} catch {
		console.log(`(no configs dir at ${CONFIGS_DIR})`);
		return;
	}
	const slugs = entries
		.filter((e) => e.endsWith(".json"))
		.map((e) => e.replace(/\.json$/, ""));
	if (slugs.length === 0) {
		console.log(`(no configs in ${CONFIGS_DIR})`);
		return;
	}
	console.log(`Configs in ${CONFIGS_DIR}:`);
	for (const slug of slugs) {
		try {
			const c: TechWeekConfig = loadConfig(slug);
			console.log(
				`  ${slug.padEnd(28)}  city=${c.city.padEnd(12)}  source=${c.source.type}`,
			);
		} catch (err) {
			console.log(
				`  ${slug.padEnd(28)}  (invalid: ${(err as Error).message})`,
			);
		}
	}
}

main().catch((err) => {
	console.error(`\n✗ ${err.message}`);
	process.exit(1);
});
