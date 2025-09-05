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

export interface FoodNutrient {
	id: number;
	amount: number;
	nutrient: {
		id: number;
		number: string;
		name: string;
		rank: number;
		unitName: string;
	};
	foodNutrientDerivation?: {
		id: number;
		code: string;
		description: string;
	};
}

export interface Food {
	fdcId: number;
	description: string;
	dataType: string;
	publicationDate: string;
	brandOwner?: string;
	brandName?: string;
	ingredients?: string;
	marketCountry?: string;
	foodCategory?: string;
	modifiedDate?: string;
	dataSource?: string;
	packageWeight?: string;
	servingSizeUnit?: string;
	servingSize?: number;
	householdServingFullText?: string;
	foodNutrients: FoodNutrient[];
	foodAttributes?: Array<{
		id: number;
		sequenceNumber: number;
		value: string;
	}>;
}

export interface AbridgedFood {
	fdcId: number;
	description: string;
	dataType: string;
	publicationDate: string;
	brandOwner?: string;
	gtinUpc?: string;
	brandName?: string;
	ingredients?: string;
	marketCountry?: string;
	foodCategory?: string;
	modifiedDate?: string;
	dataSource?: string;
	packageWeight?: string;
	servingSizeUnit?: string;
	servingSize?: number;
	householdServingFullText?: string;
	shortDescription?: string;
	tradeChannels?: string[];
	allHighlightFields?: string;
	score?: number;
	microbes?: any[];
	foodNutrients: Array<{
		nutrientId: number;
		nutrientName: string;
		nutrientNumber: string;
		unitName: string;
		value: number;
	}>;
}

export interface SearchResult {
	totalHits: number;
	currentPage: number;
	totalPages: number;
	pageList: number[];
	foods: AbridgedFood[];
	criteria: {
		query: string;
		dataType: string[];
		pageSize: number;
		pageNumber: number;
		sortBy: string;
		sortOrder: string;
	};
	aggregations?: {
		dataType: Record<string, number>;
		nutrients: Record<string, any>;
	};
}

export interface FoodsListResponse {
	currentPage: number;
	totalHits: number;
	totalPages: number;
	foods: AbridgedFood[];
}

/**
 * API request/response types
 */
export type DataType =
	| "Branded"
	| "Foundation"
	| "Survey"
	| "Legacy"
	| "Survey (FNDDS)"
	| "SR Legacy";
export type SortBy =
	| "dataType.keyword"
	| "lowercaseDescription.keyword"
	| "fdcId"
	| "publishedDate";
export type SortOrder = "asc" | "desc";

export interface SearchOptions {
	query: string;
	dataType?: DataType[];
	pageSize?: number;
	pageNumber?: number;
	sortBy?: SortBy;
	sortOrder?: SortOrder;
	brandOwner?: string;
}

export interface ListOptions {
	dataType?: DataType[];
	pageSize?: number;
	pageNumber?: number;
	sortBy?: SortBy;
	sortOrder?: SortOrder;
}

export interface FoodsOptions {
	fdcIds: number[];
	format?: "abridged" | "full";
	nutrients?: number[];
}

/**
 * Error types for better error handling
 */
export class FDCApiError extends Error {
	constructor(
		message: string,
		public status?: number,
		public response?: any,
	) {
		super(message);
		this.name = "FDCApiError";
	}
}

export class FDCRateLimitError extends FDCApiError {
	constructor(
		message = "Rate limit exceeded. API key temporarily blocked for 1 hour.",
	) {
		super(message, 429);
		this.name = "FDCRateLimitError";
	}
}

export class FDCAuthError extends FDCApiError {
	constructor(message = "Invalid API key") {
		super(message, 401);
		this.name = "FDCAuthError";
	}
}

/**
 * Configuration interface
 */
export interface FDCClientConfig {
	apiKey: string;
	baseUrl?: string;
	timeout?: number;
	retryAttempts?: number;
	retryDelay?: number;
}

/**
 * Main FoodData Central API Client Class
 */
