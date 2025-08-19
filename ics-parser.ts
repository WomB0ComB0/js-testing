/**
 * Copyright 2025 Mike Odnis
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview A utility for converting ICS (iCalendar) files to JSON format with customizable output options.
 * Supports flattening nested structures, removing fields, renaming keys, and filtering by date range.
 */

import { $ } from "bun";
import { Command } from "commander";
import { lines2tree } from "icalts";

/**
 * Represents an alarm component in an iCalendar event
 * @interface VAlarm
 */
interface VAlarm {
	/** The action to be invoked when an alarm is triggered */
	ACTION: string;
	/** A more complete description of the alarm */
	DESCRIPTION: string;
	/** A short summary or subject for the alarm */
	SUMMARY?: string;
	/** The calendar user who is the target of the alarm */
	ATTENDEE?: string;
	/** When the alarm will trigger relative to the associated event */
	TRIGGER: string;
}

/**
 * Represents an event component in an iCalendar
 * @interface VEvent
 */
interface VEvent {
	/** Start date/time of the event. Can be a string or an object with __value__ property */
	DTSTART: string | { __value__: string };
	/** End date/time of the event. Can be a string or an object with __value__ property */
	DTEND?: string | { __value__: string };
	/** Last modification date of the iCalendar object */
	DTSTAMP: string;
	/** Unique identifier for the event */
	UID: string;
	/** Creation date of the event */
	CREATED: string;
	/** Full description of the event */
	DESCRIPTION: string;
	/** Last modification date of the event */
	LAST_MODIFIED: string;
	/** Physical location of the event */
	LOCATION: string;
	/** Sequence number for the event */
	SEQUENCE: string;
	/** Status of the event (e.g., CONFIRMED, TENTATIVE) */
	STATUS: string;
	/** Short summary or subject of the event */
	SUMMARY: string;
	/** Transparency of the event (e.g., OPAQUE, TRANSPARENT) */
	TRANSP: string;
	/** Optional array of alarm components */
	VALARM?: VAlarm[];
}

/**
 * Represents daylight savings rules in a timezone
 * @interface VTimeZoneDaylight
 */
interface VTimeZoneDaylight {
	/** The offset before the change */
	TZOFFSETFROM: string;
	/** The offset after the change */
	TZOFFSETTO: string;
	/** The timezone name */
	TZNAME: string;
	/** When the change takes effect */
	DTSTART: string;
	/** Recurrence rule for when the change happens */
	RRULE: string;
}

/**
 * Represents standard time rules in a timezone
 * @interface VTimeZoneStandard
 */
interface VTimeZoneStandard {
	/** The offset before the change */
	TZOFFSETFROM: string;
	/** The offset after the change */
	TZOFFSETTO: string;
	/** The timezone name */
	TZNAME: string;
	/** When the change takes effect */
	DTSTART: string;
	/** Optional recurrence rule for when the change happens */
	RRULE?: string;
}

/**
 * Represents a timezone definition in an iCalendar
 * @interface VTimeZone
 */
interface VTimeZone {
	/** Timezone identifier */
	TZID: string;
	/** Geographic location of the timezone */
	X_LIC_LOCATION: string;
	/** Optional array of daylight savings rules */
	DAYLIGHT?: VTimeZoneDaylight[];
	/** Optional array of standard time rules */
	STANDARD?: VTimeZoneStandard[];
}

/**
 * Represents a calendar component in an iCalendar
 * @interface VCalendar
 */
interface VCalendar {
	/** Identifier for the product that created the iCalendar object */
	PRODID: string;
	/** Version of the iCalendar specification */
	VERSION: string;
	/** Calendar scale used for the calendar */
	CALSCALE: string;
	/** Method associated with the iCalendar object */
	METHOD?: string;
	/** Display name of the calendar */
	X_WR_CALNAME: string;
	/** Default timezone for the calendar */
	X_WR_TIMEZONE: string;
	/** Optional array of timezone definitions */
	VTIMEZONE?: VTimeZone[];
	/** Optional array of events */
	VEVENT?: VEvent[];
}

