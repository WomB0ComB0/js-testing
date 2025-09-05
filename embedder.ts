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

import type { PineconeRecord } from "@pinecone-database/pinecone";
import type { FeatureExtractionPipeline } from "@xenova/transformers";
import { v4 as uuidv4 } from "uuid";

export interface SpotifyGenres {
	genres: string[];
	subgenres: string[];
	genres_map: {
		Pop: string[];
		Electronic: string[];
		"Hip Hop": string[];
		"R&B": string[];
		Latin: string[];
		Rock: string[];
		Metal: string[];
		Country: string[];
		"Folk/Acoustic": string[];
		Classical: string[];
		Jazz: string[];
		Blues: string[];
		"Easy listening": string[];
		"New age": string[];
		"World/Traditional": string[];
	};
}

export const sliceIntoChunks = <T>(arr: T[], chunkSize: number) => {
	return Array.from({ length: Math.ceil(arr.length / chunkSize) }, (_, i) =>
		arr.slice(i * chunkSize, (i + 1) * chunkSize),
	);
};

class Embedder {
	private pipe: FeatureExtractionPipeline | null = null;

	async init() {
		console.log("Initializing embedder pipeline...");
		const { pipeline } = await import("@xenova/transformers");
		this.pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
		console.log("Pipeline initialized successfully");
	}

	async embed(text: string, genres: SpotifyGenres[]): Promise<PineconeRecord> {
		console.log("Starting embedding process for text:", text);

		if (!this.pipe) {
			console.error("Pipeline not initialized");
			throw new Error("Pipeline not initialized. Call init() first.");
		}

		console.log("Generating embeddings...");
		const result = await this.pipe(text, { pooling: "mean", normalize: true });
		console.log("Raw embedding result generated");

		const embedding = Array.from(result.data);
		console.log("Generated embedding:", embedding);

		const record = {
			id: uuidv4(),
			metadata: {
				text,
				genres: genres?.map((genre) => JSON.stringify(genre)) ?? [],
			},
			values: embedding,
		};
		console.log("Created Pinecone record:", record);

		return record;
	}
}

const embedder = new Embedder();
console.log("Embedder instance created");
export { embedder };
