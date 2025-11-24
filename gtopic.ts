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
 * GitHub Repository Analyzer with Gemini AI
 *
 * @description Analyzes GitHub repositories using GitIngest and Gemini AI
 * @author Mike Odnis
 * @license MIT
 *
 * @usage
 *   bun repo-analyzer.ts <github-url> <command> [options]
 *
 * @commands
 *   topics     - Suggest and optionally apply GitHub topics
 *   summary    - Generate comprehensive project summary
 *   tech       - Identify all technologies used
 *   improve    - Suggest specific improvements
 *
 * @options
 *   --apply    - Auto-apply suggested topics (requires GITHUB_TOKEN)
 *   --dry-run  - Show what would be applied without making changes
 *
 * @examples
 *   bun repo-analyzer.ts https://github.com/user/repo topics
 *   bun repo-analyzer.ts https://github.com/user/repo topics --apply
 *   bun repo-analyzer.ts https://github.com/user/repo summary
 *   bun repo-analyzer.ts https://github.com/user/repo topics --apply --merge
 */

import { GoogleGenAI, type Model } from "@google/genai";

// ============================================================================
// Type Definitions
// ============================================================================

interface GitIngestRequest {
	readonly input_text: string;
	readonly token: string;
	readonly max_file_size: string;
	readonly pattern_type: string;
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

interface GitHubTopicsResponse {
	readonly names: ReadonlyArray<string>;
}

interface GitHubError {
	readonly message: string;
	readonly documentation_url?: string;
}

type AnalysisType = "topics" | "summary" | "tech" | "improve";

interface AnalysisResult {
	readonly type: AnalysisType;
	readonly content: string;
	readonly topics?: ReadonlyArray<string>;
}

interface Config {
	readonly githubToken?: string;
	readonly geminiApiKey: string;
	readonly shouldApply: boolean;
	readonly isDryRun: boolean;
	readonly shouldMerge: boolean;
}

// ============================================================================
// Type Guards and Validation
// ============================================================================

function isValidGitHubUrl(url: string): boolean {
	const githubUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/?#]+$/;
	return githubUrlPattern.test(url);
}

function isValidAnalysisType(type: string): type is AnalysisType {
	return ["topics", "summary", "tech", "improve"].includes(type);
}

function isValidString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isValidStringArray(value: unknown): value is ReadonlyArray<string> {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isValidNumber(value: unknown): value is number {
	return typeof value === "number" && !isNaN(value);
}

function validateGitIngestResponse(data: unknown): GitIngestResponse {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid GitIngest response: not an object");
	}

	const response = data as Record<string, unknown>;

	const requiredFields = [
		"repo_url",
		"short_repo_url",
		"summary",
		"digest_url",
		"tree",
		"content",
		"default_max_file_size",
		"pattern_type",
		"pattern",
	];

	for (const field of requiredFields) {
		if (!(field in response)) {
			throw new Error(`Invalid GitIngest response: missing field '${field}'`);
		}
	}

	if (!isValidString(response.repo_url)) {
		throw new Error("Invalid GitIngest response: repo_url must be a string");
	}

	if (!isValidString(response.content)) {
		throw new Error("Invalid GitIngest response: content must be a string");
	}

	if (!isValidNumber(response.default_max_file_size)) {
		throw new Error(
			"Invalid GitIngest response: default_max_file_size must be a number",
		);
	}

	return {
		repo_url: response.repo_url,
		short_repo_url: response.short_repo_url as string,
		summary: response.summary as string,
		digest_url: response.digest_url as string,
		tree: response.tree as string,
		content: response.content,
		default_max_file_size: response.default_max_file_size,
		pattern_type: response.pattern_type as string,
		pattern: response.pattern as string,
	};
}

function validateGitHubTopicsResponse(data: unknown): GitHubTopicsResponse {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid GitHub topics response: not an object");
	}

	const response = data as Record<string, unknown>;

	if (!("names" in response)) {
		throw new Error("Invalid GitHub topics response: missing names field");
	}

