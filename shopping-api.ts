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

import { FetchHttpClient } from "@effect/platform";
import { Effect, pipe } from "effect";
import { type as arktype } from "arktype";
import { get } from "./effect-fetch.js";

export const PriceQuote = arktype({
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

export const PricingRequest = arktype({
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

const SerpApiShoppingResult = arktype({
  title: "string",
  "link?": "string",
  "product_link?": "string",
  "extracted_price?": "number",
  "price?": "string | number",
  "extracted_old_price?": "number",
  "product_id?": "string | number",
  "source?": "string",
});

const SerpApiResponse = arktype({
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
        }
      ),
      Effect.provide(FetchHttpClient.layer)
    );

    const payload = await Effect.runPromise(effect);
    const results = Array.isArray(payload.shopping_results) ? payload.shopping_results : [];

    const quotes: PriceQuote[] = results
      .map((r) => {
        const url =
          r.link ??
          r.product_link ??
          (r.product_id != null ? `https://www.google.com/shopping/product/${String(r.product_id)}` : undefined);

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
    else console.log("No shopping_results returned. Try a broader query or check quota.");
  } catch (err) {
    console.error("SerpAPI error:", err instanceof Error ? err.message : String(err));
  }
}

(async () => { console.log(await _testSerpApi().catch(console.error)); })();
