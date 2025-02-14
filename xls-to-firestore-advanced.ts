import xlsx from 'node-xlsx';
import admin from 'firebase-admin';
import { GeoFirestore } from 'geofirestore';
import { Client } from '@googlemaps/google-maps-services-js';
import dotenv from 'dotenv';

dotenv.config();

const googleMapsClient = new Client({});

interface ServiceAccount {
  projectId: string;
  privateKey: string;
  clientEmail: string;
}

interface CleanedData {
  [key: string]: string | number | undefined | admin.firestore.GeoPoint;
  coordinates?: admin.firestore.GeoPoint;
}

(async () => {
  try {
    const serviceAccount: ServiceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    const firestore = admin.firestore();
    firestore.settings({ ignoreUndefinedProperties: true });
    const geoFirestore = new GeoFirestore(firestore);

    const sheet = xlsx.parse('./resource.xlsx');
    const data = sheet[0].data;
    const headers = data[0].map((header: string) => header.toLowerCase().replace(/\s|\//g, '_'));
    const rows = data.slice(1);

    const collectionRef = geoFirestore.collection('resources');

    for (const row of rows) {
      const docData: CleanedData = {};
      headers.forEach((header, index) => {
        docData[header] = typeof row[index] === 'string' ? row[index].trim() : row[index];
      });

      let latitude = parseFloat(docData['y'] as string);
      let longitude = parseFloat(docData['x'] as string);
      const address = docData['address'] as string;

      if (isNaN(latitude) || isNaN(longitude)) {
        if (address) {
          try {
            const response = await googleMapsClient.geocode({
              params: { address, key: process.env.GOOGLE_MAPS_API_KEY! },
            });

            if (response.data.results.length > 0) {
              const location = response.data.results[0].geometry.location;
              latitude = location.lat;
              longitude = location.lng;
              console.log(`Geocoded: ${address} -> (${latitude}, ${longitude})`);
            } else {
              console.warn(`No results found for: ${address}`);
              continue;
            }
          } catch (error) {
            console.error(`Geocoding error: ${address}`, error);
            continue;
          }
        } else {
          console.warn('Skipping row due to missing coordinates and address:', row);
          continue;
        }
      }

      await collectionRef.add({
        ...docData,
        coordinates: new admin.firestore.GeoPoint(latitude, longitude),
      });
    }

    console.log('Data successfully added to Firestore with geohashing.');
  } catch (error) {
    console.error('Error:', error);
  }
})();
