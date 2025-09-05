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

import { $, write } from "bun";

if (require.main === module) {
	(async () => {
		try {
			const filePath = `${process.cwd()}/.gitignore`;
			console.log(filePath);
			const content = await $`cat ${filePath}`.text().then((text) =>
				text
					.trim()
					.replace(/[\u{1F600}-\u{1F64F}]/gu, "")
					.replace(/[^\x00-\x7F]/g, "")
					.replace(/,/g, " ")
					.replace(/:/g, " ")
					.replace(/=/g, " ")
					.replace(/;/g, " "),
			);

			if (!content) throw new Error("File not found");

			const book: Set<string> = new Set();
			for (const line of content.split("\n")) {
				if (line.includes("#")) {
					if (line.startsWith("#")) continue;
					const [key, value] = line.split("#");
					if (key.trim().length > 0) book.add(key);
					if (value.trim().length > 0) book.add(value);
				}
				if (line.trim().length > 0) book.add(line);
			}
			await write(filePath, Array.from(book.values()).join("\n"));
		} catch (error) {
			console.error("An error occurred:", error);
			throw new Error(`${Error.isError(error) ? error.message : error}`);
		}
	})();
	process.exit(0);
}
