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

/**
 * @fileoverview A comprehensive service for interacting with various Google Maps APIs.
 * This module provides a unified interface for geocoding, places search, directions,
 * distance calculations, and more Google Maps Platform services.
 *
 * Features:
 * - Geocoding: Convert addresses to coordinates and vice versa
 * - Places: Search for places, get place details, and autocomplete predictions
 * - Directions: Get directions between locations with waypoints and travel modes
 * - Distance Matrix: Calculate distances and travel times between multiple origins/destinations
 * - Street View: Get Street View images and metadata for locations
 * - Elevation: Get elevation data for locations or paths
 * - Time Zones: Get timezone information for coordinates
 * - Geolocation: Get current location using various data sources
 *
 * @module GoogleMapsService
 * @requires axios
 * @requires dotenv
 * @requires @google-cloud/firestore
 */

import { GeoPoint } from "@google-cloud/firestore";
import axios from "axios";
import { $ } from "bun";
import dotenv from "dotenv";

dotenv.config();

/**
 * Interface representing a geocoding result from the Google Maps Geocoding API
 * @interface GeocodingResult
 * @property {string} formatted_address - The human-readable address of the location
 * @property {Object} geometry - The geocoded geometry information
 * @property {Object} geometry.location - The latitude/longitude coordinates
 * @property {number} geometry.location.lat - The latitude coordinate
 * @property {number} geometry.location.lng - The longitude coordinate
 * @property {string} place_id - Unique identifier of the place
 */
interface GeocodingResult {
	formatted_address: string;
	geometry: {
		location: {
			lat: number;
			lng: number;
		};
	};
	place_id: string;
}

/**
 * Interface representing a place search result from the Google Places API
 * @interface PlaceSearchResult
 * @property {string} name - Name of the place
 * @property {string} formatted_address - Formatted address of the place
 * @property {string} place_id - Unique identifier of the place
 * @property {Object} geometry - Geographic information about the place
 * @property {Object} geometry.location - The coordinates of the place
 * @property {number} geometry.location.lat - The latitude coordinate
 * @property {number} geometry.location.lng - The longitude coordinate
 */
interface PlaceSearchResult {
	name: string;
	formatted_address: string;
	place_id: string;
	geometry: {
		location: {
			lat: number;
			lng: number;
		};
	};
}

/**
 * Interface representing detailed place information from the Google Places API
 * @interface PlaceDetails
 * @property {string} name - Name of the place
 * @property {string} [formatted_phone_number] - Formatted phone number if available
 * @property {string} [website] - Website URL if available
 * @property {Object} [opening_hours] - Opening hours information if available
 * @property {string[]} [opening_hours.weekday_text] - Text representation of opening hours for each day
 * @property {boolean} [opening_hours.open_now] - Whether the place is currently open
 */
interface PlaceDetails {
	name: string;
	formatted_phone_number?: string;
	website?: string;
	opening_hours?: {
		weekday_text: string[];
		open_now: boolean;
	};
}

/**
 * Interface representing a distance matrix result from the Google Distance Matrix API
 * @interface DistanceMatrixResult
 * @property {string[]} origin_addresses - Array of origin addresses
 * @property {string[]} destination_addresses - Array of destination addresses
 * @property {Object[]} rows - Matrix rows containing distance/duration elements
 * @property {Object[]} rows.elements - Elements containing distance and duration info
 * @property {Object} rows.elements.distance - Distance information
 * @property {string} rows.elements.distance.text - Human-readable distance
 * @property {number} rows.elements.distance.value - Distance in meters
 * @property {Object} rows.elements.duration - Duration information
 * @property {string} rows.elements.duration.text - Human-readable duration
 * @property {number} rows.elements.duration.value - Duration in seconds
 * @property {string} rows.elements.status - Status of this matrix element
 * @property {string} status - Overall status of the API request
 */
interface DistanceMatrixResult {
	origin_addresses: string[];
	destination_addresses: string[];
	rows: {
		elements: {
			distance: {
				text: string;
				value: number;
			};
			duration: {
				text: string;
				value: number;
			};
			status: string;
		}[];
	}[];
	status: string;
}

/**
 * Interface representing directions result from the Google Directions API
 * @interface DirectionsResult
 * @property {Object[]} routes - Available routes from origin to destination
 * @property {string} routes.summary - Brief description of the route
 * @property {Object[]} routes.legs - Individual legs of the journey
 * @property {Object} routes.legs.distance - Distance information for this leg
 * @property {string} routes.legs.distance.text - Human-readable distance
 * @property {number} routes.legs.distance.value - Distance in meters
 * @property {Object} routes.legs.duration - Duration information for this leg
 * @property {string} routes.legs.duration.text - Human-readable duration
 * @property {number} routes.legs.duration.value - Duration in seconds
 * @property {Object[]} routes.legs.steps - Turn-by-turn navigation steps
 * @property {string} routes.legs.steps.html_instructions - HTML-formatted instructions
 * @property {Object} routes.legs.steps.distance - Distance for this step
 * @property {Object} routes.legs.steps.duration - Duration for this step
 * @property {string} status - Status of the API request
 */
