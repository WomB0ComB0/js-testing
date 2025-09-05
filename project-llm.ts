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

import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { argv, write } from "bun";
import { Logger } from "./logger.js";

/**
 * Decorator that automatically instantiates a class when it's defined
 */
function selfExecute<T extends { new (...args: any[]): {} }>(
	constructor: T,
): T {
	new constructor();
	return constructor;
}

/**
 * Main application class for generating project descriptions using Gemini API
 * Automatically instantiates itself when the module is loaded
 */
@selfExecute
class Main {
	/** Gemini API key from environment variables */
	private geminiApiKey: string;

	/** Command line arguments passed to the application */
	private args: [string, ...string[]];

	/** Flag to determine whether to ignore processed files */
	protected ignoreProcessed = false;

	/** Required content for project description generation */
	protected requiredContent: [string, ...string[]];

	/** Logger instance for application logging */
	private logger: Logger;

	/** Google GenAI client */
	private genAI: GoogleGenAI;

	/**
	 * Initializes the application with environment variables and command line arguments
	 */
	constructor() {
		this.geminiApiKey = process.env.GEMINI_API_KEY || "";
		this.args = argv.slice(2) as [string, ...string[]];
		this.requiredContent = ["", "", ""].slice(2) as [string, ...string[]];
		this.logger = new Logger("Main");
		this.genAI = new GoogleGenAI({ apiKey: this.geminiApiKey });
		this.initialize();
	}

	/**
	 * Validates environment variables and runs the application if it's the main module
	 */
	private initialize(): void {
		this.validateEnvironmentVariables();

		if (require.main === module) {
			this.run().catch((error) => {
				this.logger.error(`Unhandled error: ${error}`);
			});
		}
	}

	/**
	 * Validates that required environment variables are set
	 * @throws {Error} If GEMINI_API_KEY is not set
	 */
	private validateEnvironmentVariables(): void {
		if (!this.geminiApiKey) {
			this.logger.error("GEMINI_API_KEY environment variable is not set");
			process.exit(1);
		}
	}

	/**
	 * Main execution method that orchestrates the project description generation process
	 *
	 * This method:
	 * 1. Defines the master prompt for the AI
	 * 2. Processes command line arguments
	 * 3. Retrieves the project's folder structure
	 * 4. Collects file content from the project
	 * 5. Generates a project description using the Gemini API
	 * 6. Saves the description to a markdown file
	 *
	 * @returns {Promise<void>}
	 */
	async run(): Promise<void> {
		const MASTER_PROMPT = `
      You are a senior technical writer and interdisciplinary project analyst. Your task is to generate a comprehensive and structured description of a coding project based on the following details. DON NOT include meta data in your response:

      - **Project Name**: [Insert Project Name]
      - **Project Type**: [e.g., Web App, API, CLI Tool, ML Model, Data Pipeline, Research Tool]
      - **Primary Programming Language(s)**: [e.g., Python, JavaScript, R]
      - **Frameworks/Libraries Used**: [e.g., React, Flask, TensorFlow, Pandas]
      - **Purpose and Goals**: [Describe the main objectives and the problems the project aims to solve]
      - **Key Features**: [List notable functionalities and components]
      - **Target Users or Audience**: [Who is this project intended for?]
      - **Deployment Environment**: [e.g., AWS, Docker, Heroku, On-Premises]
      - **Current Development Status**: [e.g., Planning, In Progress, Completed]
      - **Challenges Faced**: [Optional - Any significant hurdles encountered]
      - **Future Plans**: [Optional - Upcoming features or improvements]
      - **Interdisciplinary Aspects**: [Optional - Describe any non-software components, such as data analysis, scientific research, or domain-specific considerations]

      Using this information, please provide:

      1. **Executive Summary**: A concise overview capturing the essence and significance of the project.
      2. **Technical Architecture**: Detailed information about the technologies, tools, and system design.
      3. **Functional Overview**: An in-depth look at the core features and their operations.
      4. **User Experience**: Describe how users interact with the project, including interfaces and workflows.
      5. **Interdisciplinary Integration**: Explain how the project integrates with non-software domains or contributes to broader fields.
      6. **Development Insights**: Share any notable challenges faced during development and how they were addressed.
      7. **Future Roadmap**: Outline potential future enhancements or updates.
      8. **Usage Examples**: Provide brief examples demonstrating how the project is used, don't assume the functionality, derive the functionality from the code (e.g., code snippets, command-line usage, user scenarios).

      Ensure the description is clear, informative, and suitable for inclusion in documentation, academic papers, or a project README. Use markdown formatting where appropriate for readability.
    `;

		let [
			findArgs = [".", "-type", "f"],
			excluded = await this.gitignore(),
			prompt = MASTER_PROMPT,
		] = this.args;

		if (typeof excluded === "string") excluded = excluded.split("|");
		if (typeof findArgs === "string") findArgs = findArgs.split("|");

		let [folderStructure, fileContent, description] = this.requiredContent;

		try {
			this.logger.info("Starting project description generation");
			this.logger.debug("Retrieving folder structure");
			folderStructure = await this.folderStructure(excluded);
			this.logger.info(folderStructure.slice(0, 50));

			this.logger.debug("Retrieving file content");
			fileContent = await this.fileContent(excluded, findArgs);
			this.logger.info(`File Content: ${fileContent.slice(0, 1000)}`);

			const content = `
        ${folderStructure}
        \n
        ${fileContent}
      `;

			this.logger.info("Generating project description with Gemini API");
			description = await this.generateDescription(content, prompt);
			this.logger.info(description.slice(0, 200));

			const outputPath = path.join(process.cwd(), "project-description.md");
			this.logger.debug(`Writing description to ${outputPath}`);
			await write(outputPath, description);
			this.logger.success(
				`Project description successfully generated and saved to project-description.md`,
			);
		} catch (error) {
			this.logger.error(`Error in run method: ${error}`);
			throw new Error(`${error instanceof Error ? error.message : error}`);
		}
	}

