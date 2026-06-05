/**
 * Pushes events from a tech-week calendar.json (the envelope produced by
 * extract-calendar-from-{har,ics}.ts or scrape-{partiful,luma}.ts) into a
 * Google Calendar so they show up on phone/desktop with reminders.
 *
 * One-time setup
 * --------------
 * 1. Enable Google Calendar API in a GCP project.
 * 2. Create a service account, download its JSON key.
 * 3. Create a dedicated Google Calendar (calendar.google.com → Settings
 *    → Add calendar → Create new calendar; e.g. "Tech Week NYC 2026").
 * 4. Share that calendar with the service account's email
 *    (`<sa-name>@<project>.iam.gserviceaccount.com`) with
 *    "Make changes to events" permission.
 * 5. Copy the calendar ID from Settings → Integrate calendar.
 * 6. Set GOOGLE_SERVICE_ACCOUNT_JSON in .env (one-line stringified JSON)
 *    OR pass --service-account <path-to-json>.
 *
 * Usage
 * -----
 *   bun run push-to-google-calendar.ts \
 *     --calendar tech-week-luma-nyc-calendar.json \
 *     --gcal-id <calendar-id-from-step-5> \
 *     --min-priority-score 1 \
 *     --duration-min 120 \
 *     --timezone America/New_York
 *
 *   --dry-run         : print what would be pushed without calling the API
 *   --service-account : path to service-account JSON (overrides env)
 *
 * Idempotency
 * -----------
 * Each pushed event uses a deterministic Google Calendar event id derived
 * from the tech-week id (`tw<base32>`). Re-running updates existing events
 * via events.patch instead of creating duplicates.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import dotenv from "dotenv";
import { google } from "googleapis";
import { getArg, hasFlag } from "./lib/cli.js";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = join(SCRIPT_DIR, "..");
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunOptions {
	calendarFile: string;
	gcalId: string;
	timezone?: string;
	durationMin?: number;
	minPriorityScore?: number;
	dryRun?: boolean;
	serviceAccountPath?: string;
}

export interface RunResult {
	inserted: number;
	updated: number;
	failed: number;
	skipped: number;
}

// ---------------------------------------------------------------------------
// Calendar event shape (loose — passthrough fields preserved from extractors)
// ---------------------------------------------------------------------------

interface CalendarEvent {
	id: number;
	name: string;
	date: string;
	time: string;
	location?: string | null;
	city?: string;
	description?: string | null;
	externalHref?: string | null;
	priorityScore?: number;
	priorityMatches?: string[];
	facets?: {
		hosts?: Array<{ label: string }>;
	};
}

interface CalendarFile {
	events: CalendarEvent[];
	source?: string;
}

// ---------------------------------------------------------------------------
// Service-account credential loading
// ---------------------------------------------------------------------------

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	project_id?: string;
}

function loadServiceAccount(serviceAccountPath?: string): ServiceAccountKey {
	if (serviceAccountPath) {
		const raw = readFileSync(resolve(serviceAccountPath), "utf8");
		return JSON.parse(raw) as ServiceAccountKey;
	}
	const env = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
	if (!env) {
		throw new Error(
			"No service account credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON in .env or pass --service-account <path>.",
		);
	}
	return JSON.parse(env) as ServiceAccountKey;
}

// ---------------------------------------------------------------------------
// Stable GCal event id from tech-week numeric id. Google requires base32hex
// (chars 0-9 a-v), length 5-1024. Prefix keeps it human-readable for debug.
// ---------------------------------------------------------------------------

function gcalEventId(techWeekId: number): string {
	const base = techWeekId.toString(32); // 0-9, a-v ⊂ base32hex alphabet
	return `tw${base}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// ISO datetime helpers — combine YYYY-MM-DD + HH:MM:SS with no offset; rely
// on the per-event `timeZone` field to fix interpretation Google-side.
// ---------------------------------------------------------------------------

function toIsoLocal(date: string, time: string): string {
	return `${date}T${time}`;
}

function addMinutesIso(date: string, time: string, minutes: number): string {
	// Parse as UTC purely to do clock math; we'll send timeZone alongside
	// so Google interprets the result as local in TIMEZONE.
	const d = new Date(`${date}T${time}Z`);
	d.setUTCMinutes(d.getUTCMinutes() + minutes);
	return d.toISOString().slice(0, 19);
}

// ---------------------------------------------------------------------------
// Build the Google Calendar event payload from a CalendarEvent
// ---------------------------------------------------------------------------

function buildGCalEvent(
	ev: CalendarEvent,
	timezone: string,
	durationMin: number,
): {
	id: string;
	summary: string;
	description: string;
	location?: string;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	source?: { url: string; title: string };
	extendedProperties: { private: Record<string, string> };
} {
	const hosts = ev.facets?.hosts?.map((h) => h.label).join(", ") ?? "";
	const matches = ev.priorityMatches?.join(", ") ?? "";
	const lines = [
		ev.description?.trim() ?? "",
		"",
		hosts ? `Hosts: ${hosts}` : "",
		ev.priorityScore != null ? `Priority score: ${ev.priorityScore}` : "",
		matches ? `Matched: ${matches}` : "",
		ev.externalHref ? `Source: ${ev.externalHref}` : "",
	].filter(Boolean);

	return {
		id: gcalEventId(ev.id),
		summary: ev.name,
		description: lines.join("\n"),
		location: ev.location ?? undefined,
		start: { dateTime: toIsoLocal(ev.date, ev.time), timeZone: timezone },
		end: {
			dateTime: addMinutesIso(ev.date, ev.time, durationMin),
			timeZone: timezone,
		},
		source: ev.externalHref
			? { url: ev.externalHref, title: "Open registration" }
			: undefined,
		extendedProperties: {
			private: {
				techWeekId: String(ev.id),
				priorityScore: String(ev.priorityScore ?? 0),
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(options: RunOptions): Promise<RunResult> {
	const timezone = options.timezone ?? "America/New_York";
	const durationMin = options.durationMin ?? 120;
	const minScore = options.minPriorityScore ?? 0;
	const dryRun = options.dryRun ?? false;

	const raw = readFileSync(resolve(options.calendarFile), "utf8");
	const parsed = JSON.parse(raw) as CalendarFile;
	const all = parsed.events;
	const eligible = all.filter((e) => (e.priorityScore ?? 0) >= minScore);

	console.log(
		`Loaded ${all.length} events from ${options.calendarFile}; ` +
			`${eligible.length} pass min-priority-score=${minScore}`,
	);

	if (dryRun) {
		console.log("--dry-run — would push:");
		for (const e of eligible) {
			console.log(
				`  ${e.date} ${e.time}  score=${e.priorityScore ?? 0}  ${e.name}  (gcal id ${gcalEventId(e.id)})`,
			);
		}
		return {
			inserted: 0,
			updated: 0,
			failed: 0,
			skipped: all.length - eligible.length,
		};
	}

	const credentials = loadServiceAccount(options.serviceAccountPath);
	const auth = new google.auth.JWT({
		email: credentials.client_email,
		key: credentials.private_key,
		scopes: ["https://www.googleapis.com/auth/calendar"],
	});
	const calendar = google.calendar({ version: "v3", auth });

	let inserted = 0;
	let updated = 0;
	let failed = 0;

	for (const ev of eligible) {
		const payload = buildGCalEvent(ev, timezone, durationMin);
		try {
			await calendar.events.insert({
				calendarId: options.gcalId,
				requestBody: payload,
			});
			inserted += 1;
		} catch (error) {
			// 409 = id already exists → patch instead.
			const status = (error as { code?: number }).code;
			if (status === 409) {
				try {
					await calendar.events.patch({
						calendarId: options.gcalId,
						eventId: payload.id,
						requestBody: payload,
					});
					updated += 1;
				} catch (patchErr) {
					failed += 1;
					console.warn(
						`  patch failed for ${payload.id} (${ev.name}):`,
						(patchErr as Error).message,
					);
				}
			} else {
				failed += 1;
				console.warn(
					`  insert failed for ${payload.id} (${ev.name}):`,
					(error as Error).message,
				);
			}
		}
		const done = inserted + updated + failed;
		if (done % 10 === 0 || done === eligible.length) {
			console.log(
				`  progress: ${done}/${eligible.length} (inserted=${inserted} updated=${updated} failed=${failed})`,
			);
		}
	}

	const skipped = all.length - eligible.length;
	console.log(
		`\nDone. inserted=${inserted} updated=${updated} failed=${failed} skipped=${skipped}`,
	);
	return { inserted, updated, failed, skipped };
}

if (import.meta.main) {
	const calendarFile = getArg("--calendar");
	const gcalId = getArg("--gcal-id") ?? process.env.GOOGLE_CALENDAR_ID;
	if (!calendarFile) {
		console.error(
			"Usage: push-to-google-calendar.ts --calendar <file.json> --gcal-id <id> [--min-priority-score N] [--duration-min N] [--timezone TZ] [--dry-run] [--service-account <path>]",
		);
		process.exit(1);
	}
	if (!gcalId) {
		console.error(
			"Missing --gcal-id (or GOOGLE_CALENDAR_ID in env). See script header for setup steps.",
		);
		process.exit(1);
	}
	run({
		calendarFile,
		gcalId,
		timezone: getArg("--timezone") ?? undefined,
		durationMin: getArg("--duration-min") ? Number(getArg("--duration-min")) : undefined,
		minPriorityScore: getArg("--min-priority-score")
			? Number(getArg("--min-priority-score"))
			: undefined,
		dryRun: hasFlag("--dry-run"),
		serviceAccountPath: getArg("--service-account"),
	}).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
