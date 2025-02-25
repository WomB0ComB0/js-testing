import type { PineconeRecord } from "@pinecone-database/pinecone";
import { FeatureExtractionPipeline } from "@xenova/transformers";
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
    arr.slice(i * chunkSize, (i + 1) * chunkSize)
  );
};


class Embedder {
  private pipe: FeatureExtractionPipeline | null = null;

  async init() {
    console.log('Initializing embedder pipeline...');
    const { pipeline } = await import("@xenova/transformers");
    this.pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log('Pipeline initialized successfully');
  }

  async embed(text: string, genres: SpotifyGenres[]): Promise<PineconeRecord> {
    console.log('Starting embedding process for text:', text);

    if (!this.pipe) {
      console.error('Pipeline not initialized');
      throw new Error("Pipeline not initialized. Call init() first.");
    }

    console.log('Generating embeddings...');
    const result = await this.pipe(text, { pooling: 'mean', normalize: true });
    console.log('Raw embedding result generated');

    const embedding = Array.from(result.data);
    console.log('Generated embedding:', embedding);

    const record = {
      id: uuidv4(),
      metadata: {
        text,
        genres: genres?.map((genre) => JSON.stringify(genre)) ?? [],
      },
      values: embedding,
    };
    console.log('Created Pinecone record:', record);

    return record;
  }
}

const embedder = new Embedder();
console.log('Embedder instance created');
export { embedder };