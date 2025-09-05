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

import axios from "axios";
import { customsearch_v1 } from "googleapis";
import { z } from "zod";

const SearchRecommendationSchema = z.object({
	info: z.object({
		totalResults: z.string(),
		searchTime: z.number(),
		formattedTotalResults: z.string(),
		formattedSearchTime: z.string(),
	}),
	items: z.array(
		z.object({
			link: z.string(),
			title: z.string(),
			snippet: z.string(),
			thumbnail: z
				.object({
					src: z.string(),
					width: z.string(),
					height: z.string(),
				})
				.optional(),
		}),
	),
});

type SearchRecommendation = z.infer<typeof SearchRecommendationSchema>;

// API Configuration
const YOUTUBE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

// Initialize Google Custom Search client
const customSearch = new customsearch_v1.Customsearch({
	key: GOOGLE_SEARCH_API_KEY,
});

/**
 * Truncates a query string to a maximum length
 */
function truncateQuery(query: string, maxLength = 100): string {
	if (query.length <= maxLength) return query;
	return query.substring(0, maxLength - 3) + "...";
}

/**
 * Searches YouTube videos by calling the YouTube Data API v3 endpoint directly.
 */
export const searchYouTube = async (query: string, pageToken?: string) => {
	if (!YOUTUBE_API_KEY) {
		throw new Error("YouTube API key is missing");
	}

	const YOUTUBE_SEARCH_ENDPOINT =
		"https://www.googleapis.com/youtube/v3/search";

	const params: {
		part: string;
		q: string;
		type: string;
		maxResults: number;
		key: string;
		pageToken?: string;
	} = {
		part: "snippet",
		q: query,
		type: "video",
		maxResults: 10,
		key: YOUTUBE_API_KEY,
	};

	if (pageToken) {
		params.pageToken = pageToken;
	}

	try {
		const response = await axios.get(YOUTUBE_SEARCH_ENDPOINT, { params });
		return response.data;
	} catch (error) {
		// Provide more specific error details if available from axios
		if (axios.isAxiosError(error)) {
			const errorDetails =
				error.response?.data?.error?.message || error.message;
			throw new Error(`Error searching YouTube: ${errorDetails}`);
		}
		// Fallback for other types of errors
		throw new Error(
			`Error searching YouTube: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

/**
 * Performs a Google Custom Search using the googleapis client library.
 */
export const search = async (query: string): Promise<SearchRecommendation> => {
	if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
		throw new Error("Google Search API key or Search Engine ID is missing");
	}

	try {
		const truncatedQuery = truncateQuery(query);
		const res = await customSearch.cse.list({
			key: GOOGLE_SEARCH_API_KEY,
			cx: GOOGLE_SEARCH_ENGINE_ID,
			q: truncatedQuery,
		});

		const data = res.data;

		const result = SearchRecommendationSchema.parse({
			info: {
				totalResults: data.searchInformation?.totalResults || "0",
				searchTime: data.searchInformation?.searchTime || 0,
				formattedTotalResults:
					data.searchInformation?.formattedTotalResults || "0",
				formattedSearchTime: data.searchInformation?.formattedSearchTime || "0",
			},
			items:
				data.items?.map((item) => ({
					link: item.link || "",
					title: item.title || "No title",
					snippet: item.snippet || "No snippet available",
					thumbnail: item.pagemap?.cse_thumbnail?.[0]
						? {
								src: item.pagemap.cse_thumbnail[0].src || "",
								width: item.pagemap.cse_thumbnail[0].width || "",
								height: item.pagemap.cse_thumbnail[0].height || "",
							}
						: undefined,
				})) || [],
		});

		return result;
	} catch (error) {
		throw new Error(
			`Error performing search: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

// =================================================================
// ======================== USAGE EXAMPLES =========================
// =================================================================

/**
 * An asynchronous main function to run the examples.
 * This is a common pattern to allow the use of 'await' at the top level.
 */
async function main() {
	const sampleQuery = "TypeScript tutorials for beginners";

	console.log(`Running examples with query: "${sampleQuery}"\n`);

	// --- Example 1: Search YouTube ---
	console.log("--- Running YouTube Search Example ---");
	try {
		const youtubeResults = await searchYouTube(sampleQuery);
		console.log("YouTube search successful!");

		// Log the title of the first video, if it exists
		if (youtubeResults.items && youtubeResults.items.length > 0) {
			console.log(
				`First video title: ${youtubeResults.items[0].snippet?.title}`,
			);
			console.log(`Total results in this page: ${youtubeResults.items.length}`);
		} else {
			console.log("No YouTube videos found for this query.");
		}
		// console.log("Full YouTube Response:", JSON.stringify(youtubeResults, null, 2)); // Uncomment to see the full response
	} catch (error) {
		console.error("YouTube search failed:", error);
	}

	console.log("\n" + "-".repeat(40) + "\n");

	// --- Example 2: Perform a Google Custom Search ---
	console.log("--- Running Google Custom Search Example ---");
	try {
		const searchResults = await search(sampleQuery);
		console.log("Google Custom Search successful!");

		// Log some metadata from the search
		console.log(
			`Found ${searchResults.info.formattedTotalResults} results in ${searchResults.info.formattedSearchTime} seconds.`,
		);

		// Log the title and link of the first result, if it exists
		if (searchResults.items.length > 0) {
			console.log(`First result title: ${searchResults.items[0].title}`);
			console.log(`First result link: ${searchResults.items[0].link}`);
		} else {
			console.log("No search results found for this query.");
		}
		// console.log("Full Custom Search Response:", JSON.stringify(searchResults, null, 2)); // Uncomment to see the full response
	} catch (error) {
		console.error("Google Custom Search failed:", error);
	}
}

// Execute the main function and catch any top-level errors.
main().catch((error) => {
	console.error("An unexpected error occurred:", error);
});
