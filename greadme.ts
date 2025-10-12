#!/usr/bin/env bun
/**
 * Copyright (c) 2025 Mike Odnis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * AI-Powered README Generator
 * 
 * @description Generates comprehensive, interactive README documentation using Gemini AI
 * @author Mike Odnis
 * @license MIT
 * 
 * @usage
 *   bun readme-gen.ts <github-url> [options]
 * 
 * @options
 *   --format <md|mdx>    Output format (default: md)
 *   --output <file>      Save to file (default: stdout)
 *   --style <minimal|standard|comprehensive>  Documentation depth
 * 
 * @examples
 *   bun readme-gen.ts https://github.com/user/repo
 *   bun readme-gen.ts https://github.com/user/repo --format mdx
 *   bun readme-gen.ts https://github.com/user/repo --output README.md
 *   bun readme-gen.ts https://github.com/user/repo --style comprehensive
 *   bun readme-gen.ts https://github.com/user/repo --push
 *   bun readme-gen.ts https://github.com/user/repo --push --branch develop
 *   bun readme-gen.ts https://github.com/user/repo --push --branch develop --style comprehensive
 *   bun readme-gen.ts https://github.com/user/repo --push --branch develop --style comprehensive --format mdx
 *   bun readme-gen.ts https://github.com/user/repo --push --branch develop --style comprehensive --format mdx --output README.md
 *   bun readme-gen.ts https://github.com/user/repo --push --branch develop --style comprehensive --format mdx --output README.md
 */

import { GoogleGenAI, type Model } from "@google/genai";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// ============================================================================
// Type Definitions & Type Guards
// ============================================================================

// Strict type definitions with validation
interface GitIngestRequest {
  readonly input_text: string;
  readonly token: string;
  readonly max_file_size: string;
  readonly pattern_type: 'include' | 'exclude';
  readonly pattern: string;
}

interface GitIngestResponse {
  readonly repo_url: string;
  readonly short_repo_url: string;
  readonly summary: string;
  readonly digest_url: string;
  readonly tree: string;
  readonly content: string;
  readonly default_max_file_size: number;
  readonly pattern_type: string;
  readonly pattern: string;
}

interface ModelParams {
  readonly model: string;
}

type OutputFormat = 'md' | 'mdx';
type DocumentationStyle = 'minimal' | 'standard' | 'comprehensive';

interface Config {
  readonly geminiApiKey: string;
  readonly githubToken?: string;
  readonly outputFormat: OutputFormat;
  readonly outputFile: string;
  readonly shouldPush: boolean;
  readonly branch: string;
  readonly style: DocumentationStyle;
}

interface ReadmeGenerationResult {
  readonly content: string;
  readonly metadata: {
    readonly format: OutputFormat;
    readonly style: DocumentationStyle;
    readonly generatedAt: string;
    readonly repository: string;
  };
}

interface GitHubFileContent {
  readonly name: string;
  readonly path: string;
  readonly sha: string;
  readonly size: number;
  readonly content: string;
  readonly encoding: string;
}

interface GitHubError {
  readonly message: string;
  readonly documentation_url?: string;
}

// Error types for better error handling
class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class ApiError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly endpoint?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

class FileSystemError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'FileSystemError';
  }
}

// Type guard functions for runtime validation
function isValidUrl(url: string): url is string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
  } catch {
    return false;
  }
}

function isValidOutputFormat(format: string): format is OutputFormat {
  return format === 'md' || format === 'mdx';
}

function isValidDocumentationStyle(style: string): style is DocumentationStyle {
  return style === 'minimal' || style === 'standard' || style === 'comprehensive';
}

function isValidBranchName(branch: string): boolean {
  // GitHub branch name validation
  return /^[a-zA-Z0-9._-]+$/.test(branch) && branch.length <= 255;
}

