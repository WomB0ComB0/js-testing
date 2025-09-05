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

const NewsAPI = require("newsapi");

import { config } from "dotenv";

// Load environment variables
config();

// Types for News API responses
interface Article {
	source: {
		id: string | null;
		name: string;
	};
	author: string | null;
	title: string;
	description: string | null;
	url: string;
	urlToImage: string | null;
	publishedAt: string;
	content: string | null;
}

interface Source {
	id: string;
	name: string;
	description: string;
	url: string;
	category: string;
	language: string;
	country: string;
}

interface TopHeadlinesResponse {
	status: string;
	totalResults: number;
	articles: Article[];
}

interface EverythingResponse {
	status: string;
	totalResults: number;
	articles: Article[];
}

interface SourcesResponse {
	status: string;
	sources: Source[];
}

type NewsAPIResponse =
	| TopHeadlinesResponse
	| EverythingResponse
	| SourcesResponse;

// Test configuration
interface TestConfig {
	delayBetweenRequests: number;
	maxArticlesToShow: number;
}

const TEST_CONFIG: TestConfig = {
	delayBetweenRequests: 1000, // 1 second delay to respect rate limits
	maxArticlesToShow: 3, // Limit console output
};

// Initialize NewsAPI with your API key
const NEWS_API_KEY = process.env.NEWS_API_KEY || "your_api_key_here";
const newsapi = new NewsAPI(NEWS_API_KEY);

// Utility function to add delay between requests
const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

// Utility function to display results
const displayResults = (
	testName: string,
	response: NewsAPIResponse,
	showArticles: boolean = true,
): void => {
	console.log(`\n=== ${testName} ===`);
	console.log(`Status: ${response.status}`);

	if ("sources" in response) {
		console.log(`Total sources: ${response.sources.length}`);
		console.log(
			"Sample sources:",
			response.sources.slice(0, 3).map((s) => s.name),
		);
	}

	if ("articles" in response) {
		console.log(
			`Total articles: ${response.totalResults || response.articles.length}`,
		);

		if (showArticles && response.articles.length > 0) {
			console.log("\nSample articles:");
			response.articles
				.slice(0, TEST_CONFIG.maxArticlesToShow)
				.forEach((article, index) => {
					console.log(`${index + 1}. ${article.title}`);
					console.log(`   Source: ${article.source.name}`);
					console.log(`   Published: ${article.publishedAt}`);
					console.log(`   URL: ${article.url}\n`);
				});
		}
	}
};

// Test function with error handling
const runTest = async <T extends NewsAPIResponse>(
	testName: string,
	testFunction: () => Promise<T>,
): Promise<T | null> => {
	try {
		console.log(`\n🧪 Running: ${testName}`);
		const response = await testFunction();
		displayResults(testName, response);
		return response;
	} catch (error) {
		const err = error as Error & { code?: string };
		console.error(`\n❌ Error in ${testName}:`, err.message);
		if (err.code) console.error(`Error code: ${err.code}`);
		return null;
	}
};

// Top Headlines test parameters
interface TopHeadlinesParams {
	sources?: string;
	q?: string;
	category?:
		| "business"
		| "entertainment"
		| "general"
		| "health"
		| "science"
		| "sports"
		| "technology";
	language?: string;
	country?: string;
	pageSize?: number;
}

// Everything test parameters
interface EverythingParams {
	q?: string;
	sources?: string;
	domains?: string;
	excludeDomains?: string;
	from?: string;
	to?: string;
	language?: string;
	sortBy?: "relevancy" | "popularity" | "publishedAt";
	pageSize?: number;
	page?: number;
}

// Sources test parameters
interface SourcesParams {
	category?:
		| "business"
		| "entertainment"
		| "general"
		| "health"
		| "science"
		| "sports"
		| "technology";
	language?: string;
	country?: string;
}

