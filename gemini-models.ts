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

import { GoogleGenAI, type Model } from "@google/genai";

/**
 * Model parameters interface
 */
export interface ModelParams {
	model: string;
}

/**
 * Fetches the latest free Gemini model dynamically
 * @param {string} apiKey - Your Google AI API key
 * @returns {Promise<ModelParams>} The latest free model parameters
 */
export async function getLatestFreeModel(apiKey: string): Promise<ModelParams> {
	try {
		const genAI = new GoogleGenAI({ apiKey });

		// Fetch all available models
		const modelsPager = (await genAI.models.list());

		// Iterate through all pages to get all models
		const allModels: Model[] = [];
		for await (const model of modelsPager) allModels.push(model);

		// Filter for free models (typically Flash models)
		// Prioritize: Flash-8B > Flash-2.0 > Flash-1.5
		const freeModels = allModels.filter(
			(model: Model) =>
				model.name?.includes("flash") && !model.name?.includes("pro"),
		);

		// Sort by version/name to get the latest
		freeModels.sort((a: Model, b: Model) => {
			// Extract version numbers and compare
			const extractVersion = (name?: string) => {
				if (!name) return 0;
				const match = name.match(/(\d+\.?\d*)/g);
				return match ? parseFloat(match.join(".")) : 0;
			};
			return extractVersion(b.name) - extractVersion(a.name);
		});

		if (freeModels.length === 0) {
			// Fallback to known free model
			console.warn("No free models found, using fallback");
			return { model: "gemini-1.5-flash" };
		}

		// Return the latest free model (remove 'models/' prefix)
		const modelName =
			freeModels[0].name?.replace("models/", "") || "gemini-1.5-flash";
		console.log(`Selected model: ${modelName}`);

		return { model: modelName };
	} catch (error) {
		console.error("Error fetching models:", error);
		// Fallback to known free model
		return { model: "gemini-1.5-flash" };
	}
}

/**
 * Cached model params with expiration
 */
let cachedModel: { params: ModelParams; timestamp: number } | null = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Gets the latest free model with caching (24-hour cache)
 * @param {string} apiKey - Your Google AI API key
 * @param {boolean} forceRefresh - Force refresh the cache
 * @returns {Promise<ModelParams>} The latest free model parameters
 */
export async function getCachedFreeModel(
	apiKey: string,
	forceRefresh: boolean = false,
): Promise<ModelParams> {
	const now = Date.now();

	// Return cached model if valid and not forcing refresh
	if (
		!forceRefresh &&
		cachedModel &&
		now - cachedModel.timestamp < CACHE_DURATION
	) {
		console.log("Using cached model:", cachedModel.params.model);
		return cachedModel.params;
	}

	// Fetch new model
	const params = (await getLatestFreeModel(apiKey));

	// Update cache
	cachedModel = { params, timestamp: now };

	return params;
}

/**
 * Alternative: Static export with periodic updates
 * This can be used as a drop-in replacement for your current export
 */
export const gemini_model: ModelParams = {
	model: "gemini-1.5-flash-8b" as const satisfies ModelParams["model"],
};

(async () => {
	const modelParams = await getCachedFreeModel(
		process.env.GEMINI_API_KEY ||
			(() => {
				console.error("GEMINI_API_KEY is not set");
				process.exit(1);
			})(),
	);
	const genAI = new GoogleGenAI({
		apiKey:
			process.env.GEMINI_API_KEY ||
			(() => {
				console.error("GEMINI_API_KEY is not set");
				process.exit(1);
			})(),
	});
	const model = await genAI.models.get({ model: modelParams.model });
	console.log(model);
})();