/**
 * Represents the root structure of an iCalendar file
 * @interface ICSTree
 */
interface ICSTree {
	/** Array of calendar components */
	VCALENDAR: VCalendar[];
}

/**
 * Truncates a string to a specified maximum length
 * @param {string} str - The string to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} The truncated string with ellipsis if needed
 */
const truncateString = (str: string, maxLength: number): string =>
	str.length > maxLength ? `${str.substring(0, maxLength)}...` : str;

/**
 * Recursively truncates all string values in an object
 * @param {any} obj - The object to process
 * @param {number} maxLength - Maximum length for string values
 * @returns {any} A new object with truncated string values
 */
const truncateObjectValues = (obj: any, maxLength: number): any => {
	if (typeof obj !== "object" || obj === null) return obj;
	if (Array.isArray(obj))
		return obj.map((item) => truncateObjectValues(item, maxLength));

	return Object.keys(obj).reduce((acc, key) => {
		acc[key] =
			typeof obj[key] === "string"
				? truncateString(obj[key], maxLength)
				: truncateObjectValues(obj[key], maxLength);
		return acc;
	}, {} as any);
};

/**
 * Removes carriage returns from object keys
 * @param {any} obj - The object to sanitize
 * @returns {any} A new object with sanitized keys
 */
const sanitizeKeys = (obj: any): any => {
	if (typeof obj !== "object" || obj === null) return obj;
	if (Array.isArray(obj)) return obj.map(sanitizeKeys);

	return Object.keys(obj).reduce((acc, key) => {
		const sanitizedKey = key.replace(/\r/g, "");
		acc[sanitizedKey] = sanitizeKeys(obj[key]);
		return acc;
	}, {} as any);
};

/**
 * Parses an iCalendar date string into a JavaScript Date object
 * @param {string | { __value__: string } | undefined} dateStr - The date string to parse
 * @returns {Date | null} The parsed Date object or null if parsing fails
 */
const parseICalDate = (
	dateStr: string | { __value__: string } | undefined,
): Date | null => {
	if (
		typeof dateStr === "object" &&
		dateStr !== null &&
		"__value__" in dateStr
	) {
		dateStr = dateStr.__value__;
	}

	if (!dateStr || typeof dateStr !== "string") {
		console.warn(`Invalid date string: ${JSON.stringify(dateStr)}`);
		return null;
	}

	try {
		const [year, month, day, hour, minute, second] = [
			dateStr.substring(0, 4),
			dateStr.substring(4, 6),
			dateStr.substring(6, 8),
			dateStr.substring(9, 11),
			dateStr.substring(11, 13),
			dateStr.substring(13, 15),
		].map((val) => parseInt(val, 10));

		return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
	} catch (error) {
		console.error(`Error parsing date string: ${dateStr}`, error);
		return null;
	}
};

/**
 * Flattens nested structures in the iCalendar tree
 * @param {ICSTree} tree - The tree to flatten
 * @returns {ICSTree} A new flattened tree
 */
