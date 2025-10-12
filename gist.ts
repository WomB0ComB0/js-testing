#!/usr/bin/env node

// -*- typescript -*-

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

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

/**
 * Interface for file data structure
 */
interface FileData {
	content: string;
	description: string;
	size: number;
	extension: string;
}

/**
 * Interface for application configuration
 */
interface AppConfig {
	model: string;
	maxOutputTokens: number;
	temperature: number;
	maxConcurrency: number;
	retryAttempts: number;
	retryDelay: number;
	maxFileSize: number;
	supportedExtensions: Set<string>;
	truncateContentAt: number;
}

/**
 * Interface for GitHub API response
 */
interface GistResponse {
	html_url: string;
	id: string;
	description: string;
}

/**
 * Decorator that automatically instantiates a class when it's defined.
 * @param constructor - The class constructor to instantiate
 * @returns The original constructor
 */
function selfExecute<T extends { new (...args: any[]): {} }>(constructor: T) {
	new constructor();
	return constructor;
}

/**
 * Enhanced GitHub Gist creator with AI-generated descriptions.
 * Features improved error handling, file filtering, progress tracking,
 * and better user experience.
 */
@selfExecute
class Gist {
	private readonly geminiApiKey: string;
	private readonly githubToken: string;
	private readonly rl: readline.Interface;
	private readonly ai: GoogleGenAI;
	private readonly config: AppConfig;

	/**
	 * Initializes the application with enhanced configuration and validation.
	 */
	constructor() {
		this.geminiApiKey = process.env.GEMINI_API_KEY || "";
		this.githubToken = process.env.GITHUB_TOKEN || "";
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		this.ai = new GoogleGenAI({ apiKey: this.geminiApiKey });

		this.config = {
			model: "gemini-2.0-flash-exp",
			maxOutputTokens: 8_192,
			temperature: 0.1,
			maxConcurrency: 3,
			retryAttempts: 3,
			retryDelay: 1_000,
			maxFileSize: 1_024 * 1_024, // 1MB
			supportedExtensions: new Set([
				"js",
				"ts",
				"jsx",
				"tsx",
				"py",
				"java",
				"cpp",
				"c",
				"cs",
				"php",
				"rb",
				"go",
				"rs",
				"swift",
				"kt",
				"scala",
				"html",
				"css",
				"scss",
				"sass",
				"less",
				"json",
				"xml",
				"yaml",
				"yml",
				"md",
				"txt",
				"sql",
				"sh",
				"bash",
				"ps1",
				"dockerfile",
				"makefile",
				"cmake",
				"gradle",
			]),
			truncateContentAt: 8_000,
		};

		this.initialize();
	}

	/**
	 * Validates environment and initializes the application.
	 */
	private initialize(): void {
		this.validateEnvironmentVariables();
		this.displayWelcomeMessage();

		if (import.meta.url === `file://${process.argv[1]}`) {
			this.run()
				.catch((error) => {
					console.error("\n❌ Application error:", error.message);
					process.exit(1);
				})
				.finally(() => this.rl.close());
		}
	}

	/**
	 * Displays a welcome message with application info.
	 */
	private displayWelcomeMessage(): void {
		console.log("\n🚀 Enhanced GitHub Gist Creator with AI Descriptions");
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log(
			`📂 Max file size: ${this.formatBytes(this.config.maxFileSize)}`,
		);
		console.log(
			`🔧 Supported extensions: ${Array.from(this.config.supportedExtensions).slice(0, 10).join(", ")}${this.config.supportedExtensions.size > 10 ? "..." : ""}`,
		);
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
	}

	/**
	 * Validates required environment variables with better error messages.
	 */
	private validateEnvironmentVariables(): void {
		const errors: string[] = [];

		if (!this.geminiApiKey) {
			errors.push("❌ GEMINI_API_KEY environment variable is required");
		}

		if (!this.githubToken) {
			errors.push(
				"❌ GITHUB_TOKEN or GITHUB_TOKEN_M environment variable is required",
			);
		}

		if (errors.length > 0) {
			console.error("\n🔴 Configuration Error:");
			errors.forEach((error) => console.error(error));
			console.error(
				"\n💡 Please set the required environment variables and try again.",
			);
			process.exit(1);
		}
	}