	if (!isValidStringArray(response.names)) {
		throw new Error(
			"Invalid GitHub topics response: names must be an array of strings",
		);
	}

	return { names: response.names };
}

function validateGitHubError(data: unknown): GitHubError {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid GitHub error response: not an object");
	}

	const error = data as Record<string, unknown>;

	if (!("message" in error) || !isValidString(error.message)) {
		throw new Error(
			"Invalid GitHub error response: missing or invalid message",
		);
	}

	return {
		message: error.message,
		documentation_url: error.documentation_url as string | undefined,
	};
}

function validateModelParams(data: unknown): ModelParams {
	if (!data || typeof data !== "object") {
		throw new Error("Invalid model params: not an object");
	}

	const params = data as Record<string, unknown>;

	if (!("model" in params) || !isValidString(params.model)) {
		throw new Error("Invalid model params: model must be a string");
	}

	return { model: params.model };
}

// ============================================================================
// Constants
// ============================================================================

const GITINGEST_API = "https://gitingest.com/api/ingest" as const;
const GITHUB_API = "https://api.github.com" as const;
const GITHUB_API_VERSION = "2022-11-28" as const;
const DEFAULT_MAX_FILE_SIZE = "1118" as const;
const CONTENT_PREVIEW_LENGTH = 3_000 as const;

// ============================================================================
// Gemini Model Selection
// ============================================================================

async function getLatestFreeModel(apiKey: string): Promise<ModelParams> {
	if (!isValidString(apiKey)) {
		throw new Error("Invalid API key for getLatestFreeModel");
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
				model.name?.includes("flash") && !model.name?.includes("pro"),
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

		const modelName =
			freeModels[0].name?.replace("models/", "") || "gemini-1.5-flash";
		return validateModelParams({ model: modelName });
	} catch (error) {
		console.error(
			"⚠️  Error fetching models:",
			error instanceof Error ? error.message : "Unknown error",
		);
		return { model: "gemini-1.5-flash" };
	}
}

// ============================================================================
// GitIngest Integration
// ============================================================================

async function fetchRepositoryContent(
	repoUrl: string,
): Promise<GitIngestResponse> {
	if (!isValidGitHubUrl(repoUrl)) {
		throw new Error(`Invalid GitHub URL format: ${repoUrl}`);
	}

	const requestBody: GitIngestRequest = {
		input_text: repoUrl,
		token: "",
		max_file_size: DEFAULT_MAX_FILE_SIZE,
		pattern_type: "exclude",
		pattern: "",
	};

	try {
		const response = await fetch(GITINGEST_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			throw new Error(
				`GitIngest API failed: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return validateGitIngestResponse(data);
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Failed to fetch repository content: ${error.message}`);
		}
		throw new Error("Failed to fetch repository content: Unknown error");
	}
}

// ============================================================================
// GitHub API Integration
// ============================================================================

function parseGitHubUrl(url: string): { owner: string; repo: string } {
	if (!isValidGitHubUrl(url)) {
		throw new Error(`Invalid GitHub URL format: ${url}`);
	}

	const match = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
	if (!match || !match[1] || !match[2]) {
		throw new Error(`Failed to parse GitHub URL: ${url}`);
	}

	const owner = match[1].trim();
	const repo = match[2].trim();

	if (!owner || !repo) {
		throw new Error(`Invalid owner or repository name in URL: ${url}`);
	}

	return { owner, repo };
}

async function getCurrentTopics(
	owner: string,
	repo: string,
	token: string,
): Promise<ReadonlyArray<string>> {
	if (!isValidString(owner) || !isValidString(repo) || !isValidString(token)) {
		throw new Error("Invalid parameters for getCurrentTopics");
	}

	try {
		const response = await fetch(
			`${GITHUB_API}/repos/${owner}/${repo}/topics`,
			{
				method: "GET",
				headers: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${token}`,
					"X-GitHub-Api-Version": GITHUB_API_VERSION,
				},
			},
		);

		if (!response.ok) {
			try {
				const errorData = await response.json();
				const error = validateGitHubError(errorData);
				throw new Error(`Failed to get topics: ${error.message}`);
			} catch (parseError) {
				throw new Error(
					`Failed to get topics: ${response.status} ${response.statusText}`,
				);
			}
		}

		const data = await response.json();
		const validatedData = validateGitHubTopicsResponse(data);
		return validatedData.names;
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Failed to fetch current topics: ${error.message}`);
		}
		throw new Error("Failed to fetch current topics: Unknown error");
	}
}