	/**
	 * Executes a shell command and returns the result
	 *
	 * @param command - The command to execute
	 * @param errorMessage - Custom error message if command fails
	 * @returns Object containing success status, command output, and exit code
	 */
	private async executeCommand(
		command: string,
		errorMessage?: string,
	): Promise<{ success: boolean; text: string; exitCode: number }> {
		try {
			const proc = Bun.spawn({
				cmd: ["/bin/sh", "-c", command],
				stdout: "pipe",
			});

			const output = await new Response(proc.stdout).text();
			const success = proc.exitCode === 0;

			return {
				success,
				text: output.trim(),
				exitCode: proc.exitCode || 0,
			};
		} catch (error) {
			this.logger.warn(
				errorMessage || `Error executing command '${command}': ${error}`,
			);
			return {
				success: false,
				text: error instanceof Error ? error.message : String(error),
				exitCode: -1,
			};
		}
	}

	/**
	 * Processes command output with fallback handling
	 *
	 * @param command - The command to execute
	 * @param errorMessage - Error message if command fails
	 * @param fallbackMessage - Message to return if fallback is needed
	 * @param fallbackFn - Fallback function to execute if command fails
	 * @returns Processed output or fallback result
	 */
	private async processCommandWithFallback(
		command: string,
		errorMessage: string,
		fallbackMessage: string,
		fallbackFn?: () => Promise<string>,
	): Promise<string> {
		const result = await this.executeCommand(command, errorMessage);

		if (!result.success) {
			this.logger.warn(fallbackMessage);
			return fallbackFn ? await fallbackFn() : fallbackMessage;
		}

		return result.text;
	}

	/**
	 * Retrieves and parses the .gitignore file to determine which directories to exclude
	 *
	 * This method:
	 * 1. Checks if .gitignore exists in the current directory
	 * 2. Reads and parses the file content
	 * 3. Processes each line to extract exclusion patterns
	 * 4. Returns an array of directories/patterns to exclude
	 *
	 * @returns Array of directories/patterns to exclude
	 */
	async gitignore(): Promise<string[]> {
		try {
			const filePath = `${process.cwd()}/.gitignore`;
			this.logger.debug(`Reading .gitignore from ${filePath}`);

			if (
				!(await this.executeCommand(
					`test -f ${filePath} | echo $?`,
					`Error checking for .gitignore: file not found, using empty exclusion list`,
				))
			)
				return [];

			const result = await this.executeCommand(
				`cat ${filePath}`,
				`Failed to read .gitignore`,
			);
			if (!result.success) {
				this.logger.warn(
					`Failed to read .gitignore with exit code ${result.exitCode}, using empty exclusion list`,
				);
				return [];
			}

			const content = result.text
				.replace(/[\u{1F600}-\u{1F64F}]/gu, "")
				.replace(/[^\x00-\x7F]/g, "")
				.replace(/,/g, " ")
				.replace(/:/g, " ")
				.replace(/=/g, " ")
				.replace(/;/g, " ");

			if (!content) {
				this.logger.warn(`.gitignore is empty, using empty exclusion list`);
				return [];
			}

			const book: Set<string> = new Set();
			for (const line of (await content).split("\n")) {
				if (line.includes("#")) {
					if (line.startsWith("#")) continue;
					const [key, value] = line.split("#");
					if (key.trim().length > 0) book.add(key);
					if (value.trim().length > 0) book.add(value);
				}
				if (line.trim().length > 0) book.add(line);
			}
			const excludedDirs = Array.from(book.values());
			this.logger.debug(
				`Found ${excludedDirs.length} excluded directories/patterns`,
			);
			return excludedDirs;
		} catch (error) {
			this.logger.error(`Error in gitignore method: ${error}`);
			this.logger.warn(`Using empty exclusion list due to error`);
			return [];
		}
	}

