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
 * # Markdown to Google Docs Converter
 *
 * This module provides functionality to convert Markdown content to Google Docs
 * with proper formatting. It handles various Markdown elements like headings,
 * lists, bold, italic, links, and code blocks.
 *
 * ## Features
 * - Create Google Docs from Markdown content
 * - Apply proper formatting (headings, bold, italic, links, code blocks)
 * - Share documents with specified recipients
 * - Batch processing of formatting requests
 * - Cleanup of Markdown syntax after formatting
 *
 * ## Usage
 * ```typescript
 * // Create a new manager instance
 * const manager = new GoogleDocsManager('./path-to-credentials.json');
 *
 * // Create and share a document
 * const documentUrl = await manager.createAndShareDocument({
 *   title: 'My Document',
 *   recipientEmail: 'recipient@example.com',
 *   markdownContent: '# Hello World\n\nThis is **bold** and *italic*.'
 * });
 *
 * console.log(`Document created: ${documentUrl}`);
 * ```
 *
 * ## Command Line Usage
 * ```
 * bun run markdown-to-google-docs.ts <input.md> <document-title> <recipient-email> [credentials-path]
 * ```
 *
 * @module markdown-to-google-docs
 */

import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";
import type { Token, Tokens } from "marked";
import { marked } from "marked";
import * as stringSimilarity from "string-similarity";
import { Logger, LogLevel } from "./logger";
import { convertMarkdownToPlainText } from "./markdown-to-text";

/**
 * Decorator that automatically instantiates a class when the module is loaded
 * @param constructor - The class constructor to instantiate
 * @returns The original constructor
 */
function selfExecute<T extends { new (...args: any[]): {} }>(constructor: T) {
	new constructor();
	return constructor;
}

/**
 * Options for creating a Google Doc from Markdown
 * @interface GoogleDocOptions
 */
interface GoogleDocOptions {
	/** The title of the Google Doc */
	title: string;
	/** Email address to share the document with */
	recipientEmail: string;
	/** Markdown content to convert */
	markdownContent: string;
	/** Path to Google service account credentials (optional) */
	credentialsPath?: string;
}

/**
 * Represents a paragraph position in a Google Doc
 * @interface ParagraphPosition
 */
type ParagraphPosition = {
	/** Start index of the paragraph */
	startIndex: number;
	/** End index of the paragraph */
	endIndex: number;
	/** Text content of the paragraph */
	content: string;
};

/**
 * Context for the Markdown renderer
 * @interface RendererContext
 */
interface RendererContext {
	/** Function to find text positions in the document */
	findTextPositions: (
		contentWithPositions: {
			text: string;
			startIndex: number;
			endIndex: number;
		}[],
		text: string,
	) => { startIndex: number; endIndex: number }[];
	/** Array of content elements with their positions */
	contentWithPositions: {
		text: string;
		startIndex: number;
		endIndex: number;
	}[];
	/** Array of Google Docs API requests */
	requests: any[];
	/** Array of paragraphs in the document */
	paragraphs: ParagraphPosition[];
	/** Function to find a paragraph by its text content */
	findParagraphByText: (
		paragraphs: ParagraphPosition[],
		text: string,
	) => ParagraphPosition | null;
}

// Initialize logger
const logger = Logger.getLogger("GoogleDocsManager", {
	minLevel: LogLevel.INFO,
	includeTimestamp: true,
});

/**
 * Main class for managing Google Docs operations
 *
 * Handles creation, sharing, and formatting of Google Docs from Markdown content.
 */
class GoogleDocsManager {
	private auth: GoogleAuth;
	private docsService: any;
	private driveService: any;

	/**
	 * Creates a new GoogleDocsManager instance
	 * @param credentialsPath - Path to the Google service account credentials JSON file
	 */
	constructor(credentialsPath: string = "./service-account.json") {
		this.auth = new GoogleAuth({
			keyFile: credentialsPath,
			scopes: [
				"https://www.googleapis.com/auth/documents",
				"https://www.googleapis.com/auth/drive",
			],
		});

		this.docsService = google.docs({ version: "v1", auth: this.auth });
		this.driveService = google.drive({ version: "v3", auth: this.auth });
		logger.debug("GoogleDocsManager initialized", { credentialsPath });
	}

