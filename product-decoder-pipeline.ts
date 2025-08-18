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

// Testing
// Test 2
// Test 3
import axios from "axios";
import { customsearch_v1, youtube_v3 } from 'googleapis';
import { z } from 'zod';

const SearchRecommendationSchema = z.object({
  info: z.object({
    totalResults: z.string(),
    searchTime: z.number(),
    formattedTotalResults: z.string(),
    formattedSearchTime: z.string(),
  }),
  items: z.array(
    z.object({
      link: z.string(),
      title: z.string(),
      snippet: z.string(),
      thumbnail: z
        .object({
          src: z.string(),
          width: z.string(),
          height: z.string(),
        })
        .optional(),
    }),
  ),
});

type SearchRecommendation = z.infer<typeof SearchRecommendationSchema>;

// YouTube API Configuration
const YOUTUBE_API_KEY = process.env.GOOGLE_YOUTUBE_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

// Initialize Google Custom Search
const customSearch = new customsearch_v1.Customsearch({
  key: GOOGLE_SEARCH_API_KEY,
});

// Initialize YouTube API
const youtube = new youtube_v3.Youtube({
  key: YOUTUBE_API_KEY,
});

/**
 * Truncates a query string to a maximum length
 */
function truncateQuery(query: string, maxLength = 100): string {
  if (query.length <= maxLength) return query;
  return query.substring(0, maxLength - 3) + '...';
}

/**
 * Searches YouTube videos using the YouTube Data API v3
 */
export const searchYouTube = async (query: string, pageToken?: string) => {
  if (!YOUTUBE_API_KEY) {
    throw new Error('YouTube API key is missing');
  }

  try {
    const params: {
      part: string[];
      q: string;
      type: string;
      maxResults: number;
      pageToken?: string;
    } = {
      part: ['snippet'],
      q: query,
      type: 'video',
      maxResults: 10,
    };

    if (pageToken) params.pageToken = pageToken;

    const response = await youtube.search.list(params);
    
    return response.data;
  } catch (error) {
    throw new Error(
      `Error searching YouTube: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Performs a Google Custom Search
 */
export const search = async (query: string): Promise<SearchRecommendation> => {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID) {
    throw new Error('Google Search API key or Search Engine ID is missing');
  }

  try {
    const truncatedQuery = truncateQuery(query);
    const res = await customSearch.cse.list({
      key: GOOGLE_SEARCH_API_KEY,
      cx: GOOGLE_SEARCH_ENGINE_ID,
      q: truncatedQuery,
    });

    const data = res.data;
    
    const result = SearchRecommendationSchema.parse({
      info: {
        totalResults: data.searchInformation?.totalResults || '0',
        searchTime: data.searchInformation?.searchTime || 0,
        formattedTotalResults: data.searchInformation?.formattedTotalResults || '0',
        formattedSearchTime: data.searchInformation?.formattedSearchTime || '0',
      },
      items: data.items?.map((item) => ({
        link: item.link || '',
        title: item.title || 'No title',
        snippet: item.snippet || 'No snippet available',
        thumbnail:
          item.pagemap?.cse_thumbnail?.[0]
            ? {
                src: item.pagemap.cse_thumbnail[0].src || '',
                width: item.pagemap.cse_thumbnail[0].width || '',
                height: item.pagemap.cse_thumbnail[0].height || '',
              }
            : undefined,
      })) || [],
    });

    return result;
  } catch (error) {
    throw new Error(
      `Error performing search: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};