	/**
	 * Enhanced user prompt with better formatting.
	 */
	private async promptUser(question: string): Promise<string> {
		return new Promise((resolve) => {
			this.rl.question(`\n❓ ${question}`, (answer) => {
				resolve(answer.trim());
			});
		});
	}

	/**
	 * Main execution flow with enhanced error handling and progress tracking.
	 */
	async run(): Promise<void> {
		try {
			const currentDir = process.cwd();
			console.log(`📍 Working directory: ${currentDir}`);

			const allFiles = this.listFiles(currentDir);
			const validFiles = this.filterValidFiles(allFiles, currentDir);

			if (validFiles.length === 0) {
				console.log("\n⚠️  No valid files found in the current directory.");
				return;
			}

			this.displayFiles(validFiles, currentDir);

			const selectedFiles = await this.selectFiles(validFiles);

			if (selectedFiles.length === 0) {
				console.log("\n👋 No files selected. Goodbye!");
				return;
			}

			console.log(`\n✅ Selected ${selectedFiles.length} file(s):`);
			selectedFiles.forEach((file) => console.log(`   • ${file}`));

			const titleFile = await this.chooseTitleFile(selectedFiles);
			console.log(`\n📌 Using "${titleFile}" as the gist title.`);

			const fileData = await this.processFiles(selectedFiles, currentDir);

			if (Object.keys(fileData).length === 0) {
				console.log("\n❌ No files were successfully processed.");
				return;
			}

			await this.createAndPublishGist(fileData, titleFile);
		} catch (error) {
			console.error("\n💥 Unexpected error:", error);
			throw error;
		}
	}

	/**
	 * Filters files by size, extension, and other criteria.
	 */
	private filterValidFiles(files: string[], directory: string): string[] {
		return files.filter((file) => {
			const filePath = path.join(directory, file);
			const stats = fs.statSync(filePath);
			const ext = path.extname(file).slice(1).toLowerCase();

			if (stats.size > this.config.maxFileSize) {
				return false;
			}

			if (!ext && !this.isLikelyScript(filePath)) {
				return false;
			}

			if (ext && !this.config.supportedExtensions.has(ext)) {
				return false;
			}

			// Skip hidden files and common build artifacts
			if (file.startsWith(".") || this.isIgnoredFile(file)) {
				return false;
			}

			return true;
		});
	}