	/**
	 * Creates a new Google Doc with the specified title
	 * @param title - The title of the document
	 * @returns Promise resolving to the document ID
	 */
	async createDocument(title: string): Promise<string> {
		try {
			const response = await logger.time("Create Google Doc", async () => {
				return await this.docsService.documents.create({
					requestBody: {
						title: title,
					},
				});
			});

			logger.info(`Document created with ID: ${response.data.documentId}`, {
				title,
			});
			return response.data.documentId;
		} catch (error) {
			logger.error(`Error creating Google Doc`, error);
			throw error;
		}
	}

	/**
	 * Shares a Google Doc with the specified email address
	 * @param documentId - The ID of the document to share
	 * @param email - The email address to share with
	 */
	async shareDocument(documentId: string, email: string): Promise<void> {
		try {
			await logger.time("Share Google Doc", async () => {
				return await this.driveService.permissions.create({
					fileId: documentId,
					requestBody: {
						type: "user",
						role: "writer",
						emailAddress: email,
					},
				});
			});

			logger.info(`Document shared with ${email}`, { documentId });
		} catch (error) {
			logger.error(`Error sharing Google Doc`, error, { documentId, email });
			throw error;
		}
	}

	/**
	 * Updates a Google Doc with plain text content
	 * @param documentId - The ID of the document to update
	 * @param content - The text content to insert
	 */
	async updateDocumentContent(
		documentId: string,
		content: string,
	): Promise<void> {
		try {
			await logger.time("Update document content", async () => {
				return await this.docsService.documents.batchUpdate({
					documentId: documentId,
					requestBody: {
						requests: [
							{
								insertText: {
									location: {
										index: 1,
									},
									text: content,
								},
							},
						],
					},
				});
			});

			logger.info("Document content updated successfully", {
				documentId,
				contentLength: content.length,
			});
		} catch (error) {
			logger.error(`Error updating Google Doc content`, error, { documentId });
			throw error;
		}
	}

	/**
	 * Converts Markdown content to a formatted Google Doc
	 * @param documentId - The ID of the document to format
	 * @param markdownContent - The Markdown content to convert
	 */
	async convertMarkdownToFormattedDoc(
		documentId: string,
		markdownContent: string,
	): Promise<void> {
		try {
			logger.debug("Starting markdown conversion", { documentId });

			// First convert to plain text (keeping markdown syntax)
			const plainText = convertMarkdownToPlainText(markdownContent);
			await this.updateDocumentContent(documentId, plainText);

			// Get the document
			const document = await this.docsService.documents.get({ documentId });

			// Apply formatting
			const requests = await this.createFormattingRequestsFromMarkdown(
				markdownContent,
				document.data,
			);

			// Apply formatting in batches
			if (requests.length > 0) {
				await logger.time("Apply text formatting", async () => {
					const batchSize = 1000;
					for (let i = 0; i < requests.length; i += batchSize) {
						const batch = requests.slice(i, i + batchSize);
						await this.docsService.documents.batchUpdate({
							documentId: documentId,
							requestBody: {
								requests: batch,
							},
						});
					}
				});
			}

			// Now clean up the markdown syntax
			const cleanupRequests = this.createMarkdownSyntaxCleanupRequests(
				document.data,
			);
			if (cleanupRequests.length > 0) {
				await this.docsService.documents.batchUpdate({
					documentId: documentId,
					requestBody: {
						requests: cleanupRequests,
					},
				});
			}

			logger.info("Document formatting applied successfully", {
				documentId,
				requestCount: requests.length,
			});
		} catch (error) {
			logger.error(`Error formatting Google Doc content`, error, {
				documentId,
			});
			throw error;
		}
	}

