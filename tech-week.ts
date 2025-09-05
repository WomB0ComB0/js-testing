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

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { file, readableStreamToJSON } from "bun";
import dotenv from "dotenv";
import { z } from "zod";
import { GoogleMapsService } from "./map.js";

dotenv.config({ path: ".env" });

const TechWeekEventSchema = z.object({
	id: z.string(),
	event_name: z.string(),
	start_time: z.string(),
	city: z.string(),
	neighborhood: z.string().nullable(),
	invite_url: z.string(),
	hosts: z.array(z.string()),
	target_audiences: z.array(z.string()),
	themes: z.array(z.string()),
	formats: z.array(z.string()),
	is_featured: z.boolean(),
	starred_on_calendar: z.string().nullable(),
	day: z.string(),
	time: z.string(),
});

type TechWeekEvent = z.infer<typeof TechWeekEventSchema>;

function eventsOverlap(event1: TechWeekEvent, event2: TechWeekEvent): boolean {
	const event1Start = new Date(event1.start_time);
	const event2Start = new Date(event2.start_time);

	const estimatedDuration = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
	const event1End = new Date(event1Start.getTime() + estimatedDuration);
	const event2End = new Date(event2Start.getTime() + estimatedDuration);

	return event1Start < event2End && event1End > event2Start;
}

function findNonOverlappingEvents(events: TechWeekEvent[]): TechWeekEvent[] {
	const sortedEvents = [...events].sort(
		(a, b) =>
			new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
	);

	const selectedEvents: TechWeekEvent[] = [];

	for (const event of sortedEvents) {
		if (
			selectedEvents.length === 0 ||
			!eventsOverlap(selectedEvents[selectedEvents.length - 1], event)
		) {
			selectedEvents.push(event);
		}
	}

	return selectedEvents;
}

(async () => {
	try {
		const apiKey = process.env.GOOGLE_MAPS_API_KEY || "";
		const mapsService = new GoogleMapsService(apiKey);

		let jsonData;
		try {
			const stream = file("tech-week.json").stream();
			jsonData = await readableStreamToJSON(stream);
		} catch (error) {
			console.error("Error reading JSON file:", error);
			return;
		}

		const parseResult = z.array(TechWeekEventSchema).safeParse(jsonData);

		if (parseResult.success) {
			const allEvents = parseResult.data;

			let events = allEvents.filter((event) => {
				if (event.invite_url === "Invite Only") return false;

				if (!event.neighborhood) return false;

				return true;
			});

			events = events.slice(0, 100);
			console.log(`Filtered to ${events.length} events`);

			const nonOverlappingEvents = findNonOverlappingEvents(events);
			console.log(
				`Selected ${nonOverlappingEvents.length} non-overlapping events`,
			);

			let routeInfo = "";
			if (nonOverlappingEvents.length > 1 && apiKey) {
				routeInfo = await calculateRoutes(nonOverlappingEvents, mapsService);
			}

			const formattedEvents = nonOverlappingEvents.map((event) => ({
				name: event.event_name,
				time_location: `${event.day} | ${event.time} | ${event.city}${event.neighborhood ? ` (${event.neighborhood})` : ""}`,
				details: `Hosts: ${event.hosts.join(", ")} | Themes: ${event.themes.join(", ")}`,
				url: event.invite_url,
			}));

			const prompt = `Based on my resume and this optimized, non-overlapping list of tech events, suggest which events I should attend.
        
        ${JSON.stringify(formattedEvents, null, 2)}
        
        ${routeInfo}

        Please format your response as a markdown table with columns for Event Name, Time/Location, Details, and Registration Link.`;

			const { text } = await generateText({
				model: openai("gpt-4o"),
				system:
					"You are a helpful assistant who can analyze events and match them to a person's resume and skills.",
				prompt: prompt,
				maxTokens: 3000,
			});

			await Bun.write("./response.md", text);
			await Bun.spawn({ cmd: ["/bin/sh", "-c", `xdg-open ./response.md`] });
			for (const event of nonOverlappingEvents)
				setTimeout(async () => {
					await Bun.spawn({
						cmd: ["/bin/sh", "-c", `xdg-open ${event.invite_url}`],
					});
				}, 1000);
		} else {
			console.error("Failed to parse events:", parseResult.error);
		}
	} catch (error) {
		console.error("An unexpected error occurred:", error);
	}
})();

async function calculateRoutes(
	events: TechWeekEvent[],
	mapsService: GoogleMapsService,
): Promise<string> {
	try {
		const eventLocations = events.map(
			(event) =>
				`${event.city}${event.neighborhood ? `, ${event.neighborhood}` : ""}`,
		);

		let routeInfo = "## Optimal Route Information\n\n";

		for (let i = 0; i < events.length - 1; i++) {
			const origin = eventLocations[i];
			const destination = eventLocations[i + 1];

			try {
				const result = await mapsService.getDirections(origin, destination);

				if (result && result.routes && result.routes.length > 0) {
					const route = result.routes[0];
					const leg = route.legs[0];

					routeInfo += `- From "${events[i].event_name}" to "${events[i + 1].event_name}":\n`;
					routeInfo += `  - Distance: ${leg.distance?.text}\n`;
					routeInfo += `  - Duration: ${leg.duration?.text}\n`;
					routeInfo += `  - Route: ${route.summary}\n\n`;
				}
			} catch (error) {
				console.error(
					`Failed to get directions from ${origin} to ${destination}:`,
					error,
				);
			}
		}

		return routeInfo;
	} catch (error) {
		console.error("Error calculating routes:", error);
		return "Could not calculate routes between events.";
	}
}