const flattenTree = (tree: ICSTree): ICSTree => {
	if (!tree?.VCALENDAR) {
		console.warn("Warning: Invalid tree structure received in flattenTree");
		return { VCALENDAR: [] };
	}

	return {
		VCALENDAR: tree.VCALENDAR.map((calendar) => ({
			PRODID: calendar.PRODID ?? "",
			VERSION: calendar.VERSION ?? "",
			CALSCALE: calendar.CALSCALE ?? "",
			METHOD: calendar.METHOD,
			X_WR_CALNAME: calendar.X_WR_CALNAME ?? "",
			X_WR_TIMEZONE: calendar.X_WR_TIMEZONE ?? "",
			VTIMEZONE: calendar.VTIMEZONE?.map((timezone) => ({
				TZID: timezone.TZID ?? "",
				X_LIC_LOCATION: timezone.X_LIC_LOCATION ?? "",
				DAYLIGHT: timezone.DAYLIGHT?.map((daylight) => ({
					TZOFFSETFROM: daylight.TZOFFSETFROM ?? "",
					TZOFFSETTO: daylight.TZOFFSETTO ?? "",
					TZNAME: daylight.TZNAME ?? "",
					DTSTART: daylight.DTSTART ?? "",
					RRULE: daylight.RRULE ?? "",
				})),
				STANDARD: timezone.STANDARD?.map((standard) => ({
					TZOFFSETFROM: standard.TZOFFSETFROM ?? "",
					TZOFFSETTO: standard.TZOFFSETTO ?? "",
					TZNAME: standard.TZNAME ?? "",
					DTSTART: standard.DTSTART ?? "",
					RRULE: standard.RRULE,
				})),
			})),
			VEVENT: calendar.VEVENT?.map((event) => ({
				DTSTART: event.DTSTART ?? "",
				DTEND: event.DTEND,
				DTSTAMP: event.DTSTAMP ?? "",
				UID: event.UID ?? "",
				CREATED: event.CREATED ?? "",
				DESCRIPTION: event.DESCRIPTION ?? "",
				LAST_MODIFIED: event.LAST_MODIFIED ?? "",
				LOCATION: event.LOCATION ?? "",
				SEQUENCE: event.SEQUENCE ?? "",
				STATUS: event.STATUS ?? "",
				SUMMARY: event.SUMMARY ?? "",
				TRANSP: event.TRANSP ?? "",
				VALARM: event.VALARM?.map((alarm) => ({
					ACTION: alarm.ACTION ?? "",
					DESCRIPTION: alarm.DESCRIPTION ?? "",
					SUMMARY: alarm.SUMMARY,
					ATTENDEE: alarm.ATTENDEE,
					TRIGGER: alarm.TRIGGER ?? "",
				})),
			})),
		})),
	};
};

/**
 * Removes specified fields from the iCalendar tree
 * @param {ICSTree} tree - The tree to modify
 * @param {string[]} fields - Array of field names to remove
 * @returns {ICSTree} A new tree with specified fields removed
 */
const removeFields = (tree: ICSTree, fields: string[]): ICSTree => ({
	VCALENDAR: tree.VCALENDAR.map((calendar) => ({
		...calendar,
		VTIMEZONE: fields.includes("VTIMEZONE") ? undefined : calendar.VTIMEZONE,
		VEVENT: fields.includes("VEVENT") ? undefined : calendar.VEVENT,
	})),
});

/**
 * Renames keys in the iCalendar tree according to a mapping
 * @param {ICSTree} tree - The tree to modify
 * @param {Record<string, string>} keyMap - Object mapping old keys to new keys
 * @returns {ICSTree} A new tree with renamed keys
 */
const renameKeys = (
	tree: ICSTree,
	keyMap: Record<string, string>,
): ICSTree => ({
	VCALENDAR: tree.VCALENDAR.map((calendar) => ({
		...calendar,
		VTIMEZONE: calendar.VTIMEZONE?.map((timezone) => ({
			...timezone,
			...Object.fromEntries(
				Object.entries(timezone).map(([key, value]) => [
					keyMap[key] || key,
					value,
				]),
			),
		})),
		VEVENT: calendar.VEVENT?.map((event) => ({
			...event,
			...Object.fromEntries(
				Object.entries(event).map(([key, value]) => [
					keyMap[key] || key,
					value,
				]),
			),
		})),
	})),
});

/**
 * Filters events in the tree by a date range
 * @param {ICSTree} tree - The tree to filter
 * @param {string} dateRange - Date range in format "YYYY-MM-DD,YYYY-MM-DD"
 * @returns {ICSTree} A new tree with filtered events
 */