	/**
	 * Recursively processes Markdown tokens to apply formatting
	 * @param tokens - Array of Markdown tokens
	 * @param context - Renderer context
	 * @private
	 */
	private processTokensRecursively(
		tokens: Token[],
		context: RendererContext,
	): void {
		for (const token of tokens) {
			switch (token.type) {
				case "strong":
					this.applyStrongFormatting(token as Tokens.Strong, context);
					break;
				case "em":
					this.applyEmFormatting(token as Tokens.Em, context);
					break;
				case "link":
					this.applyLinkFormatting(token as Tokens.Link, context);
					break;
				case "codespan":
					this.applyCodespanFormatting(token as Tokens.Codespan, context);
					break;
			}

			if ("tokens" in token && Array.isArray(token.tokens)) {
				this.processTokensRecursively(token.tokens, context);
			}

			if (token.type === "list") {
				const listToken = token as Tokens.List;
				for (const item of listToken.items) {
					if (item.tokens) {
						this.processTokensRecursively(item.tokens, context);
					}
				}
			}
		}
	}

	/**
	 * Applies bold formatting to text
	 * @param token - Strong token from Markdown
	 * @param context - Renderer context
	 * @private
	 */
	private applyStrongFormatting(
		token: Tokens.Strong,
		context: RendererContext,
	): void {
		const cleanText = token.text.replace(/<[^>]*>/g, "");
		const positions = context.findTextPositions(
			context.contentWithPositions,
			cleanText,
		);
		for (const position of positions) {
			context.requests.push({
				updateTextStyle: {
					range: {
						startIndex: position.startIndex,
						endIndex: position.endIndex,
					},
					textStyle: {
						bold: true,
					},
					fields: "bold",
				},
			});
		}
	}

	/**
	 * Applies italic formatting to text
	 * @param token - Em token from Markdown
	 * @param context - Renderer context
	 * @private
	 */
	private applyEmFormatting(token: Tokens.Em, context: RendererContext): void {
		const positions = context.findTextPositions(
			context.contentWithPositions,
			token.text,
		);
		for (const position of positions) {
			context.requests.push({
				updateTextStyle: {
					range: {
						startIndex: position.startIndex,
						endIndex: position.endIndex,
					},
					textStyle: {
						italic: true,
					},
					fields: "italic",
				},
			});
		}
	}

	/**
	 * Applies link formatting to text
	 * @param token - Link token from Markdown
	 * @param context - Renderer context
	 * @private
	 */
	private applyLinkFormatting(
		token: Tokens.Link,
		context: RendererContext,
	): void {
		const positions = context.findTextPositions(
			context.contentWithPositions,
			token.text,
		);
		for (const position of positions) {
			context.requests.push({
				updateTextStyle: {
					range: {
						startIndex: position.startIndex,
						endIndex: position.endIndex,
					},
					textStyle: {
						link: {
							url: token.href,
						},
					},
					fields: "link",
				},
			});
		}
	}

	/**
	 * Applies code formatting to inline code
	 * @param token - Codespan token from Markdown
	 * @param context - Renderer context
	 * @private
	 */
	private applyCodespanFormatting(
		token: Tokens.Codespan,
		context: RendererContext,
	): void {
		const positions = context.findTextPositions(
			context.contentWithPositions,
			token.text,
		);
		for (const position of positions) {
			context.requests.push({
				updateTextStyle: {
					range: {
						startIndex: position.startIndex,
						endIndex: position.endIndex,
					},
					textStyle: {
						weightedFontFamily: {
							fontFamily: "Courier New",
						},
					},
					fields: "weightedFontFamily",
				},
			});
		}
	}

