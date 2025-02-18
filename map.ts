import axios from 'axios';
import dotenv from 'dotenv';
import { $ } from 'bun';
dotenv.config();

class GoogleMapsService {
  private apiKey: string;
  private geocodingBaseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';
  private placesBaseUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async testGeocoding(address: string) {
    try {
      const response = await axios.get(this.geocodingBaseUrl, {
        params: {
          address,
          key: this.apiKey
        }
      });
      // Only return the first result
      const topResult = response.data.results?.[0] || null;
      console.log('Geocoding')
      console.log(Object.keys(response.data))
      console.log({
        results: response.data['results'][0],
        status: response.data['status']
      })
      return topResult;
    } catch (error) {
      console.error('Geocoding Error:', error);
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
      // Only return the first result
      const topResult = response.data.results?.[0] || null;
      console.log('Place Search')
      console.log(Object.keys(response.data))
      console.log({
        html_attributions: response.data['html_attributions'],
        next_page_token: response.data['next_page_token'],
        results: response.data['results'][0],
        status: response.data['status']
      })
      return topResult;
    } catch (error) {
      console.error('Places Search Error:', error);
      throw error;
    }
  }
}

// Test the endpoints
async function main() {
  const mapsService = new GoogleMapsService(process.env.GOOGLE_MAPS_API_KEY!);

  try {
    // Test Geocoding API
    await mapsService.testGeocoding('1600 Amphitheatre Parkway, Mountain View, CA');

    // Test Places API
    await mapsService.testPlacesSearch('restaurants in Mountain View');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}