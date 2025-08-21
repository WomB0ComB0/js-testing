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

import vision from "@google-cloud/vision";
import fs from "node:fs/promises";
import { type } from "arktype";

const WebDetection = type({
  webEntities: [{ description: "string|undefined", score: "number|undefined" }, "[]"],
  fullMatchingImages: [{ url: "string" }, "[]"],
  partialMatchingImages: [{ url: "string" }, "[]"],
  pagesWithMatchingImages: [{ url: "string", pageTitle: "string|undefined" }, "[]"],
});
type WebDetection = typeof WebDetection.infer;

const client = new vision.ImageAnnotatorClient({ keyFilename: './credentials.json' }); // requires GOOGLE_APPLICATION_CREDENTIALS

export async function reverseImageSearch(filePath: string): Promise<WebDetection> {
  const [res] = await client.webDetection({ image: { content: await fs.readFile(filePath) } });
  const web = res.webDetection ?? {};

  const data = WebDetection.assert({
    webEntities: (web.webEntities ?? []).map(e => ({ description: e.description, score: e.score })),
    fullMatchingImages: (web.fullMatchingImages ?? []).map(i => ({ url: i.url ?? "" })),
    partialMatchingImages: (web.partialMatchingImages ?? []).map(i => ({ url: i.url ?? "" })),
    pagesWithMatchingImages: (web.pagesWithMatchingImages ?? []).map(p => ({
      url: p.url ?? "",
      pageTitle: p.pageTitle
    })),
  });

  return data;
}

// (async () => console.log(await reverseImageSearch('./test_image.jpg')))()
