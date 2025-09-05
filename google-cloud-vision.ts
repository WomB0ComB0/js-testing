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

import fs from "node:fs/promises";
import vision from "@google-cloud/vision";
import { type } from "arktype";

const WebDetection = type({
	webEntities: [
		{ description: "string|undefined", score: "number|undefined" },
		"[]",
	],
	fullMatchingImages: [{ url: "string" }, "[]"],
	partialMatchingImages: [{ url: "string" }, "[]"],
	pagesWithMatchingImages: [
		{ url: "string", pageTitle: "string|undefined" },
		"[]",
	],
});
type WebDetection = typeof WebDetection.infer;

const client = new vision.ImageAnnotatorClient({
	keyFilename: "./credentials.json",
}); // requires GOOGLE_APPLICATION_CREDENTIALS

export async function reverseImageSearch(
	filePath: string,
): Promise<WebDetection> {
	const [res] = await client.webDetection({
		image: { content: await fs.readFile(filePath) },
	});
	const web = res.webDetection ?? {};

	const data = WebDetection.assert({
		webEntities: (web.webEntities ?? []).map((e) => ({
			description: e.description,
			score: e.score,
		})),
		fullMatchingImages: (web.fullMatchingImages ?? []).map((i) => ({
			url: i.url ?? "",
		})),
		partialMatchingImages: (web.partialMatchingImages ?? []).map((i) => ({
			url: i.url ?? "",
		})),
		pagesWithMatchingImages: (web.pagesWithMatchingImages ?? []).map((p) => ({
			url: p.url ?? "",
			pageTitle: p.pageTitle,
		})),
	});

	return data;
}

(async () => console.log(await reverseImageSearch('./test_image.jpg')))()