interface DirectionsResult {
	routes: {
		summary: string;
		legs: {
			distance: {
				text: string;
				value: number;
			};
			duration: {
				text: string;
				value: number;
			};
			steps: {
				html_instructions: string;
				distance: {
					text: string;
					value: number;
				};
				duration: {
					text: string;
					value: number;
				};
			}[];
		}[];
	}[];
	status: string;
}

/**
 * Interface representing a place autocomplete prediction
 * @interface AutocompletePrediction
 * @property {string} description - Full description of the place
 * @property {string} place_id - Unique identifier of the place
 * @property {Object} structured_formatting - Formatted text structure
 * @property {string} structured_formatting.main_text - Primary text description
 * @property {string} structured_formatting.secondary_text - Secondary text description
 * @property {Object[]} terms - Individual terms in the description
 * @property {number} terms.offset - Offset of the term in the description
 * @property {string} terms.value - The term text
 * @property {string[]} types - Types of the place (e.g., 'establishment', 'geocode')
 */
interface AutocompletePrediction {
	description: string;
	place_id: string;
	structured_formatting: {
		main_text: string;
		secondary_text: string;
	};
	terms: {
		offset: number;
		value: string;
	}[];
	types: string[];
}

/**
 * Interface representing a geolocation result
 * @interface GeolocationResult
 * @property {Object} location - Geographic coordinates
 * @property {number} location.lat - Latitude coordinate
 * @property {number} location.lng - Longitude coordinate
 * @property {number} accuracy - Accuracy radius in meters
 */
interface GeolocationResult {
	location: {
		lat: number;
		lng: number;
	};
	accuracy: number;
}

/**
 * Interface representing a Street View metadata result
 * @interface StreetViewResult
 * @property {string} status - Status of the request
 * @property {string} [copyright] - Copyright information
 * @property {string} [date] - Date the image was captured
 * @property {Object} [location] - Location where the image was captured
 * @property {number} location.lat - Latitude coordinate
 * @property {number} location.lng - Longitude coordinate
 * @property {string} [pano_id] - Unique panorama ID
 */
interface StreetViewResult {
	status: string;
	copyright?: string;
	date?: string;
	location?: {
		lat: number;
		lng: number;
	};
	pano_id?: string;
}

/**
 * Interface representing an elevation result
 * @interface ElevationResult
 * @property {number} elevation - Elevation in meters
 * @property {Object} location - Location coordinates
 * @property {number} location.lat - Latitude coordinate
 * @property {number} location.lng - Longitude coordinate
 * @property {number} resolution - Resolution of the elevation measurement
 */
interface ElevationResult {
	elevation: number;
	location: {
		lat: number;
		lng: number;
	};
	resolution: number;
}

/**
 * Interface representing a timezone result
 * @interface TimeZoneResult
 * @property {number} dstOffset - Daylight savings offset in seconds
 * @property {number} rawOffset - Raw offset from UTC in seconds
 * @property {string} status - Status of the request
 * @property {string} timeZoneId - IANA timezone ID
 * @property {string} timeZoneName - Long form name of the timezone
 */
interface TimeZoneResult {
	dstOffset: number;
	rawOffset: number;
	status: string;
	timeZoneId: string;
	timeZoneName: string;
}

/**
 * A comprehensive service class for interacting with Google Maps Platform APIs.
 * Provides methods for geocoding, places search, directions, distance calculations,
 * and more Google Maps services.
 *
 * @class GoogleMapsService
 * @example
 * ```typescript
 * const mapsService = new GoogleMapsService('your-api-key');
 *
 * // Geocode an address
 * const location = await mapsService.geocodeAddress('1600 Amphitheatre Parkway, Mountain View, CA');
 *
 * // Search for places
 * const places = await mapsService.searchPlaces('restaurants in Mountain View');
 *
 * // Get directions
 * const directions = await mapsService.getDirections('Mountain View, CA', 'San Francisco, CA');
 * ```
 */
class GoogleMapsService {
	private readonly apiKey: string;
	private readonly geocodingBaseUrl =
		"https://maps.googleapis.com/maps/api/geocode/json";
	private readonly placesBaseUrl =
		"https://maps.googleapis.com/maps/api/place/textsearch/json";
	private readonly placeDetailsBaseUrl =
		"https://maps.googleapis.com/maps/api/place/details/json";
	private readonly nearbySearchBaseUrl =
		"https://maps.googleapis.com/maps/api/place/nearbysearch/json";
	private readonly distanceMatrixBaseUrl =
		"https://maps.googleapis.com/maps/api/distancematrix/json";
	private readonly directionsBaseUrl =
		"https://maps.googleapis.com/maps/api/directions/json";
	private readonly placesAutocompleteBaseUrl =
		"https://maps.googleapis.com/maps/api/place/autocomplete/json";
	private readonly geolocationBaseUrl =
		"https://www.googleapis.com/geolocation/v1/geolocate";
	private readonly streetViewBaseUrl =
		"https://maps.googleapis.com/maps/api/streetview";
	private readonly streetViewMetadataBaseUrl =
		"https://maps.googleapis.com/maps/api/streetview/metadata";
	private readonly elevationBaseUrl =
		"https://maps.googleapis.com/maps/api/elevation/json";
	private readonly timeZoneBaseUrl =
		"https://maps.googleapis.com/maps/api/timezone/json";

