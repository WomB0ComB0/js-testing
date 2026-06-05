/**
 * Standard config schema for the tech-week pipeline. One JSON file per
 * "calendar" (a city/source combo) captures everything the previous flag
 * soup encoded — source location, filters, itinerary tunables, and the
 * Google Calendar target — so the user-facing CLI is just
 *
 *   bun run tech-week/cli.ts <slug> <command>
 *
 * Output paths follow a convention (tech-week/out/<slug>/...) so the
 * pipeline never asks the user to wire flags between stages.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type SourceConfig =
	| { type: "har"; file: string }
	| { type: "ics"; url?: string; file?: string }
	| { type: "luma"; cards: string }
	| { type: "luma-discover"; discoverSlug: string }
	| { type: "partiful"; calendar: string }
	| { type: "partiful-explore"; region: "NYC" | "LA" | "SF" }
	| {
			/**
			 * Combine other configs' pulled calendars into one. Used for
			 * conflict-spotting across sources. Each child must be a config
			 * slug discoverable in `configs/`. Children are auto-pulled if
			 * their calendar.json doesn't exist yet.
			 */
			type: "merge";
			sources: string[];
	  };

export interface TechWeekConfig {
	/** Kebab-case identifier; drives output directory and event IDs. */
	slug: string;
	/** Human display name used in titles ("NYC", "Boston", "Luma NYC"). */
	city: string;
	/**
	 * Optional page title override. When set, used verbatim in the
	 * itinerary HTML <title>, sidebar <h1>, and AI prompt header. When
	 * unset, falls back to "{city} Tech Week 2026".
	 */
	title?: string;
	/** IANA zone. Defaults to America/New_York. */
	timezone?: string;
	/** Where the events come from. */
	source: SourceConfig;
	filter?: {
		/** Min keyword-match score required to keep an event. Default: 1 */
		minPriorityScore?: number;
		/** ISO date "YYYY-MM-DD" — drop events ending before this. */
		since?: string;
		/** ISO date "YYYY-MM-DD" — drop events starting after this. */
		until?: string;
	};
	itinerary?: {
		/** Avg urban speed for travel-time estimation, km/h. Default: 18 */
		avgSpeedKmh?: number;
		/** Per-event slot duration in minutes. Default: 120 */
		durationMin?: number;
		/** Cap on candidate pool before non-overlap selection. Default: 100 */
		maxCandidates?: number;
		/**
		 * Drop events whose start is in the past. Default: true.
		 * Set false to keep historical events (e.g. archival itinerary).
		 */
		futureOnly?: boolean;
		/**
		 * Collapse candidates to a non-overlapping travel-aware schedule.
		 * Default: false — show ALL above-score candidates so the user can
		 * see conflicts and pick what to RSVP to.
		 */
		greedyNonOverlap?: boolean;
	};
	google?: {
		/** Target calendar id (e.g. abc@group.calendar.google.com). */
		calendarId?: string;
		/** Per-event GCal duration in minutes. Default: 120 */
		durationMin?: number;
	};
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const TECH_WEEK_ROOT = resolve(import.meta.dir, "..");
export const CONFIGS_DIR = join(TECH_WEEK_ROOT, "configs");
export const OUT_ROOT = join(TECH_WEEK_ROOT, "out");

/**
 * Resolve a config reference — either a bare slug ("luma-nyc"), an explicit
 * path to a JSON file, or a slug that lives in configs/<slug>.json.
 */
function resolveConfigPath(slugOrPath: string): string {
	if (slugOrPath.endsWith(".json")) {
		return isAbsolute(slugOrPath) ? slugOrPath : resolve(slugOrPath);
	}
	return join(CONFIGS_DIR, `${slugOrPath}.json`);
}

export function loadConfig(slugOrPath: string): TechWeekConfig {
	const path = resolveConfigPath(slugOrPath);
	if (!existsSync(path)) {
		throw new Error(
			`Config not found: ${path}\n  (looked up "${slugOrPath}" in ${CONFIGS_DIR})`,
		);
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as TechWeekConfig;
	if (!raw.slug) throw new Error(`Config ${path} missing "slug"`);
	if (!raw.city) throw new Error(`Config ${path} missing "city"`);
	if (!raw.source?.type) throw new Error(`Config ${path} missing "source.type"`);
	return raw;
}

// ---------------------------------------------------------------------------
// Output path conventions — every output for a given slug lives under
// tech-week/out/<slug>/. Single source of truth so scripts and CLI agree.
// ---------------------------------------------------------------------------

export interface ConfigPaths {
	outDir: string;
	calendarJson: string;
	geocodedJson: string;
	itineraryHtml: string;
	itineraryDataJs: string;
	responseMd: string;
	priorityMd: string;
}

export function paths(config: TechWeekConfig): ConfigPaths {
	const outDir = join(OUT_ROOT, config.slug);
	return {
		outDir,
		calendarJson: join(outDir, "calendar.json"),
		geocodedJson: join(outDir, "geocoded.json"),
		itineraryHtml: join(outDir, "itinerary.html"),
		itineraryDataJs: join(outDir, "itinerary.data.js"),
		responseMd: join(outDir, "response.md"),
		priorityMd: join(outDir, "priority.md"),
	};
}

/**
 * Resolve a file path that's part of a source config (e.g.
 * source.har, source.cards) — accept absolute paths as-is, otherwise
 * resolve relative to the config file or the tech-week root.
 */
export function resolveSourcePath(p: string, base?: string): string {
	if (isAbsolute(p)) return p;
	if (base) return resolve(dirname(base), p);
	return resolve(TECH_WEEK_ROOT, p);
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULTS = {
	timezone: "America/New_York",
	minPriorityScore: 1,
	avgSpeedKmh: 18,
	durationMin: 120,
	maxCandidates: 100,
	gcalDurationMin: 120,
} as const;