export class FDCClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly timeout: number;
	private readonly retryAttempts: number;
	private readonly retryDelay: number;

	constructor(config: FDCClientConfig) {
		if (!config.apiKey || config.apiKey.trim() === "") {
			throw new Error("API key is required");
		}

		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl || "https://api.nal.usda.gov/fdc/v1";
		this.timeout = config.timeout || 10000; // 10 seconds
		this.retryAttempts = config.retryAttempts || 3;
		this.retryDelay = config.retryDelay || 1000; // 1 second
	}

	/**
	 * Makes HTTP requests with error handling, retries, and security
	 */
	private async makeRequest<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		const requestOptions: RequestInit = {
			...options,
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				...options.headers,
			},
		};

		let lastError: Error;

		for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
			try {
				console.log(`Making request to: ${url}`); // Debug log

				const response = await fetch(url, requestOptions);
				clearTimeout(timeoutId);

				if (!response.ok) {
					await this.handleHttpError(response);
				}

				const data = await response.json();
				console.log(`Response received:`, JSON.stringify(data, null, 2)); // Debug log
				return data as T;
			} catch (error) {
				lastError = error as Error;

				// Log the error for debugging
				console.error(`Attempt ${attempt} failed:`, error);

				if (
					error instanceof FDCRateLimitError ||
					error instanceof FDCAuthError
				) {
					throw error; // Don't retry on these errors
				}

				if (attempt < this.retryAttempts) {
					await this.delay(this.retryDelay * attempt);
				}
			}
		}

		clearTimeout(timeoutId);
		throw lastError!;
	}

	/**
	 * Handle HTTP errors with appropriate error types
	 */
	private async handleHttpError(response: Response): Promise<never> {
		let responseText = "";
		try {
			responseText = await response.text();
		} catch (e) {
			responseText = `Could not read response: ${e}`;
		}

		console.error(`HTTP Error ${response.status}: ${responseText}`); // Debug log

		switch (response.status) {
			case 401:
				throw new FDCAuthError("Invalid API key");
			case 429:
				throw new FDCRateLimitError();
			case 404:
				throw new FDCApiError(
					`Resource not found. Check the endpoint URL and FDC ID.`,
					404,
					responseText,
				);
			case 400:
				throw new FDCApiError(
					`Bad request: ${responseText}`,
					400,
					responseText,
				);
			case 500:
				throw new FDCApiError(
					`Server error: ${responseText}`,
					500,
					responseText,
				);
			default:
				throw new FDCApiError(
					`HTTP ${response.status}: ${responseText}`,
					response.status,
					responseText,
				);
		}
	}

	/**
	 * Utility method for delays
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Validates FDC ID format
	 */
	private validateFdcId(fdcId: number): void {
		if (!Number.isInteger(fdcId) || fdcId <= 0) {
			throw new Error(`Invalid FDC ID: ${fdcId}. Must be a positive integer.`);
		}
	}

	/**
	 * Builds query parameters securely
	 */
	private buildQueryParams(params: Record<string, any>): string {
		const urlParams = new URLSearchParams();
		urlParams.set("api_key", this.apiKey);

		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined && value !== null) {
				if (Array.isArray(value)) {
					value.forEach((v) => urlParams.append(key, String(v)));
				} else {
					urlParams.set(key, String(value));
				}
			}
		});

		return urlParams.toString();
	}

	/**
	 * Get details for a single food item by FDC ID
	 */
	async getFood(fdcId: number, nutrients?: number[]): Promise<Food> {
		this.validateFdcId(fdcId);

		const params: Record<string, any> = {};
		if (nutrients && nutrients.length > 0) {
			params.nutrients = nutrients.join(",");
		}

		const queryString = this.buildQueryParams(params);
		const endpoint = `/food/${fdcId}?${queryString}`;

		return this.makeRequest<Food>(endpoint);
	}

	/**
	 * Get details for multiple food items by FDC IDs
	 */
	async getFoods(options: FoodsOptions): Promise<Food[]> {
		if (!options.fdcIds || options.fdcIds.length === 0) {
			throw new Error("At least one FDC ID is required");
		}

		if (options.fdcIds.length > 20) {
			throw new Error("Maximum 20 FDC IDs allowed per request");
		}

		options.fdcIds.forEach((id) => this.validateFdcId(id));

		const body = {
			fdcIds: options.fdcIds,
			format: options.format || "full",
			...(options.nutrients && { nutrients: options.nutrients }),
		};

		const queryString = this.buildQueryParams({});
		const endpoint = `/foods?${queryString}`;

		return this.makeRequest<Food[]>(endpoint, {
			method: "POST",
			body: JSON.stringify(body),
		});
	}

	/**
	 * Get a paginated list of foods
	 * NOTE: The /foods/list endpoint may not be available in all FDC API versions
	 * This is a common source of 404 errors
	 */
	async getFoodsList(
		options: ListOptions = {},
	): Promise<FoodsListResponse | null> {
		try {
			const params: Record<string, any> = {
				pageSize: Math.min(options.pageSize || 50, 200), // Max 200 per API docs
				pageNumber: Math.max(options.pageNumber || 1, 1),
				sortBy: options.sortBy || "fdcId",
				sortOrder: options.sortOrder || "asc",
			};

			// Only add dataType if specified
			if (options.dataType && options.dataType.length > 0) {
				params.dataType = options.dataType;
			}

			const queryString = this.buildQueryParams(params);
			const endpoint = `/foods/list?${queryString}`;

			return await this.makeRequest<FoodsListResponse>(endpoint);
		} catch (error) {
			if (error instanceof FDCApiError && error.status === 404) {
				console.warn(
					"getFoodsList: /foods/list endpoint not available. Use searchFoods instead.",
				);
				return null;
			}
			throw error;
		}
	}

	/**
	 * Search for foods matching query criteria
	 */
	async searchFoods(options: SearchOptions): Promise<SearchResult> {
		if (!options.query || options.query.trim() === "") {
			throw new Error("Search query is required");
		}

		const body: Record<string, any> = {
			query: options.query.trim(),
			pageSize: Math.min(options.pageSize || 50, 200), // Max 200 per API docs
			pageNumber: Math.max(options.pageNumber || 1, 1),
			sortBy: options.sortBy || "dataType.keyword",
			sortOrder: options.sortOrder || "asc",
		};

		// Only add optional parameters if they're specified
		if (options.dataType && options.dataType.length > 0) {
			body.dataType = options.dataType;
		}

		if (options.brandOwner) {
			body.brandOwner = options.brandOwner;
		}

		const queryString = this.buildQueryParams({});
		const endpoint = `/foods/search?${queryString}`;

		return this.makeRequest<SearchResult>(endpoint, {
			method: "POST",
			body: JSON.stringify(body),
		});
	}

	/**
	 * Get nutrient information for a food item (convenience method)
	 */
	async getFoodNutrients(
		fdcId: number,
		nutrientIds?: number[],
	): Promise<FoodNutrient[]> {
		const food = await this.getFood(fdcId, nutrientIds);
		return food.foodNutrients;
	}

	/**
	 * Search for a specific food and return the first match (convenience method)
	 */
	async findFood(
		query: string,
		dataType?: DataType[],
	): Promise<AbridgedFood | null> {
		const results = await this.searchFoods({
			query,
			dataType,
			pageSize: 1,
			pageNumber: 1,
		});

		return results.foods.length > 0 ? results.foods[0] : null;
	}

	/**
	 * Alternative to getFoodsList using search with wildcard
	 * This is more reliable since the search endpoint is always available
	 */
	async getFoodsListAlternative(
		options: ListOptions = {},
	): Promise<SearchResult> {
		// Use a broad search term to get a general list
		const searchOptions: SearchOptions = {
			query: "*", // Wildcard to get all foods
			dataType: options.dataType,
			pageSize: options.pageSize || 50,
			pageNumber: options.pageNumber || 1,
			sortBy: (options.sortBy as any) || "dataType.keyword",
			sortOrder: options.sortOrder || "asc",
		};

		return this.searchFoods(searchOptions);
	}
}