	/**
	 * Creates a new GoogleMapsService instance
	 * @param {string} apiKey - Your Google Maps API key
	 * @throws {Error} If API key is not provided
	 * @example
	 * ```typescript
	 * const mapsService = new GoogleMapsService('your-api-key');
	 * ```
	 */
	constructor(apiKey: string) {
		if (!apiKey) {
			throw new Error("Google Maps API key is required");
		}
		this.apiKey = apiKey;
	}

	/**
	 * Geocodes an address to coordinates
	 * @param {string} address - The address to geocode
	 * @returns {Promise<GeocodingResult | null>} Promise resolving to geocoding result or null if not found
	 * @throws {Error} If geocoding fails
	 * @example
	 * ```typescript
	 * const result = await mapsService.geocodeAddress('1600 Amphitheatre Parkway, Mountain View, CA');
	 * console.log(result?.geometry.location); // { lat: 37.4224764, lng: -122.0842499 }
	 * ```
	 */
	async geocodeAddress(address: string): Promise<GeocodingResult | null> {
		try {
			const response = await axios.get(this.geocodingBaseUrl, {
				params: {
					address,
					key: this.apiKey,
				},
			});

			if (response.data.status !== "OK") {
				console.error(`Geocoding failed with status: ${response.data.status}`);
				return null;
			}

			return response.data.results?.[0] || null;
		} catch (error) {
			console.error("Geocoding Error:", error);
			throw new Error(`Failed to geocode address: ${(error as Error).message}`);
		}
	}

	/**
	 * Searches for places matching a text query
	 * @param {string} query - The search query
	 * @returns {Promise<PlaceSearchResult | null>} Promise resolving to place result or null if not found
	 * @throws {Error} If place search fails
	 * @example
	 * ```typescript
	 * const result = await mapsService.searchPlaces('restaurants in Mountain View');
	 * console.log(result?.name); // Name of the first matching restaurant
	 * ```
	 */
	async searchPlaces(query: string): Promise<PlaceSearchResult | null> {
		try {
			const response = await axios.get(this.placesBaseUrl, {
				params: {
					query,
					key: this.apiKey,
				},
			});

			if (response.data.status !== "OK") {
				console.error(
					`Places search failed with status: ${response.data.status}`,
				);
				return null;
			}

			return response.data.results?.[0] || null;
		} catch (error) {
			console.error("Places Search Error:", error);
			throw new Error(`Failed to search places: ${(error as Error).message}`);
		}
	}

	/**
	 * Gets detailed information about a place near specified coordinates
	 * @param {GeoPoint} coordinates - The coordinates to search near
	 * @returns {Promise<PlaceDetails | null>} Promise resolving to place details or null if not found
	 * @example
	 * ```typescript
	 * const googleHQ = new GeoPoint(37.422, -122.084);
	 * const details = await mapsService.getPlaceDetails(googleHQ);
	 * console.log(details?.name); // Name of the place at those coordinates
	 * ```
	 */
	async getPlaceDetails(coordinates: GeoPoint): Promise<PlaceDetails | null> {
		try {
			// Step 1: Find nearby places
			const nearbyUrl = new URL(this.nearbySearchBaseUrl);
			nearbyUrl.searchParams.append(
				"location",
				`${coordinates.latitude},${coordinates.longitude}`,
			);
			nearbyUrl.searchParams.append("radius", "50");
			nearbyUrl.searchParams.append("key", this.apiKey);

			const nearbyResponse = await fetch(nearbyUrl.toString());
			const nearbyData = await nearbyResponse.json();

			if (nearbyData.status !== "OK" || !nearbyData.results?.length) {
				console.log("No nearby places found");
				return null;
			}

			// Step 2: Get details for the first place
			const placeId = nearbyData.results[0].place_id;
			const detailsUrl = new URL(this.placeDetailsBaseUrl);
			detailsUrl.searchParams.append("place_id", placeId);
			detailsUrl.searchParams.append(
				"fields",
				"name,formatted_phone_number,website,opening_hours",
			);
			detailsUrl.searchParams.append("key", this.apiKey);

			const detailsResponse = await fetch(detailsUrl.toString());
			const detailsData = await detailsResponse.json();

			if (detailsData.status !== "OK") {
				console.error(
					`Place details failed with status: ${detailsData.status}`,
				);
				return null;
			}

			return detailsData.result;
		} catch (error) {
			console.error("Place details error:", error);
			return null;
		}
	}

