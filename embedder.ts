import type { PineconeRecord } from "@pinecone-database/pinecone";
import type { GenreMatch } from "@/types";
import { FeatureExtractionPipeline } from "@xenova/transformers";
import { v4 as uuidv4 } from "uuid";

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

  async embed(text: string, genres?: GenreMatch[]): Promise<PineconeRecord> {
    console.log('Starting embedding process for text:', text);
    
    if (!this.pipe) {
      console.error('Pipeline not initialized');
      throw new Error("Pipeline not initialized. Call init() first.");
    }
    
    console.log('Generating embeddings...');
    const result = await this.pipe(text);
    console.log('Raw embedding result generated');

    const meanValue = Array.from(result.data).reduce((sum: number, val: number) => sum + val, 0) / result.data.length;
    console.log('Calculated mean embedding value:', meanValue);
    
    const record = {
      id: uuidv4(),
      metadata: {
        text,
        genres: genres?.map((genre) => JSON.stringify(genre)) ?? [],
      },
      values: [meanValue],
    };
    console.log('Created Pinecone record:', record);
    
    return record;
  }

  async embedBatch(
    texts: string[],
    batchSize: number,
    onDoneBatch: (embeddings: PineconeRecord[]) => Promise<void>
  ): Promise<void> {
    console.log(`Starting batch embedding for ${texts.length} texts with batch size ${batchSize}`);
    const batches = sliceIntoChunks(texts, batchSize);
    console.log(`Split into ${batches.length} batches`);

    for (const [index, batch] of batches.entries()) {
      console.log(`Processing batch ${index + 1}/${batches.length}`);
      const embeddings = await Promise.all(batch.map((text: string) => this.embed(text)));
      console.log(`Batch ${index + 1} embeddings generated`);
      await onDoneBatch(embeddings);
      console.log(`Batch ${index + 1} processing complete`);
    }
    console.log('All batches processed successfully');
  }
}

const embedder = new Embedder();
console.log('Embedder instance created');
export { embedder };