	/**
	 * Creates formatting requests for Markdown content
	 * @param markdownContent - The Markdown content to format
	 * @param document - The Google Doc document object
	 * @returns Array of Google Docs API requests
	 * @private
	 */
	private async createFormattingRequestsFromMarkdown(
		markdownContent: string,
		document: any,
	): Promise<any[]> {
		const requests: any[] = [];

		const renderer = new marked.Renderer();
		const contentWithPositions = this.getContentWithPositions(document);

		const paragraphs = document.body.content
			.filter((item: any) => item.paragraph)
			.map((item: any) => ({
				startIndex: item.startIndex,
				endIndex: item.endIndex,
				content: item.paragraph.elements
					.map((el: any) => el.textRun?.content || "")
					.join(""),
			}));

		type ContentPosition = {
			text: string;
			startIndex: number;
			endIndex: number;
		};
		type ParagraphPosition = {
			startIndex: number;
			endIndex: number;
			content: string;
		};

		type RendererContext = {
			findParagraphByText: (
				paragraphs: ParagraphPosition[],
				text: string,
			) => ParagraphPosition | null;
			findTextPositions: (
				contentWithPositions: ContentPosition[],
				text: string,
			) => TextPosition[];
			paragraphs: ParagraphPosition[];
			contentWithPositions: ContentPosition[];
			requests: any[];
		};

		const context: RendererContext = {
			findParagraphByText: this.findParagraphByText.bind(this),
			findTextPositions: this.findTextPositions.bind(this),
			paragraphs,
			contentWithPositions,
			requests,
		};

		function isHeadingToken(token: Tokens.Generic): token is Tokens.Heading {
			return token.type === "heading" && "depth" in token && "text" in token;
		}

		function isListToken(token: Tokens.Generic): token is Tokens.List {
			return token.type === "list" && "items" in token && "ordered" in token;
		}

		type TextPosition = { startIndex: number; endIndex: number };

		function stripHtml(html: string): string {
			return html.replace(/<[^>]*>/g, "");
		}

		renderer.heading = (token: Tokens.Heading): string => {
			if (!isHeadingToken(token)) {
				logger.warn("Invalid heading token", token);
				return "";
			}

			const cleanText = stripHtml(token.text);

			const paragraph = context.findParagraphByText(
				context.paragraphs,
				cleanText,
			);
			if (paragraph) {
				context.requests.push({
					updateParagraphStyle: {
						range: {
							startIndex: paragraph.startIndex,
							endIndex: paragraph.endIndex - 1,
						},
						paragraphStyle: {
							namedStyleType: `HEADING_${Math.min(Math.max(token.depth, 1), 6)}`,
						},
						fields: "namedStyleType",
					},
				});
			}
			return cleanText;
		};

		renderer.strong = ({ text }: Tokens.Strong): string => {
			const positions = context.findTextPositions(
				context.contentWithPositions,
				text,
			);
			for (const position of positions) {
				context.requests.push({
					updateTextStyle: {
						range: {
							startIndex: position.startIndex,
							endIndex: position.endIndex,
						},
						textStyle: {
							bold: true,
						},
						fields: "bold",
					},
				});
			}
			return text;
		};

		renderer.em = ({ text }: Tokens.Em): string => {
			const positions = context.findTextPositions(
				context.contentWithPositions,
				text,
			);
			for (const position of positions) {
				context.requests.push({
					updateTextStyle: {
						range: {
							startIndex: position.startIndex,
							endIndex: position.endIndex,
						},
						textStyle: {
							italic: true,
						},
						fields: "italic",
					},
				});
			}
			return text;
		};

		renderer.link = ({ href, title, text }: Tokens.Link): string => {
			const positions = context.findTextPositions(
				context.contentWithPositions,
				text,
			);
			for (const position of positions) {
				context.requests.push({
					updateTextStyle: {
						range: {
							startIndex: position.startIndex,
							endIndex: position.endIndex,
						},
						textStyle: {
							link: {
								url: href,
							},
						},
						fields: "link",
					},
				});
			}
			return text;
		};

		renderer.code = ({ text, lang, escaped }: Tokens.Code): string => {
			const positions = context.findTextPositions(
				context.contentWithPositions,
				text,
			);
			for (const position of positions) {
				context.requests.push({
					updateTextStyle: {
						range: {
							startIndex: position.startIndex,
							endIndex: position.endIndex,
						},
						textStyle: {
							weightedFontFamily: {
								fontFamily: "Courier New",
							},
							backgroundColor: {
								color: {
									rgbColor: {
										red: 0.95,
										green: 0.95,
										blue: 0.95,
									},
								},
							},
						},
						fields: "weightedFontFamily,backgroundColor",
					},
				});
			}
			return text;
		};

		renderer.codespan = ({ text }: Tokens.Codespan): string => {
			const positions = context.findTextPositions(
				context.contentWithPositions,
				text,
			);
			for (const position of positions) {
				context.requests.push({
					updateTextStyle: {
						range: {
							startIndex: position.startIndex,
							endIndex: position.endIndex,
						},
						textStyle: {
							weightedFontFamily: {
								fontFamily: "Courier New",
							},
						},
						fields: "weightedFontFamily",
					},
				});
			}
			return text;
		};

		renderer.list = (token: Tokens.List): string => {
			if (!isListToken(token)) {
				logger.warn("Invalid list token", token);
				return "";
			}

			for (const item of token.items) {
				const paragraph = context.findParagraphByText(
					context.paragraphs,
					item.text.trim(),
				);
				if (paragraph) {
					context.requests.push({
						createParagraphBullets: {
							range: {
								startIndex: paragraph.startIndex,
								endIndex: paragraph.endIndex - 1,
							},
							bulletPreset: token.ordered
								? "NUMBERED_DECIMAL_NESTED"
								: "BULLET_DISC_CIRCLE_SQUARE",
						},
					});
				}
			}

			return token.items.map((item) => item.text).join("\n");
		};

		const tokens = marked.lexer(markdownContent);

		this.processTokensRecursively(tokens, context);

		for (const token of tokens) {
			if (token.type === "heading") {
				const headingToken = token as Tokens.Heading;
				const paragraph = context.findParagraphByText(
					context.paragraphs,
					headingToken.text.trim(),
				);
				if (paragraph) {
					let headingStyle: string;
					switch (headingToken.depth) {
						case 1:
							headingStyle = "HEADING_1";
							break;
						case 2:
							headingStyle = "HEADING_2";
							break;
						case 3:
							headingStyle = "HEADING_3";
							break;
						case 4:
							headingStyle = "HEADING_4";
							break;
						case 5:
							headingStyle = "HEADING_5";
							break;
						case 6:
							headingStyle = "HEADING_6";
							break;
						default:
							headingStyle = "NORMAL_TEXT";
					}

					context.requests.push({
						updateParagraphStyle: {
							range: {
								startIndex: paragraph.startIndex,
								endIndex: paragraph.endIndex - 1,
							},
							paragraphStyle: {
								namedStyleType: headingStyle,
							},
							fields: "namedStyleType",
						},
					});
				}
			} else if (token.type === "list") {
				const listToken = token as Tokens.List;
				const paragraphs = context.paragraphs;

				for (const item of listToken.items) {
					const paragraph = context.findParagraphByText(
						paragraphs,
						item.text.trim(),
					);
					if (paragraph) {
						requests.push({
							createParagraphBullets: {
								range: {
									startIndex: paragraph.startIndex,
									endIndex: paragraph.endIndex - 1,
								},
								bulletPreset: listToken.ordered
									? "NUMBERED_DECIMAL_NESTED"
									: "BULLET_DISC_CIRCLE_SQUARE",
							},
						});
					}
				}
			}
		}

		return requests;
	}

