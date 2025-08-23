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
