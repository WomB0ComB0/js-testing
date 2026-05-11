/**
 * Copyright (c) 2025 Mike Odnis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { join } from "node:path";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import dotenv from "dotenv";
import { z } from "zod";
import { type Coordinates2D, Distance } from "./distance-formulas.js";
import { GoogleMapsService } from "./map.js";

// Resolve paths relative to this script so the file works from any CWD.
// .env lives at the project root (one level up from this folder).
const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = join(SCRIPT_DIR, "..");

dotenv.config({ path: join(PROJECT_ROOT, ".env") });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SOURCE_FILE = join(SCRIPT_DIR, "tech-week-calendar.json");
const GEOCODE_CACHE_FILE = join(SCRIPT_DIR, "tech-week-geocoded.json");
const RESPONSE_FILE = join(SCRIPT_DIR, "response.md");
const ITINERARY_HTML_FILE = join(SCRIPT_DIR, "itinerary.html");
const ITINERARY_DATA_FILE = join(SCRIPT_DIR, "itinerary.data.js");

const MAX_CANDIDATES = 100;
const EVENT_DURATION_MIN = 120;
const NYC_AVG_SPEED_KMH = 18;
const NYC_TIMEZONE_OFFSET = "-04:00";

// Drop any event whose priorityScore is below this. Set to 0 to disable
// (i.e., consider every event regardless of how well its description matches
// the keyword list in scrape-partiful.ts). Raise to tighten the candidate
// pool; lower to widen.
const MIN_PRIORITY_SCORE = 3;

// ---------------------------------------------------------------------------
// Schema (matches tech-week-calendar.json built from www.tech-week.com.har)
// ---------------------------------------------------------------------------

const FacetHostSchema = z.object({
	key: z.string(),
	label: z.string(),
	role: z.string(),
});

const CalendarEventSchema = z.object({
	id: z.number(),
	city: z.string(),
	date: z.string(),
	time: z.string(),
	location: z.string().nullable(),
	name: z.string(),
	company: z.string().nullable(),
	externalHref: z.string().nullable(),
	isInviteOnly: z.boolean(),
	facets: z
		.object({
			time: z.object({ label: z.string() }).optional(),
			locations: z.array(z.object({ label: z.string() })).optional(),
			hosts: z.array(FacetHostSchema).optional(),
		})
		.default({}),
	// Added by scrape-partiful.ts. All optional so this script still works
	// against an unenriched calendar file (the priority filter will simply
	// pass everything through).
	description: z.string().nullable().optional(),
	priorityScore: z.number().optional(),
	priorityMatches: z.array(z.string()).optional(),
});

const CalendarFileSchema = z.object({
	source: z.string().optional(),
	uniqueEventCount: z.number().optional(),
	priorityKeywords: z.array(z.string()).optional(),
	events: z.array(CalendarEventSchema),
});

type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function eventStartMs(event: CalendarEvent): number {
	return new Date(
		`${event.date}T${event.time}${NYC_TIMEZONE_OFFSET}`,
	).getTime();
}

function formatTimeOfDay(time: string): string {
	const [h, m] = time.split(":");
	const hour = Number(h);
	const suffix = hour >= 12 ? "PM" : "AM";
	const hour12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${hour12}:${m} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Geocoding (cached to disk to avoid hammering Maps API across runs)
// ---------------------------------------------------------------------------

type GeocodeCache = Record<string, Coordinates2D | null>;

async function loadGeocodeCache(): Promise<GeocodeCache> {
	try {
		const data = await Bun.file(GEOCODE_CACHE_FILE).json();
		return data ?? {};
	} catch {
		return {};
	}
}

async function saveGeocodeCache(cache: GeocodeCache): Promise<void> {
	await Bun.write(GEOCODE_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function geocodeLocations(
	events: CalendarEvent[],
	mapsService: GoogleMapsService,
): Promise<Map<string, Coordinates2D>> {
	const cache = await loadGeocodeCache();
	const unique = new Set<string>();
	for (const event of events) {
		if (event.location) unique.add(event.location);
	}

	let added = 0;
	for (const location of unique) {
		if (location in cache) continue;
		try {
			const result = await mapsService.geocodeAddress(
				`${location}, New York City, NY`,
			);
			cache[location] = result
				? {
						lat: result.geometry.location.lat,
						lng: result.geometry.location.lng,
					}
				: null;
			added += 1;
		} catch (error) {
			console.error(`Geocoding failed for "${location}":`, error);
			cache[location] = null;
		}
	}

	if (added > 0) {
		await saveGeocodeCache(cache);
		console.log(`Geocoded ${added} new location(s); cache size: ${unique.size}`);
	}

	const resolved = new Map<string, Coordinates2D>();
	for (const [name, coords] of Object.entries(cache)) {
		if (coords) resolved.set(name, coords);
	}
	return resolved;
}

// ---------------------------------------------------------------------------
// Scheduling (travel-time-aware greedy)
// ---------------------------------------------------------------------------

function estimatedTravelMinutes(a: Coordinates2D, b: Coordinates2D): number {
	const km = Distance.haversine(a, b);
	return (km / NYC_AVG_SPEED_KMH) * 60;
}

function findNonOverlappingEvents(
	events: CalendarEvent[],
	coords: Map<string, Coordinates2D>,
): CalendarEvent[] {
	const sorted = [...events].sort(
		(a, b) => eventStartMs(a) - eventStartMs(b),
	);

	const selected: CalendarEvent[] = [];
	for (const event of sorted) {
		if (selected.length === 0) {
			selected.push(event);
			continue;
		}

		const prev = selected[selected.length - 1];
		const prevEndMs = eventStartMs(prev) + EVENT_DURATION_MIN * 60_000;

		let travelMs = 0;
		const prevCoords = prev.location ? coords.get(prev.location) : undefined;
		const nextCoords = event.location ? coords.get(event.location) : undefined;
		if (prevCoords && nextCoords) {
			travelMs = estimatedTravelMinutes(prevCoords, nextCoords) * 60_000;
		}

		if (eventStartMs(event) >= prevEndMs + travelMs) {
			selected.push(event);
		}
	}

	return selected;
}

// ---------------------------------------------------------------------------
// Route info + itinerary map
// ---------------------------------------------------------------------------

function eventQueryAddress(event: CalendarEvent): string {
	const place = event.location ?? "";
	return place ? `${place}, ${event.city}` : event.city;
}

async function buildRouteInfo(
	events: CalendarEvent[],
	mapsService: GoogleMapsService,
): Promise<string> {
	let out = "## Optimal Route Information\n\n";

	for (let i = 0; i < events.length - 1; i += 1) {
		const origin = eventQueryAddress(events[i]);
		const destination = eventQueryAddress(events[i + 1]);

		try {
			const result = await mapsService.getDirections(origin, destination);
			const leg = result?.routes[0]?.legs[0];
			if (leg) {
				out += `- **${events[i].name}** → **${events[i + 1].name}**\n`;
				out += `  - Distance: ${leg.distance?.text ?? "?"}\n`;
				out += `  - Duration: ${leg.duration?.text ?? "?"}\n`;
				out += `  - Route: ${result?.routes[0]?.summary ?? "?"}\n\n`;
			}
		} catch (error) {
			console.error(`Directions failed (${origin} → ${destination}):`, error);
		}
	}

	return out;
}

function buildItineraryMapUrl(
	events: CalendarEvent[],
	coords: Map<string, Coordinates2D>,
	mapsService: GoogleMapsService,
): string | null {
	const markers = events
		.map((event, index) => {
			const c = event.location ? coords.get(event.location) : undefined;
			if (!c) return null;
			return {
				location: c,
				color: "blue",
				label: String.fromCharCode(65 + (index % 26)),
			} as const;
		})
		.filter((m): m is NonNullable<typeof m> => m !== null);

	if (markers.length === 0) return null;

	return mapsService.getStaticMapUrl({
		size: "800x600",
		maptype: "roadmap",
		markers: [...markers],
	});
}

// ---------------------------------------------------------------------------
// Interactive routing — per-day Google Maps deeplinks + standalone HTML
// ---------------------------------------------------------------------------

interface DayDeeplink {
	date: string;
	count: number;
	url: string;
}

function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
	const out = new Map<string, CalendarEvent[]>();
	for (const event of events) {
		const day = out.get(event.date) ?? [];
		day.push(event);
		out.set(event.date, day);
	}
	for (const day of out.values()) {
		day.sort((a, b) => a.time.localeCompare(b.time));
	}
	return out;
}

/**
 * Build one Google Maps deeplink per day that opens the native Google Maps app
 * (or web UI) with the day's events as origin/waypoints/destination — a fully
 * interactive, turn-by-turn route. Up to 9 waypoints supported by Google Maps.
 */