// Main test suite
export async function runAllTests(): Promise<void> {
	console.log("🚀 Starting News API Tests");
	console.log(`Using API Key: ${NEWS_API_KEY.substring(0, 8)}...`);

	// Test 1: Top Headlines - General
	await runTest(
		"Top Headlines - General",
		async (): Promise<TopHeadlinesResponse> => {
			const params: TopHeadlinesParams = {
				language: "en",
				pageSize: 10,
			};
			return await newsapi.v2.topHeadlines(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 2: Top Headlines - Specific Sources
	await runTest(
		"Top Headlines - BBC & The Verge",
		async (): Promise<TopHeadlinesResponse> => {
			const params: TopHeadlinesParams = {
				sources: "bbc-news,the-verge",
				pageSize: 10,
			};
			return await newsapi.v2.topHeadlines(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 3: Top Headlines - Category
	await runTest(
		"Top Headlines - Technology Category",
		async (): Promise<TopHeadlinesResponse> => {
			const params: TopHeadlinesParams = {
				category: "technology",
				country: "us",
				pageSize: 10,
			};
			return await newsapi.v2.topHeadlines(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 4: Top Headlines - Search Query
	await runTest(
		"Top Headlines - Bitcoin Query",
		async (): Promise<TopHeadlinesResponse> => {
			const params: TopHeadlinesParams = {
				q: "bitcoin",
				language: "en",
				pageSize: 10,
			};
			return await newsapi.v2.topHeadlines(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 5: Everything - General Search
	await runTest(
		"Everything - AI Search",
		async (): Promise<EverythingResponse> => {
			const params: EverythingParams = {
				q: "artificial intelligence",
				language: "en",
				sortBy: "popularity",
				pageSize: 10,
			};
			return await newsapi.v2.everything(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 6: Everything - Date Range
	await runTest(
		"Everything - Last Week Tech News",
		async (): Promise<EverythingResponse> => {
			const lastWeek = new Date();
			lastWeek.setDate(lastWeek.getDate() - 7);

			const params: EverythingParams = {
				q: "technology",
				from: lastWeek.toISOString().split("T")[0],
				language: "en",
				sortBy: "publishedAt",
				pageSize: 10,
			};
			return await newsapi.v2.everything(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 7: Everything - Specific Domains
	await runTest(
		"Everything - TechCrunch & BBC",
		async (): Promise<EverythingResponse> => {
			const params: EverythingParams = {
				domains: "techcrunch.com,bbc.co.uk",
				q: "startup",
				language: "en",
				pageSize: 10,
			};
			return await newsapi.v2.everything(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 8: Sources - All Available
	await runTest(
		"Sources - All Available",
		async (): Promise<SourcesResponse> => {
			return await newsapi.v2.sources({});
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 9: Sources - Technology Category
	await runTest(
		"Sources - Technology Category",
		async (): Promise<SourcesResponse> => {
			const params: SourcesParams = {
				category: "technology",
				language: "en",
			};
			return await newsapi.v2.sources(params);
		},
	);

	await delay(TEST_CONFIG.delayBetweenRequests);

	// Test 10: Sources - By Country
	await runTest("Sources - US Sources", async (): Promise<SourcesResponse> => {
		const params: SourcesParams = {
			country: "us",
			language: "en",
		};
		return await newsapi.v2.sources(params);
	});

	console.log("\n✅ All tests completed!");
}

// Performance test function
export async function performanceTest(): Promise<void> {
	console.log("\n⚡ Running Performance Test");

	const startTime = Date.now();

	try {
		const promises: Promise<NewsAPIResponse>[] = [
			newsapi.v2.topHeadlines({ country: "us", pageSize: 5 }),
			newsapi.v2.everything({ q: "javascript", pageSize: 5 }),
			newsapi.v2.sources({ category: "technology" }),
		];

		const results = await Promise.all(promises);
		const endTime = Date.now();

		console.log(
			`✅ All 3 concurrent requests completed in ${endTime - startTime}ms`,
		);
		results.forEach((result, index) => {
			const testNames = ["Top Headlines", "Everything Search", "Sources"];
			console.log(`${testNames[index]}: ${result.status}`);
		});
	} catch (error) {
		const err = error as Error;
		console.error("❌ Performance test failed:", err.message);
	}
}

// Individual test functions for manual testing
export const individualTests = {
	// Test specific headline search
	testHeadlineSearch: async (
		query: string,
	): Promise<TopHeadlinesResponse | null> => {
		return await runTest(
			`Headlines Search: "${query}"`,
			async (): Promise<TopHeadlinesResponse> => {
				const params: TopHeadlinesParams = {
					q: query,
					language: "en",
					pageSize: 5,
				};
				return await newsapi.v2.topHeadlines(params);
			},
		);
	},

	// Test specific source
	testSource: async (
		sourceId: string,
	): Promise<TopHeadlinesResponse | null> => {
		return await runTest(
			`Source: ${sourceId}`,
			async (): Promise<TopHeadlinesResponse> => {
				const params: TopHeadlinesParams = {
					sources: sourceId,
					pageSize: 5,
				};
				return await newsapi.v2.topHeadlines(params);
			},
		);
	},

	// Test date range search
	testDateRange: async (
		query: string,
		daysBack: number = 7,
	): Promise<EverythingResponse | null> => {
		const fromDate = new Date();
		fromDate.setDate(fromDate.getDate() - daysBack);

		return await runTest(
			`Date Range Search: "${query}" (${daysBack} days)`,
			async (): Promise<EverythingResponse> => {
				const params: EverythingParams = {
					q: query,
					from: fromDate.toISOString().split("T")[0],
					language: "en",
					sortBy: "publishedAt",
					pageSize: 5,
				};
				return await newsapi.v2.everything(params);
			},
		);
	},
};

// Main execution
async function main(): Promise<void> {
	if (NEWS_API_KEY === "your_api_key_here") {
		console.log(
			"⚠️  Please set your NEWS_API_KEY in environment variables or update the script",
		);
		console.log("You can get a free API key from: https://newsapi.org/");
		return;
	}

	// Run all tests
	await runAllTests();

	// Run performance test
	await performanceTest();

	// Example of using individual tests
	console.log("\n🎯 Running Individual Tests");
	await individualTests.testHeadlineSearch("climate change");
	await delay(TEST_CONFIG.delayBetweenRequests);
	await individualTests.testSource("techcrunch");
	await delay(TEST_CONFIG.delayBetweenRequests);
	await individualTests.testDateRange("cryptocurrency", 3);
}

// Export newsapi instance for external use
export { newsapi };

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