	/**
	 * Calculates distances and travel times between origins and destinations
	 * @param {string | string[] | { lat: number; lng: number }[]} origins - Starting point(s)
	 * @param {string | string[] | { lat: number; lng: number }[]} destinations - Destination point(s)
	 * @param {Object} [options] - Additional options for the request
	 * @param {'driving' | 'walking' | 'bicycling' | 'transit'} [options.mode='driving'] - Travel mode
	 * @param {'tolls' | 'highways' | 'ferries'} [options.avoid] - Features to avoid
	 * @param {'metric' | 'imperial'} [options.units='metric'] - Unit system
	 * @param {number | 'now'} [options.departure_time] - Departure time
	 * @param {'best_guess' | 'pessimistic' | 'optimistic'} [options.traffic_model] - Traffic model
	 * @returns {Promise<DistanceMatrixResult | null>} Promise resolving to distance matrix result or null if failed
	 * @throws {Error} If distance matrix calculation fails
	 * @example
	 * ```typescript
	 * const result = await mapsService.getDistanceMatrix(
	 *   'Mountain View, CA',
	 *   'San Francisco, CA',
	 *   { mode: 'driving', units: 'imperial' }
	 * );
	 * console.log(result?.rows[0].elements[0].distance.text); // "30.5 mi"
	 * ```
	 */
	async getDistanceMatrix(
		origins: string | string[] | { lat: number; lng: number }[],
		destinations: string | string[] | { lat: number; lng: number }[],
		options: {
			mode?: "driving" | "walking" | "bicycling" | "transit";
			avoid?: "tolls" | "highways" | "ferries";
			units?: "metric" | "imperial";
			departure_time?: number | "now";
			traffic_model?: "best_guess" | "pessimistic" | "optimistic";
		} = {},
	): Promise<DistanceMatrixResult | null> {
		try {
			// Convert origins and destinations to arrays if they are not already
			const originsArray = Array.isArray(origins) ? origins : [origins];
			const destinationsArray = Array.isArray(destinations)
				? destinations
				: [destinations];

			// Format locations as strings
			const originsStr = originsArray
				.map((origin) => {
					if (typeof origin === "string") return origin;
					return `${origin.lat},${origin.lng}`;
				})
				.join("|");

			const destinationsStr = destinationsArray
				.map((destination) => {
					if (typeof destination === "string") return destination;
					return `${destination.lat},${destination.lng}`;
				})
				.join("|");

			const response = await axios.get(this.distanceMatrixBaseUrl, {
				params: {
					origins: originsStr,
					destinations: destinationsStr,
					mode: options.mode || "driving",
					avoid: options.avoid,
					units: options.units || "metric",
					departure_time: options.departure_time,
					traffic_model: options.traffic_model,
					key: this.apiKey,
				},
			});

			if (response.data.status !== "OK") {
				console.error(
					`Distance Matrix API failed with status: ${response.data.status}`,
				);
				return null;
			}

			return response.data;
		} catch (error) {
			console.error("Distance Matrix API Error:", error);
			throw new Error(
				`Failed to get distance matrix: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Gets directions between two points
	 * @param {string | { lat: number; lng: number }} origin - Starting point
	 * @param {string | { lat: number; lng: number }} destination - Ending point
	 * @param {Object} [options] - Additional options for the request
	 * @param {'driving' | 'walking' | 'bicycling' | 'transit'} [options.mode='driving'] - Travel mode
	 * @param {(string | { lat: number; lng: number })[]} [options.waypoints] - Intermediate waypoints
	 * @param {'tolls' | 'highways' | 'ferries'} [options.avoid] - Features to avoid
	 * @param {'metric' | 'imperial'} [options.units='metric'] - Unit system
	 * @param {number | 'now'} [options.departure_time] - Departure time
	 * @param {'best_guess' | 'pessimistic' | 'optimistic'} [options.traffic_model] - Traffic model
	 * @param {boolean} [options.alternatives] - Whether to return alternative routes
	 * @returns {Promise<DirectionsResult | null>} Promise resolving to directions result or null if failed
	 * @throws {Error} If directions request fails
	 * @example
	 * ```typescript
	 * const result = await mapsService.getDirections(
	 *   'Mountain View, CA',
	 *   'San Francisco, CA',
	 *   {
	 *     mode: 'driving',
	 *     waypoints: ['Palo Alto, CA'],
	 *     alternatives: true
	 *   }
	 * );
	 * console.log(result?.routes[0].summary); // Route summary
	 * ```
	 */
	async getDirections(
		origin: string | { lat: number; lng: number },
		destination: string | { lat: number; lng: number },
		options: {
			mode?: "driving" | "walking" | "bicycling" | "transit";
			waypoints?: (string | { lat: number; lng: number })[];
			avoid?: "tolls" | "highways" | "ferries";
			units?: "metric" | "imperial";
			departure_time?: number | "now";
			traffic_model?: "best_guess" | "pessimistic" | "optimistic";
			alternatives?: boolean;
		} = {},
	): Promise<DirectionsResult | null> {
		try {
			// Format origin and destination
			const originStr =
				typeof origin === "string" ? origin : `${origin.lat},${origin.lng}`;
			const destinationStr =
				typeof destination === "string"
					? destination
					: `${destination.lat},${destination.lng}`;

			// Format waypoints if provided
			let waypointsStr;
			if (options.waypoints && options.waypoints.length > 0) {
				waypointsStr = options.waypoints
					.map((wp) => {
						if (typeof wp === "string") return wp;
						return `${wp.lat},${wp.lng}`;
					})
					.join("|");
			}

			const response = await axios.get(this.directionsBaseUrl, {
				params: {
					origin: originStr,
					destination: destinationStr,
					waypoints: waypointsStr,
					mode: options.mode || "driving",
					avoid: options.avoid,
					units: options.units || "metric",
					departure_time: options.departure_time,
					traffic_model: options.traffic_model,
					alternatives: options.alternatives,
					key: this.apiKey,
				},
			});

			if (response.data.status !== "OK") {
				console.error(
					`Directions API failed with status: ${response.data.status}`,
				);
				return null;
			}

			return response.data;
		} catch (error) {
			console.error("Directions API Error:", error);
			throw new Error(`Failed to get directions: ${(error as Error).message}`);
		}
	}

	/**
	 * Generates a script tag for including the Maps JavaScript API
	 * @param {Object} [options] - Configuration options for the script tag
	 * @param {string[]} [options.libraries] - Additional libraries to load
	 * @param {string} [options.callback] - Callback function name
	 * @param {string} [options.version] - API version
	 * @param {string} [options.language] - Language code
	 * @param {string} [options.region] - Region code
	 * @returns {string} HTML script tag as a string
	 * @example
	 * ```typescript
	 * const scriptTag = mapsService.getMapsJavaScriptTag({
	 *   libraries: ['places', 'geometry'],
	 *   callback: 'initMap',
	 *   language: 'en'
	 * });
	 * // <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places,geometry&callback=initMap&language=en" async defer></script>
	 * ```
	 */
	getMapsJavaScriptTag(
		options: {
			libraries?: string[];
			callback?: string;
			version?: string;
			language?: string;
			region?: string;
		} = {},
	): string {
		const libraries = options.libraries
			? `&libraries=${options.libraries.join(",")}`
			: "";
		const callback = options.callback ? `&callback=${options.callback}` : "";
		const version = options.version ? `&v=${options.version}` : "";
		const language = options.language ? `&language=${options.language}` : "";
		const region = options.region ? `&region=${options.region}` : "";

		return `<script src="https://maps.googleapis.com/maps/api/js?key=${this.apiKey}${libraries}${callback}${version}${language}${region}" async defer></script>`;
	}

	/**
	 * Gets place autocomplete predictions for a search input
	 * @param {string} input - The search input
	 * @param {Object} [options] - Additional options for the request
	 * @param {string} [options.sessiontoken] - Session token for billing
	 * @param {number} [options.offset] - Offset in the input string
	 * @param {{ lat: number; lng: number }} [options.location] - Location bias point
	 * @param {number} [options.radius] - Location bias radius
	 * @param {string} [options.types] - Types of predictions to return
	 * @param {{ [key: string]: string }} [options.components] - Component restrictions
	 * @param {boolean} [options.strictbounds] - Whether to return only results within bounds
	 * @param {string} [options.language] - Language for results
	 * @returns {Promise<AutocompletePrediction[] | null>} Promise resolving to array of predictions or null if failed
	 * @throws {Error} If autocomplete request fails
	 * @example
	 * ```typescript
	 * const predictions = await mapsService.getPlacesAutocomplete('Googl', {
	 *   location: { lat: 37.4224764, lng: -122.0842499 },
	 *   radius: 5000,
	 *   types: 'establishment'
	 * });
	 * console.log(predictions?.[0].description); // First prediction
	 * ```
	 */
	async getPlacesAutocomplete(
		input: string,
		options: {
			sessiontoken?: string;
			offset?: number;
			location?: { lat: number; lng: number };
			radius?: number;
			types?: string;
			components?: { [key: string]: string };
			strictbounds?: boolean;
			language?: string;
		} = {},
	): Promise<AutocompletePrediction[] | null> {
		try {
			// Format location if provided
			let locationStr;
			if (options.location) {
				locationStr = `${options.location.lat},${options.location.lng}`;
			}

			// Format components if provided
			let componentsStr;
			if (options.components) {
				componentsStr = Object.entries(options.components)
					.map(([key, value]) => `${key}:${value}`)
					.join("|");
			}

			const response = await axios.get(this.placesAutocompleteBaseUrl, {
				params: {
					input,
					sessiontoken: options.sessiontoken,
					offset: options.offset,
					location: locationStr,
					radius: options.radius,
					types: options.types,
					components: componentsStr,
					strictbounds: options.strictbounds,
					language: options.language,
					key: this.apiKey,
				},
			});

			if (response.data.status !== "OK") {
				console.error(
					`Places Autocomplete API failed with status: ${response.data.status}`,
				);
				return null;
			}

			return response.data.predictions;
		} catch (error) {
			console.error("Places Autocomplete API Error:", error);
			throw new Error(
				`Failed to get autocomplete predictions: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Gets the current location using the Geolocation API
	 * @param {Object} [options] - Additional options for the request
	 * @param {boolean} [options.considerIp] - Whether to consider IP address
	 * @param {any[]} [options.cellTowers] - Cell tower information
	 * @param {any[]} [options.wifiAccessPoints] - WiFi access point information
	 * @returns {Promise<GeolocationResult | null>} Promise resolving to geolocation result or null if failed
	 * @throws {Error} If geolocation request fails
	 * @example
	 * ```typescript
	 * const location = await mapsService.getCurrentLocation({ considerIp: true });
	 * console.log(location?.location); // { lat: 37.4224764, lng: -122.0842499 }
	 * ```
	 */
	async getCurrentLocation(
		options: {
			considerIp?: boolean;
			cellTowers?: any[];
			wifiAccessPoints?: any[];
		} = {},
	): Promise<GeolocationResult | null> {
		try {
			const payload: any = {};

			if (options.considerIp !== undefined) {
				payload.considerIp = options.considerIp;
			}

			if (options.cellTowers && options.cellTowers.length > 0) {
				payload.cellTowers = options.cellTowers;
			}

			if (options.wifiAccessPoints && options.wifiAccessPoints.length > 0) {
				payload.wifiAccessPoints = options.wifiAccessPoints;
			}

			const response = await axios.post(
				`${this.geolocationBaseUrl}?key=${this.apiKey}`,
				payload,
			);

			if (!response.data.location) {
				console.error("Geolocation API failed");
				return null;
			}

			return response.data;
		} catch (error) {
			console.error("Geolocation API Error:", error);
			throw new Error(
				`Failed to get current location: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Test method for geocoding functionality
	 * @param address - Address to geocode
	 * @returns Promise resolving to geocoding result or null
	 */
	async testGeocoding(address: string) {
		try {
			const response = await axios.get(this.geocodingBaseUrl, {
				params: {
					address,
					key: this.apiKey,
				},
			});

			console.log("Geocoding Response:");
			console.log({
				status: response.data.status,
				resultCount: response.data.results?.length || 0,
				firstResult: response.data.results?.[0] || null,
			});

			return response.data.results?.[0] || null;
		} catch (error) {
			console.error("Geocoding Test Error:", error);
			throw error;
		}
	}

	/**
	 * Test method for places search functionality
	 * @param query - Search query
	 * @returns Promise resolving to place search result or null
	 */
	async testPlacesSearch(query: string) {
		try {
			const response = await axios.get(this.placesBaseUrl, {
				params: {
					query,
					key: this.apiKey,
				},
			});

			console.log("Place Search Response:");
			console.log({
				status: response.data.status,
				resultCount: response.data.results?.length || 0,
				firstResult: response.data.results?.[0] || null,
				hasNextPage: !!response.data.next_page_token,
			});

			return response.data.results?.[0] || null;
		} catch (error) {
			console.error("Places Search Test Error:", error);
			throw error;
		}
	}

	/**
	 * Test method for distance matrix functionality
	 * @param origin - Starting point
	 * @param destination - Ending point
	 * @returns Promise resolving to distance matrix result
	 */
	async testDistanceMatrix(origin: string, destination: string) {
		try {
			const result = await this.getDistanceMatrix(origin, destination);
			console.log("Distance Matrix Response:");
			console.log({
				status: result?.status,
				origin: result?.origin_addresses[0],
				destination: result?.destination_addresses[0],
				distance: result?.rows[0]?.elements[0]?.distance?.text,
				duration: result?.rows[0]?.elements[0]?.duration?.text,
			});
			return result;
		} catch (error) {
			console.error("Distance Matrix Test Error:", error);
			throw error;
		}
	}

	/**
	 * Test method for directions functionality
	 * @param origin - Starting point
	 * @param destination - Ending point
	 * @returns Promise resolving to directions result
	 */
	async testDirections(origin: string, destination: string) {
		try {
			const result = await this.getDirections(origin, destination);
			console.log("Directions Response:");
			console.log({
				status: result?.status,
				routes: result?.routes.length,
				summary: result?.routes[0]?.summary,
				distance: result?.routes[0]?.legs[0]?.distance?.text,
				duration: result?.routes[0]?.legs[0]?.duration?.text,
				steps: result?.routes[0]?.legs[0]?.steps.length,
			});
			return result;
		} catch (error) {
			console.error("Directions Test Error:", error);
			throw error;
		}
	}

	/**
	 * Test method for places autocomplete functionality
	 * @param input - Search input
	 * @returns Promise resolving to autocomplete predictions
	 */
	async testPlacesAutocomplete(input: string) {
		try {
			const result = await this.getPlacesAutocomplete(input);
			console.log("Places Autocomplete Response:");
			console.log({
				predictionsCount: result?.length || 0,
				firstPrediction: result?.[0] || null,
			});
			return result;
		} catch (error) {
			console.error("Places Autocomplete Test Error:", error);
			throw error;
		}
	}

	/**
	 * Test method for geolocation functionality
	 * @returns Promise resolving to geolocation result
	 */
	async testGeolocation() {
		try {
			const result = await this.getCurrentLocation({ considerIp: true });
			console.log("Geolocation Response:");
			console.log({
				lat: result?.location.lat,
				lng: result?.location.lng,
				accuracy: result?.accuracy,
			});
			return result;
		} catch (error) {
			console.error("Geolocation Test Error:", error);
			throw error;
		}
	}

	/**
	 * Gets a Street View image URL for a location
	 * @param options - Configuration options for the Street View request
	 * @returns URL string for the Street View image
	 * @throws {Error} If required parameters are missing
	 */
	getStreetViewImageUrl(options: {
		location?: string | { lat: number; lng: number };
		pano?: string;
		size?: string;
		heading?: number;
		pitch?: number;
		fov?: number;
		radius?: number;
		return_error_code?: boolean;
		source?: "default" | "outdoor";
	}): string {
		const params = new URLSearchParams();

		// Format location if provided
		if (options.location) {
			if (typeof options.location === "string") {
				params.append("location", options.location);
			} else {
				params.append(
					"location",
					`${options.location.lat},${options.location.lng}`,
				);
			}
		}

		// Add pano if provided
		if (options.pano) {
			params.append("pano", options.pano);
		}

		// One of location or pano is required
		if (!options.location && !options.pano) {
			throw new Error("Either location or pano is required for Street View");
		}

		// Add other parameters
		params.append("size", options.size || "600x400");
		if (options.heading !== undefined)
			params.append("heading", options.heading.toString());
		if (options.pitch !== undefined)
			params.append("pitch", options.pitch.toString());
		if (options.fov !== undefined) params.append("fov", options.fov.toString());
		if (options.radius !== undefined)
			params.append("radius", options.radius.toString());
		if (options.return_error_code !== undefined)
			params.append("return_error_code", options.return_error_code.toString());
		if (options.source) params.append("source", options.source);
		params.append("key", this.apiKey);

		return `${this.streetViewBaseUrl}?${params.toString()}`;
	}

	/**
	 * Gets metadata about a Street View panorama
	 * @param options - Configuration options for the metadata request
	 * @returns Promise resolving to Street View metadata or null if failed
	 * @throws {Error} If metadata request fails
	 */
	async getStreetViewMetadata(options: {
		location?: string | { lat: number; lng: number };
		pano?: string;
		radius?: number;
		source?: "default" | "outdoor";
	}): Promise<StreetViewResult | null> {
		try {
			const params: Record<string, string | number> = {
				key: this.apiKey,
			};

			// Format location if provided
			if (options.location) {
				if (typeof options.location === "string") {
					params.location = options.location;
				} else {
					params.location = `${options.location.lat},${options.location.lng}`;
				}
			}

			// Add pano if provided
			if (options.pano) {
				params.pano = options.pano;
			}

			// One of location or pano is required
			if (!options.location && !options.pano) {
				throw new Error(
					"Either location or pano is required for Street View metadata",
				);
			}

			// Add other parameters
			if (options.radius !== undefined) params.radius = options.radius;
			if (options.source) params.source = options.source;

			const response = await axios.get(this.streetViewMetadataBaseUrl, {
				params,
			});

			return response.data;
		} catch (error) {
			console.error("Street View Metadata Error:", error);
			throw new Error(
				`Failed to get Street View metadata: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Gets elevation data for locations
	 * @param locations - Array of locations or encoded polyline
	 * @param samples - Number of samples when using encoded polyline
	 * @returns Promise resolving to elevation results or null if failed
	 * @throws {Error} If elevation request fails
	 */
	async getElevation(
		locations: (string | { lat: number; lng: number })[] | string,
		samples?: number,
	): Promise<ElevationResult[] | null> {
		try {
			const params: Record<string, string> = { key: this.apiKey };

			// Handle path request (locations + samples)
			if (typeof locations === "string" && samples) {
				params.path = locations;
				params.samples = samples.toString();
			}
			// Handle locations request (array of locations)
			else if (Array.isArray(locations)) {
				const locationsStr = locations
					.map((loc) => {
						if (typeof loc === "string") return loc;
						return `${loc.lat},${loc.lng}`;
					})
					.join("|");
				params.locations = locationsStr;
			}
			// Handle single location
			else if (typeof locations === "object") {
				params.locations = `${locations["lat"]},${locations["lng"]}`;
			}

			const response = await axios.get(this.elevationBaseUrl, { params });

			if (response.data.status !== "OK") {
				console.error(
					`Elevation API failed with status: ${response.data.status}`,
				);
				return null;
			}

			return response.data.results;
		} catch (error) {
			console.error("Elevation API Error:", error);
			throw new Error(
				`Failed to get elevation data: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Gets timezone information for a location
	 * @param location - The location coordinates
	 * @param timestamp - Timestamp for the request (defaults to current time)
	 * @param language - Language for the response
	 * @returns Promise resolving to timezone result or null if failed
	 * @throws {Error} If timezone request fails
	 */
	async getTimeZone(
		location: { lat: number; lng: number },
		timestamp: number = Math.floor(Date.now() / 1000),
		language?: string,
	): Promise<TimeZoneResult | null> {
		try {
			const response = await axios.get(this.timeZoneBaseUrl, {
				params: {
					location: `${location.lat},${location.lng}`,
					timestamp,
					language,
					key: this.apiKey,
				},
			});

			if (response.data.status !== "OK") {
				console.error(
					`Time Zone API failed with status: ${response.data.status}`,
				);
				return null;
			}

			return response.data;
		} catch (error) {
			console.error("Time Zone API Error:", error);
			throw new Error(
				`Failed to get time zone data: ${(error as Error).message}`,
			);
		}
	}

	// Test methods for the new APIs
	async testStreetView(location: string | { lat: number; lng: number }) {
		try {
			// Get metadata first to check if Street View is available
			const metadata = await this.getStreetViewMetadata({ location });
			console.log("Street View Metadata Response:");
			console.log({
				status: metadata?.status,
				panoId: metadata?.pano_id,
				copyright: metadata?.copyright,
				location: metadata?.location,
			});

			if (metadata?.status === "OK") {
				// Generate image URL
				const imageUrl = this.getStreetViewImageUrl({
					location,
					size: "600x300",
					heading: 180,
					pitch: 0,
				});
				console.log("Street View Image URL:");
				console.log(imageUrl);
			}

			return metadata;
		} catch (error) {
			console.error("Street View Test Error:", error);
			throw error;
		}
	}

	async testElevation(location: { lat: number; lng: number }) {
		try {
			const result = await this.getElevation([location]);
			console.log("Elevation Response:");
			console.log({
				elevation: result?.[0]?.elevation,
				resolution: result?.[0]?.resolution,
			});
			return result;
		} catch (error) {
			console.error("Elevation Test Error:", error);
			throw error;
		}
	}

	async testTimeZone(location: { lat: number; lng: number }) {
		try {
			const result = await this.getTimeZone(location);
			console.log("Time Zone Response:");
			console.log({
				timeZoneId: result?.timeZoneId,
				timeZoneName: result?.timeZoneName,
				rawOffset: result?.rawOffset,
				dstOffset: result?.dstOffset,
			});
			return result;
		} catch (error) {
			console.error("Time Zone Test Error:", error);
			throw error;
		}
	}
}

// Test the endpoints
async function main() {
	const apiKey = process.env.GOOGLE_MAPS_API_KEY;

	if (!apiKey) {
		console.error("GOOGLE_MAPS_API_KEY environment variable is not set");
		process.exit(1);
	}

	const mapsService = new GoogleMapsService(apiKey);

	try {
		console.log("\n===== Testing Geocoding API =====");
		await mapsService.testGeocoding(
			"1600 Amphitheatre Parkway, Mountain View, CA",
		);

		console.log("\n===== Testing Places API =====");
		await mapsService.testPlacesSearch("restaurants in Mountain View");

		console.log("\n===== Testing Place Details API =====");
		const googleHQ = new GeoPoint(37.422, -122.084);
		const placeDetails = await mapsService.getPlaceDetails(googleHQ);
		console.log("Place Details:", placeDetails);

		console.log("\n===== Testing Distance Matrix API =====");
		await mapsService.testDistanceMatrix(
			"Mountain View, CA",
			"San Francisco, CA",
		);

		console.log("\n===== Testing Directions API =====");
		await mapsService.testDirections("Mountain View, CA", "San Francisco, CA");

		console.log("\n===== Testing Places Autocomplete API =====");
		await mapsService.testPlacesAutocomplete("Googl");

		console.log("\n===== Testing Geolocation API =====");
		await mapsService.testGeolocation();

		console.log("\n===== Maps JavaScript API Script Tag =====");
		const scriptTag = mapsService.getMapsJavaScriptTag({
			libraries: ["places", "geometry"],
			callback: "initMap",
		});
		console.log(scriptTag);

		console.log("\n===== Testing Street View API =====");
		await mapsService.testStreetView(
			"1600 Amphitheatre Parkway, Mountain View, CA",
		);

		console.log("\n===== Testing Elevation API =====");
		await mapsService.testElevation({ lat: 39.7391536, lng: -104.9847034 }); // Denver

		console.log("\n===== Testing Time Zone API =====");
		await mapsService.testTimeZone({ lat: 39.7391536, lng: -104.9847034 }); // Denver
	} catch (error) {
		console.error("Test failed:", error);
	}
}

if (require.main === module) {
	main().catch(console.error);
}

export { GoogleMapsService };