function buildDayDeeplinks(events: CalendarEvent[]): DayDeeplink[] {
	const byDay = groupByDay(events);
	const links: DayDeeplink[] = [];

	for (const [date, dayEvents] of [...byDay.entries()].sort()) {
		if (dayEvents.length === 0) continue;

		const toAddress = (e: CalendarEvent): string =>
			`${e.location ?? ""}, ${e.city}`.replace(/^,\s*/, "");

		const params = new URLSearchParams();
		params.set("api", "1");

		if (dayEvents.length === 1) {
			params.set("destination", toAddress(dayEvents[0]));
		} else {
			params.set("origin", toAddress(dayEvents[0]));
			params.set("destination", toAddress(dayEvents[dayEvents.length - 1]));
			const waypoints = dayEvents.slice(1, -1).map(toAddress);
			if (waypoints.length > 0) {
				params.set("waypoints", waypoints.join("|"));
			}
		}
		params.set("travelmode", "transit");

		links.push({
			date,
			count: dayEvents.length,
			url: `https://www.google.com/maps/dir/?${params.toString()}`,
		});
	}

	return links;
}

interface ItineraryEvent {
	label: string;
	id: number;
	name: string;
	date: string;
	time: string;
	location: string | null;
	city: string;
	hosts: string;
	priorityScore: number;
	priorityMatches: string[];
	description: string;
	url: string;
	lat: number | null;
	lng: number | null;
}