/**
 * Factory function for creating FDC client instances
 */
export function createFDCClient(
	apiKey: string,
	config?: Partial<FDCClientConfig>,
): FDCClient {
	return new FDCClient({
		apiKey,
		...config,
	});
}

// Example usage with improved error handling
async function testFDCClient() {
	const client = createFDCClient(process.env.FOOD_API_KEY || "your-api-key");

	try {
		// Search for foods
		console.log("=== Searching for Cheddar cheese ===");
		const searchResults = await client.searchFoods({
			query: "Cheddar cheese",
			dataType: ["Branded"],
			pageSize: 25,
		});
		console.log("Search Results:", searchResults.foods.length, "foods found");

		// Get specific food details (using FDC ID from search results)
		if (searchResults.foods.length > 0) {
			console.log("\n=== Getting food details ===");
			const firstFood = searchResults.foods[0];
			const food = await client.getFood(firstFood.fdcId);
			console.log("Food Details:", food.description);

			// Get multiple foods
			console.log("\n=== Getting multiple foods ===");
			const foods = await client.getFoods({
				fdcIds: [firstFood.fdcId],
				format: "full",
			});
			console.log("Multiple Foods:", foods.length);
		}

		// Try the foods list endpoint (might not be available)
		console.log("\n=== Trying getFoodsList ===");
		const foodsList = await client.getFoodsList({
			dataType: ["Foundation"],
			pageSize: 50,
			pageNumber: 1,
		});

		if (foodsList) {
			console.log("Foods List:", foodsList.foods?.length, "foods");
		} else {
			console.log("Foods List endpoint not available, trying alternative...");

			// Use alternative method
			console.log("\n=== Using getFoodsListAlternative ===");
			const alternativeList = await client.getFoodsListAlternative({
				dataType: ["Foundation"],
				pageSize: 10,
				pageNumber: 1,
			});
			console.log(
				"Alternative Foods List:",
				alternativeList.foods.length,
				"foods",
			);
		}

		// Find a specific food (convenience method)
		console.log("\n=== Finding apple ===");
		const apple = await client.findFood("apple", ["Foundation"]);
		console.log("Apple:", apple?.description);

		// Get nutrients for a food
		if (apple) {
			console.log("\n=== Getting nutrients ===");
			const nutrients = await client.getFoodNutrients(apple.fdcId, [203, 204]); // protein, fat
			console.log("Nutrients:", nutrients.length);
		}
	} catch (error) {
		if (error instanceof FDCApiError) {
			console.error("FDC API Error:", error.message, "Status:", error.status);
			if (error.response) {
				console.error("Response:", error.response);
			}
		} else {
			console.error("Unexpected error:", error);
		}
	}
}

// Run the test if this file is executed directly
if (typeof require !== "undefined" && require.main === module) {
	testFDCClient();
}
