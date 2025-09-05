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

import { Client } from "@googlemaps/google-maps-services-js";
import crypto from "crypto";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { GeoFirestore } from "geofirestore";
import xlsx from "node-xlsx";

dotenv.config();

const googleMapsClient = new Client({});

interface ServiceAccount {
	projectId: string;
	privateKey: string;
	clientEmail: string;
}

interface CleanedData {
	// id: string;
	source_service: string;
	contact: string | null;
	agency_provider: string;
	website: string | null;
	address: string | null;
	information: string | null;
	hours_of_operation: string;
	coordinates?: admin.firestore.GeoPoint;
}

(async () => {
	try {
		const serviceAccount: ServiceAccount = {
			projectId: process.env.FIREBASE_PROJECT_ID,
			privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
			clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
		};

		admin.initializeApp({
			credential: admin.credential.cert(serviceAccount),
		});

		const firestore = admin.firestore();
		firestore.settings({ ignoreUndefinedProperties: true });
		const geoFirestore = new GeoFirestore(firestore);

		const sheet = xlsx.parse("./resource.xlsx");
		const data = sheet[0].data;
		const headers = data[0].map((header: string) =>
			header.toLowerCase().replace(/\s|\//g, "_"),
		);
		const rows = data.slice(1) as (string | undefined)[][];

		const collectionRef = geoFirestore.collection("search");

		for (const row of rows) {
			const paddedRow =
				row.length >= 8
					? row
					: [...row, ...Array(Math.max(0, 8 - row.length)).fill(undefined)];

			const docData: CleanedData = {
				// id: crypto.randomUUID(),
				source_service: paddedRow[0]?.toString().trim() ?? "Unknown Service",
				contact: paddedRow[1]?.toString().trim() ?? null,
				agency_provider: paddedRow[2]?.toString().trim() ?? "Unknown Provider",
				website: paddedRow[3]?.toString().trim() ?? null,
				address: paddedRow[4]?.toString().trim() ?? null,
				information: paddedRow[6]?.toString().trim() ?? null,
				hours_of_operation:
					paddedRow[7]?.toString().trim() ?? "Hours not specified",
			};

			let latitude = parseFloat(paddedRow[5] as string);
			let longitude = parseFloat(paddedRow[6] as string);
			const address = docData.address;

			if ((isNaN(latitude) || isNaN(longitude)) && address) {
				try {
					const response = await googleMapsClient.geocode({
						params: { address, key: process.env.GOOGLE_MAPS_API_KEY! },
					});
					if (response.data.results.length > 0) {
						const location = response.data.results[0].geometry.location;
						latitude = location.lat;
						longitude = location.lng;
						console.log(`Geocoded: ${address} -> (${latitude}, ${longitude})`);
					}
				} catch (error) {
					console.error(`Geocoding error: ${address}`, error);
				}
			}

			if (isNaN(latitude) || isNaN(longitude)) {
				console.warn(
					"Skipping row due to missing coordinates and failed geocoding:",
					row,
				);
				continue;
			}

			await collectionRef.add({
				...docData,
				coordinates: new admin.firestore.GeoPoint(latitude, longitude),
			});
		}

		console.log("Data successfully added to Firestore with geohashing.");
	} catch (error) {
		console.error("Error:", error);
	}
})();