function toItineraryEvent(
	event: CalendarEvent,
	index: number,
	coords: Map<string, Coordinates2D>,
): ItineraryEvent {
	const c = event.location ? coords.get(event.location) : undefined;
	return {
		label: String.fromCharCode(65 + (index % 26)),
		id: event.id,
		name: event.name,
		date: event.date,
		time: event.time,
		location: event.location,
		city: event.city,
		hosts:
			event.facets.hosts?.map((h) => h.label).join(", ") ??
			event.company ??
			"",
		priorityScore: event.priorityScore ?? 0,
		priorityMatches: event.priorityMatches ?? [],
		description: event.description ?? "",
		url: event.externalHref ?? "",
		lat: c?.lat ?? null,
		lng: c?.lng ?? null,
	};
}

/**
 * Build a standalone HTML page with an interactive Google Maps view:
 *   - All event markers labeled A, B, C…
 *   - One DirectionsRenderer per day (transit mode) tracing the route
 *   - Day filter buttons + event sidebar with click-to-pan
 *   - Each event shows priority matches, hosts, description, registration link
 * The HTML loads the Maps JavaScript API client-side, so the map is fully
 * interactive — pan, zoom, click markers, get turn-by-turn directions.
 */
/**
 * Builds the per-itinerary data file as plain JS that sets
 * `window.ITINERARY_DATA = { apiKey, events: [...] }`.
 *
 * Plain JS (not JSON) so the HTML can load it via `<script src>` on `file://`
 * — most browsers block `fetch()` of local JSON files for security.
 */
function buildItineraryDataJs(
	events: CalendarEvent[],
	coords: Map<string, Coordinates2D>,
	apiKey: string,
): string {
	const itinerary = events.map((event, i) =>
		toItineraryEvent(event, i, coords),
	);
	const payload = { apiKey, events: itinerary };
	const json = JSON.stringify(payload, null, 2).replace(/</g, "\\u003c");
	return `// Auto-generated by tech-week-26.ts. Replace this file with your own
// itinerary to reuse itinerary.html for a different set of events.
window.ITINERARY_DATA = ${json};
`;
}

/**
 * Builds a static HTML template (no embedded events, no embedded API key)
 * that loads its data from a sibling \`itinerary.data.js\`. This means the
 * HTML can be shared as-is and reused for any itinerary by swapping the
 * data file — no code changes required.
 */
