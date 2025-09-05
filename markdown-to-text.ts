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
 * # Markdown to Plain Text Converter
 *
 * This module provides functionality to convert Markdown content to plain text
 * while preserving the structure and readability of the original content.
 *
 * ## Features
 * - Converts Markdown to plain text with customizable formatting
 * - Preserves document structure (headings, lists, tables)
 * - Handles special characters and HTML entities
 * - Provides fallback rendering options
 * - Preserves table of contents structure
 *
 * ## Usage
 * ```typescript
 * import { convertMarkdownToPlainText } from './markdown-to-text';
 *
 * const markdown = '# Hello World\n\nThis is **bold** and *italic*.';
 * const plainText = convertMarkdownToPlainText(markdown);
 *
 * console.log(plainText);
 * // Output: Hello World
 * //
 * // This is bold and italic.
 * ```
 */

import type { MarkedOptions, Renderer, Tokens } from "marked";
import { marked } from "marked";
import { Logger, LogLevel } from "./logger";

// Create a logger instance for this module
const logger = Logger.getLogger("MarkdownToText", {
	minLevel: LogLevel.INFO,
	includeTimestamp: true,
});

/**
 * Options for the plain text renderer
 * @interface PlainTextRendererOptions
 * @extends MarkedOptions
 */
interface PlainTextRendererOptions extends MarkedOptions {
	/** Use spaces instead of newlines for whitespace delimiter */
	spaces?: boolean;
}

/**
 * Renderer that converts Markdown tokens to plain text
 * @class PlainTextRenderer
 * @implements {Renderer}
 */
class PlainTextRenderer implements Renderer {
	parser: any;
	options: PlainTextRendererOptions;
	private whitespaceDelimiter: string;

	/**
	 * Creates a new PlainTextRenderer instance
	 * @param {PlainTextRendererOptions} options - Configuration options
	 */
	constructor(options?: PlainTextRendererOptions) {
		this.options = options || {};
		this.whitespaceDelimiter = this.options.spaces ? " " : "\n";
		this.parser = {
			parse: (text: string) => text,
		};
		logger.debug("PlainTextRenderer initialized", { options: this.options });
	}

	/**
	 * Helper method to safely convert any value to string
	 * @param {any} value - The value to convert to string
	 * @returns {string} The string representation of the value
	 * @private
	 */
	private safeToString(value: any): string {
		if (value == null) {
			return "";
		}

		if (typeof value === "object") {
			try {
				return JSON.stringify(value);
			} catch (e) {
				logger.warn("Failed to stringify object", { error: e });
				return "[Complex Object]";
			}
		}

		return String(value);
	}

	/**
	 * Renders a space token
	 * @returns {string} The rendered space
	 */
	space(): string {
		return this.whitespaceDelimiter;
	}

