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
 * Enhanced ImageContextExtractor with improved image identification accuracy
 */

import { GoogleGenAI, Type } from "@google/genai";
import { type } from "arktype";
import { Error } from "effect/Data";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";

const DetailedImageAnalysis = type({
	uuid: "string.uuid.v4",
	primaryObjects: ["string", "[]"],
	textContent: ["string", "[]"],
	brandIdentification: {
		brands: ["string", "[]"],
		confidence: "number",
		brandElements: ["string", "[]"]
	},
	technicalDetails: {
		imageQuality: "'high' | 'medium' | 'low'",
		lighting: "'good' | 'poor' | 'mixed'",
		angle: "'front' | 'side' | 'angled' | 'top' | 'bottom'",
		clarity: "number",
		partialOcclusion: "boolean"
	},
	contextualInfo: {
		setting: "string",
		backgroundElements: ["string", "[]"],
		associatedProducts: ["string", "[]"]
	},
	rawAnalysis: "string|undefined",
	timestamp: "string",
	processingStatus: "'completed' | 'failed'",
});

type DetailedImageAnalysis = typeof DetailedImageAnalysis.infer;

class EnhancedImageContextExtractor {
	private ai: GoogleGenAI;
	private model: string;

	constructor(apiKey: string) {
		this.ai = new GoogleGenAI({
			apiKey: apiKey || Bun.env.GEMINI_API_KEY,
		});
		this.model = "gemini-2.0-flash-exp";
	}

