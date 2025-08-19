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
 * @name Playwright Iframe Remover
 * @description This script uses Playwright to open a website and inject a script
 * that removes/hides all iframes, effectively blocking many types of ads
 * and pop-ups. It's designed to work on sites that block developer tools.
 * @author Gemini
 */

import { execSync } from "node:child_process";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

// The script that will be injected into the page to handle iframes.
// This is the same logic from the previous script, prepared for injection.
const iframeBusterScript = `
    (function() {
        'use strict';

        // --- Configuration ---
        // Set to 'true' to completely remove the iframe.
        // Set to 'false' to hide it (safer).
        const REMOVE_IFRAME_ENTIRELY = false;

        const processIframes = () => {
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    if (REMOVE_IFRAME_ENTIRELY) {
                        iframe.parentNode.removeChild(iframe);
                        console.log('[Iframe Buster] Removed an iframe.');
                    } else {
                        if (iframe.style.display !== 'none') {
                           iframe.style.display = 'none';
                           iframe.style.visibility = 'hidden';
                           iframe.style.width = '0';
                           iframe.style.height = '0';
                           console.log('[Iframe Buster] Hid an iframe.');
                        }
                    }
                } catch (error) {
                    // This might fail if the iframe is from a different origin and already removed.
                    // We can safely ignore these errors.
                }
            }
        };

        const observeDOMChanges = () => {
            const observer = new MutationObserver((mutations) => {
                // We are looking for added nodes that could be iframes.
                let needsProcessing = false;
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                       needsProcessing = true;
                       break;
                    }
                }
                if(needsProcessing) {
                    processIframes();
                }
            });

            // Start observing the body for new elements.
            if (document.body) {
                 observer.observe(document.body, { childList: true, subtree: true });
            } else {
                // If body is not ready yet, wait for it.
                window.addEventListener('DOMContentLoaded', () => {
                    observer.observe(document.body, { childList: true, subtree: true });
                });
            }
        };

        // Initial run and setup observer
        processIframes();
        observeDOMChanges();
    })();
`;

/**
 * The main function to run the Playwright automation.
 */
(async () => {
	console.log("🚀 Launching browser...");
	// Ensure Chromium is installed for Playwright
	try {
		// Try to launch Chromium with Playwright's CLI to check if it's installed
		execSync("npx playwright install chromium", { stdio: "ignore" });
	} catch (e) {
		console.error(
			"Failed to install Chromium for Playwright. Please check your setup.",
		);
		process.exit(1);
	}
	// Launch the browser. `headless: false` means we'll see the browser window.
	const browser: Browser = await chromium.launch({ headless: false });
	const context = await browser.newContext();
	const page: Page = await context.newPage();

	// Inject the iframe buster script.
	// This runs the script before any other scripts on the page, ensuring it catches everything.
	await page.addInitScript(iframeBusterScript);
	console.log("✅ Iframe buster script injected.");

	const [targetUrl] = Bun.argv.splice(2) as [string, ...string[]];

	try {
		console.log(`Navigating to: ${targetUrl}`);
		// Navigate to the target URL.
		await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
		console.log("✅ Page loaded successfully.");
		console.log(
			"ℹ️ The browser will remain open. You can now interact with the page.",
		);
		console.log(
			"Press Ctrl+C in the terminal or close the browser window to exit.",
		);
	} catch (error) {
		console.error("❌ An error occurred during navigation:", error);
		// Close the browser if an error occurs.
		await browser.close();
	}

	// We don't call browser.close() here, so the window stays open for you to use.
})();
