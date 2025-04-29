import { Pinecone } from '@pinecone-database/pinecone';
import winston from 'winston';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import type { Track } from '@spotify/web-api-ts-sdk/src/types';
import { genres } from './spotify-genre-search';
import dotenv from 'dotenv';
import { embedder, SpotifyGenres } from './embedder';

dotenv.config();

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Configuration interface
interface Config {
  pineconeApiKey: string;
  pineconeIndexName: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
}

const config: Config = {
  pineconeApiKey: process.env.PINECONE_API_KEY || 'pcsk_6XgYfG_Dq1zSKKxSSnnf3Av9DMAwNM7qVQXqCbxYN9XVjs7rSeD8gLKkpQA2JbLuZEXwPF',
  pineconeIndexName: process.env.PINECONE_INDEX_NAME || 'hackbrown-search',
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
};

// Processed vector interface
interface ProcessedVector {
  id: string;
  values: number[];
  metadata: {
    genres: string[];
  };
}

// Utility function to validate strings
const isValidString = (value: string): boolean => typeof value === 'string' && value.length > 0;

// Spotify service
class SpotifyService {
  private spotify: SpotifyApi;

  constructor(private clientId: string, private clientSecret: string) {
    this.spotify = SpotifyApi.withClientCredentials(clientId, clientSecret);
  }

  async searchTracks(genresToMatch: string[]): Promise<Track[]> {
    const searchQuery = `genre:${genresToMatch.join(',')}`;
    const searchResults = await this.spotify.search(searchQuery, ['track'], undefined, 10);
    return searchResults.tracks.items;
  }
}

// Pinecone service
class PineconeService {
  private pinecone: Pinecone;
  private index: ReturnType<Pinecone['index']>;

  constructor(private apiKey: string, private indexName: string) {
    this.pinecone = new Pinecone({ apiKey });
    this.index = this.pinecone.index(indexName);
  }

  async fetchExistingVectors(ids: string[]): Promise<Set<string>> {
    const existingVectors = new Set<string>();
    const existingVectorsList = await this.index.fetch(ids);
    for (const id of Object.keys(existingVectorsList.records)) {
      existingVectors.add(id);
    }
    return existingVectors;
  }

  async upsertVectors(vectors: ProcessedVector[], batchSize: number = 100): Promise<void> {
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await this.index.upsert(batch);
      logger.info(`Uploaded batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(vectors.length / batchSize)}`);
    }
  }
}

// Genre service
class GenreService {
  constructor(
    private pineconeService: PineconeService,
  ) {}

  async initialize() {
    await embedder.init();
  }

  async uploadGenresToPinecone(genres: SpotifyGenres): Promise<void> {
    logger.info('Starting genre upload to Pinecone');

    const vectors: ProcessedVector[] = [];
    const existingVectors = await this.pineconeService.fetchExistingVectors(['genre_*', 'subgenre_*']);

    // Process main genres
    for (const genre of genres.genres) {
      if (!isValidString(genre)) continue;

      const id = `genre_${genre.toLowerCase().replace(/[^\u0020-\u007F]+/g, '').replace(/\s+/g, '_')}`;
      if (existingVectors.has(id)) {
        logger.info(`Skipping existing genre: ${genre}`);
        continue;
      }

      const vector: ProcessedVector = {
        id,
        values: await this.generateEmbedding(genre),
        metadata: {
          genres: [genre],
        },
      };
      vectors.push(vector);
    }

    // Process subgenres from genres_map
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
          values: await this.generateEmbedding(subGenre),
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

    await this.pineconeService.upsertVectors(vectors);
    logger.info(`Successfully uploaded ${vectors.length} new genre vectors to Pinecone`);
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    console.log(`Generating embedding for: ${text}`);
    const record = await embedder.embed(text, [{
      genres: [text],
    }] as Omit<SpotifyGenres[], 'genres_map'>);
    return record.values;
  }
}

// Main execution function
async function main(): Promise<void> {
  logger.info('Starting genre upload and search pipeline');

  try {
    const pineconeService = new PineconeService(config.pineconeApiKey, config.pineconeIndexName);
    const genreService = new GenreService(pineconeService);

    await genreService.initialize();

    await genreService.uploadGenresToPinecone(genres);

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
  SpotifyService,
  PineconeService,
  GenreService,
  main,
  type ProcessedVector,
};