	/**
	 * Extracts content with positions from a Google Doc
	 * @param document - The Google Doc document object
	 * @returns Array of content elements with their positions
	 * @public
	 */
	public getContentWithPositions(
		document: any,
	): { text: string; startIndex: number; endIndex: number }[] {
		const result: { text: string; startIndex: number; endIndex: number }[] = [];

		if (document.body && document.body.content) {
			for (const item of document.body.content) {
				if (item.paragraph) {
					for (const element of item.paragraph.elements) {
						if (element.textRun && element.textRun.content) {
							result.push({
								text: element.textRun.content,
								startIndex: element.startIndex,
								endIndex: element.endIndex,
							});
						}
					}
				}
			}
		}

		return result;
	}

	/**
	 * Finds positions of text in a document
	 * @param contentWithPositions - Array of content elements with their positions
	 * @param searchText - Text to search for
	 * @returns Array of positions where the text was found
	 * @public
	 */
	public findTextPositions(
		contentWithPositions: {
			text: string;
			startIndex: number;
			endIndex: number;
		}[],
		searchText: string,
	): { startIndex: number; endIndex: number }[] {
		const results: { startIndex: number; endIndex: number }[] = [];

		for (const item of contentWithPositions) {
			let index = item.text.indexOf(searchText);
			while (index !== -1) {
				results.push({
					startIndex: item.startIndex + index,
					endIndex: item.startIndex + index + searchText.length,
				});
				index = item.text.indexOf(searchText, index + 1);
			}
		}

		return results;
	}

