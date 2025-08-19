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

import { argv, file, readableStreamToJSON, write } from "bun";
import { z } from "zod";

const fireSchema = z.object({
	markdown: z.string(),
	metadata: z.object({
		generator: z.string(),
		viewport: z.string(),
		language: z.string(),
		description: z.string(),
		title: z.string(),
		scrapeId: z.string(),
		sourceURL: z.string(),
		url: z.string(),
		statusCode: z.number(),
	}),
	warning: z.string().optional(),
});

type FireCrawl = z.infer<typeof fireSchema>;

/**
 * Validates command line arguments
 * @returns An object with validated arguments or throws an error
 */
function validateArgs(): {
	filepath: string;
	filterPattern: string;
	limit: number;
} {
	if (argv.length < 3) {
		console.error("Error: Missing required arguments");
		console.log(
			"Usage: bun fire-crawl-parser.ts <file_path> [filter_pattern] [limit]",
		);
		process.exit(1);
	}

	const [filepath, filterPattern = "", limitStr = "0"] = argv.slice(2);
	const limit = parseInt(limitStr, 10);

	if (isNaN(limit) && limitStr !== "0") {
		console.error(`Error: Invalid limit value: ${limitStr}`);
		process.exit(1);
	}

	return { filepath, filterPattern, limit };
}

/**
 * Reads and parses a JSON file
 * @param filepath Path to the JSON file
 * @returns Parsed and validated data
 */
async function readAndParseFile(filepath: string): Promise<FireCrawl[]> {
	const fileObj = file(filepath);

	if (!(await fileObj.exists())) {
		console.error(`Error: File not found: ${filepath}`);
		process.exit(1);
	}

	try {
		const fileData = await readableStreamToJSON(fileObj.stream());
		const validationResult = z.array(fireSchema).safeParse(fileData);

		if (!validationResult.success) {
			console.error("Error: Invalid data format");
			console.error(validationResult.error.format());
			process.exit(1);
		}

		return validationResult.data;
	} catch (error) {
		console.error(`Error reading or parsing file: ${filepath}`);
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

/**
 * Filters data based on a pattern and limit
 * @param data Array of FireCrawl objects
 * @param filterPattern Pattern to filter URLs by
 * @param limit Maximum number of results (0 for unlimited)
 * @returns Filtered data
 */
function filterData(
	data: FireCrawl[],
	filterPattern: string,
	limit: number,
): FireCrawl[] {
	let filtered = data.filter((item) => {
		const statusCode = item.metadata.statusCode;
		// 2xx: Success
		// 3xx: Redirection
		// 4xx: Client errors
		// 5xx: Server errors
		return statusCode >= 200 && statusCode < 600;
	});

	if (filterPattern) {
		const patterns = filterPattern.split("|");
		filtered = data.filter((item) =>
			patterns.some((pattern) => item.metadata.url.includes(pattern)),
		);
	}

	if (limit > 0) filtered = filtered.slice(0, limit);

	return filtered;
}

/**
 * Outputs the results
 * @param data Filtered data to output
 */
function outputResults(data: FireCrawl[] | string[]): void {
	console.log(`Found ${data.length} matching results.`);

	const outputPath = `crawl-results-${Date.now()}.json`;
	write(outputPath, JSON.stringify(data, null, 2));
	console.log(`Results written to ${outputPath}`);

	data.forEach((item, index) => {
		console.log(`\nResult ${index + 1}:`);
		if (typeof item === "string") {
			console.log(`  URL: ${item}`);
		} else {
			console.log(`  Title: ${item.metadata.title}`);
			console.log(`  URL: ${item.metadata.url}`);
			console.log(`  Status Code: ${item.metadata.statusCode}`);
		}
	});
}

/**
 * Main function that orchestrates the parsing process
 */
async function main(): Promise<void> {
	try {
		const { filepath, filterPattern, limit } = validateArgs();

		console.log(`Processing file: ${filepath}`);
		if (filterPattern) console.log(`Using filter: ${filterPattern}`);
		if (limit > 0) console.log(`Limiting results to: ${limit}`);

		const data = await readAndParseFile(filepath);
		console.log(`Successfully parsed ${data.length} entries.`);

		const filteredData = filterData(data, filterPattern, limit).map(
			(item) => item.metadata.url,
		);
		outputResults(filteredData);

		process.exit(0);
	} catch (error) {
		console.error("Unexpected error occurred:");
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

if (require.main === module) {
	main().catch(console.error);
}