	/**
	 * Checks if a file without extension is likely a script.
	 */
	private isLikelyScript(filePath: string): boolean {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const firstLine = content.split("\n")[0];
			return (
				firstLine?.startsWith("#!") ||
				content.includes("#!/") ||
				["Makefile", "Dockerfile", "Rakefile", "Gemfile"].includes(
					path.basename(filePath),
				)
			);
		} catch {
			return false;
		}
	}

	/**
	 * Checks if a file should be ignored (build artifacts, etc.).
	 */
	private isIgnoredFile(filename: string): boolean {
		const ignoredPatterns = [
			/\.min\.(js|css)$/,
			/\.map$/,
			/^package-lock\.json$/,
			/^yarn\.lock$/,
			/^.*\.log$/,
			/^.*\.tmp$/,
			/^.*\.cache$/,
		];

		return ignoredPatterns.some((pattern) => pattern.test(filename));
	}

	/**
	 * Enhanced file listing with metadata.
	 */
	private listFiles(directory: string): string[] {
		try {
			return fs
				.readdirSync(directory)
				.filter((file) => fs.statSync(path.join(directory, file)).isFile());
		} catch (error) {
			console.error(`❌ Error reading directory: ${error}`);
			return [];
		}
	}

	/**
	 * Enhanced file display with size and type information.
	 */
	private displayFiles(files: string[], directory: string): void {
		console.log(`\n📋 Found ${files.length} valid file(s):`);
		console.log("┌" + "─".repeat(70) + "┐");

		files.forEach((file, index) => {
			const filePath = path.join(directory, file);
			const stats = fs.statSync(filePath);
			const ext = path.extname(file).slice(1) || "no ext";
			const size = this.formatBytes(stats.size);
			const number = String(index + 1).padStart(2);
			const fileName =
				file.length > 25 ? file.substring(0, 22) + "..." : file.padEnd(25);
			const fileType = `[${ext.toUpperCase()}]`.padEnd(12);
			const fileSize = size.padStart(8);

			console.log(`│ ${number}. ${fileName} ${fileType} ${fileSize} │`);
		});

		console.log("└" + "─".repeat(70) + "┘");
	}

	/**
	 * Enhanced file selection with validation and shortcuts.
	 */
	private async selectFiles(files: string[]): Promise<string[]> {
		const input = await this.promptUser(
			"Enter file numbers (comma-separated, e.g., '1,3,5') or 'all' for all files: ",
		);

		if (input.toLowerCase() === "all") {
			return files;
		}

		if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
			return [];
		}

		const selectedIndices = input
			.split(",")
			.map((num) => parseInt(num.trim()) - 1)
			.filter((index) => !isNaN(index) && index >= 0 && index < files.length);

		return [...new Set(selectedIndices)].map((index) => files[index]!);
	}

	/**
	 * Enhanced title file selection with better UX.
	 */
	private async chooseTitleFile(files: string[]): Promise<string> {
		if (files.length === 1 && files[0]) {
			return files[0];
		}

		console.log("\n🏷️  Choose the main file for the gist title:");
		console.log("┌" + "─".repeat(50) + "┐");
		files.forEach((file, index) => {
			const number = String(index + 1).padStart(2);
			const fileName =
				file.length > 40 ? file.substring(0, 37) + "..." : file.padEnd(40);
			console.log(`│ ${number}. ${fileName} │`);
		});
		console.log("└" + "─".repeat(50) + "┘");

		const input = await this.promptUser(
			"Enter file number for the title (or press Enter for first file): ",
		);

		if (!input && files[0]) return files[0];

		const index = parseInt(input) - 1;

		if (isNaN(index) || index < 0 || index >= files.length) {
			console.log("⚠️  Invalid selection, using the first file as title.");
			return files[0]!;
		}

		return files[index]!;
	}

	/**
	 * Process files with progress tracking and concurrent processing.
	 */
	private async processFiles(
		files: string[],
		directory: string,
	): Promise<Record<string, FileData>> {
		console.log("\n🔄 Processing files...");
		console.log("┌" + "─".repeat(60) + "┐");
		const fileData: Record<string, FileData> = {};
		const createdDescriptionFiles: string[] = [];

		try {
			const batches = this.createBatches(files, this.config.maxConcurrency);
			let processedCount = 0;

			for (const batch of batches) {
				const batchPromises = batch.map(async (file) => {
					const filePath = path.join(directory, file);
					const extension = path.extname(file).slice(1) || "txt";

					try {
						const fileName =
							file.length > 30
								? file.substring(0, 27) + "..."
								: file.padEnd(30);
						process.stdout.write(`│ 🔍 Analyzing: ${fileName} │\r`);

						const content = fs.readFileSync(filePath, "utf-8");
						const stats = fs.statSync(filePath);

						const description = await this.generateDescription(
							filePath,
							extension,
							content,
						);

						fileData[file] = {
							content,
							description,
							size: stats.size,
							extension,
						};

						const descFilePath = this.saveDescription(
							directory,
							file,
							description,
						);
						createdDescriptionFiles.push(descFilePath);

						processedCount++;
						const progress = String(processedCount).padStart(2);
						const total = String(files.length).padStart(2);
						console.log(`│ ✅ Completed: ${fileName} (${progress}/${total}) │`);
					} catch (error) {
						const fileName =
							file.length > 30
								? file.substring(0, 27) + "..."
								: file.padEnd(30);
						console.log(`│ ❌ Failed: ${fileName} │`);
					}
				});

				await Promise.all(batchPromises);
			}

			console.log("└" + "─".repeat(60) + "┘");

			setTimeout(
				() => this.deleteDescriptionFiles(createdDescriptionFiles),
				1_000,
			);

			return fileData;
		} catch (error) {
			this.deleteDescriptionFiles(createdDescriptionFiles);
			throw error;
		}
	}

	/**
	 * Creates batches for concurrent processing.
	 */
	private createBatches<T>(items: T[], batchSize: number): T[][] {
		const batches: T[][] = [];
		for (let i = 0; i < items.length; i += batchSize) {
			batches.push(items.slice(i, i + batchSize));
		}
		return batches;
	}

	/**
	 * Enhanced description generation with better prompts and error handling.
	 */
	private async generateDescription(
		filePath: string,
		fileType: string,
		content: string,
	): Promise<string> {
		const truncatedContent =
			content.length > this.config.truncateContentAt
				? content.substring(0, this.config.truncateContentAt) +
					"\n\n... (truncated)"
				: content;

		const fileName = path.basename(filePath);
		const lineCount = content.split("\n").length;

		const prompt = `# ${fileName}
_A concise technical summary in plain English._

| Key | Value |
| --- | ----- |
| File type | ${fileType} |
| Lines | ${lineCount} |
| Size | ${this.formatBytes(content.length)} |
| Generated | ${new Date().toLocaleString()} |
| Target | ~/.config/git/gitdiff-exclude |

## Purpose
Provide a short statement of what this file does in practical terms.

## Key elements
- Home-dir resolution via \`Bun.env.HOME\` or \`process.env.HOME\`.
- Base path constant and relative path for the exclude file.
- Default exclusion patterns list.

## Runtime & dependencies
- Uses Node.js \`path\` module.
- Optional support for Bun runtime.

## How it works
1. Determine the home directory.
2. Compute absolute path to the exclude file.
3. Prepare default Git diff-exclude patterns.
4. (Note: no filesystem operations done here.)

## Usage
Intended to be invoked by a script or CLI that ensures the file exists, merges patterns, etc.

> [!NOTE]
> The current implementation only defines data; it doesn't write to disk.

## Next steps
- Add idempotent file write logic.
- Allow configuring target path.
- Offer a dry-run mode for preview.

Content snippet:

\`\`\`${fileType}
${truncatedContent}
\`\`\`
`;

		try {
			const generatedText = await this.makeApiCall(prompt);
			return this.formatDescription(
				fileName,
				fileType,
				generatedText,
				lineCount,
				content.length,
			);
		} catch (error) {
			console.warn(
				`⚠️  AI generation failed for ${fileName}, using fallback description`,
			);
			return this.createFallbackDescription(
				fileName,
				fileType,
				content,
				lineCount,
			);
		}
	}

	/**
	 * Formats the final description with consistent structure.
	 */
	private formatDescription(
		fileName: string,
		fileType: string,
		description: string,
		lineCount: number,
		size: number,
	): string {
		return `# ${fileName}

**File Type:** ${fileType.toUpperCase()}  
**Lines:** ${lineCount}  
**Size:** ${this.formatBytes(size)}  
**Generated:** ${new Date().toLocaleString()}

---

${description}

---
*Description generated using AI analysis*`;
	}

	/**
	 * Creates a fallback description when AI generation fails.
	 */
	private createFallbackDescription(
		fileName: string,
		fileType: string,
		content: string,
		lineCount: number,
	): string {
		const preview =
			content.length > 200 ? content.substring(0, 200) + "..." : content;

		return `# ${fileName}

**File Type:** ${fileType.toUpperCase()}  
**Lines:** ${lineCount}  
**Size:** ${this.formatBytes(content.length)}  
**Generated:** ${new Date().toLocaleString()}

## Basic Analysis

This is a ${fileType} file containing ${lineCount} lines of code.

### Content Preview
\`\`\`${fileType}
${preview}
\`\`\`

*Note: AI-powered analysis was unavailable. This is a basic fallback description.*`;
	}

	/**
	 * Enhanced API call with exponential backoff and better error handling.
	 */
	private async makeApiCall(prompt: string, attempt = 1): Promise<string> {
		const delay = Math.pow(this.config.retryDelay * 2, attempt - 1);

		try {
			const response = await this.ai.models.generateContent({
				model: this.config.model,
				contents: [{ parts: [{ text: prompt }] }],
				config: {
					maxOutputTokens: this.config.maxOutputTokens,
					temperature: this.config.temperature,
					systemInstruction: `You are an expert code analyst and technical writer. Provide detailed, accurate, and insightful analysis of code files. Focus on technical aspects, architecture, and practical usage. Write in a clear, professional tone suitable for developers.`,
				},
			});

			const generatedContent = response.candidates?.[0]?.content?.parts?.[0]?.text;

			if (!generatedContent) {
				throw new Error("No content generated from API response");
			}

			return generatedContent;
		} catch (error) {
			if (attempt < this.config.retryAttempts) {
				console.log(
					`   ⏳ Retrying in ${delay}ms... (attempt ${attempt + 1}/${this.config.retryAttempts})`,
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
				return this.makeApiCall(prompt, attempt + 1);
			}
			throw error;
		}
	}

	/**
	 * Creates and publishes the gist with enhanced error handling.
	 */
	private async createAndPublishGist(
		fileData: Record<string, FileData>,
		titleFile: string,
	): Promise<void> {
		console.log("\n🚀 Creating gist...");
		console.log("┌" + "─".repeat(50) + "┐");

		try {
			const gistUrl = await this.createGistWithMultipleFiles(
				fileData,
				titleFile,
			);
			console.log("└" + "─".repeat(50) + "┘");

			console.log("\n🎉 Success! Gist created:");
			console.log("┌" + "─".repeat(60) + "┐");
			console.log(`│ 🔗 ${gistUrl.padEnd(58)} │`);

			const totalSize = Object.values(fileData).reduce(
				(sum, data) => sum + data.size,
				0,
			);
			const fileCount = Object.keys(fileData).length;
			console.log(
				`│ 📊 Total files: ${String(fileCount).padStart(3)}${" ".repeat(45)} │`,
			);
			console.log(
				`│ 📏 Total size: ${this.formatBytes(totalSize).padStart(10)}${" ".repeat(38)} │`,
			);
			console.log("└" + "─".repeat(60) + "┘");
		} catch (error) {
			console.log("└" + "─".repeat(50) + "┘");
			console.error("\n❌ Failed to create gist:", error);
		}
	}

	/**
	 * Enhanced gist creation with better structure and error handling.
	 */
	private async createGistWithMultipleFiles(
		fileData: Record<string, FileData>,
		titleFile: string,
	): Promise<string> {
		const cleanTitle = path.basename(titleFile, path.extname(titleFile));
		const gistDescription = `${cleanTitle} - Enhanced with AI-generated documentation`;

		const gistFiles: Record<string, { content: string }> = {};

		if (fileData[titleFile]) {
			gistFiles[titleFile] = { content: fileData[titleFile].content };

			const descFileName = `${cleanTitle}_README.md`;
			gistFiles[descFileName] = { content: fileData[titleFile].description };
		}

		for (const [fileName, data] of Object.entries(fileData)) {
			if (fileName === titleFile) continue;

			gistFiles[fileName] = { content: data.content };

			const descFileName = `${path.basename(fileName, path.extname(fileName))}_README.md`;
			gistFiles[descFileName] = { content: data.description };
		}

		const response = await fetch("https://api.github.com/gists", {
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${this.githubToken}`,
				"X-GitHub-Api-Version": "2022-11-28",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				description: gistDescription,
				public: false,
				files: gistFiles,
			}),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			// Fix: Replace Error.isError() with proper error checking
			const errorMessage =
				errorData && typeof errorData === "object" && "message" in errorData
					? errorData.message
					: response.statusText;
			throw new Error(`GitHub API error (${response.status}): ${errorMessage}`);
		}

		const data = (await response.json()) as GistResponse;
		return data.html_url;
	}

	/**
	 * Enhanced description saving with better error handling.
	 */
	private saveDescription(
		directory: string,
		originalFile: string,
		description: string,
	): string {
		const baseName = path.basename(originalFile, path.extname(originalFile));
		const descriptionFile = path.join(directory, `${baseName}_description.md`);

		try {
			fs.writeFileSync(descriptionFile, description, "utf-8");
			return descriptionFile;
		} catch (error) {
			console.warn(`⚠️  Failed to save description for ${originalFile}`);
			return "";
		}
	}

	/**
	 * Enhanced cleanup with better error handling.
	 */
	private deleteDescriptionFiles(filePaths: string[]): void {
		if (filePaths.length === 0) return;

		console.log("\n🧹 Cleaning up temporary files...");
		console.log("┌" + "─".repeat(50) + "┐");

		for (const filePath of filePaths) {
			if (!filePath) continue;

			try {
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
					const fileName = path.basename(filePath).padEnd(35);
					console.log(`│ 🗑️  Deleted: ${fileName} │`);
				}
			} catch (error) {
				const fileName = path.basename(filePath).padEnd(35);
				console.log(`│ ⚠️  Failed: ${fileName} │`);
			}
		}

		console.log("└" + "─".repeat(50) + "┘");
	}

	/**
	 * Formats bytes into human-readable format.
	 */
	private formatBytes(bytes: number): string {
		if (bytes === 0) return "0 B";

		const k = 1024;
		const sizes = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));

		return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
	}
}

export default Gist;
