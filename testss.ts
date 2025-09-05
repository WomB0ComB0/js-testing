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

(async () => {
	const HOME = Bun.env.HOME ?? process.env.HOME;
	if (!HOME) throw new Error("HOME is not set");

	const GIT_DIFF_EXCLUDE = ".config/git/gitdiff-exclude";
	const EXCLUDE_PATH = path.join(HOME, GIT_DIFF_EXCLUDE);

	const DEFAULT_EXCLUDES = [
		// folders
		"/.git/",
		"/.husky/",
		"/node_modules/",
		"/dist/",
		"/build/",
		"/.next/",
		"/out/",
		"/.pnpm-store/",
		// file patterns
		".lock",
		".png",
		".jpg",
		".jpeg",
		".gif",
		".webp",
		".mp4",
		".mp3",
		".pdf",
		".woff",
		".woff2",
		".ttf",
		".eot",
	];
	// console.log(EXCLUDE_PATH);
})();
