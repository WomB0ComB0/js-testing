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

import { GoogleGenAI } from "@google/genai";

if (require.main === module) {
	(async () => {
		const ai = new GoogleGenAI({
			apiKey: process.env.GEMINI_API_KEY,
		});
		const response = await ai.models.generateContent({
			model: "gemini-2.5-pro-exp-03-25",
			contents: [
				{
					parts: [
						{
							text: `Hello, world!`,
						},
					],
				},
			],
			config: {
				systemInstruction: "You are an expert resume writer",
				maxOutputTokens: 65536,
			},
		});

		console.log(response.candidates?.[0]?.content?.parts?.[0]?.text);
	})();
}
