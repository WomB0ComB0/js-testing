import axios from 'axios';
import dotenv from 'dotenv';
import { $ } from 'bun';
import { GeoPoint } from '@google-cloud/firestore';

dotenv.config();

// Define interfaces for API responses
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

interface PlaceDetails {
  name: string;
  formatted_phone_number?: string;
  website?: string;
  opening_hours?: {
    weekday_text: string[];
    open_now: boolean;
  };
}

class GoogleMapsService {
  private readonly apiKey: string;
  private readonly geocodingBaseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';
  private readonly placesBaseUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
  private readonly placeDetailsBaseUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
  private readonly nearbySearchBaseUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Google Maps API key is required');
    }
    this.apiKey = apiKey;
  }

  async geocodeAddress(address: string): Promise<GeocodingResult | null> {
    try {
      const response = await axios.get(this.geocodingBaseUrl, {
        params: {
          address,
          key: this.apiKey
        }
      });

      if (response.data.status !== 'OK') {
        console.error(`Geocoding failed with status: ${response.data.status}`);
        return null;
      }

      return response.data.results?.[0] || null;
    } catch (error) {
      console.error('Geocoding Error:', error);
      throw new Error(`Failed to geocode address: ${(error as Error).message}`);
    }
  }

  async searchPlaces(query: string): Promise<PlaceSearchResult | null> {
    try {
      const response = await axios.get(this.placesBaseUrl, {
        params: {
          query,
          key: this.apiKey
        }
      });

      if (response.data.status !== 'OK') {
        console.error(`Places search failed with status: ${response.data.status}`);
        return null;
      }

      return response.data.results?.[0] || null;
    } catch (error) {
      console.error('Places Search Error:', error);
      throw new Error(`Failed to search places: ${(error as Error).message}`);
    }
  }

  async getPlaceDetails(coordinates: GeoPoint): Promise<PlaceDetails | null> {
    try {
      // Step 1: Find nearby places
      const nearbyUrl = new URL(this.nearbySearchBaseUrl);
      nearbyUrl.searchParams.append('location', `${coordinates.latitude},${coordinates.longitude}`);
      nearbyUrl.searchParams.append('radius', '50');
      nearbyUrl.searchParams.append('key', this.apiKey);

      const nearbyResponse = await fetch(nearbyUrl.toString());
      const nearbyData = await nearbyResponse.json();

      if (nearbyData.status !== 'OK' || !nearbyData.results?.length) {
        console.log('No nearby places found');
        return null;
      }

      // Step 2: Get details for the first place
      const placeId = nearbyData.results[0].place_id;
      const detailsUrl = new URL(this.placeDetailsBaseUrl);
      detailsUrl.searchParams.append('place_id', placeId);
      detailsUrl.searchParams.append('fields', 'name,formatted_phone_number,website,opening_hours');
      detailsUrl.searchParams.append('key', this.apiKey);

      const detailsResponse = await fetch(detailsUrl.toString());
      const detailsData = await detailsResponse.json();

      if (detailsData.status !== 'OK') {
        console.error(`Place details failed with status: ${detailsData.status}`);
        return null;
      }

      return detailsData.result;
    } catch (error) {
      console.error('Place details error:', error);
      return null;
    }
  }

  // Debug methods for testing
  async testGeocoding(address: string) {
    try {
      const response = await axios.get(this.geocodingBaseUrl, {
        params: {
          address,
          key: this.apiKey
        }
      });
      
      console.log('Geocoding Response:');
      console.log({
        status: response.data.status,
        resultCount: response.data.results?.length || 0,
        firstResult: response.data.results?.[0] || null
      });
      
      return response.data.results?.[0] || null;
    } catch (error) {
      console.error('Geocoding Test Error:', error);
      throw error;
    }
  }

  async testPlacesSearch(query: string) {
    try {
      const response = await axios.get(this.placesBaseUrl, {
        params: {
          query,
          key: this.apiKey
        }
      });
      
      console.log('Place Search Response:');
      console.log({
        status: response.data.status,
        resultCount: response.data.results?.length || 0,
        firstResult: response.data.results?.[0] || null,
        hasNextPage: !!response.data.next_page_token
      });
      
      return response.data.results?.[0] || null;
    } catch (error) {
      console.error('Places Search Test Error:', error);
      throw error;
    }
  }
}

// Test the endpoints
async function main() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY environment variable is not set');
    process.exit(1);
  }

  const mapsService = new GoogleMapsService(apiKey);

  try {
    console.log('\n===== Testing Geocoding API =====');
    await mapsService.testGeocoding('1600 Amphitheatre Parkway, Mountain View, CA');

    console.log('\n===== Testing Places API =====');
    await mapsService.testPlacesSearch('restaurants in Mountain View');

    console.log('\n===== Testing Place Details API =====');
    const googleHQ = new GeoPoint(37.422, -122.084);
    const placeDetails = await mapsService.getPlaceDetails(googleHQ);
    console.log('Place Details:', placeDetails);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Check if running as a script
if (require.main === module) {
  main().catch(console.error);
}

export { GoogleMapsService };