function buildItineraryHtml(): string {
	const escapeAttr = (s: string): string =>
		s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
	const title = escapeAttr("Itinerary");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg: #0f1115;
    --panel: #1a1d24;
    --line: #262b34;
    --text: #e7ebf0;
    --muted: #98a1b0;
    --accent: #4a9eff;
    --pill: #2a3140;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; color: var(--text); background: var(--bg); }
  #app { display: grid; grid-template-columns: 380px 1fr; height: 100vh; }
  #sidebar { background: var(--panel); border-right: 1px solid var(--line); overflow-y: auto; }
  #sidebar header { padding: 16px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--panel); }
  #sidebar h1 { margin: 0; font-size: 18px; font-weight: 600; }
  #sidebar .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  #days { display: flex; gap: 6px; padding: 12px 20px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
  #days button { background: var(--pill); color: var(--text); border: 1px solid transparent; border-radius: 999px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
  #days button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .event { padding: 14px 20px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .event:hover { background: #232831; }
  .event .row1 { display: flex; gap: 10px; align-items: baseline; }
  .event .label { background: var(--accent); color: #fff; font-weight: 700; width: 24px; height: 24px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
  .event .name { font-weight: 600; line-height: 1.3; }
  .event .meta { color: var(--muted); font-size: 12px; margin-top: 6px; }
  .event .matches { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
  .event .matches span { background: var(--pill); color: var(--muted); padding: 2px 8px; border-radius: 999px; font-size: 11px; }
  .event .desc { color: var(--muted); font-size: 12px; margin-top: 8px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .event a { color: var(--accent); font-size: 12px; text-decoration: none; }
  .event a:hover { text-decoration: underline; }
  #map { width: 100%; height: 100vh; }
  .gm-iw { color: #111; }
  @media (max-width: 800px) {
    #app { grid-template-columns: 1fr; grid-template-rows: 1fr 50vh; }
    #map { height: 100%; }
  }
</style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <header>
      <h1>NYC Tech Week 2026</h1>
      <div class="sub" id="summary"></div>
    </header>
    <div id="days"></div>
    <div id="list"></div>
  </aside>
  <div id="map"></div>
</div>
<script src="itinerary.data.js"></script>
<script>
if (!window.ITINERARY_DATA) {
  document.body.innerHTML =
    '<div style="padding:2em;font-family:system-ui;color:#e7ebf0;background:#0f1115;height:100vh">' +
    '<h1>Missing data file</h1>' +
    '<p>This page expects a sibling <code>itinerary.data.js</code> that sets ' +
    '<code>window.ITINERARY_DATA = { apiKey, events }</code>.</p>' +
    '<p>Generate one with <code>bun tech-week-26.ts</code>, or write your own.</p>' +
    '</div>';
  throw new Error("itinerary.data.js not loaded");
}
const EVENTS = window.ITINERARY_DATA.events;
const API_KEY = window.ITINERARY_DATA.apiKey;

const DAY_LABELS = {
  "2026-06-01": "Mon 6/1",
  "2026-06-02": "Tue 6/2",
  "2026-06-03": "Wed 6/3",
  "2026-06-04": "Thu 6/4",
  "2026-06-05": "Fri 6/5",
  "2026-06-06": "Sat 6/6",
  "2026-06-07": "Sun 6/7",
};
const DAY_COLORS = ["#4a9eff", "#ff6b9d", "#52d4a3", "#f5c842", "#b48aff", "#ff8a4a", "#7adaff"];

const state = {
  activeDay: "all",
  map: null,
  markers: [],
  renderers: [],
  infoWindow: null,
};

function uniqueDays() {
  return [...new Set(EVENTS.map(e => e.date))].sort();
}

function formatTime(t) {
  const [h, m] = t.split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return hour12 + ":" + m + " " + suffix;
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderSidebar() {
  document.getElementById("summary").textContent =
    EVENTS.length + " events across " + uniqueDays().length + " days";

  const dayBar = document.getElementById("days");
  dayBar.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.textContent = "All";
  allBtn.dataset.day = "all";
  if (state.activeDay === "all") allBtn.classList.add("active");
  allBtn.onclick = () => setDay("all");
  dayBar.appendChild(allBtn);
  for (const day of uniqueDays()) {
    const b = document.createElement("button");
    b.textContent = DAY_LABELS[day] ?? day;
    b.dataset.day = day;
    if (state.activeDay === day) b.classList.add("active");
    b.onclick = () => setDay(day);
    dayBar.appendChild(b);
  }

  const list = document.getElementById("list");
  list.innerHTML = "";
  const visible = EVENTS.filter(e => state.activeDay === "all" || e.date === state.activeDay);
  for (const e of visible) {
    const div = document.createElement("div");
    div.className = "event";
    div.onclick = () => focusEvent(e);
    const matches = (e.priorityMatches || []).map(m => '<span>' + htmlEscape(m) + '</span>').join("");
    div.innerHTML =
      '<div class="row1"><div class="label">' + htmlEscape(e.label) + '</div>' +
      '<div><div class="name">' + htmlEscape(e.name) + '</div>' +
      '<div class="meta">' + htmlEscape(DAY_LABELS[e.date] ?? e.date) + ' · ' + htmlEscape(formatTime(e.time)) +
      ' · ' + htmlEscape(e.location ?? "?") + ' · score ' + e.priorityScore + '</div></div></div>' +
      (matches ? '<div class="matches">' + matches + '</div>' : '') +
      (e.description ? '<div class="desc">' + htmlEscape(e.description) + '</div>' : '') +
      (e.url ? '<div style="margin-top:8px"><a href="' + htmlEscape(e.url) + '" target="_blank" rel="noopener">Open registration →</a></div>' : '');
    list.appendChild(div);
  }
}

function setDay(day) {
  state.activeDay = day;
  for (const btn of document.querySelectorAll("#days button")) {
    btn.classList.toggle("active", btn.dataset.day === day);
  }
  renderSidebar();
  renderRoutes();
}

function focusEvent(e) {
  if (e.lat == null || e.lng == null) return;
  state.map.panTo({ lat: e.lat, lng: e.lng });
  state.map.setZoom(15);
  const marker = state.markers.find(m => m.eventId === e.id);
  if (marker) {
    state.infoWindow.setContent(infoHtml(e));
    state.infoWindow.open(state.map, marker);
  }
}

function infoHtml(e) {
  return '<div class="gm-iw" style="max-width:260px"><strong>' + htmlEscape(e.name) + '</strong><br>' +
    htmlEscape(DAY_LABELS[e.date] ?? e.date) + ' · ' + htmlEscape(formatTime(e.time)) + '<br>' +
    htmlEscape(e.location ?? "") + ', ' + htmlEscape(e.city) +
    (e.hosts ? '<br><em>' + htmlEscape(e.hosts) + '</em>' : '') +
    (e.description ? '<p style="margin:8px 0 0;font-size:12px">' + htmlEscape(e.description.slice(0, 240)) + (e.description.length > 240 ? '…' : '') + '</p>' : '') +
    (e.url ? '<p style="margin:8px 0 0"><a href="' + htmlEscape(e.url) + '" target="_blank" rel="noopener">Open registration →</a></p>' : '') +
    '</div>';
}

function placeMarkers() {
  state.markers.forEach(m => m.setMap(null));
  state.markers = [];
  const visible = EVENTS.filter(e => state.activeDay === "all" || e.date === state.activeDay);
  const bounds = new google.maps.LatLngBounds();
  for (const e of visible) {
    if (e.lat == null || e.lng == null) continue;
    const marker = new google.maps.Marker({
      position: { lat: e.lat, lng: e.lng },
      map: state.map,
      label: { text: e.label, color: "#fff", fontWeight: "700" },
      title: e.name,
    });
    marker.eventId = e.id;
    marker.addListener("click", () => {
      state.infoWindow.setContent(infoHtml(e));
      state.infoWindow.open(state.map, marker);
    });
    state.markers.push(marker);
    bounds.extend(marker.getPosition());
  }
  if (!bounds.isEmpty()) state.map.fitBounds(bounds);
}

function renderRoutes() {
  state.renderers.forEach(r => r.setMap(null));
  state.renderers = [];

  const days = state.activeDay === "all" ? uniqueDays() : [state.activeDay];
  const service = new google.maps.DirectionsService();

  days.forEach((day, idx) => {
    const dayEvents = EVENTS
      .filter(e => e.date === day && e.lat != null && e.lng != null)
      .sort((a, b) => a.time.localeCompare(b.time));
    if (dayEvents.length < 2) return;

    const origin = { lat: dayEvents[0].lat, lng: dayEvents[0].lng };
    const destination = {
      lat: dayEvents[dayEvents.length - 1].lat,
      lng: dayEvents[dayEvents.length - 1].lng,
    };
    const waypoints = dayEvents.slice(1, -1).map(e => ({
      location: new google.maps.LatLng(e.lat, e.lng),
      stopover: true,
    }));

    service.route(
      {
        origin,
        destination,
        waypoints,
        travelMode: google.maps.TravelMode.TRANSIT,
      },
      (result, status) => {
        if (status !== "OK") {
          service.route(
            { origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING },
            (r2, s2) => {
              if (s2 === "OK") drawRoute(r2, idx);
            }
          );
          return;
        }
        drawRoute(result, idx);
      }
    );
  });

  placeMarkers();
}

function drawRoute(result, idx) {
  const renderer = new google.maps.DirectionsRenderer({
    map: state.map,
    directions: result,
    suppressMarkers: true,
    polylineOptions: {
      strokeColor: DAY_COLORS[idx % DAY_COLORS.length],
      strokeOpacity: 0.85,
      strokeWeight: 4,
    },
  });
  state.renderers.push(renderer);
}

function initMap() {
  state.map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 40.7549, lng: -73.984 },
    zoom: 12,
    styles: [
      { elementType: "geometry", stylers: [{ color: "#1d2630" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#9aa4b2" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#1d2630" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a3340" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c1117" }] },
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    ],
  });
  state.infoWindow = new google.maps.InfoWindow();
  renderSidebar();
  renderRoutes();
}

window.initMap = initMap;

const s = document.createElement("script");
s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(API_KEY) + "&callback=initMap";
s.async = true;
document.head.appendChild(s);
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
	try {
		const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
		if (!apiKey) {
			console.warn(
				"GOOGLE_MAPS_API_KEY not set — running without geocoding, routes, or map URLs.",
			);
		}
		const mapsService = new GoogleMapsService(apiKey || "no-op");

		const raw = await Bun.file(SOURCE_FILE)
			.json()
			.catch((error: unknown) => {
				console.error(`Failed to read ${SOURCE_FILE}:`, error);
				return null;
			});
		if (!raw) return;

		const parseResult = CalendarFileSchema.safeParse(raw);
		if (!parseResult.success) {
			console.error("Schema mismatch in calendar JSON:", parseResult.error);
			return;
		}

		const usable = parseResult.data.events.filter(
			(event) =>
				!event.isInviteOnly &&
				!!event.location &&
				!!event.externalHref &&
				!!event.name,
		);

		// Clamp the threshold to the actual keyword count so a small/edited
		// keyword list still produces a usable candidate pool. Max score is
		// bounded by len(priorityKeywords); demanding more than that would
		// always yield zero events.
		const keywordCount = parseResult.data.priorityKeywords?.length ?? 0;
		const effectiveMin = Math.min(
			MIN_PRIORITY_SCORE,
			Math.max(1, keywordCount),
		);

		const priorityFiltered = usable.filter(
			(event) => (event.priorityScore ?? 0) >= effectiveMin,
		);

		// Take the top-MAX_CANDIDATES events by priorityScore so the greedy
		// non-overlap step picks from the strongest matches first, not the
		// first 100 in source order.
		const candidates = [...priorityFiltered]
			.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
			.slice(0, MAX_CANDIDATES);

		const thresholdNote =
			effectiveMin < MIN_PRIORITY_SCORE
				? ` (clamped from MIN_PRIORITY_SCORE=${MIN_PRIORITY_SCORE} because only ${keywordCount} keyword${keywordCount === 1 ? "" : "s"} active)`
				: "";
		console.log(
			`Loaded ${parseResult.data.events.length} events; ${usable.length} usable; ${priorityFiltered.length} above score ${effectiveMin}${thresholdNote}; ${candidates.length} taken as candidates.`,
		);

		const coords = apiKey
			? await geocodeLocations(candidates, mapsService)
			: new Map<string, Coordinates2D>();

		const selected = findNonOverlappingEvents(candidates, coords);
		console.log(
			`Selected ${selected.length} non-overlapping events (travel-time-aware).`,
		);

		const routeInfo =
			selected.length > 1 && apiKey
				? await buildRouteInfo(selected, mapsService)
				: "";

		const itineraryMapUrl = apiKey
			? buildItineraryMapUrl(selected, coords, mapsService)
			: null;

		const dayDeeplinks = buildDayDeeplinks(selected);
		const dayDeeplinksMd =
			dayDeeplinks.length > 0
				? `## Open the Day in Google Maps (interactive)\n\n${dayDeeplinks
						.map(
							(d) =>
								`- [${d.date} — route through ${d.count} event${
									d.count === 1 ? "" : "s"
								}](${d.url})`,
						)
						.join("\n")}\n\n`
				: "";

		const formatted = selected.map((event, index) => ({
			label: String.fromCharCode(65 + (index % 26)),
			name: event.name,
			when: `${event.date} | ${formatTimeOfDay(event.time)} (${
				event.facets.time?.label ?? "anytime"
			})`,
			where: `${event.location ?? "?"} — ${event.city}`,
			hosts:
				event.facets.hosts?.map((host) => host.label).join(", ") ??
				event.company ??
				"",
			priorityScore: event.priorityScore ?? 0,
			priorityMatches: event.priorityMatches ?? [],
			description: event.description ?? null,
			url: event.externalHref ?? "",
		}));

		const prompt = `Given this pre-filtered itinerary of NYC Tech Week 2026 events,
identify the highest-signal events from the candidate pool.

The candidates were already filtered to those whose descriptions matched a priority
keyword list and then trimmed to a travel-time-aware non-overlapping schedule. Each
event includes:
  - priorityScore: how many priority keywords its description hit
  - priorityMatches: the specific keywords matched
  - description: the actual event description scraped from the registration page

Use the descriptions to judge content quality — don't just trust priorityScore.
If a high-score event reads like generic networking, say so and prefer a lower-score
event with more substantive content.

Events (each labeled A, B, C... matching the static map):
${JSON.stringify(formatted, null, 2)}

${routeInfo}

${itineraryMapUrl ? `Itinerary map: ${itineraryMapUrl}\n` : ""}

${dayDeeplinksMd}

Format the response as a markdown table with columns:
Label, Event Name, Time/Location, Hosts, Priority Match, Why It Stands Out, Registration Link.
Then under the table give 2-3 sentences on which day looks strongest and why.
Preserve the "Open the Day in Google Maps" section verbatim in your output so the
reader can click into the interactive route for each day.`;

		let text: string;
		try {
			const result = await generateText({
				model: openai("gpt-4o"),
				system:
					"You pick the most relevant tech events from a curated list and explain why each one is worth attending based on its description.",
				prompt,
				maxTokens: 3000,
			});
			text = result.text;
		} catch (error) {
			console.error(
				"AI generation failed; writing raw itinerary instead.",
				error,
			);
			text =
				`# NYC Tech Week 2026 — Itinerary\n\n` +
				`${selected.length} non-overlapping events selected.\n\n` +
				(itineraryMapUrl ? `![map](${itineraryMapUrl})\n\n` : "") +
				dayDeeplinksMd +
				selected
					.map(
						(event, i) =>
							`${i + 1}. **${event.name}** — ${event.date} ${formatTimeOfDay(
								event.time,
							)} @ ${event.location}\n   ${event.externalHref ?? ""}`,
					)
					.join("\n") +
				"\n\n" +
				routeInfo;
		}

		await Bun.write(RESPONSE_FILE, text);

		// Write the fully interactive itinerary page alongside response.md.
		// Requires GOOGLE_MAPS_API_KEY for the client-side Maps JS API; without
		// one, the markers list + day deeplinks above are still usable.
		if (apiKey) {
			// HTML is a reusable static template; data lives in a sibling .js file
			// so the same HTML can be shared and reused for different itineraries.
			const html = buildItineraryHtml();
			const dataJs = buildItineraryDataJs(selected, coords, apiKey);
			await Bun.write(ITINERARY_HTML_FILE, html);
			await Bun.write(ITINERARY_DATA_FILE, dataJs);
			console.log(`Wrote interactive itinerary → ${ITINERARY_HTML_FILE}`);
			console.log(`Wrote itinerary data       → ${ITINERARY_DATA_FILE}`);
			Bun.spawn({ cmd: ["/bin/sh", "-c", `xdg-open "${ITINERARY_HTML_FILE}"`] });
		}

		Bun.spawn({ cmd: ["/bin/sh", "-c", `xdg-open "${RESPONSE_FILE}"`] });

		for (const event of selected) {
			if (!event.externalHref) continue;
			Bun.spawn({
				cmd: ["/bin/sh", "-c", `xdg-open "${event.externalHref}"`],
			});
		}
	} catch (error) {
		console.error("An unexpected error occurred:", error);
	}
})();
