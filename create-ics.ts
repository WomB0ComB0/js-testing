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

/**
 * @fileoverview Creates an ICS calendar file with recurring events based on provided configuration
 */

import { writeFileSync } from "fs";
import ical, { ICalEventRepeatingFreq, ICalWeekday } from "ical-generator";
import type { ICalRepeatingOptions } from "ical-generator/dist/index.d.ts";
import { DateTime } from "luxon";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

/**
 * Weekday constants for easier event scheduling
 */
// @ts-expect-error
const monday = ICalWeekday.MO,
	wednesday = ICalWeekday.WE,
	saturday = ICalWeekday.SA,
	sunday = ICalWeekday.SU,
	tuesday = ICalWeekday.TU,
	thursday = ICalWeekday.TH,
	friday = ICalWeekday.FR;

/**
 * Array of event configurations
 * @type {Array<{
 *   title: string,
 *   description: string,
 *   start: string,
 *   end: string,
 *   days: ICalWeekday[]
 * }>}
 */
const events: {
	title: string;
	description: string;
	start: string;
	end: string;
	days: ICalWeekday[];
}[] = [
	{
		title: "Twitch Stream",
		description: "Live coding and programming stream on Twitch",
		start: "21:30",
		end: "23:00",
		days: [monday, tuesday, wednesday, thursday, friday],
	},
];

/**
 * Main function that generates the ICS calendar file
 * @async
 * @returns {Promise<void>} Promise that resolves when the file is written
 */
async function main(): Promise<void> {
	// Parse command line arguments
	const argv = await yargs(hideBin(process.argv))
		.option("repeat", {
			alias: "r",
			type: "boolean",
			description: "Whether the events should repeat",
			default: true,
		})
		.option("duration", {
			alias: "d",
			type: "number",
			description: "How long the events should repeat (in days)",
			default: 90,
		})
		.option("timezone", {
			alias: "t",
			type: "string",
			description: "Timezone for the events",
			default: "America/New_York",
		})
		.parseAsync();

	const timezone = argv.timezone;
	const calendar = ical({ name: "My Schedule", timezone });

	// Calculate start and end dates for events
	const startDate = DateTime.now().setZone(timezone);
	const endDate = argv.repeat
		? startDate.plus({ days: argv.duration })
		: startDate;

	// Create calendar events
	events.forEach((event) => {
		// Configure recurrence rule for repeating events
		const recurrenceRule = {
			freq: ICalEventRepeatingFreq.WEEKLY,
			byDay: event.days.map((day) => day),
			until: endDate.toJSDate(),
		} satisfies ICalRepeatingOptions;

		// Calculate event start and end times
		const startTime = DateTime.fromISO(
			`${startDate.toISODate()}T${event.start}:00`,
			{ zone: timezone },
		);
		const endTime = DateTime.fromISO(
			`${startDate.toISODate()}T${event.end}:00`,
			{ zone: timezone },
		);

		// Create the calendar event
		calendar.createEvent({
			start: startTime.toJSDate(),
			end: endTime.toJSDate(),
			summary: event.title,
			timezone: timezone,
			repeating: recurrenceRule,
		});
	});

	// Write calendar to file
	writeFileSync("schedule.ics", calendar.toString());

	console.log("ICS file generated successfully!");
}

/**
 * Entry point - only run main if this is the main module
 */
if (require.main === module) {
	main().catch(console.error);
}
