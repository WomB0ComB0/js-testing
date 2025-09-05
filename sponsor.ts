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

import { Octokit } from "@octokit/rest";
import { argv, env } from "bun";

function selfExecute<T extends { new (...args: any[]): {} }>(
	constructor: T,
): T {
	new constructor();
	return constructor;
}

@selfExecute
class Main {
	private octokit: Octokit;
	private args: [string, ...string[]] = argv.slice(2) as [string, ...string[]];
	private fundingContent: string[] = [
		"github: WomB0ComB0",
		"open_collective: mike-odnis",
		"ko_fi: Y8Y77AJEA",
		"buy_me_a_coffee: mikeodnis",
	] as const;

	constructor() {
		if (!env.GITHUB_TOKEN) {
			throw new Error("GITHUB_TOKEN environment variable is required");
		}

		this.octokit = new Octokit({ auth: env.GITHUB_TOKEN });

		if (this.args.length < 2) {
			throw new Error("Owner and repo arguments are required");
		}

		if (require.main === module) {
			this.updateFundingFile();
		}
	}

	async updateFundingFile() {
		const [owner, repo, path = ".github/FUNDING.yml"] = this.args;
		const content = Buffer.from(this.fundingContent.join("\n") + "\n").toString(
			"base64",
		);

		try {
			// Try to get existing file first
			const { data } = await this.octokit.repos.getContent({
				owner,
				repo,
				path,
			});

			// Update existing file
			await this.octokit.repos.createOrUpdateFileContents({
				owner,
				repo,
				path,
				message: "Update FUNDING.yml",
				content,
				sha: (data as any).sha,
			});

			console.log("Successfully updated FUNDING.yml");
		} catch (error: any) {
			if (error.status === 404) {
				// Create new file if it doesn't exist
				await this.octokit.repos.createOrUpdateFileContents({
					owner,
					repo,
					path,
					message: "Create FUNDING.yml",
					content,
				});

				console.log("Successfully created FUNDING.yml");
			} else {
				console.error("Error updating FUNDING.yml:", error.message);
				throw error;
			}
		}
	}
}
