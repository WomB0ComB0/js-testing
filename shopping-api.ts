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

import { FetchHttpClient } from "@effect/platform";
import { type } from "arktype";
import { Effect, pipe } from "effect";
import { get } from "./effect-fetch.js";

export const PriceQuote = type({
	source: "'bestbuy'|'ebay'|'walmart'|'serpapi'|'merchant'",
	title: "string",
	url: "string",
	currency: "string",
	price: "number",
	listPrice: "number|undefined",
	availability: "'in_stock'|'out_of_stock'|'limited'|'unknown'",
	gtin: "string|undefined",
	sku: "string|undefined",
	seller: "string|undefined",
});
export type PriceQuote = typeof PriceQuote.infer;

export const PricingRequest = type({
	query: "string",
	gtin: "string|undefined",
	brand: "string|undefined",
	category: "'Food'|'Clothes'|'Drugs'|'Technology'|'News'|'Other'",
	country: "string",
	zip: "string|undefined",
});
export type PricingRequest = typeof PricingRequest.infer;

export interface PricingProvider {
	name: PriceQuote["source"];
	fetchQuotes(input: PricingRequest): Promise<PriceQuote[]>;
}

const SerpApiShoppingResult = type({
	title: "string",
	"link?": "string",
	"product_link?": "string",
	"extracted_price?": "number",
	"price?": "string | number",
	"extracted_old_price?": "number",
	"product_id?": "string | number",
	"source?": "string",
});

const SerpApiResponse = type({
	"shopping_results?": [SerpApiShoppingResult, "[]"],
});

const SERP_BASE = "https://serpapi.com";

export const serpApiProvider: PricingProvider = {
	name: "serpapi",
	async fetchQuotes(input) {
		const effect = pipe(
			get(
				`${SERP_BASE}/search.json`,
				{
					schema: SerpApiResponse,
					retries: 1,
					retryDelay: 500,
					timeout: 10_000,
				},
				{
					engine: "google_shopping",
					q: input.gtin ? input.gtin : input.query,
					api_key: process.env.SERP_API_KEY!,
					gl: (input.country || "US").toLowerCase(),
					hl: "en",
					// tip: you can also try `no_cache: "true"` when debugging results variance
				},
			),
			Effect.provide(FetchHttpClient.layer),
		);

		const payload = await Effect.runPromise(effect);
		const results = Array.isArray(payload.shopping_results)
			? payload.shopping_results
			: [];

		const quotes: PriceQuote[] = results
			.map((r) => {
				const url =
					r.link ??
					r.product_link ??
					(r.product_id != null
						? `https://www.google.com/shopping/product/${String(r.product_id)}`
						: undefined);

				if (!url) return undefined;

				const numericPrice =
					r.extracted_price ??
					(typeof r.price === "number"
						? r.price
						: r.price
							? Number(String(r.price).replace(/[^0-9.]/g, ""))
							: 0);

				const candidate = {
					source: "serpapi" as const,
					title: r.title,
					url,
					currency: "USD",
					price: numericPrice,
					listPrice: r.extracted_old_price,
					availability: "unknown" as const,
					gtin: undefined,
					sku: r.product_id != null ? String(r.product_id) : undefined,
					seller: r.source,
				};

				return PriceQuote.assert(candidate);
			})
			.filter((q): q is PriceQuote => !!q)
			.sort((a, b) => a.price - b.price);

		return quotes;
	},
};

async function _testSerpApi() {
	const req: PricingRequest = {
		query: "Touhou Cirno plush",
		gtin: undefined,
		brand: undefined,
		category: "Clothes",
		country: "US",
		zip: undefined,
	};

	try {
		const quotes = await serpApiProvider.fetchQuotes(req);
		console.log("[serpapi] got", quotes.length, "quotes");
		if (quotes.length) console.table(quotes.slice(0, 5));
		else
			console.log(
				"No shopping_results returned. Try a broader query or check quota.",
			);
	} catch (err) {
		console.error(
			"SerpAPI error:",
			Error.isError(err) ? err.message : String(err),
		);
	}
}

(async () => {
	console.log(await _testSerpApi().catch(console.error));
})();
