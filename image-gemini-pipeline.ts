import { GoogleGenAI } from '@google/genai'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

type ImageContextExtractorConfig = {
  apiKey?: string
}

type ImageAnalysisResult = {
  uuid: string
  rawAnalysis: string | undefined
  timestamp: string
  processingStatus: 'completed' | 'failed'
}

type InitialResults = {
  uuid: string
  parentUuid: string
  results: any
  timestamp: string
  processingStatus: 'completed' | 'failed'
}

type MetadataResults = {
  uuid: string
  parentUuid: string
  imageUuid: string
  metadata: any
  foreignKeys: ForeignKeys
  timestamp: string
  processingStatus: 'completed' | 'failed'
}

type ForeignKeys = {
  productId: string
  categoryId: string
  brandId: string
  locationId: string
}

type PipelineSummary = {
  uuid: string
  categories: string[]
  confidence: number
  processingTime: string
}

type PipelineResult = {
  pipeline: {
    imageAnalysis: ImageAnalysisResult
    initialResults: InitialResults
    metadata: MetadataResults
  }
  summary: PipelineSummary
}

class ImageContextExtractor {
  private ai: GoogleGenAI
  private model: string

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({
      apiKey: apiKey || process.env.GEMINI_API_KEY!,
    })
    this.model = 'gemini-2.0-flash-exp'
  }

  /**
   * Process image similar to Google Lens - identify objects, text, and context
   * @param imagePath - Path to image file or image buffer
   * @returns Initial processing results
   */
  async processImage(imagePath: string | Buffer): Promise<ImageAnalysisResult> {
    try {
      // Convert image to base64 if it's a file path
      let imageData: string
      if (typeof imagePath === 'string') {
        const imageBuffer = fs.readFileSync(imagePath)
        imageData = imageBuffer.toString('base64')
      } else {
        imageData = imagePath.toString('base64')
      }

      const response: any = await this.ai.models.generateContent({
        model: this.model,
        contents: [{
          parts: [
            {
              text: `Analyze this image like Google Lens would. Identify:
              1. All visible products, brands, and text
              2. Product categories (food, clothing, technology, drugs/medicine, etc.)
              3. Any readable text, labels, or signs
              4. Visual context and setting
              5. Potential shopping/commercial elements
              
              Format your response as structured data that can be easily parsed.`
            },
            {
              inlineData: {
                mimeType: 'image/jpeg', // Adjust based on actual image type
                data: imageData
              }
            }
          ]
        }],
        config: {
          systemInstruction: `You are an expert image analysis system similar to Google Lens. 
          Focus on identifying products, brands, text, and commercial elements in images. 
          Provide structured, actionable data for product categorization and information retrieval.`,
          maxOutputTokens: 4096,
        }
      })

      const analysisText: string | undefined = response.candidates?.[0]?.content?.parts?.[0]?.text

      return {
        uuid: uuidv4(),
        rawAnalysis: analysisText,
        timestamp: new Date().toISOString(),
        processingStatus: 'completed'
      }

    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error processing image:', error)
        throw new Error(`Image processing failed: ${error.message}`)
      } else {
        console.error('Error processing image:', error)
        throw new Error('Image processing failed: Unknown error')
      }
    }
  }

  /**
   * Generate initial top results based on image analysis
   * @param imageAnalysis - Results from processImage
   * @returns Top search results and suggestions
   */
  async generateInitialResults(imageAnalysis: ImageAnalysisResult): Promise<InitialResults> {
    try {
      const response: any = await this.ai.models.generateContent({
        model: this.model,
        contents: [{
          parts: [{
            text: `Based on this image analysis, generate the top 5-10 most relevant search results and product matches:
            
            Analysis: ${imageAnalysis.rawAnalysis}
            
            Provide:
            1. Top product matches with confidence scores
            2. Suggested search queries
            3. Relevant categories
            4. Key identifying features
            5. Potential brand matches
            
            Format as JSON with clear structure for downstream processing.`
          }]
        }],
        config: {
          systemInstruction: `Generate structured search results and product matches based on image analysis. 
          Focus on actionable results that can be used for product categorization and information retrieval.
          Prioritize accuracy and relevance.`,
          maxOutputTokens: 4096,
        }
      })

      const resultsText: string | undefined = response.candidates?.[0]?.content?.parts?.[0]?.text

      return {
        uuid: uuidv4(),
        parentUuid: imageAnalysis.uuid,
        results: this.parseResults(resultsText),
        timestamp: new Date().toISOString(),
        processingStatus: 'completed'
      }

    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error generating initial results:', error)
        throw new Error(`Results generation failed: ${error.message}`)
      } else {
        console.error('Error generating initial results:', error)
        throw new Error('Results generation failed: Unknown error')
      }
    }
  }

  /**
   * Extract structured metadata from results
   * @param initialResults - Results from generateInitialResults
   * @returns Extracted and structured metadata
   */
  async extractMetadata(initialResults: InitialResults): Promise<MetadataResults> {
    try {
      const response: any = await this.ai.models.generateContent({
        model: this.model,
        contents: [{
          parts: [{
            text: `Extract structured metadata from these search results for database storage and categorization:
            
            Results: ${JSON.stringify(initialResults.results, null, 2)}
            
            Extract:
            1. Product categories (food, clothes, drugs, technology, etc.)
            2. Brand information and confidence levels
            3. Key attributes and features
            4. Price-related information if available
            5. Location-relevant data
            6. Nutritional info (for food)
            7. Technical specifications (for technology)
            8. Foreign key relationships for database storage
            
            Format as structured JSON with clear field mappings.`
          }]
        }],
        config: {
          systemInstruction: `Extract and structure metadata for database storage and product categorization.
          Focus on creating clean, normalized data with proper foreign key relationships.
          Ensure all extracted data is actionable for the downstream pipeline.`,
          maxOutputTokens: 4096,
        }
      })

      const metadataText: string | undefined = response.candidates?.[0]?.content?.parts?.[0]?.text

      return {
        uuid: uuidv4(),
        parentUuid: initialResults.uuid,
        imageUuid: initialResults.parentUuid,
        metadata: this.parseMetadata(metadataText),
        foreignKeys: this.generateForeignKeys(metadataText),
        timestamp: new Date().toISOString(),
        processingStatus: 'completed'
      }

    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error extracting metadata:', error)
        throw new Error(`Metadata extraction failed: ${error.message}`)
      } else {
        console.error('Error extracting metadata:', error)
        throw new Error('Metadata extraction failed: Unknown error')
      }
    }
  }

  /**
   * Complete pipeline from image to metadata
   * @param imagePath - Path to image or image buffer
   * @returns Complete processing results
   */
  async processImagePipeline(imagePath: string | Buffer): Promise<PipelineResult> {
    try {
      console.log('🔄 Processing image...')
      const imageAnalysis = await this.processImage(imagePath)

      console.log('🔄 Generating initial results...')
      const initialResults = await this.generateInitialResults(imageAnalysis)

      console.log('🔄 Extracting metadata...')
      const metadata = await this.extractMetadata(initialResults)

      return {
        pipeline: {
          imageAnalysis,
          initialResults,
          metadata
        },
        summary: {
          uuid: imageAnalysis.uuid,
          categories: Array.isArray(metadata.metadata?.categories) ? metadata.metadata.categories : [],
          confidence: typeof metadata.metadata?.confidence === 'number' ? metadata.metadata.confidence : 0,
          processingTime: new Date().toISOString()
        }
      }

    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Pipeline processing failed:', error)
        throw error
      } else {
        console.error('Pipeline processing failed:', error)
        throw new Error('Pipeline processing failed: Unknown error')
      }
    }
  }

  // Helper methods
  parseResults(resultsText: string | undefined): any {
    if (!resultsText) return { raw: '' }
    try {
      // Try to extract JSON from the response
      const jsonMatch = resultsText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
      // Fallback to structured text parsing
      return { raw: resultsText }
    } catch (error) {
      return { raw: resultsText }
    }
  }

  parseMetadata(metadataText: string | undefined): any {
    if (!metadataText) return { raw: '' }
    try {
      const jsonMatch = metadataText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
      return { raw: metadataText }
    } catch (error) {
      return { raw: metadataText }
    }
  }

  generateForeignKeys(_metadataText: string | undefined): ForeignKeys {
    // Generate foreign key relationships based on extracted data
    const foreignKeys: ForeignKeys = {
      productId: uuidv4(),
      categoryId: uuidv4(),
      brandId: uuidv4(),
      locationId: uuidv4()
    }

    return foreignKeys
  }
}

// Usage example
if (require.main === module) {
  (async () => {
    try {
      // For demonstration, allow API key override via env or argument
      const apiKey = process.env.GEMINI_API_KEY || ''
      const extractor = new ImageContextExtractor(apiKey)

      // Example usage - replace with actual image path
      const imagePath = './test_image.jpg'

      if (!fs.existsSync(imagePath)) {
        console.log('⚠️  Sample image not found. Please provide a valid image path.')
        console.log('Usage example:')
        console.log('const result = await extractor.processImagePipeline("./your-image.jpg");')
        return
      }

      const result = await extractor.processImagePipeline(imagePath)

      console.log('✅ Pipeline completed successfully!')
      console.log('📊 Summary:', JSON.stringify(result.summary, null, 2))

    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('❌ Pipeline failed:', error.message)
      } else {
        console.error('❌ Pipeline failed:', error)
      }
    }
  })()
}

export default ImageContextExtractor