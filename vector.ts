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

import fs from "node:fs";
import { Pinecone } from "@pinecone-database/pinecone";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import JSZip from "jszip";
import winston from "winston";

// Load environment variables
dotenv.config();

// Configure logger
const logger = winston.createLogger({
	level: "info",
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json(),
	),
	transports: [
		new winston.transports.File({ filename: "error.log", level: "error" }),
		new winston.transports.Console({
			format: winston.format.simple(),
		}),
	],
});

// Configuration interface
interface Config {
	pineconeApiKey: string;
	pineconeIndexName: string;
	datasetUrl: string;
	batchSize: number;
}

// Load configuration
const config: Config = {
	pineconeApiKey: process.env.PINECONE_API_KEY || "",
	pineconeIndexName: process.env.PINECONE_INDEX_NAME || "hackbrown-features",
	datasetUrl:
		process.env.DATASET_URL ||
		"https://www.kaggle.com/api/v1/datasets/download/tomigelo/spotify-audio-features",
	batchSize: Number.parseInt(process.env.BATCH_SIZE || "100"),
};

// Type definitions
interface SpotifyRecord {
	artist_name: string;
	track_id: string;
	track_name: string;
	acousticness: number;
	danceability: number;
	duration_ms: number;
	energy: number;
	instrumentalness: number;
	key: number;
	liveness: number;
}

interface ProcessedVector {
	id: string;
	values: number[];
	metadata: {
		artist_name: string;
		track_name: string;
	};
}

// Utility to validate numeric values
function isValidNumber(value: number): boolean {
	return !isNaN(value) && isFinite(value);
}

/**
 * Saves a Blob to a file
 * @param blob The Blob to save
 * @param filename The output filename
 */
async function saveBlobToFile(blob: Blob, filename: string): Promise<void> {
	const buffer = await blob.arrayBuffer();
	fs.writeFileSync(filename, Buffer.from(buffer));
	logger.info(`Saved blob to file: ${filename}`);
}

/**
 * Downloads the Spotify dataset from the specified URL
 * @returns Promise<Blob> The downloaded dataset as a blob
 * @throws Error if the download fails
 */
async function downloadSpotifyDataset(): Promise<Blob> {
	logger.info("Starting dataset download");
	try {
		const response = await fetch(config.datasetUrl, {
			method: "GET",
			redirect: "follow",
		});

		if (!response.ok) {
			const headers: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				headers[key] = value;
			});

			logger.error(`HTTP error! status: ${response.status}`, {
				headers,
			});
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const blob = await response.blob();
		logger.info(
			`Downloaded dataset: ${(blob.size / 1024 / 1024).toFixed(2)}MB`,
		);

		// Log the MIME type of the downloaded file
		logger.info(`Downloaded file type: ${blob.type}`);

		// Save the blob to a file for inspection
		await saveBlobToFile(blob, "downloaded_dataset.zip");

		return blob;
	} catch (error) {
		logger.error("Failed to download dataset", {
			error: (error as Error).stack,
		});
		throw new Error("Dataset download failed");
	}
}

/**
 * Extracts CSV content from a zip file
 * @param blob The zip file as a blob
 * @returns Promise<string> The CSV content
 * @throws Error if extraction fails
 */
async function extractDataset(blob: Blob): Promise<string> {
	logger.info("Extracting dataset from zip");
	try {
		const zip = new JSZip();
		const arrayBuffer = await blob.arrayBuffer(); // Convert Blob to ArrayBuffer
		const contents = await zip.loadAsync(arrayBuffer); // Pass ArrayBuffer to JSZip

		// Log all files in the ZIP
		for (const filename of Object.keys(contents.files)) {
			logger.info(`Found file in ZIP: ${filename}`);
		}

		const csvFile = contents.file(/\.csv$/)[0];

		if (!csvFile) {
			throw new Error("No CSV file found in zip archive");
		}

		const csvText = await csvFile.async("text");
		logger.info("Dataset extracted successfully");
		return csvText;
	} catch (error) {
		logger.error("Failed to extract dataset", {
			error: (error as Error).stack,
		});
		throw new Error("Dataset extraction failed");
	}
}

/**
 * Preprocesses the CSV data into vector format
 * @param csvText The raw CSV content
 * @returns Array<ProcessedVector> The processed vectors
 * @throws Error if preprocessing fails
 */
function preprocessData(csvText: string): ProcessedVector[] {
	logger.info("Preprocessing data");
	try {
		const records: SpotifyRecord[] = parse(csvText, {
			columns: true,
			skip_empty_lines: true,
		});

		const vectors = records
			.map((record: SpotifyRecord) => {
				const values = [
					Number(record.acousticness),
					Number(record.danceability),
					Number(record.duration_ms),
					Number(record.energy),
					Number(record.instrumentalness),
					Number(record.key),
					Number(record.liveness),
				];

				// Validate all numeric values
				if (!values.every(isValidNumber)) {
					logger.warn("Invalid numeric values found", {
						track_id: record.track_id,
					});
					return null;
				}

				return {
					id: record.track_id,
					values,
					metadata: {
						artist_name: record.artist_name,
						track_name: record.track_name,
					},
				};
			})
			.filter((vector): vector is ProcessedVector => vector !== null);

		logger.info(`Preprocessed ${vectors.length} valid records`);
		return vectors;
	} catch (error) {
		logger.error("Failed to preprocess data", {
			error: (error as Error).stack,
		});
		throw new Error("Data preprocessing failed");
	}
}

/**
 * Uploads vectors to Pinecone in batches
 * @param vectors The processed vectors to upload
 * @throws Error if upload fails
 */
async function uploadToPinecone(vectors: ProcessedVector[]): Promise<void> {
	logger.info("Initializing Pinecone upload");
	try {
		if (!config.pineconeApiKey) {
			throw new Error("Pinecone API key not configured");
		}

		const pc = new Pinecone({
			apiKey: config.pineconeApiKey,
		});

		const index = pc.index(config.pineconeIndexName);

		// Upload in batches
		for (let i = 0; i < vectors.length; i += config.batchSize) {
			const batch = vectors.slice(i, i + config.batchSize);
			await index.upsert(batch);
			logger.info(
				`Uploaded batch ${Math.floor(i / config.batchSize) + 1}/${Math.ceil(vectors.length / config.batchSize)}`,
			);
		}

		logger.info(`Successfully uploaded ${vectors.length} vectors to Pinecone`);
	} catch (error) {
		logger.error("Failed to upload to Pinecone", {
			error: (error as Error).stack,
		});
		throw new Error("Pinecone upload failed");
	}
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
	logger.info("Starting ETL pipeline");
	try {
		const blob = await downloadSpotifyDataset();
		const csvText = await extractDataset(blob);
		const vectors = preprocessData(csvText);
		await uploadToPinecone(vectors);
		logger.info("ETL pipeline completed successfully");
	} catch (error) {
		logger.error("ETL pipeline failed", { error: (error as Error).stack });
		process.exit(1);
	}
}

if (require.main === module) {
	main().catch(logger.error);
}

export {
	downloadSpotifyDataset,
	extractDataset,
	preprocessData,
	uploadToPinecone,
	main,
	type SpotifyRecord,
	type ProcessedVector,
};
