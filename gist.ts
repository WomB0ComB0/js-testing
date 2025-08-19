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

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

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
 * Main application class for creating GitHub Gists with AI-generated descriptions.
 * This class handles file selection, content analysis, and gist creation.
 */
@selfExecute
class Main {
	// API keys
	private geminiApiKey: string;
	private githubToken: string;
	private rl: readline.Interface;

	/**
	 * Initializes the application with API keys and sets up the readline interface.
	 */
	constructor() {
		this.geminiApiKey = process.env.GEMINI_API_KEY || "";
		this.githubToken = process.env.GITHUB_TOKEN_M || "";
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		this.initialize();
	}

	/**
	 * Validates environment variables and starts the application if run directly.
	 */
	private initialize() {
		this.validateEnvironmentVariables();

		if (require.main === module) {
			this.run()
				.catch(console.error)
				.finally(() => this.rl.close());
		}
	}

	/**
	 * Ensures required API keys are available in environment variables.
	 * Exits the process if any required keys are missing.
	 */
	private validateEnvironmentVariables() {
		if (!this.geminiApiKey) {
			console.error("Error: GEMINI_API_KEY environment variable is not set");
			process.exit(1);
		}

		if (!this.githubToken) {
			console.error("Error: No GitHub token found in environment variables");
			process.exit(1);
		}
	}

	/**
	 * Prompts the user with a question and returns their response.
	 * @param question - The question to display to the user
	 * @returns A promise that resolves to the user's input
	 */
	private async promptUser(question: string): Promise<string> {
		return new Promise((resolve) => {
			this.rl.question(question, resolve);
		});
	}

	/**
	 * Main execution flow of the application.
	 * Handles file selection, description generation, and gist creation.
	 */
	async run() {
		// Get current working directory
		const currentDir = process.cwd();
		console.log(`Current working directory: ${currentDir}`);

		const files = this.listFiles(currentDir);
		this.displayFiles(files);

		const selectedFiles = await this.selectFiles(files);
		console.log("\nSelected files:", selectedFiles);

		if (selectedFiles.length === 0) {
			console.log("No files selected. Exiting.");
			return;
		}

		// Choose which file should be the title
		let titleFile = selectedFiles[0]; // Default to first file
		if (selectedFiles.length > 1) {
			const titleIndex = await this.chooseTitleFile(selectedFiles);
			titleFile = selectedFiles[titleIndex];
		}
		console.log(`\nUsing "${titleFile}" as the title for the gist.`);

		// Collect all file contents and descriptions
		const fileData: Record<string, { content: string; description: string }> =
			{};
		const createdDescriptionFiles: string[] = [];

		for (const file of selectedFiles) {
			const filePath = path.join(currentDir, file);
			const extension = path.extname(file).slice(1);

			console.log(`\nProcessing: ${file} (${extension})`);

			try {
				// Generate description using AI
				const description = await this.generateDescription(filePath, extension);
				console.log(`Description generated successfully.`);

				// Read file content
				const content = fs.readFileSync(filePath, "utf-8");

				// Store file data
				fileData[file] = {
					content,
					description,
				};

				// Save description locally and track the file path
				const descFilePath = this.saveDescription(
					currentDir,
					file,
					description,
				);
				createdDescriptionFiles.push(descFilePath);
			} catch (error) {
				console.error(`Error processing ${file}:`, error);
			}
		}

		// Create a single gist with all files
		if (Object.keys(fileData).length > 0) {
			try {
				const gistUrl = await this.createGistWithMultipleFiles(
					fileData,
					titleFile,
				);
				console.log(`\nGist created with all selected files: ${gistUrl}`);

				// Delete the local description files
				this.deleteDescriptionFiles(createdDescriptionFiles);
			} catch (error) {
				console.error("Error creating gist:", error);
			}
		}
	}

	/**
	 * Prompts the user to select which file should be used for the gist title.
	 * @param files - Array of file names to choose from
	 * @returns The index of the selected file
	 */
	private async chooseTitleFile(files: string[]): Promise<number> {
		console.log("\nChoose which file should be used for the gist title:");
		files.forEach((file, index) => {
			console.log(`${index + 1}. ${file}`);
		});

		const input = await this.promptUser("\nEnter file number for the title: ");
		const index = parseInt(input.trim()) - 1;

		// Validate input and return a valid index
		if (isNaN(index) || index < 0 || index >= files.length) {
			console.log("Invalid selection, using the first file as title.");
			return 0;
		}

		return index;
	}

	/**
	 * Lists all files in the specified directory.
	 * @param directory - The directory path to scan
	 * @returns Array of file names (excluding directories)
	 */
	private listFiles(directory: string): string[] {
		return fs
			.readdirSync(directory)
			.filter((file: string) =>
				fs.statSync(path.join(directory, file)).isFile(),
			);
	}

	/**
	 * Displays a numbered list of files to the console.
	 * @param files - Array of file names to display
	 */
	private displayFiles(files: string[]) {
		console.log("\nAvailable files:");
		files.forEach((file, index) => {
			console.log(`${index + 1}. ${file}`);
		});
	}