function isValidFileName(filename: string): boolean {
  // Basic filename validation
  return /^[^<>:"/\\|?*]+$/.test(filename) && filename.length > 0 && filename.length <= 255;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidApiKey(apiKey: string): boolean {
  return isNonEmptyString(apiKey) && apiKey.length >= 20;
}

function isValidGitHubToken(token: string): boolean {
  return isNonEmptyString(token) && (token.startsWith('ghp_') || token.startsWith('gho_') || token.startsWith('ghu_') || token.startsWith('ghs_') || token.startsWith('ghr_'));
}

// ============================================================================
// Constants
// ============================================================================

const GITINGEST_API = 'https://gitingest.com/api/ingest' as const;
const GITHUB_API = 'https://api.github.com' as const;
const GITHUB_API_VERSION = '2022-11-28' as const;
const DEFAULT_MAX_FILE_SIZE = '1118' as const;
const CONTENT_PREVIEW_LENGTH = 8000 as const;

// ============================================================================
// Input Validation & Sanitization
// ============================================================================

function validateAndSanitizeInput(args: string[]): {
  repoUrl: string;
  outputFormat: OutputFormat;
  outputFile: string;
  branch: string;
  style: DocumentationStyle;
  shouldPush: boolean;
} {
  if (args.length === 0) {
    throw new ValidationError("Repository URL is required");
  }

  const repoUrl = args[0];
  if (!isValidUrl(repoUrl)) {
    throw new ValidationError("Invalid GitHub URL format. Expected: https://github.com/owner/repo", "repoUrl");
  }

  // Parse options with validation
  const formatIndex = args.indexOf('--format');
  const outputIndex = args.indexOf('--output');
  const branchIndex = args.indexOf('--branch');
  const styleIndex = args.indexOf('--style');
  const shouldPush = args.includes('--push');
  
  const outputFormat = (formatIndex !== -1 && args[formatIndex + 1]) 
    ? args[formatIndex + 1] as OutputFormat 
    : 'md';
  
  if (!isValidOutputFormat(outputFormat)) {
    throw new ValidationError(`Invalid output format: ${outputFormat}. Must be 'md' or 'mdx'`, "format");
  }
  
  const outputFile = (outputIndex !== -1 && args[outputIndex + 1]) 
    ? args[outputIndex + 1] 
    : `README.${outputFormat}`;
  
  if (!isValidFileName(outputFile)) {
    throw new ValidationError(`Invalid filename: ${outputFile}`, "output");
  }
  
  const branch = (branchIndex !== -1 && args[branchIndex + 1]) 
    ? args[branchIndex + 1] 
    : 'main';
  
  if (!isValidBranchName(branch)) {
    throw new ValidationError(`Invalid branch name: ${branch}`, "branch");
  }
  
  const style = (styleIndex !== -1 && args[styleIndex + 1]) 
    ? args[styleIndex + 1] as DocumentationStyle 
    : 'standard';
  
  if (!isValidDocumentationStyle(style)) {
    throw new ValidationError(`Invalid documentation style: ${style}. Must be 'minimal', 'standard', or 'comprehensive'`, "style");
  }

  return {
    repoUrl,
    outputFormat,
    outputFile,
    branch,
    style,
    shouldPush
  };
}

function validateEnvironmentVariables(shouldPush: boolean): {
  geminiApiKey: string;
  githubToken?: string;
} {
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiApiKey) {
    throw new ValidationError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required", "geminiApiKey");
  }

  if (!isValidApiKey(geminiApiKey)) {
    throw new ValidationError("Invalid API key format", "geminiApiKey");
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (shouldPush) {
    if (!githubToken) {
      throw new ValidationError("GITHUB_TOKEN environment variable is required for --push mode", "githubToken");
    }

    if (!isValidGitHubToken(githubToken)) {
      throw new ValidationError("Invalid GitHub token format", "githubToken");
    }
  }

  return { geminiApiKey, githubToken };
}

// ============================================================================
// Gemini Model Selection
// ============================================================================

async function getLatestFreeModel(apiKey: string): Promise<ModelParams> {
  if (!isValidApiKey(apiKey)) {
    throw new ValidationError("Invalid Gemini API key format");
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelsPager = await genAI.models.list();

    const allModels: Model[] = [];
    for await (const model of modelsPager) {
      allModels.push(model);
    }

    const freeModels = allModels.filter(
      (model: Model) =>
        model.name?.includes("flash") && !model.name?.includes("pro")
    );

    freeModels.sort((a: Model, b: Model) => {
      const extractVersion = (name?: string): number => {
        if (!name) return 0;
        const match = name.match(/(\d+\.?\d*)/g);
        return match ? parseFloat(match.join(".")) : 0;
      };
      return extractVersion(b.name) - extractVersion(a.name);
    });

    if (freeModels.length === 0) {
      return { model: "gemini-1.5-flash" };
    }

    const modelName = freeModels[0].name?.replace("models/", "") || "gemini-1.5-flash";
    return { model: modelName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new ApiError(`Failed to fetch Gemini models: ${errorMessage}`, undefined, "Gemini API");
  }
}

// ============================================================================
// GitHub Repository Utilities
// ============================================================================

function parseGitHubUrl(url: string): { owner: string; repo: string } {
  if (!isValidUrl(url)) {
    throw new ValidationError("Invalid GitHub URL format", "url");
  }

  const match = url.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
  if (!match || !match[1] || !match[2]) {
    throw new ValidationError("Could not parse owner and repository from URL", "url");
  }

  const owner = match[1].trim();
  const repo = match[2].trim();

  if (!isNonEmptyString(owner) || !isNonEmptyString(repo)) {
    throw new ValidationError("Owner and repository names cannot be empty", "url");
  }

  return { owner, repo };
}

async function getExistingReadme(
  owner: string,
  repo: string,
  filename: string,
  token: string
): Promise<GitHubFileContent | null> {
  if (!isNonEmptyString(owner) || !isNonEmptyString(repo) || !isNonEmptyString(filename)) {
    throw new ValidationError("Owner, repository, and filename must be non-empty strings");
  }

  if (!isValidGitHubToken(token)) {
    throw new ValidationError("Invalid GitHub token format");
  }

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${filename}`,
      {
        method: "GET",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        }
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.json() as GitHubError;
      throw new ApiError(`Failed to get existing README: ${error.message}`, response.status, "GitHub API");
    }

    return await response.json() as GitHubFileContent;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new ApiError(`GitHub API request failed: ${errorMessage}`, undefined, "GitHub API");
  }
}

async function pushReadmeToGitHub(
  owner: string,
  repo: string,
  filename: string,
  content: string,
  branch: string,
  token: string
): Promise<void> {
  if (!isNonEmptyString(owner) || !isNonEmptyString(repo) || !isNonEmptyString(filename)) {
    throw new ValidationError("Owner, repository, and filename must be non-empty strings");
  }

  if (!isNonEmptyString(content)) {
    throw new ValidationError("Content cannot be empty");
  }

  if (!isValidBranchName(branch)) {
    throw new ValidationError(`Invalid branch name: ${branch}`);
  }

  if (!isValidGitHubToken(token)) {
    throw new ValidationError("Invalid GitHub token format");
  }

  try {
    // Get existing file SHA if it exists
    const existingFile = await getExistingReadme(owner, repo, filename, token);
    
    const requestBody = {
      message: `docs: update ${filename} with AI-generated documentation`,
      content: Buffer.from(content).toString('base64'),
      branch,
      ...(existingFile && { sha: existingFile.sha })
    };

    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${filename}`,
      {
        method: "PUT",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const error = await response.json() as GitHubError;
      throw new ApiError(`Failed to push README: ${error.message}`, response.status, "GitHub API");
    }
  } catch (error) {
    if (error instanceof ApiError || error instanceof ValidationError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new ApiError(`GitHub push failed: ${errorMessage}`, undefined, "GitHub API");
  }
}

// ============================================================================
// GitIngest Integration
// ============================================================================

async function fetchRepositoryContent(repoUrl: string): Promise<GitIngestResponse> {
  if (!isValidUrl(repoUrl)) {
    throw new ValidationError("Invalid GitHub URL format", "repoUrl");
  }

  const requestBody: GitIngestRequest = {
    input_text: repoUrl,
    token: "",
    max_file_size: DEFAULT_MAX_FILE_SIZE,
    pattern_type: "exclude",
    pattern: ""
  };

  try {
    const response = await fetch(GITINGEST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new ApiError(`GitIngest API failed: ${response.status} ${response.statusText}`, response.status, "GitIngest API");
    }

    const data = await response.json() as GitIngestResponse;
    
    // Validate response structure
    if (!isNonEmptyString(data.repo_url) || !isNonEmptyString(data.content)) {
      throw new ApiError("Invalid response from GitIngest API", response.status, "GitIngest API");
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError || error instanceof ValidationError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new ApiError(`GitIngest API request failed: ${errorMessage}`, undefined, "GitIngest API");
  }
}

// ============================================================================
// README Generation Prompts
// ============================================================================

function buildReadmePrompt(
  repoData: GitIngestResponse,
  format: OutputFormat,
  style: DocumentationStyle
): string {
  const basePrompt = `Generate a polished, highly usable README (or documentation) in ${format.toUpperCase()} for this application.
The generated README should feel like a small documentation site, with good UX/navigation, structure, and interactivity.

CRITICAL: Return ONLY the raw ${format.toUpperCase()} content with NO explanatory text before or after. Start directly with the README content.

Here's what to include:

1. **Hero / Title Section + Short Tagline**
   - Project name (extract from repository)
   - One-line compelling summary
   - Relevant badges (build status, license, version, language)

2. **Table of Contents / Navigation Links**
   - Auto-generated TOC with anchor links
   - Section links for easy navigation
   - "Back to top" links for long sections

3. **Overview / Introduction**
   - What the application does, its purpose & goals
   - Why it matters / problem it solves
   - Target audience

4. **Feature Highlights**
   - Highlight main features with bullets and emojis
   - Use callout boxes (🔍, ⚠️, ✅, 💡)
   - Group related features

5. **Architecture / Design / Modules**
   - High-level component diagram using Mermaid
   - Explanation of each part/responsibility
   - Technology stack breakdown

6. **Getting Started / Installation / Setup**
   - Prerequisites with version requirements
   - Installation steps (clear code blocks)
   - Configuration (environment variables, config files)
   - Running in development and production

7. **Usage / Workflows / Examples**
   - Step-by-step scenarios
   - CLI commands with explanations
   - Code samples in proper language blocks
   - Common use cases

8. **Interactivity & Navigation Enhancements**
   - Use <details> tags for collapsible sections
   - Internal anchor links throughout
   - Embedded Mermaid diagrams
   ${format === 'mdx' ? '- Interactive MDX components (accordions, tabs)' : ''}

9. **Limitations, Known Issues & Future Roadmap**
   - Current limitations
   - Known issues
   - Planned enhancements
   - Feature requests

10. **Contributing & Development Guidelines**
    - How to contribute
    - Branch/PR guidelines
    - Code style, testing, linting
    - Development setup

11. **License, Credits & Contact**
    - License information
    - Dependencies and acknowledgments
    - Maintainer contact info

12. **Appendix / Optional Extras**
    - Changelog (recent updates)
    - FAQ section
    - Troubleshooting guide
    - API reference links

13. **Mermaid Diagrams**
    - Include at least one Mermaid diagram (flowchart, component diagram, or sequence diagram)
    - Should illustrate core processing flow or architecture
    - Integrate and explain in context

**Tone & Style Guidance:**
- Use clear headings (H1-H4), short paragraphs, bullet lists
- Use internal links and anchors extensively
- Use callout boxes (🔍, ⚠️, ✅, 💡, 🚀) for warnings, tips, and important notes
- Ensure documentation is scannable with minimal cognitive load
- Write in friendly, professional tone
${format === 'mdx' ? '- Use MDX components for enhanced interactivity' : ''}

**Documentation Style: ${style}**
${getStyleGuidance(style)}

**Repository Information:**
- URL: ${repoData.repo_url}
- Summary: ${repoData.summary}

**Repository Structure:**
\`\`\`
${repoData.tree}
\`\`\`

**Code Content Analysis:**
\`\`\`
${repoData.content.slice(0, CONTENT_PREVIEW_LENGTH)}
${repoData.content.length > CONTENT_PREVIEW_LENGTH ? '\n... (content truncated)' : ''}
\`\`\`

REMEMBER: Output ONLY the ${format.toUpperCase()} content. No preamble, no explanation, no markdown code fences around it. Just the raw README content starting with the title.`;

  return basePrompt;
}

function getStyleGuidance(style: DocumentationStyle): string {
  switch (style) {
    case 'minimal':
      return `- Focus on essential information only
- Shorter sections with key points
- Minimal examples, focus on quick start
- Basic Mermaid diagram`;
    
    case 'standard':
      return `- Balanced detail across all sections
- Multiple examples where relevant
- Moderate use of diagrams and callouts
- Standard Mermaid diagrams`;
    
    case 'comprehensive':
      return `- Exhaustive coverage of all aspects
- Multiple examples and use cases
- Extensive diagrams and visual aids
- Detailed troubleshooting and FAQ
- Multiple Mermaid diagrams for different aspects`;
    
    default:
      return '';
  }
}

// ============================================================================
// README Generation
// ============================================================================

async function generateReadme(
  repoData: GitIngestResponse,
  config: Config
): Promise<ReadmeGenerationResult> {
  if (!isNonEmptyString(repoData.content)) {
    throw new ValidationError("Repository content is empty");
  }

  if (!isValidApiKey(config.geminiApiKey)) {
    throw new ValidationError("Invalid Gemini API key");
  }

  try {
    const modelParams = await getLatestFreeModel(config.geminiApiKey);
    const genAI = new GoogleGenAI({ apiKey: config.geminiApiKey });

    const prompt = buildReadmePrompt(repoData, config.outputFormat, config.style);

    const result = await genAI.models.generateContent({
      model: modelParams.model,
      contents: prompt
    });

    const content = result.text || "";

    if (!isNonEmptyString(content)) {
      throw new ApiError("AI model returned empty content", undefined, "Gemini API");
    }

    // Clean up any potential markdown code fences if they slipped through
    const cleanedContent = content
      .replace(/^```(?:md|mdx|markdown)?\s*\n/i, '')
      .replace(/\n```\s*$/i, '')
      .trim();

    if (!isNonEmptyString(cleanedContent)) {
      throw new ApiError("Generated content is empty after cleaning", undefined, "Gemini API");
    }

    return {
      content: cleanedContent,
      metadata: {
        format: config.outputFormat,
        style: config.style,
        generatedAt: new Date().toISOString(),
        repository: repoData.repo_url
      }
    };
  } catch (error) {
    if (error instanceof ApiError || error instanceof ValidationError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new ApiError(`README generation failed: ${errorMessage}`, undefined, "Gemini API");
  }
}

// ============================================================================
// File Output
// ============================================================================

async function saveReadmeLocally(
  result: ReadmeGenerationResult,
  outputFile: string
): Promise<void> {
  if (!isNonEmptyString(result.content)) {
    throw new ValidationError("Generated content cannot be empty");
  }

  if (!isValidFileName(outputFile)) {
    throw new ValidationError(`Invalid output filename: ${outputFile}`);
  }

  try {
    // Ensure directory exists
    const outputDir = dirname(outputFile);
    if (outputDir !== '.' && !existsSync(outputDir)) {
      throw new FileSystemError(`Output directory does not exist: ${outputDir}`, outputDir);
    }

    const header = `<!--
  Generated by AI-Powered README Generator
  Repository: ${result.metadata.repository}
  Generated: ${result.metadata.generatedAt}
  Format: ${result.metadata.format}
  Style: ${result.metadata.style}
-->\n\n`;

    const fullContent = header + result.content;
    
    await writeFile(outputFile, fullContent, 'utf-8');
  } catch (error) {
    if (error instanceof ValidationError || error instanceof FileSystemError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new FileSystemError(`Failed to save file: ${errorMessage}`, outputFile);
  }
}

async function handleReadmeOutput(
  result: ReadmeGenerationResult,
  config: Config,
  repoUrl: string
): Promise<void> {
  const fullContent = `<!--
  Generated by AI-Powered README Generator
  Repository: ${result.metadata.repository}
  Generated: ${result.metadata.generatedAt}
  Format: ${result.metadata.format}
  Style: ${result.metadata.style}
-->\n\n${result.content}`;

  if (config.shouldPush) {
    if (!config.githubToken) {
      throw new Error("GITHUB_TOKEN required to push to repository");
    }

    const { owner, repo } = parseGitHubUrl(repoUrl);
    
    console.log(`\n🔄 Pushing README to ${owner}/${repo}...`);
    console.log(`   Branch: ${config.branch}`);
    console.log(`   File: ${config.outputFile}`);
    
    await pushReadmeToGitHub(
      owner,
      repo,
      config.outputFile,
      fullContent,
      config.branch,
      config.githubToken
    );
    
    console.log(`✅ README pushed successfully!`);
    console.log(`   View: https://github.com/${owner}/${repo}/blob/${config.branch}/${config.outputFile}`);
  } else {
    await saveReadmeLocally(result, config.outputFile);
    console.log(`\n✅ README saved to: ${config.outputFile}`);
  }
}

// ============================================================================
// Display Functions & User Experience
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}

function createProgressBar(current: number, total: number, width: number = 30): string {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage}%`;
}

function displayHeader(repoUrl: string, config: Config): void {
  console.clear();
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + " ".repeat(20) + "📝 AI-Powered README Generator" + " ".repeat(20) + "║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log(`║ 📦 Repository: ${repoUrl.padEnd(55)} ║`);
  console.log(`║ 📄 Format: ${config.outputFormat.toUpperCase().padEnd(58)} ║`);
  console.log(`║ 📊 Style: ${config.style.padEnd(60)} ║`);
  console.log(`║ 💾 Output: ${config.outputFile.padEnd(59)} ║`);
  if (config.shouldPush) {
    console.log(`║ 🚀 Mode: Push to GitHub (${config.branch})${" ".repeat(35)} ║`);
  } else {
    console.log(`║ 📁 Mode: Save locally${" ".repeat(45)} ║`);
  }
  console.log("╚" + "═".repeat(68) + "╝");
  console.log();
}

function displayProgress(step: string, current: number, total: number): void {
  const progress = createProgressBar(current, total);
  process.stdout.write(`\r🔄 ${step} ${progress}`);
  if (current === total) {
    process.stdout.write('\n');
  }
}

function displayResult(result: ReadmeGenerationResult): void {
  const lines = result.content.split('\n').length;
  const size = formatBytes(result.content.length);
  const generated = formatTimestamp(result.metadata.generatedAt);
  
  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + " ".repeat(25) + "📊 Generation Summary" + " ".repeat(25) + "║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log(`║ Format: ${result.metadata.format.padEnd(59)} ║`);
  console.log(`║ Style: ${result.metadata.style.padEnd(60)} ║`);
  console.log(`║ Generated: ${generated.padEnd(50)} ║`);
  console.log(`║ Lines: ${lines.toString().padEnd(61)} ║`);
  console.log(`║ Size: ${size.padEnd(63)} ║`);
  console.log("╚" + "═".repeat(68) + "╝");
}

function displayError(error: Error): void {
  console.log("\n╔" + "═".repeat(68) + "╗");
  console.log("║" + " ".repeat(25) + "❌ Error Occurred" + " ".repeat(27) + "║");
  console.log("╠" + "═".repeat(68) + "╣");
  
  if (error instanceof ValidationError) {
    console.log(`║ Validation Error: ${error.message.padEnd(48)} ║`);
    if (error.field) {
      console.log(`║ Field: ${error.field.padEnd(60)} ║`);
    }
  } else if (error instanceof ApiError) {
    console.log(`║ API Error: ${error.message.padEnd(57)} ║`);
    if (error.statusCode) {
      console.log(`║ Status: ${error.statusCode.toString().padEnd(60)} ║`);
    }
    if (error.endpoint) {
      console.log(`║ Endpoint: ${error.endpoint.padEnd(58)} ║`);
    }
  } else if (error instanceof FileSystemError) {
    console.log(`║ File System Error: ${error.message.padEnd(48)} ║`);
    if (error.path) {
      console.log(`║ Path: ${error.path.padEnd(62)} ║`);
    }
  } else {
    console.log(`║ ${error.message.padEnd(66)} ║`);
  }
  
  console.log("╚" + "═".repeat(68) + "╝");
}

// ============================================================================
// Main Logic
// ============================================================================

function displayUsage(): void {
  console.log("╔" + "═".repeat(68) + "╗");
  console.log("║" + " ".repeat(20) + "📝 AI-Powered README Generator" + " ".repeat(20) + "║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log("║ Usage: bun readme-gen.ts <github-url> [options]".padEnd(68) + " ║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log("║ Options:".padEnd(68) + " ║");
  console.log("║   --format <md|mdx>                      Output format (default: md)".padEnd(68) + " ║");
  console.log("║   --output <file>                        Output filename (default: README.md)".padEnd(68) + " ║");
  console.log("║   --push                                 Push directly to GitHub repo".padEnd(68) + " ║");
  console.log("║   --branch <name>                        Branch to push to (default: main)".padEnd(68) + " ║");
  console.log("║   --style <minimal|standard|comprehensive>  Documentation depth".padEnd(68) + " ║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log("║ Modes:".padEnd(68) + " ║");
  console.log("║   Local:  Saves to current directory".padEnd(68) + " ║");
  console.log("║   Push:   Commits directly to GitHub repository (requires GITHUB_TOKEN)".padEnd(68) + " ║");
  console.log("╠" + "═".repeat(68) + "╣");
  console.log("║ Examples:".padEnd(68) + " ║");
  console.log("║   # Save to current directory".padEnd(68) + " ║");
  console.log("║   bun readme-gen.ts https://github.com/user/repo".padEnd(68) + " ║");
  console.log("║   bun readme-gen.ts https://github.com/user/repo --output DOCS.md".padEnd(68) + " ║");
  console.log("║".padEnd(68) + " ║");
  console.log("║   # Push to GitHub repository".padEnd(68) + " ║");
  console.log("║   export GITHUB_TOKEN=your_token".padEnd(68) + " ║");
  console.log("║   bun readme-gen.ts https://github.com/user/repo --push".padEnd(68) + " ║");
  console.log("║   bun readme-gen.ts https://github.com/user/repo --push --branch develop".padEnd(68) + " ║");
  console.log("║".padEnd(68) + " ║");
  console.log("║   # Comprehensive docs pushed to GitHub".padEnd(68) + " ║");
  console.log("║   bun readme-gen.ts https://github.com/user/repo --style comprehensive --push".padEnd(68) + " ║");
  console.log("╚" + "═".repeat(68) + "╝");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    displayUsage();
    process.exit(1);
  }

  try {
    // Validate and parse input
    const input = validateAndSanitizeInput(args);
    const envVars = validateEnvironmentVariables(input.shouldPush);

    const config: Config = {
      geminiApiKey: envVars.geminiApiKey,
      githubToken: envVars.githubToken,
      outputFormat: input.outputFormat,
      outputFile: input.outputFile,
      shouldPush: input.shouldPush,
      branch: input.branch,
      style: input.style
    };

    displayHeader(input.repoUrl, config);

    // Step 1: Fetch repository content
    displayProgress("Fetching repository content", 1, 4);
    const repoData = await fetchRepositoryContent(input.repoUrl);
    displayProgress("Repository content fetched", 2, 4);

    // Step 2: Get AI model
    displayProgress("Initializing AI model", 3, 4);
    const modelParams = await getLatestFreeModel(config.geminiApiKey);
    
    // Step 3: Generate README
    displayProgress("Generating README with AI", 4, 4);
    const result = await generateReadme(repoData, config);

    await handleReadmeOutput(result, config, input.repoUrl);
    
    displayResult(result);

    console.log("\n╔" + "═".repeat(68) + "╗");
    console.log("║" + " ".repeat(25) + "🎉 README Generation Complete!" + " ".repeat(25) + "║");
    console.log("╚" + "═".repeat(68) + "╝");
  } catch (error) {
    displayError(error instanceof Error ? error : new Error(String(error)));
    
    // Provide helpful suggestions based on error type
    if (error instanceof ValidationError) {
      console.log("\n💡 Suggestions:");
      if (error.field === 'repoUrl') {
        console.log("   • Ensure the URL is a valid GitHub repository URL");
        console.log("   • Format: https://github.com/owner/repository");
      } else if (error.field === 'geminiApiKey') {
        console.log("   • Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable");
        console.log("   • Get your key: https://makersuite.google.com/app/apikey");
      } else if (error.field === 'githubToken') {
        console.log("   • Set GITHUB_TOKEN environment variable for --push mode");
        console.log("   • Get token: https://github.com/settings/tokens");
      }
    } else if (error instanceof ApiError) {
      console.log("\n💡 Suggestions:");
      if (error.endpoint === 'GitHub API') {
        console.log("   • Check your GitHub token permissions");
        console.log("   • Ensure the repository exists and is accessible");
      } else if (error.endpoint === 'Gemini API') {
        console.log("   • Verify your Gemini API key is correct");
        console.log("   • Check your API quota and billing");
      }
    }
    
    process.exit(1);
  }
}

main();