	/**
	 * Finds a paragraph by its text content using string similarity
	 * @param paragraphs - Array of paragraphs to search
	 * @param text - Text to search for
	 * @param similarityThreshold - Minimum similarity threshold (0-1)
	 * @returns The matching paragraph or null if not found
	 * @public
	 */
	public findParagraphByText(
		paragraphs: ParagraphPosition[],
		text: string,
		similarityThreshold = 0.8,
	): ParagraphPosition | null {
		const target = text.trim().toLowerCase();

		for (const paragraph of paragraphs) {
			const source = paragraph.content.trim().toLowerCase();
			const similarity = stringSimilarity.compareTwoStrings(source, target);

			if (similarity >= similarityThreshold) {
				return paragraph;
			}
		}

		logger.warn("Paragraph not found for text:", { target, paragraphs });
		return null;
	}

	/**
	 * Creates requests to clean up Markdown syntax from the document
	 * @param document - The Google Doc document object
	 * @returns Array of Google Docs API requests
	 * @private
	 */
	private createMarkdownSyntaxCleanupRequests(document: any): any[] {
		const requests: any[] = [];
		const contentWithPositions = this.getContentWithPositions(document);

		// Find and replace markdown syntax patterns
		const patterns = [
			{ regex: /\*\*(.*?)\*\*/g, replacement: "$1" }, // Bold
			{ regex: /\*(.*?)\*/g, replacement: "$1" }, // Italic
			{ regex: /`(.*?)`/g, replacement: "$1" }, // Code
			{ regex: /__(.*?)__/g, replacement: "$1" }, // Underline
			{ regex: /_(.*?)_/g, replacement: "$1" }, // Underline/Italic
			{ regex: /~~(.*?)~~/g, replacement: "$1" }, // Strikethrough
		];

		for (const item of contentWithPositions) {
			for (const pattern of patterns) {
				let match;
				while ((match = pattern.regex.exec(item.text)) !== null) {
					const fullMatch = match[0];
					const startIndex = item.startIndex + match.index;
					const endIndex = startIndex + fullMatch.length;

					requests.push({
						replaceAllText: {
							replaceText: match[1], // The text without markdown syntax
							containsText: {
								text: fullMatch,
								matchCase: true,
							},
						},
					});
				}
			}
		}

		return requests;
	}

	/**
	 * Creates a Google Doc from Markdown content and shares it
	 * @param options - Options for creating and sharing the document
	 * @returns Promise resolving to the document URL
	 * @public
	 */
	async createAndShareDocument(options: GoogleDocOptions): Promise<string> {
		try {
			logger.info("Starting document creation process", {
				title: options.title,
				recipient: options.recipientEmail,
			});

			const documentId = await this.createDocument(options.title);

			await this.convertMarkdownToFormattedDoc(
				documentId,
				options.markdownContent,
			);

			await this.shareDocument(documentId, options.recipientEmail);

			const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
			logger.success("Document created, updated, and shared successfully", {
				documentUrl,
			});

			return documentUrl;
		} catch (error) {
			logger.error(`Error in createAndShareDocument`, error, {
				title: options.title,
				recipient: options.recipientEmail,
			});
			throw error;
		}
	}
}

/**
 * Main class for command-line execution
 * Automatically runs when the module is executed directly
 */
@selfExecute
class Main {
	constructor() {
		if (require.main === module) {
			this.main();
		}
	}

	/**
	 * Main entry point for command-line execution
	 */
	async main() {
		const args = process.argv.slice(2);

		if (args.length < 3) {
			console.log(
				"Usage: bun run markdown-to-google-docs.ts <input.md> <document-title> <recipient-email> [credentials-path]",
			);
			process.exit(1);
		}

		const [inputFile, title, email, credentialsPath] = args;

		try {
			const markdownContent = await Bun.file(inputFile).text();

			const manager = new GoogleDocsManager(credentialsPath);

			const documentUrl = await manager.createAndShareDocument({
				title,
				recipientEmail: email,
				markdownContent,
			});

			console.log(`Document created and shared successfully!`);
			console.log(`URL: ${documentUrl}`);
		} catch (error) {
			console.error(`Error: ${error}`);
			process.exit(1);
		}
	}
}

export { GoogleDocsManager, type GoogleDocOptions, Main };
