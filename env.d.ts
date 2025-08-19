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

declare global {
	namespace NodeJS {
		interface ProcessEnv extends Record<string, string> {
			NODE_ENV: string;
			FIREBASE_TYPE: string;
			FIREBASE_PROJECT_ID: string;
			FIREBASE_PRIVATE_KEY_ID: string;
			FIREBASE_PRIVATE_KEY: string;
			FIREBASE_CLIENT_EMAIL: string;
			FIREBASE_CLIENT_ID: string;
			FIREBASE_AUTH_URI: string;
			FIREBASE_TOKEN_URI: string;
			FIREBASE_AUTH_PROVIDER_X509_CERT_URL: string;
			FIREBASE_CLIENT_X509_CERT_URL: string;
			FIREBASE_UNIVERSE_DOMAIN: string;
			API_KEY: string;
			GOOGLE_MAPS_API_KEY: string;
			GEMINI_API_KEY: string;
			FIRECRAWL_API_KEY: string;
			GITHUB_TOKEN_M: string;
			GITHUB_TOKEN_R: string;
			GITHUB_TOKEN_D: string;
			REPO_OWNER: string;
			REPO_NAME: string;
			GEMINI_API_KEY: string;
			GOOGLE_API_KEY: string;
			OPENAI_API_KEY: string;
			MONGO_URI: string;
			NEWS_API_KEY: string;
			GNEWS_API_KEY: string;
			ARTICLE_API_KEY: string;
			FOOD_API_KEY: string;
			GOOGLE_YOUTUBE_API_KEY: string;
			GOOGLE_SEARCH_API_KEY: string;
			GOOGLE_SEARCH_ENGINE_ID: string;
		}
	}
}
export {};