const filterByDateRange = (tree: ICSTree, dateRange: string): ICSTree => {
	const [startDateStr, endDateStr] = dateRange
		.split(",")
		.map((date) => date.trim());
	const startDate = new Date(startDateStr);
	const endDate = new Date(endDateStr);

	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
		console.error(
			'Invalid date range. Please provide dates in the format "YYYY-MM-DD,YYYY-MM-DD".',
		);
		return tree;
	}

	return {
		VCALENDAR: tree.VCALENDAR.map((calendar) => ({
			...calendar,
			VEVENT: calendar.VEVENT?.filter((event) => {
				const eventStartDate = parseICalDate(event.DTSTART);
				const eventEndDate = parseICalDate(event.DTEND || event.DTSTART);
				return (
					eventStartDate &&
					eventEndDate &&
					eventStartDate >= startDate &&
					eventEndDate <= endDate
				);
			}),
		})),
	};
};

/**
 * Main function to process ICS files and convert them to JSON
 * @param {string} filePath - Path to the ICS file or directory
 * @param {boolean} useRoot - Whether to search in root directory
 * @param {any} options - Processing options (flatten, removeFields, renameKeys, dateRange)
 */
const processICSFiles = async (
	filePath: string,
	useRoot = false,
	options: any,
) => {
	try {
		const icsFiles = useRoot
			? (
					await $`find . -type d \( -name 'node_modules' -o -name '.git' \) -prune -o -type f -name '*.ics' -print`.text()
				)
					.split("\n")
					.filter(Boolean)
			: [filePath];

		if (!icsFiles.length) {
			console.error("No .ics files found.");
			return;
		}

		for (const file of icsFiles) {
			try {
				const content = await Bun.file(file).text();
				if (!content.trim()) {
					console.error(`File is empty: ${file}`);
					continue;
				}

				const rawTree = lines2tree(content.split("\n"));
				console.log("Parsed Tree:", JSON.stringify(rawTree, null, 2));

				const sanitizedTree = sanitizeKeys(rawTree);

				if (!sanitizedTree?.VCALENDAR) {
					console.error(
						`Invalid ICS file: missing VCALENDAR property in ${file}`,
					);
					continue;
				}

				let processedTree: ICSTree = sanitizedTree;
				if (options.flatten) processedTree = flattenTree(processedTree);
				if (options.removeFields)
					processedTree = removeFields(
						processedTree,
						options.removeFields.split(","),
					);
				if (options.renameKeys)
					processedTree = renameKeys(
						processedTree,
						JSON.parse(options.renameKeys),
					);
				if (options.dateRange)
					processedTree = filterByDateRange(processedTree, options.dateRange);

				const outputFilePath = file.replace(/\.ics$/, ".json");
				await Bun.write(outputFilePath, JSON.stringify(processedTree, null, 2));
				console.log(`JSON saved to: ${outputFilePath}`);
			} catch (error) {
				console.error(`Error processing file ${file}:`, error);
			}
		}
	} catch (error) {
		console.error("Error processing .ics files:", error);
	}
};

const program = new Command();
program
	.name("ics-to-json")
	.description("Convert .ics files to JSON with customizable output.")
	.version("1.0.0")
	.argument(
		"[filePath]",
		"Path to the .ics file or directory containing .ics files",
	)
	.option("--root", "Search for .ics files in the root directory")
	.option("--flatten", "Flatten nested structures in the JSON output")
	.option(
		"--remove-fields <fields>",
		"Comma-separated list of fields to remove from the JSON output",
	)
	.option("--rename-keys <keyMap>", "JSON object mapping old keys to new keys")
	.option(
		"--date-range <range>",
		'Filter events by date range (format: "YYYY-MM-DD,YYYY-MM-DD")',
	)
	.action((filePath, options) => {
		if (!filePath && !options.root) {
			console.error(
				"Please provide a file path or use the --root flag to search in the root directory.",
			);
			process.exit(1);
		}
		processICSFiles(filePath, options.root, options);
	});

program.parse(process.argv);