	/**
	 * Prompts the user to select files from the displayed list.
	 * @param files - Array of file names to choose from
	 * @returns Array of selected file names
	 */
	private async selectFiles(files: string[]): Promise<string[]> {
		const input = await this.promptUser(
			"\nEnter file numbers to process (comma-separated, e.g., '1,3,5'): ",
		);

		const selectedIndices = input
			.split(",")
			.map((num: string) => parseInt(num.trim()) - 1)
			.filter((index: number) => index >= 0 && index < files.length);

		return selectedIndices.map((index: number) => files[index]);
	}

	/**
	 * Saves the generated description to a markdown file.
	 * @param directory - The directory to save the file in
	 * @param originalFile - The name of the file being described
	 * @param description - The generated description content
	 */
	private saveDescription(
		directory: string,
		originalFile: string,
		description: string,
	): string {
		const descriptionFile = path.join(
			directory,
			`${path.basename(originalFile, path.extname(originalFile))}.md`,
		);

		fs.writeFileSync(descriptionFile, description);
		console.log(`Description saved to: ${descriptionFile}`);

		return descriptionFile; // Return the file path
	}

	/**
	 * Deletes the local description files.
	 * @param filePaths - Array of file paths to delete
	 */
	private deleteDescriptionFiles(filePaths: string[]): void {
		console.log("\nCleaning up local description files...");

		for (const filePath of filePaths) {
			try {
				fs.unlinkSync(filePath);
				console.log(`Deleted: ${filePath}`);
			} catch (error) {
				console.error(`Failed to delete ${filePath}:`, error);
			}
		}
	}

	/**
	 * Generates an AI description of a file using the Gemini API.
	 * @param filePath - Path to the file to analyze
	 * @param fileType - The file extension/type
	 * @returns A formatted markdown description of the file
	 */
	async generateDescription(
		filePath: string,
		fileType: string,
	): Promise<string> {
		const content = fs.readFileSync(filePath, "utf-8");

		const truncatedContent =
			content.length > 5000 ? content.substring(0, 5000) + "..." : content;

		const prompt = `Please analyze this ${fileType} file and provide a detailed description, and assume that any missing import reference is there, don't mention it:
    
Filename: ${path.basename(filePath)}
Content:
\`\`\`${fileType}
${truncatedContent}
\`\`\`

Generate a markdown description that includes:
1. A summary of what the file does
2. Key components or functions
3. Any notable patterns or techniques used
4. Potential use cases`;

		try {
			const response = await fetch(
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-goog-api-key": this.geminiApiKey,
					},
					body: JSON.stringify({
						contents: [
							{
								parts: [
									{
										text: prompt,
									},
								],
							},
						],
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`API request failed with status ${response.status}`);
			}

			const data = await response.json();

			// Extract the generated text from the response
			const generatedText = data.candidates[0].content.parts[0].text;

			// Format the final description
			return (
				`# ${path.basename(filePath)} Description\n\n` +
				`**File Type:** ${fileType}\n\n` +
				`**Generated Description:**\n\n` +
				`${generatedText}\n\n` +
				`*Description generated on ${new Date().toLocaleString()}*`
			);
		} catch (error) {
			console.error("Error calling Gemini API:", error);

			// Fallback to a basic description if API call fails
			return (
				`# ${path.basename(filePath)} Description\n\n` +
				`**File Type:** ${fileType}\n\n` +
				`**Generated Description:**\n` +
				`This is a ${fileType} file with approximately ${content.length} characters.\n\n` +
				`**Sample Content:**\n` +
				"```\n" +
				(content.length > 100 ? content.substring(0, 100) + "..." : content) +
				"\n```\n\n" +
				`*Description generated on ${new Date().toLocaleString()}*\n\n` +
				`Note: AI-powered description failed. This is a fallback description.`
			);
		}
	}

	/**
	 * Creates a GitHub Gist containing multiple files with their descriptions.
	 * @param fileData - Object containing file contents and descriptions
	 * @param titleFile - The file to use as the title for the gist
	 * @returns The URL of the created gist
	 */
	async createGistWithMultipleFiles(
		fileData: Record<string, { content: string; description: string }>,
		titleFile: string,
	): Promise<string> {
		try {
			// Create a descriptive name for the gist using the selected title file
			const gistDescription = `${titleFile} and related files - with AI-generated descriptions`;

			// Prepare the files object for the gist
			const gistFiles: Record<string, { content: string }> = {};

			// First add the title file to ensure it's first in the gist
			if (fileData[titleFile]) {
				gistFiles[titleFile] = {
					content: fileData[titleFile].content,
				};

				// Add its description
				const titleDescFileName = `${path.basename(titleFile, path.extname(titleFile))}_description.md`;
				gistFiles[titleDescFileName] = {
					content: fileData[titleFile].description,
				};
			}

			// Add the rest of the files and their descriptions
			for (const [fileName, data] of Object.entries(fileData)) {
				// Skip the title file as we've already added it
				if (fileName === titleFile) continue;

				// Add the original file
				gistFiles[fileName] = {
					content: data.content,
				};

				// Add the description file
				const descFileName = `${path.basename(fileName, path.extname(fileName))}_description.md`;
				gistFiles[descFileName] = {
					content: data.description,
				};
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
				const errorText = await response.text();
				throw new Error(
					`GitHub API request failed with status ${response.status}: ${errorText}`,
				);
			}

			const data = await response.json();
			return data.html_url;
		} catch (error) {
			console.error("Error creating gist:", error);
			return "Failed to create gist";
		}
	}
}