	/**
	 * Multi-stage image analysis for maximum accuracy
	 */
	async processImageDetailed(imagePath: string | Buffer): Promise<DetailedImageAnalysis> {
		try {
			let imageData: string;
			if (typeof imagePath === "string") {
				const imageBuffer = fs.readFileSync(imagePath);
				imageData = imageBuffer.toString("base64");
			} else {
				imageData = imagePath.toString("base64");
			}

			// Stage 1: Comprehensive object and brand identification
			const response = await this.ai.models.generateContent({
				model: this.model,
				contents: [
					{
						parts: [
							{
								text: `
									Perform extremely detailed image analysis for product identification. Be as specific and accurate as possible:

									IDENTIFICATION REQUIREMENTS:
									1. PRIMARY OBJECTS: List every distinct product, item, or object you can identify
									- Include specific product names, models, variations
									- Note packaging details, sizes, flavors, versions
									- Identify any product codes, SKUs, or model numbers

									2. TEXT EXTRACTION: Extract ALL visible text including:
									- Product names and descriptions
									- Brand names and logos
									- Prices, weights, sizes, quantities
									- Ingredients, nutritional info, specifications
									- Barcodes, QR codes, product codes
									- Any fine print or small text
									- Website URLs, social media handles

									3. BRAND ANALYSIS: Identify brands through:
									- Logos and brand marks
									- Typography and font styles
									- Color schemes and brand colors
									- Packaging design patterns
									- Corporate visual identity elements

									4. TECHNICAL ASSESSMENT: Evaluate:
									- Image quality and resolution
									- Lighting conditions
									- Viewing angle and perspective
									- Focus and clarity levels
									- Any obstructions or partial views

									5. CONTEXTUAL INFORMATION: Describe:
									- Physical location/setting (store shelf, kitchen, etc.)
									- Other products or items visible
									- Environmental context
									- Display or arrangement style

									ACCURACY FOCUS:
									- If uncertain about a product, state confidence level
									- Distinguish between similar products carefully
									- Note any ambiguous elements that need clarification
									- Provide alternative interpretations if multiple are possible

									Format as structured data for parsing.
								`,
							},
							{
								inlineData: {
									mimeType: this.detectMimeType(imagePath),
									data: imageData,
								},
							},
						],
					},
				],
				config: {
					systemInstruction: {
						parts: [
							{
								text: `
									You are an expert computer vision system optimized for product identification accuracy. 
									Your goal is to identify products with the precision of a professional inventory scanner combined 
									with the contextual understanding of a retail expert. Focus on:
									1. Exact product identification over general categories
									2. Brand recognition accuracy
									3. Text extraction completeness
									4. Context that aids in disambiguation
									5. Technical factors that affect identification confidence
								`
							}
						]
					},
					maxOutputTokens: 8192,
					temperature: 0.1,
				},
			});

			const analysisText = response.candidates?.[0]?.content?.parts?.[0]?.text;

			// Stage 2: Structure the analysis using a follow-up call
			const structuredResponse = await this.ai.models.generateContent({
				model: this.model,
				contents: [
					{
						parts: [
							{
								text: `
									Convert this image analysis into structured JSON format:

									${analysisText}

									Return ONLY JSON with this exact structure:
									{
										"primaryObjects": ["specific product names"],
										"textContent": ["all extracted text"],
										"brandIdentification": {
											"brands": ["identified brands"],
											"confidence": 0.0-1.0,
											"brandElements": ["logos, colors, typography elements"]
										},
										"technicalDetails": {
											"imageQuality": "high|medium|low",
											"lighting": "good|poor|mixed", 
											"angle": "front|side|angled|top|bottom",
											"clarity": 0.0-1.0,
											"partialOcclusion": true|false
										},
										"contextualInfo": {
											"setting": "description of location/setting",
											"backgroundElements": ["other visible items"],
											"associatedProducts": ["related products visible"]
										}
									}
								`
							},
						],
					},
				],
				config: {
					systemInstruction: {
						parts: [{ text: "Convert analysis to structured JSON. Be precise with product names and brand identification." }]
					},
					responseMimeType: "application/json",
					responseSchema: {
						type: Type.OBJECT,
						properties: {
							primaryObjects: { type: Type.ARRAY, items: { type: Type.STRING } },
							textContent: { type: Type.ARRAY, items: { type: Type.STRING } },
							brandIdentification: {
								type: Type.OBJECT,
								properties: {
									brands: { type: Type.ARRAY, items: { type: Type.STRING } },
									confidence: { type: Type.NUMBER },
									brandElements: { type: Type.ARRAY, items: { type: Type.STRING } }
								},
								required: ["brands", "confidence", "brandElements"]
							},
							technicalDetails: {
								type: Type.OBJECT,
								properties: {
									imageQuality: { type: Type.STRING },
									lighting: { type: Type.STRING },
									angle: { type: Type.STRING },
									clarity: { type: Type.NUMBER },
									partialOcclusion: { type: Type.BOOLEAN }
								},
								required: ["imageQuality", "lighting", "angle", "clarity", "partialOcclusion"]
							},
							contextualInfo: {
								type: Type.OBJECT,
								properties: {
									setting: { type: Type.STRING },
									backgroundElements: { type: Type.ARRAY, items: { type: Type.STRING } },
									associatedProducts: { type: Type.ARRAY, items: { type: Type.STRING } }
								},
								required: ["setting", "backgroundElements", "associatedProducts"]
							}
						},
						required: ["primaryObjects", "textContent", "brandIdentification", "technicalDetails", "contextualInfo"]
					},
					temperature: 0.0, // Maximum consistency for structured output
				},
			});

			const structuredData = JSON.parse(structuredResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");

			const resultObject = {
				uuid: uuidv4(),
				...structuredData,
				rawAnalysis: analysisText,
				timestamp: new Date().toISOString(),
				processingStatus: "completed" as const,
			};

			return DetailedImageAnalysis.assert(resultObject);

		} catch (error) {
			console.error("Enhanced image processing failed:", error);
			throw new Error(`Enhanced image processing failed: ${error}`);
		}
	}

	/**
	 * Cross-reference and validate identified products
	 */
	async validateIdentification(analysis: DetailedImageAnalysis): Promise<DetailedImageAnalysis & { validationScore: number }> {
		try {
			const response = await this.ai.models.generateContent({
				model: this.model,
				contents: [
					{
						parts: [
							{
								text: `
									Validate and cross-reference these product identifications for accuracy:

									PRIMARY OBJECTS: ${JSON.stringify(analysis.primaryObjects)}
									BRANDS: ${JSON.stringify(analysis.brandIdentification.brands)}
									TEXT CONTENT: ${JSON.stringify(analysis.textContent)}

									VALIDATION TASKS:
									1. Check for consistency between identified products and extracted text
									2. Verify brand-product relationships make sense
									3. Identify any conflicting or contradictory identifications
									4. Flag uncertain identifications that need verification
									5. Suggest corrections for likely misidentifications

									Return JSON with:
									{
										"validationScore": 0.0-1.0,
										"consistencyChecks": {
											"productTextAlignment": true|false,
											"brandProductMatch": true|false,
											"contextualConsistency": true|false
										},
										"corrections": [{"original": "...", "suggested": "...", "reason": "..."}],
										"uncertainElements": ["list of uncertain identifications"],
										"confidenceByProduct": [{"product": "...", "confidence": 0.0-1.0}]
									}
								`
							},
						],
					},
				],
				config: {
					responseMimeType: "application/json",
					maxOutputTokens: 4096,
				},
			});

			const validationData = JSON.parse(response.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");

			return {
				...analysis,
				validationScore: validationData.validationScore || 0.5,
			};

		} catch (error) {
			console.error("Validation failed:", error);
			return { ...analysis, validationScore: 0.5 };
		}
	}

	/**
	 * Enhanced pipeline with detailed identification
	 */
	async processImagePipelineEnhanced(imagePath: string | Buffer) {
		console.log("🔍 Starting enhanced image identification...");

		const detailedAnalysis = await this.processImageDetailed(imagePath);

		const validatedAnalysis = await this.validateIdentification(detailedAnalysis);

		console.log("✅ Enhanced identification completed");
		console.log(`📊 Validation Score: ${validatedAnalysis.validationScore}`);
		console.log(`🎯 Primary Objects: ${validatedAnalysis.primaryObjects.join(", ")}`);
		console.log(`🏷️ Brands: ${validatedAnalysis.brandIdentification.brands.join(", ")}`);

		return validatedAnalysis;
	}

	private detectMimeType(imagePath: string | Buffer): string {
		if (typeof imagePath === "string") {
			const ext = imagePath.toLowerCase().split('.').pop();
			switch (ext) {
				case 'png': return 'image/png';
				case 'gif': return 'image/gif';
				case 'webp': return 'image/webp';
				default: return 'image/jpeg';
			}
		}
		return 'image/jpeg';
	}
}


if (typeof require !== "undefined" && require.main === module) {
	(async () => {
		try {
			const apiKey = Bun?.env?.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
			if (!apiKey) {
				console.error("❌ Missing GEMINI_API_KEY in environment.");
				process.exit(1);
			}

			const extractor = new EnhancedImageContextExtractor(apiKey);
			const imagePath = "./test_image.jpg";

			if (!fs.existsSync(imagePath)) {
				console.log("⚠️  Sample image not found at", imagePath);
				process.exit(0);
			}

			const result = await extractor.processImagePipelineEnhanced(imagePath);

			console.log("✅ Pipeline completed successfully!");
		
			console.log("📌 UUID:", result.uuid);
			console.log("📊 Validation Score:", result.validationScore);
			console.log("🎯 Primary Objects:", result.primaryObjects.join(", "));
			console.log("🏷️ Brands:", result.brandIdentification.brands.join(", "));
			console.log("🕒 Timestamp:", result.timestamp);
			console.log("🔧 Status:", result.processingStatus);
		} catch (err) {
			const message =
				err instanceof globalThis.Error ? err.message : String(err);
			console.error("❌ Pipeline failed:", message);
			process.exit(1);
		}
	})();
}

export default EnhancedImageContextExtractor;