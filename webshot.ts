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

import puppeteer, { Browser, Page } from "puppeteer";
import { parseArgs } from "node:util";
import { mkdir, access } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { constants } from "node:fs";

// Validate and normalize URL
function validateAndNormalizeUrl(url: string): string {
  try {
    // Add https:// if no protocol specified
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    
    const parsed = new URL(url);
    
    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`);
    }
    
    return parsed.href;
  } catch (err) {
    throw new Error(`Invalid URL: ${url}. ${err instanceof Error ? err.message : ""}`);
  }
}

// Validate output filename
function validateOutputFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const validExtensions = [".png", ".jpg", ".jpeg", ".webp"];
  
  if (!ext) {
    return `${filename}.png`;
  }
  
  if (!validExtensions.includes(ext)) {
    throw new Error(`Invalid file extension: ${ext}. Supported: ${validExtensions.join(", ")}`);
  }
  
  return filename;
}

// Ensure output directory exists
async function ensureOutputDirectory(filepath: string): Promise<void> {
  const dir = dirname(filepath);
  
  try {
    await access(dir, constants.W_OK);
  } catch {
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      throw new Error(`Cannot create output directory: ${dir}`);
    }
  }
}

// Parse arguments with validation
let values: {
  url?: string;
  output?: string;
  fullPage?: boolean;
  width?: string;
  height?: string;
  timeout?: string;
  waitUntil?: string;
  userAgent?: string;
};

try {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      url: {
        type: "string",
        short: "u",
      },
      output: {
        type: "string",
        short: "o",
        default: "screenshot.png",
      },
      fullPage: {
        type: "boolean",
        short: "f",
        default: false,
      },
      width: {
        type: "string",
        short: "w",
        default: "1920",
      },
      height: {
        type: "string",
        short: "h",
        default: "1080",
      },
      timeout: {
        type: "string",
        short: "t",
        default: "30000",
      },
      waitUntil: {
        type: "string",
        default: "networkidle2",
      },
      userAgent: {
        type: "string",
      },
    },
  });
  values = parsed.values;
} catch (err) {
  console.error("❌ Error parsing arguments:", err instanceof Error ? err.message : err);
  process.exit(1);
}

// Display help and exit if no URL
if (!values.url) {
  console.error("Error: URL is required\n");
  console.log("Usage: bun run script.ts --url <website-url> [options]\n");
  console.log("Required:");
  console.log("  -u, --url          Website URL to screenshot\n");
  console.log("Options:");
  console.log("  -o, --output       Output filename (default: screenshot.png)");
  console.log("  -f, --fullPage     Capture full page screenshot (default: false)");
  console.log("  -w, --width        Viewport width (default: 1920)");
  console.log("  -h, --height       Viewport height (default: 1080)");
  console.log("  -t, --timeout      Navigation timeout in ms (default: 30000)");
  console.log("  --waitUntil        Wait condition: load, domcontentloaded, networkidle0, networkidle2 (default: networkidle2)");
  console.log("  --userAgent        Custom user agent string\n");
  console.log("Examples:");
  console.log("  bun run script.ts -u https://example.com");
  console.log("  bun run script.ts -u example.com -o screenshots/page.png -f");
  console.log("  bun run script.ts -u example.com -w 1280 -h 720 --timeout 60000");
  process.exit(1);
}

let browser: Browser | null = null;
let page: Page | null = null;

async function main() {
  try {
    // Validate and normalize inputs
    const url = validateAndNormalizeUrl(values.url!);
    const outputPath = resolve(validateOutputFilename(values.output!));
    
    const width = parseInt(values.width!, 10);
    const height = parseInt(values.height!, 10);
    const timeout = parseInt(values.timeout!, 10);
    
    // Validate numeric inputs
    if (isNaN(width) || width <= 0 || width > 7680) {
      throw new Error("Width must be a positive number between 1 and 7680");
    }
    if (isNaN(height) || height <= 0 || height > 4320) {
      throw new Error("Height must be a positive number between 1 and 4320");
    }
    if (isNaN(timeout) || timeout <= 0 || timeout > 300000) {
      throw new Error("Timeout must be a positive number between 1 and 300000 (5 minutes)");
    }
    
    // Validate waitUntil option
    const validWaitOptions = ["load", "domcontentloaded", "networkidle0", "networkidle2"] as const;
    const waitUntil = values.waitUntil as typeof validWaitOptions[number];
    if (!validWaitOptions.includes(waitUntil)) {
      throw new Error(`Invalid waitUntil option: ${values.waitUntil}. Must be one of: ${validWaitOptions.join(", ")}`);
    }
    
    // Ensure output directory exists
    await ensureOutputDirectory(outputPath);
    
    console.log(`📸 Taking screenshot of: ${url}`);
    console.log(`📐 Viewport: ${width}x${height}`);
    console.log(`💾 Output: ${outputPath}`);
    
    // Launch browser with robust options
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=" + width + "," + height,
      ],
    });
    
    page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ 
      width, 
      height,
      deviceScaleFactor: 1,
    });
    
    // Set custom user agent if provided
    if (values.userAgent) {
      await page.setUserAgent(values.userAgent);
    }
    
    // Set extra HTTP headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });
    
    // Handle page errors gracefully
    page.on("pageerror", (err) => {
      console.warn("⚠️  Page error:", err.message);
    });
    
    // Navigate to URL with timeout
    console.log("🌐 Loading page...");
    const response = await page.goto(url, {
      waitUntil,
      timeout,
    });
    
    // Check if navigation was successful
    if (!response) {
      throw new Error("Failed to load page: no response received");
    }
    
    const status = response.status();
    if (status >= 400) {
      console.warn(`⚠️  Warning: Page returned status ${status}`);
    }

    // Wait a bit for any delayed content
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Take screenshot
    console.log("📷 Capturing screenshot...");
    await page.screenshot({
      path: outputPath as `${string}.png` | `${string}.jpeg` | `${string}.webp`,
      fullPage: values.fullPage,
      captureBeyondViewport: values.fullPage,
    });
    console.log(`✅ Screenshot saved successfully to: ${outputPath}`);
    
  } catch (err) {
    if (err instanceof Error) {
      // Provide more specific error messages
      if (err.message.includes("ERR_NAME_NOT_RESOLVED")) {
        console.error("❌ Error: Cannot resolve domain name. Check if the URL is correct and you have internet connection.");
      } else if (err.message.includes("ERR_CONNECTION_REFUSED")) {
        console.error("❌ Error: Connection refused. The server may be down or blocking requests.");
      } else if (err.message.includes("Timeout")) {
        console.error("❌ Error: Navigation timeout. The page took too long to load. Try increasing --timeout value.");
      } else if (err.message.includes("net::")) {
        console.error(`❌ Network error: ${err.message}`);
      } else {
        console.error("❌ Error:", err.message);
      }
    } else {
      console.error("❌ Unknown error:", err);
    }
    process.exit(1);
  } finally {
    // Always close browser and page
    try {
      if (page) await page.close();
      if (browser) await browser.close();
    } catch (err) {
      console.warn("⚠️  Warning: Error closing browser:", err);
    }
  }
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n🛑 Interrupted, cleaning up...");
  if (page) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  process.exit(130);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Terminated, cleaning up...");
  if (page) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  process.exit(143);
});

// Run main function
main();