	/**
	 * Generates a tree representation of the project's folder structure
	 *
	 * This method:
	 * 1. Checks if the 'tree' command is available
	 * 2. Uses 'tree' to generate a hierarchical view of the project structure
	 * 3. Falls back to alternative methods if 'tree' is unavailable
	 *
	 * @param excludedDirs - Directories to exclude from the tree
	 * @returns String representation of the folder structure
	 */
	private async folderStructure(excludedDirs: string[]): Promise<string> {
		try {
			// Check if tree command exists
			const treeCheck = await this.executeCommand(
				`which tree || echo "not found"`,
				`Tree command check failed`,
			);
			if (treeCheck.text === "not found" || !treeCheck.success) {
				this.logger.warn(
					`Tree command not found. Using fallback directory listing.`,
				);
				return await this.fallbackDirectoryListing(excludedDirs);
			}

			const treeCommand = `tree -I "${excludedDirs.join("|")}"`;
			this.logger.debug(
				`Generating folder structure with ${excludedDirs.length} excluded inputs`,
			);
			this.logger.debug(`Tree command: ${treeCommand}`);

			return await this.processCommandWithFallback(
				treeCommand,
				`Error executing tree command`,
				`Tree command failed. Using fallback directory listing.`,
				() => this.fallbackDirectoryListing(excludedDirs),
			);
		} catch (error) {
			this.logger.error(`Error in folderStructure method: ${error}`);
			this.logger.warn(`Using fallback directory listing due to error`);
			return await this.fallbackDirectoryListing(excludedDirs);
		}
	}