async function setRepositoryTopics(
	owner: string,
	repo: string,
	topics: ReadonlyArray<string>,
	token: string,
): Promise<void> {
	if (!isValidString(owner) || !isValidString(repo) || !isValidString(token)) {
		throw new Error("Invalid parameters for setRepositoryTopics");
	}

	if (!isValidStringArray(topics)) {
		throw new Error("Invalid topics array for setRepositoryTopics");
	}

	try {
		const response = await fetch(
			`${GITHUB_API}/repos/${owner}/${repo}/topics`,
			{
				method: "PUT",
				headers: {
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${token}`,
					"X-GitHub-Api-Version": GITHUB_API_VERSION,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ names: topics }),
			},
		);

		if (!response.ok) {
			try {
				const errorData = await response.json();
				const error = validateGitHubError(errorData);
				throw new Error(`Failed to set topics: ${error.message}`);
			} catch (parseError) {
				throw new Error(
					`Failed to set topics: ${response.status} ${response.statusText}`,
				);
			}
		}
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Failed to set repository topics: ${error.message}`);
		}
		throw new Error("Failed to set repository topics: Unknown error");
	}
}

// ============================================================================
// Gemini AI Analysis
// ============================================================================

async function analyzeRepository(
	repoData: GitIngestResponse,
	analysisType: AnalysisType,
	apiKey: string,
): Promise<AnalysisResult> {
	if (!isValidString(apiKey)) {
		throw new Error("Invalid API key for analysis");
	}

	try {
		const modelParams = await getLatestFreeModel(apiKey);
		const genAI = new GoogleGenAI({ apiKey });

		// Ensure content is not empty and within reasonable limits
		const content = repoData.content || "";
		const tree = repoData.tree || "";

		if (content.length === 0) {
			throw new Error("Repository content is empty");
		}

		const prompts: Record<AnalysisType, string> = {
			topics: `Analyze this repository and suggest 5-8 relevant GitHub topics/tags.
Return ONLY a JSON array of lowercase strings with no additional text.
Focus on: programming languages, frameworks, technologies, and project type.

Repository Tree:
${tree}

Content Sample:
${content.slice(0, CONTENT_PREVIEW_LENGTH)}`,

			summary: `Analyze this repository and provide a comprehensive summary with:
1. Project purpose and what it does (2-3 sentences)
2. Key technologies and frameworks used
3. Main features and functionality
4. Target audience or use case

Repository Tree:
${tree}

Content Sample:
${content.slice(0, CONTENT_PREVIEW_LENGTH)}`,

			tech: `List ALL technologies, frameworks, languages, and tools used in this repository.
Format as a categorized markdown list with:
- Languages
- Frameworks
- Libraries
- Tools/Build Systems
- Databases/Services

Repository Tree:
${tree}

Content Sample:
${content.slice(0, CONTENT_PREVIEW_LENGTH)}`,

			improve: `Provide 5 specific, actionable improvements for this repository:
1. Code organization and structure
2. Documentation quality
3. Testing and CI/CD
4. Security and best practices
5. Missing features or enhancements

For each, explain WHY it matters and HOW to implement it.

Repository Tree:
${tree}

Content Sample:
${content.slice(0, CONTENT_PREVIEW_LENGTH)}`,
		};

		const result = await genAI.models.generateContent({
			model: modelParams.model,
			contents: prompts[analysisType],
		});

		const responseContent =
			result.text || "No response generated from AI model";

		let topics: ReadonlyArray<string> | undefined;
		if (analysisType === "topics") {
			try {
				const jsonMatch = responseContent.match(/\[[\s\S]*?\]/);
				if (jsonMatch) {
					const parsedTopics = JSON.parse(jsonMatch[0]);
					if (isValidStringArray(parsedTopics)) {
						// Deduplicate topics from AI response
						topics = deduplicateTopics(parsedTopics);
					}
				}
			} catch (parseError) {
				console.log(
					"⚠️  Could not parse topics from AI response, continuing without topics",
				);
			}
		}

		return { type: analysisType, content: responseContent, topics };
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Failed to analyze repository: ${error.message}`);
		}
		throw new Error("Failed to analyze repository: Unknown error");
	}
}

// ============================================================================
// Topic Management
// ============================================================================

function normalizeTopic(topic: string): string {
	return topic.toLowerCase().trim().replace(/\s+/g, "-");
}

function deduplicateTopics(
	topics: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const normalizedSet = new Set<string>();
	const result: string[] = [];

	for (const topic of topics) {
		const normalized = normalizeTopic(topic);
		if (!normalizedSet.has(normalized) && normalized.length > 0) {
			normalizedSet.add(normalized);
			result.push(topic.trim());
		}
	}

	return result;
}

function mergeTopics(
	current: ReadonlyArray<string>,
	suggested: ReadonlyArray<string>,
): ReadonlyArray<string> {
	// First deduplicate each array individually
	const deduplicatedCurrent = deduplicateTopics(current);
	const deduplicatedSuggested = deduplicateTopics(suggested);

	// Then merge and deduplicate the combined result
	const combined = [...deduplicatedCurrent, ...deduplicatedSuggested];
	const finalTopics = deduplicateTopics(combined);

	// Convert to a mutable array before sorting, since ReadonlyArray does not have sort()
	return [...finalTopics].sort();
}

function displayTopicComparison(
	current: ReadonlyArray<string>,
	suggested: ReadonlyArray<string>,
	final: ReadonlyArray<string>,
): void {
	const separator = "=".repeat(80);

	console.log();
	console.log(separator);
	console.log("  🏷️  Topic Comparison");
	console.log(separator);
	console.log();

	// Current topics section
	console.log("  📌 Current Topics:");
	if (current.length > 0) {
		current.forEach((topic, index) => {
			console.log(`    ${(index + 1).toString().padStart(2)}. ${topic}`);
		});
	} else {
		console.log("    (none)");
	}
	console.log();

	// Suggested topics section
	console.log("  ✨ Suggested Topics:");
	if (suggested.length > 0) {
		suggested.forEach((topic, index) => {
			const isNew = !current.includes(topic);
			const status = isNew ? "NEW" : "EXISTING";
			console.log(
				`    ${(index + 1).toString().padStart(2)}. ${topic} (${status})`,
			);
		});
	} else {
		console.log("    (none)");
	}
	console.log();

	// Final topics section
	console.log("  🎯 Final Topics:");
	if (final.length > 0) {
		final.forEach((topic, index) => {
			console.log(`    ${(index + 1).toString().padStart(2)}. ${topic}`);
		});
	} else {
		console.log("    (none)");
	}

	console.log();
	console.log(separator);
	console.log();
}

// ============================================================================
// Display Functions
// ============================================================================

function displayHeader(repoUrl: string, analysisType: string): void {
	const separator = "=".repeat(80);
	const title = "🔍 GitHub Repository Analyzer";
	const repo = `📦 Repository: ${repoUrl}`;
	const analysis = `📊 Analysis: ${analysisType.toUpperCase()}`;

	console.log();
	console.log(separator);
	console.log(`  ${title}`);
	console.log(separator);
	console.log(`  ${repo}`);
	console.log(`  ${analysis}`);
	console.log(separator);
	console.log();
}

function displayFetchProgress(repoData: GitIngestResponse): void {
	const summaryLines = repoData.summary
		.split("\n")
		.filter((line) => line.trim());
	const statsLine = summaryLines[1] || "Statistics not available";
	const filesLine = summaryLines[2] || "File count not available";

	console.log("✅ Repository content fetched successfully");
	console.log(`   📊 ${statsLine}`);
	console.log(`   📦 ${filesLine}`);
	console.log();
}

function displayAnalysisResult(result: AnalysisResult): void {
	const separator = "=".repeat(80);
	const title = `📋 ${result.type.toUpperCase()} Analysis Results`;

	console.log();
	console.log(separator);
	console.log(`  ${title}`);
	console.log(separator);
	console.log();

	// Format content with proper indentation
	const lines = result.content.split("\n");
	lines.forEach((line) => {
		if (line.trim()) {
			console.log(`  ${line}`);
		} else {
			console.log();
		}
	});

	console.log();
	console.log(separator);
	console.log();
}

function displayTopics(topics: ReadonlyArray<string>, label: string): void {
	const separator = "=".repeat(80);

	console.log();
	console.log(separator);
	console.log(`  🏷️  ${label}`);
	console.log(separator);
	console.log();

	if (topics.length === 0) {
		console.log("  No topics found");
	} else {
		topics.forEach((topic, index) => {
			console.log(`  ${(index + 1).toString().padStart(2)}. ${topic}`);
		});
	}

	console.log();
	console.log(separator);
	console.log();
}

// ============================================================================
// Main Logic
// ============================================================================

async function handleTopicsAnalysis(
	repoUrl: string,
	result: AnalysisResult,
	config: Config,
): Promise<void> {
	if (!result.topics || result.topics.length === 0) {
		console.log("⚠️  Could not extract topics from analysis");
		return;
	}

	const { owner, repo } = parseGitHubUrl(repoUrl);

	// Get current topics if we have a token
	let currentTopics: ReadonlyArray<string> = [];
	if (config.githubToken) {
		try {
			currentTopics = await getCurrentTopics(owner, repo, config.githubToken);
		} catch (error) {
			console.log(
				"⚠️  Could not fetch current topics:",
				error instanceof Error ? error.message : "Unknown error",
			);
		}
	}

	// Determine final topics based on merge flag
	const finalTopics = config.shouldMerge
		? mergeTopics(currentTopics, result.topics)
		: result.topics;

	// Display comparison if merging or if current topics exist
	if (config.shouldMerge || currentTopics.length > 0) {
		displayTopicComparison(currentTopics, result.topics, finalTopics);
	} else {
		displayTopics(finalTopics, "Suggested Topics");
	}

	if (!config.githubToken) {
		console.log("💡 To apply topics, set GITHUB_TOKEN environment variable");
		console.log(`   export GITHUB_TOKEN=your_token_here`);
		return;
	}

	if (config.isDryRun) {
		console.log("=".repeat(70));
		console.log("🔍 DRY RUN - Would apply these topics:");
		finalTopics.forEach((topic) => console.log(`   • ${topic}`));
		console.log("=".repeat(70));
		return;
	}

	if (!config.shouldApply) {
		console.log("=".repeat(70));
		console.log("💡 To apply these topics, use:");
		console.log(
			`   bun repo-analyzer.ts ${repoUrl} topics --apply${config.shouldMerge ? " --merge" : ""}`,
		);
		console.log("=".repeat(70));
		return;
	}

	try {
		console.log("=".repeat(70));
		console.log(`🔧 ${config.shouldMerge ? "Merging" : "Setting"} topics...`);
		await setRepositoryTopics(owner, repo, finalTopics, config.githubToken);
		console.log("✅ Topics applied successfully!");
		console.log();
		console.log("Final topics on repository:");
		finalTopics.forEach((topic) => console.log(`   • ${topic}`));
		console.log("=".repeat(70));
		console.log();
	} catch (error) {
		throw new Error(
			`Failed to apply topics: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

function validateInputs(args: string[]): {
	repoUrl: string;
	analysisType: AnalysisType;
	config: Config;
} {
	if (args.length < 2) {
		throw new Error("Insufficient arguments provided");
	}

	const repoUrl = args[0];
	const analysisType = args[1];

	if (!isValidGitHubUrl(repoUrl)) {
		throw new Error(`Invalid GitHub URL: ${repoUrl}`);
	}

	if (!isValidAnalysisType(analysisType)) {
		throw new Error(
			`Invalid analysis type: ${analysisType}. Must be one of: topics, summary, tech, improve`,
		);
	}

	const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
	if (!isValidString(geminiApiKey)) {
		throw new Error(
			"GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required",
		);
	}

	const githubToken = process.env.GITHUB_TOKEN;
	if (githubToken && !isValidString(githubToken)) {
		throw new Error("GITHUB_TOKEN environment variable is invalid");
	}

	const config: Config = {
		githubToken,
		geminiApiKey,
		shouldApply: args.includes("--apply"),
		isDryRun: args.includes("--dry-run"),
		shouldMerge: args.includes("--merge"),
	};

	return { repoUrl, analysisType, config };
}

function displayUsage(): void {
	const separator = "=".repeat(80);

	console.log();
	console.log(separator);
	console.log("  📖 GitHub Repository Analyzer - Usage Guide");
	console.log(separator);
	console.log();
	console.log("  Usage: bun repo-analyzer.ts <github-url> <command> [options]");
	console.log();
	console.log("  Commands:");
	console.log("    topics     - Suggest and optionally apply GitHub topics");
	console.log("    summary    - Generate comprehensive project summary");
	console.log("    tech       - Identify all technologies used");
	console.log("    improve    - Suggest specific improvements");
	console.log();
	console.log("  Options:");
	console.log(
		"    --apply    - Auto-apply suggested topics (requires GITHUB_TOKEN)",
	);
	console.log(
		"    --merge    - Merge with existing topics instead of replacing",
	);
	console.log(
		"    --dry-run  - Show what would be applied without making changes",
	);
	console.log();
	console.log("  Examples:");
	console.log("    bun repo-analyzer.ts https://github.com/user/repo topics");
	console.log(
		"    bun repo-analyzer.ts https://github.com/user/repo topics --apply",
	);
	console.log(
		"    bun repo-analyzer.ts https://github.com/user/repo topics --apply --merge",
	);
	console.log("    bun repo-analyzer.ts https://github.com/user/repo summary");
	console.log();
	console.log("  Environment Variables:");
	console.log(
		"    GEMINI_API_KEY or GOOGLE_API_KEY - Required for AI analysis",
	);
	console.log("    GITHUB_TOKEN - Required for applying topics");
	console.log();
	console.log(separator);
	console.log();
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	try {
		if (args.length < 2) {
			displayUsage();
			process.exit(1);
		}

		const { repoUrl, analysisType, config } = validateInputs(args);

		displayHeader(repoUrl, analysisType);

		console.log("📥 Fetching repository content...");
		const repoData = await fetchRepositoryContent(repoUrl);
		displayFetchProgress(repoData);

		console.log("🤖 Analyzing with Gemini AI...");
		const result = await analyzeRepository(
			repoData,
			analysisType,
			config.geminiApiKey,
		);
		console.log();

		displayAnalysisResult(result);

		if (analysisType === "topics") {
			await handleTopicsAnalysis(repoUrl, result, config);
		}

		const separator = "=".repeat(80);
		console.log(separator);
		console.log("  ✅ Analysis completed successfully");
		console.log(separator);
		console.log();
	} catch (error) {
		const separator = "=".repeat(80);
		console.log();
		console.log(separator);
		console.log("  ❌ Error occurred during execution");
		console.log(separator);
		console.log();

		if (error instanceof Error) {
			console.log(`  Error: ${error.message}`);
			console.log();

			if (
				error.message.includes("GEMINI_API_KEY") ||
				error.message.includes("GOOGLE_API_KEY")
			) {
				console.log(
					"  💡 Get your API key at: https://makersuite.google.com/app/apikey",
				);
			} else if (error.message.includes("GITHUB_TOKEN")) {
				console.log(
					"  💡 Get your GitHub token at: https://github.com/settings/tokens",
				);
			}
		} else {
			console.log(`  Error: ${String(error)}`);
		}

		console.log();
		console.log(separator);
		console.log();
		process.exit(1);
	}
}

main();
