#!/usr/bin/env bun
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

import { GoogleGenAI } from "@google/genai";
import { writeFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";

interface GenerationConfig {
  model: string;
  maxOutputTokens: number;
  temperature?: number;
}

class JSDocGenerator {
  private ai: GoogleGenAI;
  private config: GenerationConfig;

  constructor(apiKey: string, config: Partial<GenerationConfig> = {}) {
    this.ai = new GoogleGenAI({ apiKey });
    this.config = {
      model: 'gemini-2.5-flash-preview-05-20',
      maxOutputTokens: 65536,
      temperature: 0.1, // Lower temperature for more consistent documentation
      ...config
    };
  }

  /**
   * Generate JSDoc comments for a given file
   * @param filePath - Path to the source file
   * @returns Promise resolving to the generated JSDoc content
   */
  async generateJSDoc(filePath: string): Promise<string> {
    try {
      const fileContent = await Bun.file(filePath).text();
      
      if (!fileContent.trim()) {
        throw new Error(`File ${filePath} is empty`);
      }

      const response = await this.ai.models.generateContent({
        model: this.config.model,
        contents: [{
          parts: [{
            text: fileContent
          }]
        }],
        config: {
          systemInstruction: `You are a technical documentation expert. Given the provided code, generate comprehensive JSDoc comments that include:
          
          1. Function/method descriptions with clear explanations
          2. @param tags with types and descriptions
          3. @returns tags with types and descriptions
          4. @throws tags for potential errors
          5. @example tags where helpful
          6. Class and interface documentation
          7. @deprecated tags where applicable
          8. @web tags for web-related APIs or methods
          9. @author tags
          10. @see tags for related documentation or references
          11. @since tags to indicate when a feature was added
          12. @version tags for versioning information
          13. @async tags for asynchronous functions
          14. @readonly tags for read-only properties
          15. @private, @protected, @public for access control
          
          Rules:
          - Only return the code with JSDoc comments added
          - Do not include any explanatory text, metadata, or markdown
          - Preserve the original code structure exactly
          - Use proper TypeScript types in JSDoc annotations
          - Do not use jsdoc comments in unnecessary places, mainly for blocks of code which references subsequent and sometimes overarching codeblocks
          - Be concise but comprehensive`,
          maxOutputTokens: this.config.maxOutputTokens,
          temperature: this.config.temperature
        }
      });

      const generatedContent = response.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!generatedContent) {
        throw new Error('No content generated from AI response');
      }

      return generatedContent;
    } catch (error) {
      console.error(`Error generating JSDoc for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Process a file and optionally save the result
   * @param inputPath - Path to input file
   * @param outputPath - Optional output path (defaults to input path with .documented extension)
   * @param overwrite - Whether to overwrite the original file
   */
  async processFile(inputPath: string, outputPath?: string, overwrite = false): Promise<void> {
    try {
      console.log(`Processing ${inputPath}...`);
      
      const generatedContent = await this.generateJSDoc(inputPath);
      
      if (overwrite) {
        await writeFile(inputPath, generatedContent);
        console.log(`✅ Updated ${inputPath}`);
      } else {
        const finalOutputPath = outputPath || this.getOutputPath(inputPath);
        await writeFile(finalOutputPath, generatedContent);
        console.log(`✅ Generated ${finalOutputPath}`);
      }
    } catch (error) {
      console.error(`❌ Failed to process ${inputPath}:`, error);
      throw error;
    }
  }

  /**
   * Generate output path for documented file
   * @param inputPath - Original file path
   * @returns Output path with .documented suffix
   */
  private getOutputPath(inputPath: string): string {
    const ext = extname(inputPath);
    const base = basename(inputPath, ext);
    const dir = inputPath.replace(basename(inputPath), '');
    return join(dir, `${base}.documented${ext}`);
  }

  /**
   * Process multiple files
   * @param filePaths - Array of file paths to process
   * @param overwrite - Whether to overwrite original files
   */
  async processFiles(filePaths: string[], overwrite = false): Promise<void> {
    const results = await Promise.allSettled(
      filePaths.map(filePath => this.processFile(filePath, undefined, overwrite))
    );

    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      console.error(`❌ ${failures.length} files failed to process`);
    }
    
    console.log(`✅ ${results.length - failures.length}/${results.length} files processed successfully`);
  }
}

// CLI Usage
async function main() {
  const apiKey = Bun.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY environment variable is required');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: bun jsdoc-generator.ts <file1> [file2] [file3] ... [--overwrite]');
    process.exit(1);
  }

  const overwrite = args.includes('--overwrite');
  const files = args.filter(arg => arg !== '--overwrite');

  // Validate files exist and are supported
  const supportedExtensions = ['.ts', '.js', '.tsx', '.jsx'];
  const validFiles = [];

  for (const file of files) {
    const fileExists = await Bun.file(file).exists();
    if (!fileExists) {
      console.error(`❌ File not found: ${file}`);
      continue;
    }

    const ext = extname(file);
    if (!supportedExtensions.includes(ext)) {
      console.error(`❌ Unsupported file type: ${file} (${ext})`);
      continue;
    }

    validFiles.push(file);
  }

  if (validFiles.length === 0) {
    console.error('❌ No valid files to process');
    process.exit(1);
  }

  const generator = new JSDocGenerator(apiKey);
  
  try {
    await generator.processFiles(validFiles, overwrite);
  } catch (error) {
    console.error('❌ Processing failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main().catch(console.error);
}

export { JSDocGenerator };