	/**
	 * Fallback method to list directories when tree command fails
	 *
	 * This method:
	 * 1. Checks if the 'find' command is available
	 * 2. Uses 'find' to list directories while excluding specified patterns
	 * 3. Falls back to basic directory listing if 'find' is unavailable
	 *
	 * @param excludedDirs - Directories to exclude
	 * @returns Simple directory listing
	 */
	private async fallbackDirectoryListing(
		excludedDirs: string[],
	): Promise<string> {
		try {
			// Check if find command exists
			const findCheck = await this.executeCommand(
				`which find || echo "not found"`,
				`Find command check failed`,
			);
			if (findCheck.text === "not found" || !findCheck.success) {
				this.logger.warn(
					`Find command not found. Using ls for basic directory listing.`,
				);
				return await this.basicDirectoryListing();
			}

			const findCommand = `find . -type d -not -path "*/\\.*" ${excludedDirs.map((dir) => `-not -path "./${dir}*"`).join(" ")}`;
			this.logger.debug(`Using fallback directory listing: ${findCommand}`);

			const result = await this.executeCommand(
				findCommand,
				`Fallback directory listing failed`,
			);
			if (!result.success) {
				this.logger.warn(
					`Fallback directory listing failed with exit code ${result.exitCode}`,
				);
				return await this.basicDirectoryListing();
			}

			return (
				"Project Directory Structure:\n" +
				result.text
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0)
					.join("\n")
			);
		} catch (error) {
			this.logger.error(`Error in fallback directory listing: ${error}`);
			return await this.basicDirectoryListing();
		}
	}

	/**
	 * Provides a very basic directory listing as last resort
	 *
	 * @returns Basic directory listing using 'ls -la'
	 */
	private async basicDirectoryListing(): Promise<string> {
		try {
			const result = await this.executeCommand(
				`ls -la`,
				`Basic directory listing failed`,
			);
			return "Basic Project Directory Listing:\n" + result.text;
		} catch (error) {
			this.logger.error(`Error in basic directory listing: ${error}`);
			return "Directory listing unavailable";
		}
	}

	/**
	 * Retrieves the content of files in the project
	 *
	 * This method:
	 * 1. Checks if the 'find' command is available
	 * 2. Uses 'find' to locate files while excluding specified patterns
	 * 3. Reads the content of each file and concatenates them
	 * 4. Falls back to basic file content retrieval if 'find' is unavailable
	 *
	 * @param excludedDirs - Directories to exclude from the search
	 * @param findArgs - Arguments for the find command
	 * @returns Content of the files
	 */
	private async fileContent(
		excludedDirs: string[],
		findArgs: string[],
	): Promise<string> {
		try {
			// Check if find command exists
			const findCheck = await this.executeCommand(
				`which find || echo "not found"`,
				`Find command check failed`,
			);
			if (findCheck.text === "not found" || !findCheck.success) {
				this.logger.warn(
					`Find command not found. Using ls for basic file listing.`,
				);
				return await this.basicFileContent();
			}

			const excludeParts = excludedDirs
				.filter((dir) => dir.trim().length > 0)
				.map((dir) => `-not -path "./${dir}*"`)
				.join(" ");

			const findCommand = `find . -type f ${excludeParts} -not -path "*/\\.*"`;

			this.logger.debug(
				`Retrieving file content with find command: ${findCommand}`,
			);

			const findResult = await this.executeCommand(
				findCommand,
				"Error listing files",
			);
			if (!findResult.success) {
				this.logger.warn(
					`File listing failed with exit code ${findResult.exitCode}`,
				);
			}

			this.logger.info(
				`findResult: ${JSON.stringify(
					findResult.text.split("\n").flatMap((line) => line.trim()),
					null,
					2,
				)}`,
			);
			const files = findResult.text.split("\n").filter((line) => line.trim());
			if (files.length === 0) {
				this.logger.warn("No files found");
				return "No files found";
			}

			this.logger.info(`Found ${files.length} files to process`);

			let contentResult = "";

			for (const file of files) {
				if (!file || file.trim().length === 0) continue;

				const catCommand = `echo "\\n--------------------------------------------------------------------------------\\n${file}:\\n--------------------------------------------------------------------------------"; cat "${file}" 2>/dev/null || echo "[Binary file or error]"`;

				const fileContent = await this.executeCommand(
					catCommand,
					`Error reading file ${file}`,
				);
				if (fileContent.success && fileContent.text) {
					contentResult += fileContent.text + "\n";
				}
			}
			return contentResult;
		} catch (error) {
			this.logger.error(`Error in fileContent method: ${error}`);
			return await this.basicFileContent();
		}
	}

	/**
	 * Provides basic file content retrieval as last resort
	 *
	 * This method:
	 * 1. Lists non-directory files using 'ls -la'
	 * 2. Attempts to read important files like package.json, README.md, etc.
	 *
	 * @returns Basic file content information
	 */
	private async basicFileContent(): Promise<string> {
		try {
			const result = await this.executeCommand(
				`ls -la | grep -v ^d`,
				`Basic file listing failed`,
			);
			let content = "Basic Project Files:\n" + result.text + "\n\n";

			// Try to read a few important files
			const importantFiles = ["package.json", "README.md", "tsconfig.json"];
			for (const file of importantFiles) {
				const fileExists = await this.executeCommand(
					`test -f ${file} && echo "exists" || echo "not found"`,
					``,
				);
				if (fileExists.text === "exists") {
					const fileContent = await this.executeCommand(
						`cat "${file}"`,
						`Error reading ${file}`,
					);
					if (fileContent.success) {
						content += `\n--------------------------------------------------------------------------------\n`;
						content += `${file}:\n`;
						content += `--------------------------------------------------------------------------------\n`;
						content += fileContent.text + "\n";
					}
				}
			}

			return content;
		} catch (error) {
			this.logger.error(`Error in basic file content: ${error}`);
			return "File content retrieval unavailable";
		}
	}

	/**
	 * Generates a project description using the Gemini API
	 *
	 * This method:
	 * 1. Prepares the API request with project content and prompt
	 * 2. Configures the Gemini model with appropriate parameters
	 * 3. Processes the API response to extract the generated text
	 *
	 * @param content - Project content to analyze
	 * @param prompt - Prompt for the Gemini API
	 * @returns Generated project description
	 * @throws Error if description generation fails
	 */
	async generateDescription(content: string, prompt: string): Promise<string> {
		try {
			this.logger.debug("Making API request to Gemini");

			const model = this.genAI.models.generateContent({
				model: "gemini-2.5-pro-exp-03-25",
				contents: [
					{
						parts: [
							{
								text: `${prompt}\n\n${content}`,
							},
						],
					},
				],
				config: {
					systemInstruction:
						"You are a senior technical writer and interdisciplinary project analyst. Your task is to generate a comprehensive and structured description of a coding project based on the following details. DON NOT include meta data in your response (e.g your general response to the user). You are a senior technical writer and interdisciplinary project analyst.",
					maxOutputTokens: 65536,
				},
			});

			const response = await model;

			this.logger.debug("Processing API response");
			const generatedText = response.candidates?.[0]?.content?.parts?.[0]?.text;

			if (!generatedText) {
				throw new Error("No text generated from API response");
			}

			this.logger.debug("Successfully generated project description");
			return generatedText;
		} catch (error) {
			this.logger.error(`Error in generateDescription method: ${error}`);
			throw new Error(`${error instanceof Error ? error.message : error}`);
		}
	}
}
