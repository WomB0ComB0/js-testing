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
