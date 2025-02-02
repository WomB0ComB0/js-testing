import { Pinecone } from '@pinecone-database/pinecone';
import winston from 'winston';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { Track } from '@spotify/web-api-ts-sdk/src/types'
import { genres } from './spotify-genre-search';
import dotenv from 'dotenv';

dotenv.config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

interface Config {
  pineconeApiKey: string;
  pineconeIndexName: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
}

const config: Config = {
  pineconeApiKey: process.env.PINECONE_API_KEY || '',
  pineconeIndexName: process.env.PINECONE_INDEX_NAME || 'hackbrown-search',
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || ''
};

interface ProcessedVector {
  id: string;
  values: number[];
  metadata: {
    genres: string[];
  };
}

const isValidString = (value: string): boolean => typeof value === 'string' && value.length > 0;

/**
 * Searches Spotify for tracks matching the given genres
 * @param genresToMatch The genres to search within
 * @returns Promise<SpotifyApi.TrackObjectFull[]> The matching tracks
 */
async function searchSpotifyTracks(genresToMatch: string[]): Promise<Track[]> {
  const spotify = SpotifyApi.withClientCredentials(config.spotifyClientId, config.spotifyClientSecret);

  const searchQuery = `genre:${genresToMatch.join(',')}`;
  const searchResults = await spotify.search(searchQuery, ['track'], undefined, 10);

  return searchResults.tracks.items;
}

/**
 * Uploads genre data to Pinecone vector database
 * @param genres The genre data to upload
 * @returns Promise<void>
 */
async function uploadGenresToPinecone(
  genres: {
    genres: string[];
    subgenres: string[];
    genres_map: Record<string, string[]>;
  }
): Promise<void> {
  logger.info('Starting genre upload to Pinecone');

  try {
    const pinecone = new Pinecone({
      apiKey: config.pineconeApiKey,
    });

    const index = pinecone.index(config.pineconeIndexName);

    const vectors: ProcessedVector[] = [];
    const existingVectors = new Set<string>();

    const existingVectorsList = await index.fetch(['genre_*', 'subgenre_*']);
    for (const id of Object.keys(existingVectorsList.records)) { 
      existingVectors.add(id); 
    }

    for (const genre of genres.genres) {
      if (!isValidString(genre)) continue;

      const id = `genre_${genre.toLowerCase().replace(/[^\u0020-\u007F]+/g, '').replace(/\s+/g, '_')}`;
      if (existingVectors.has(id)) {
        logger.info(`Skipping existing genre: ${genre}`);
        continue;
      }

      const vector: ProcessedVector = {
        id,
        values: [1],
        metadata: {
          genres: [genre],
        },
      };
      vectors.push(vector);
    }

    for (const [mainGenre, subGenres] of Object.entries(genres.genres_map)) {
      for (const subGenre of subGenres) {
        if (!isValidString(subGenre)) continue;

        const id = `subgenre_${subGenre.toLowerCase().replace(/[^\u0020-\u007F]+/g, '').replace(/\s+/g, '_')}`;
        if (existingVectors.has(id)) {
          logger.info(`Skipping existing subgenre: ${subGenre}`);
          continue;
        }

        const vector: ProcessedVector = {
          id,
          values: [1],
          metadata: {
            genres: [mainGenre, subGenre],
          },
        };
        vectors.push(vector);
      }
    }

    if (vectors.length === 0) {
      logger.info('No new vectors to upload');
      return;
    }

    const BATCH_SIZE = 100;
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE);
      await index.upsert(batch);
      logger.info(`Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(vectors.length / BATCH_SIZE)}`);
    }

    logger.info(`Successfully uploaded ${vectors.length} new genre vectors to Pinecone`);
  } catch (error) {
    logger.error('Failed to upload genres to Pinecone', { error: (error as Error).stack });
    throw error;
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  logger.info('Starting genre upload and search pipeline');
  try {
    await uploadGenresToPinecone(genres);

    // Then perform the search as before
    const genresToMatch = ['Pop', 'Rock'];
    const matchingTracks = await searchSpotifyTracks(genresToMatch);
    logger.info(`Found ${matchingTracks.length} matching tracks`);

    logger.info('Pipeline completed successfully');
  } catch (error) {
    logger.error('Pipeline failed', { error: (error as Error).stack });
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(logger.error);
}

export {
  uploadGenresToPinecone,
  searchSpotifyTracks,
  main,
  type ProcessedVector
};