	/**
	 * Renders a code block token
	 * @param {Tokens.Code} token - The code block token
	 * @returns {string} The rendered code block
	 */
	code(token: Tokens.Code): string {
		return `${this.whitespaceDelimiter}${this.whitespaceDelimiter}${this.safeToString(token.text)}${this.whitespaceDelimiter}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders a blockquote token
	 * @param {Tokens.Blockquote} token - The blockquote token
	 * @returns {string} The rendered blockquote
	 */
	blockquote(token: Tokens.Blockquote): string {
		return `\t${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders an HTML token
	 * @param {Tokens.HTML | Tokens.Tag} token - The HTML token
	 * @returns {string} The rendered HTML
	 */
	html(token: Tokens.HTML | Tokens.Tag): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders a heading token
	 * @param {Tokens.Heading} token - The heading token
	 * @returns {string} The rendered heading
	 */
	heading(token: Tokens.Heading): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders a horizontal rule token
	 * @returns {string} The rendered horizontal rule
	 */
	hr(): string {
		return `${this.whitespaceDelimiter}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders a list token
	 * @param {Tokens.List} token - The list token
	 * @returns {string} The rendered list
	 */
	list(token: Tokens.List): string {
		return this.safeToString(
			token.items.map((item) => item.text).join(this.whitespaceDelimiter),
		);
	}

	/**
	 * Renders a list item token
	 * @param {Tokens.ListItem} token - The list item token
	 * @returns {string} The rendered list item
	 */
	listitem(token: Tokens.ListItem): string {
		return `\t${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders a paragraph token
	 * @param {Tokens.Paragraph} token - The paragraph token
	 * @returns {string} The rendered paragraph
	 */
	paragraph(token: Tokens.Paragraph): string {
		return `${this.whitespaceDelimiter}${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders a table token
	 * @param {Tokens.Table} token - The table token
	 * @returns {string} The rendered table
	 */
	table(token: Tokens.Table): string {
		const header = token.header.map((cell) => cell.text).join("\t");
		const rows = token.rows
			.map((row) => row.map((cell) => cell.text).join("\t"))
			.join(this.whitespaceDelimiter);
		return `${this.whitespaceDelimiter}${header}${this.whitespaceDelimiter}${rows}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders a table row token
	 * @param {Tokens.TableRow} token - The table row token
	 * @returns {string} The rendered table row
	 */
	tablerow(token: Tokens.TableRow): string {
		return `${this.safeToString(token.text)}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders a table cell token
	 * @param {Tokens.TableCell} token - The table cell token
	 * @returns {string} The rendered table cell
	 */
	tablecell(token: Tokens.TableCell): string {
		return `${this.safeToString(token.text)}\t`;
	}

	/**
	 * Renders a strong (bold) token
	 * @param {Tokens.Strong} token - The strong token
	 * @returns {string} The rendered strong text
	 */
	strong(token: Tokens.Strong): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders an emphasis (italic) token
	 * @param {Tokens.Em} token - The emphasis token
	 * @returns {string} The rendered emphasis text
	 */
	em(token: Tokens.Em): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders a code span token
	 * @param {Tokens.Codespan} token - The code span token
	 * @returns {string} The rendered code span
	 */
	codespan(token: Tokens.Codespan): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders a line break token
	 * @returns {string} The rendered line break
	 */
	br(): string {
		return `${this.whitespaceDelimiter}${this.whitespaceDelimiter}`;
	}

	/**
	 * Renders a deletion (strikethrough) token
	 * @param {Tokens.Del} token - The deletion token
	 * @returns {string} The rendered deletion text
	 */
	del(token: Tokens.Del): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders a link token
	 * @param {Tokens.Link} token - The link token
	 * @returns {string} The rendered link text
	 */
	link(token: Tokens.Link): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders an image token
	 * @param {Tokens.Image} token - The image token
	 * @returns {string} The rendered image text
	 */
	image(token: Tokens.Image): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders a text token
	 * @param {Tokens.Text | Tokens.Escape} token - The text token
	 * @returns {string} The rendered text
	 */
	text(token: Tokens.Text | Tokens.Escape): string {
		return this.safeToString(token.text);
	}

	/**
	 * Renders a checkbox token
	 * @param {Tokens.Checkbox} token - The checkbox token
	 * @returns {string} The rendered checkbox
	 */
	checkbox(token: Tokens.Checkbox): string {
		return token.checked ? "[x]" : "[ ]";
	}
}

/** Default options for the marked parser */
const defaultOptions: MarkedOptions = {};

/**
 * Converts Markdown text to plain text
 * @param {string} markdownText - The Markdown text to convert
 * @param {MarkedOptions} markedOptions - Options for the marked parser
 * @returns {string} The converted plain text
 */
function convertMarkdownToPlainText(
	markdownText: string,
	markedOptions: MarkedOptions = defaultOptions,
): string {
	try {
		const tokens = marked.lexer(markdownText);
		let plainText = "";

		const tocRegex =
			/(?:^|\n)(?:#+\s*(?:Table of Contents|Contents|TOC)\s*(?:\n+))(((?:\n*[\s]*\*.*\[.*\]\(.*\).*(?:\n|$))+))/i;
		const tocMatch = markdownText.match(tocRegex);
		let tableOfContents = "";

		if (tocMatch && tocMatch[1]) {
			// Extract the table of contents section
			tableOfContents = tocMatch[1];

			// Process the TOC links to make them plain text but preserve structure
			tableOfContents = tableOfContents
				.replace(/\*\s*\[(.*?)\]\(.*?\)/g, "• $1") // Convert markdown links to bullet points
				.replace(/\s{4}\*/g, "    •") // Preserve indentation for nested items
				.replace(/\s{8}\*/g, "        •"); // Preserve indentation for deeper nested items
		}

		/**
		 * Recursively extracts text from a token
		 * @param {any} token - The token to extract text from
		 * @returns {string} The extracted text
		 */
		const extractText = (token: any): string => {
			if (typeof token === "string") return token;

			if (token.text) return token.text;

			if (token.tokens) {
				return token.tokens.map(extractText).join(" ");
			}

			if (token.items) {
				return token.items.map(extractText).join("\n");
			}

			if (token.type === "table") {
				let tableText = "";
				if (token.header) {
					tableText +=
						token.header.map((cell: any) => cell.text).join(" | ") + "\n";
				}
				if (token.rows) {
					tableText += token.rows
						.map((row: any) => row.map((cell: any) => cell.text).join(" | "))
						.join("\n");
				}
				return tableText;
			}

			return "";
		};

		plainText = tokens.map(extractText).join("\n\n");
		plainText = plainText
			.replace(/\n{3,}/g, "\n\n")
			.replace(tocRegex, tableOfContents);

		return convertASCIICharsToText(plainText);
	} catch (error) {
		logger.error(`Error converting markdown to plain text: ${error}`);
		const renderer = new PlainTextRenderer();
		marked.setOptions(markedOptions);
		const plainText = marked(markdownText, { renderer }).toString();
		return convertASCIICharsToText(plainText);
	}
}

/**
 * Converts HTML entities and ASCII character codes to their corresponding characters
 * @param {string} str - The string containing HTML entities to convert
 * @returns {string} The string with HTML entities converted to characters
 */
function convertASCIICharsToText(str: string): string {
	logger.debug("Converting ASCII characters to text", {
		inputLength: str.length,
	});

	let result = str;

	const htmlEntities: Record<string, string> = {
		"&quot;": '"',
		"&amp;": "&",
		"&lt;": "<",
		"&gt;": ">",
		"&apos;": "'",
		"&nbsp;": " ",
		"&ndash;": "–",
		"&mdash;": "—",
		"&lsquo;": "'",
		"&rsquo;": "'",
		"&ldquo;": '"',
		"&rdquo;": '"',
		"&bull;": "•",
		"&hellip;": "…",
		"&copy;": "©",
		"&reg;": "®",
		"&trade;": "™",
		"&euro;": "€",
		"&pound;": "£",
		"&yen;": "¥",
		"&cent;": "¢",
		"&sect;": "§",
		"&para;": "¶",
		"&deg;": "°",
		"&plusmn;": "±",
		"&times;": "×",
		"&divide;": "÷",
		"&frac14;": "¼",
		"&frac12;": "½",
		"&frac34;": "¾",
		"&ne;": "≠",
		"&le;": "≤",
		"&ge;": "≥",
		"&micro;": "µ",
		"&middot;": "·",
	};

	for (const [entity, char] of Object.entries(htmlEntities)) {
		result = result.replaceAll(entity, char);
	}

	// Convert decimal HTML entities (&#123;)
	result = result.replace(/&#(\d+);/g, (match, code) =>
		String.fromCharCode(Number(code)),
	);

	// Convert hexadecimal HTML entities (&#x7B;)
	result = result.replace(/&#[xX]([A-Fa-f0-9]+);/g, (match, code) =>
		String.fromCharCode(parseInt(code, 16)),
	);

	return result;
}

export { convertMarkdownToPlainText, convertASCIICharsToText };
