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
 * @fileoverview Web UI Screenshot and Video Capture Tool
 * @module ui-capture
 * @description Automated screenshot and video recording tool using Effect-TS
 * for type-safe, composable, and testable operations.
 *
 * Features:
 * - Full-page screenshots for all routes
 * - Video recordings of user interactions
 * - Responsive viewport testing
 * - Automatic route discovery
 * - Effect-based error handling
 * - Structured concurrency
 *
 * @author Refactored with Effect-TS
 * @version 3.0.0
 * @license Apache-2.0
 */

import { Schema as S } from "@effect/schema";
import { Context, Effect, Layer, Option, Queue, Ref, Schedule } from "effect";
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Browser, chromium, type Page } from 'playwright';

// --- Schema Definitions ---

/**
 * Viewport configuration for responsive testing
 */
export class ViewportConfig extends S.Class<ViewportConfig>("ViewportConfig")({
  name: S.String,
  width: S.Number.pipe(S.int(), S.positive()),
  height: S.Number.pipe(S.int(), S.positive()),
}) {}

/**
 * Screenshot paths for different formats
 */
export class ScreenshotPaths extends S.Class<ScreenshotPaths>("ScreenshotPaths")({
  png: S.String,
  webp: S.String,
  jpg: S.String,
}) {}

/**
 * Video quality paths
 */
export class VideoQualityPaths extends S.Class<VideoQualityPaths>("VideoQualityPaths")({
  high: S.String,
  medium: S.String,
  low: S.String,
}) {}

/**
 * Capture result for a single route
 */
export class CaptureResult extends S.Class<CaptureResult>("CaptureResult")({
  url: S.String,
  route: S.String,
  screenshots: S.Record({ key: S.String, value: ScreenshotPaths }),
  videos: S.optional(S.Record({ key: S.String, value: VideoQualityPaths })),
  error: S.optional(S.String),
  timestamp: S.Number.pipe(S.int()),
}) {}

/**
 * Video recording options with defaults
 */
const VideoOptionsFields = {
  duration: S.Number.pipe(S.int(), S.positive()),
  interactions: S.Boolean,
};

export class VideoOptions extends S.Class<VideoOptions>("VideoOptions")(VideoOptionsFields) {
  static readonly Default = new VideoOptions({ duration: 10000, interactions: true });
}

/**
 * Main capture configuration with defaults
 */
const CaptureConfigFields = {
  outputDir: S.String,
  captureVideo: S.Boolean,
  viewports: S.Array(ViewportConfig),
  maxDepth: S.Number.pipe(S.int(), S.nonNegative()),
  waitTime: S.Number.pipe(S.int(), S.nonNegative()),
  videoOptions: VideoOptions,
  includeSubdomains: S.Boolean,
  allowedHosts: S.Array(S.String),
  routeConcurrency: S.Number.pipe(S.int(), S.positive()),
  menuInteractionSelectors: S.Array(S.String),
  screenshotHideSelectors: S.Array(S.String),
  ffmpegPath: S.String,
};

export class CaptureConfig extends S.Class<CaptureConfig>("CaptureConfig")(CaptureConfigFields) {
  static readonly Default = new CaptureConfig({
    outputDir: 'ui-captures',
    captureVideo: false,
    viewports: [
      new ViewportConfig({ name: 'desktop', width: 1920, height: 1080 }),
      new ViewportConfig({ name: 'tablet', width: 768, height: 1024 }),
      new ViewportConfig({ name: 'mobile', width: 375, height: 667 }),
    ],
    maxDepth: 2,
    waitTime: 2000,
    videoOptions: VideoOptions.Default,
    includeSubdomains: false,
    allowedHosts: [],
    routeConcurrency: 2,
    menuInteractionSelectors: [],
    screenshotHideSelectors: [],
    ffmpegPath: 'ffmpeg',
  });
}

type RouteTask = {
  readonly type: 'route';
  readonly url: string;
  readonly depth: number;
  readonly normalizedUrl: string;
};

type ShutdownTask = {
  readonly type: 'shutdown';
};

type QueueTask = RouteTask | ShutdownTask;

const ShutdownSignal: ShutdownTask = { type: 'shutdown' } as const;

const execFileAsync = promisify(execFile);

type ViewportConfigInput = ViewportConfig | {
  readonly name: string;
  readonly width: number;
  readonly height: number;
};

type VideoOptionsInput = VideoOptions | {
  readonly duration?: number;
  readonly interactions?: boolean;
};

export type CaptureConfigOverrides = Partial<{
  outputDir: string;
  captureVideo: boolean;
  viewports: ReadonlyArray<ViewportConfigInput>;
  maxDepth: number;
  waitTime: number;
  videoOptions: VideoOptionsInput;
  includeSubdomains: boolean;
  allowedHosts: ReadonlyArray<string>;
  routeConcurrency: number;
  menuInteractionSelectors: ReadonlyArray<string>;
  screenshotHideSelectors: ReadonlyArray<string>;
  ffmpegPath: string;
}>;

const toViewportInstance = (viewport: ViewportConfigInput): ViewportConfig =>
  viewport instanceof ViewportConfig
    ? viewport
    : new ViewportConfig(viewport);

const toVideoOptionsInstance = (
  input: VideoOptionsInput | undefined,
  fallback: VideoOptions
): VideoOptions =>
  input instanceof VideoOptions
    ? input
    : new VideoOptions({
        duration: fallback.duration,
        interactions: fallback.interactions,
        ...(input ?? {}),
      });

/**
 * Convenience helper for merging partial overrides with sane defaults to produce
 * a strongly-typed `CaptureConfig` instance.
 */
export const createCaptureConfig = (
  overrides: CaptureConfigOverrides = {}
): CaptureConfig => {
  const base = CaptureConfig.Default;

  const viewports = overrides.viewports
    ? overrides.viewports.map(toViewportInstance)
    : base.viewports.map(toViewportInstance);

  const videoOptions =
    overrides.videoOptions !== undefined
      ? toVideoOptionsInstance(overrides.videoOptions, base.videoOptions)
      : base.videoOptions;

  return new CaptureConfig({
    ...base,
    ...overrides,
    viewports,
    videoOptions,
    allowedHosts: overrides.allowedHosts
      ? Array.from(overrides.allowedHosts)
      : base.allowedHosts,
    menuInteractionSelectors: overrides.menuInteractionSelectors
      ? Array.from(overrides.menuInteractionSelectors)
      : base.menuInteractionSelectors,
    screenshotHideSelectors: overrides.screenshotHideSelectors
      ? Array.from(overrides.screenshotHideSelectors)
      : base.screenshotHideSelectors,
    ffmpegPath: overrides.ffmpegPath ?? base.ffmpegPath,
  });
};

/**
 * Capture report summary
 */
export class CaptureReport extends S.Class<CaptureReport>("CaptureReport")({
  timestamp: S.String,
  totalRoutes: S.Number.pipe(S.int(), S.nonNegative()),
  successfulCaptures: S.Number.pipe(S.int(), S.nonNegative()),
  failedCaptures: S.Number.pipe(S.int(), S.nonNegative()),
  viewports: S.Array(ViewportConfig),
  results: S.Array(S.Struct({
    url: S.String,
    route: S.String,
    screenshots: S.Array(S.String),
    hasVideo: S.Boolean,
    error: S.optional(S.String),
  })),
}) {}

// --- Error Types ---

export class BrowserError extends S.TaggedError<BrowserError>()("BrowserError", {
  message: S.String,
  cause: S.Unknown,
}) {}

export class CaptureError extends S.TaggedError<CaptureError>()("CaptureError", {
  url: S.String,
  message: S.String,
  cause: S.Unknown,
}) {}

export class FileSystemError extends S.TaggedError<FileSystemError>()("FileSystemError", {
  path: S.String,
  operation: S.String,
  cause: S.Unknown,
}) {}

type LinkDiscoveryTools = {
  readonly prepareForLinkDiscovery: (page: Page, url: string) => Effect.Effect<void, CaptureError>;
  readonly extractLinks: (page: Page) => Effect.Effect<readonly string[], never>;
};

const LINK_FILTER_CONCURRENCY = 32;
const navigationRetryPolicy = Schedule.recurs(3);
const captureRetryPolicy = Schedule.recurs(2);
const VIDEO_QUALITY_PROFILES = [
  { name: 'high' as const, scale: 1, dir: 'high-quality', transcode: false },
  { name: 'medium' as const, scale: 0.75, dir: 'medium-quality', transcode: true },
  { name: 'low' as const, scale: 0.5, dir: 'low-quality', transcode: true },
];

const transcodeVideo = (
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  scale: number
): Effect.Effect<void, FileSystemError> =>
  Effect.tryPromise({
    try: async () => {
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i',
        inputPath,
        '-vf',
        `scale=iw*${scale}:-2`,
        '-c:v',
        'libvpx-vp9',
        '-b:v',
        '0',
        outputPath,
      ]);
    },
    catch: (error) =>
      new FileSystemError({
        path: outputPath,
        operation: 'ffmpeg-transcode',
        cause: error,
      }),
  });

const createLinkDiscoveryTools = (options: {
  readonly hostMatchesFilters: (hostname: string) => boolean;
  readonly menuInteractionSelectors: ReadonlyArray<string>;
}) => {
  const { hostMatchesFilters, menuInteractionSelectors } = options;
  const interactionSelectors = menuInteractionSelectors.filter((selector) => !!selector?.trim());

  const prepareForLinkDiscovery = (
    page: Page,
    url: string
  ): Effect.Effect<void, CaptureError> =>
    Effect.tryPromise({
      try: async () => {
        await page.evaluate(async (selectors: string[]) => {
          const safeClick = (element: Element) => {
            if (!(element instanceof HTMLElement)) {
              return;
            }
            const tag = element.tagName.toLowerCase();
            if (element.hasAttribute('href') || tag === 'a') {
              return;
            }
            if (typeof element.click === 'function') {
              element.click();
            } else {
              element.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true })
              );
            }
          };

          document.querySelectorAll('details').forEach((detail) => {
            if (!detail.open) {
              detail.open = true;
            }
          });

          document.querySelectorAll('summary').forEach((summary) => {
            safeClick(summary);
          });

          selectors.forEach((selector) => {
            if (!selector) {
              return;
            }
            const elements = Array.from(document.querySelectorAll(selector)).slice(0, 10);
            elements.forEach((element) => {
              safeClick(element);
            });
          });

          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          await new Promise((resolve) => setTimeout(resolve, 150));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, interactionSelectors);
      },
      catch: (error) =>
        new CaptureError({
          url,
          message: 'Failed to prepare page for link discovery',
          cause: error,
        }),
    });

  const extractLinks = (page: Page): Effect.Effect<readonly string[], never> =>
    Effect.tryPromise({
      try: async () => {
        return await page.evaluate(() => {
          const normalize = (value: string | null | undefined): string | null => {
            if (!value) {
              return null;
            }
            const trimmed = value.trim();
            if (
              !trimmed ||
              trimmed === '#' ||
              trimmed.startsWith('javascript:') ||
              trimmed.startsWith('mailto:') ||
              trimmed.startsWith('tel:')
            ) {
              return null;
            }
            try {
              const absolute = new URL(trimmed, window.location.href);
              absolute.hash = '';
              return absolute.href;
            } catch {
              return null;
            }
          };

          const addValue = (candidate: string | null | undefined, into: Set<string>) => {
            const normalized = normalize(candidate);
            if (normalized) {
              into.add(normalized);
            }
          };

          const discovered = new Set<string>();
          const anchorElements = Array.from(document.querySelectorAll('a[href], area[href]'));
          anchorElements.forEach((element) => {
            const href = element.getAttribute('href') ?? (element as HTMLAnchorElement).href;
            addValue(href, discovered);
          });

          const attributeNames = [
            'data-href',
            'data-url',
            'data-route',
            'data-path',
            'data-link',
            'data-target',
            'routerLink',
            'routerlink',
            'to',
            'href',
          ];
          const attributeSelector = attributeNames.map((name) => `[${name}]`).join(',');

          if (attributeSelector) {
            const nodes = Array.from(document.querySelectorAll(attributeSelector));
            nodes.forEach((node) => {
              if (!(node instanceof HTMLElement)) {
                return;
              }

              attributeNames.forEach((attribute) => {
                const value =
                  node.getAttribute(attribute) ??
                  ((node as unknown as Record<string, unknown>)[attribute] as string | undefined);

                if (!value) {
                  return;
                }

                value
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .forEach((token) => addValue(token, discovered));
              });
            });
          }

          const collectFromObject = (value: unknown, into: Set<string>, depth = 0, limit = { count: 0 }) => {
            if (!value || depth > 4 || limit.count > 500) {
              return;
            }

            if (typeof value === 'string') {
              limit.count += 1;
              addValue(value, into);
              return;
            }

            if (Array.isArray(value)) {
              for (const entry of value) {
                collectFromObject(entry, into, depth + 1, limit);
                if (limit.count > 500) {
                  break;
                }
              }
              return;
            }

            if (typeof value === 'object') {
              limit.count += 1;
              const obj = value as Record<string, unknown>;
              for (const key of Object.keys(obj)) {
                const lowered = key.toLowerCase();
                if (
                  ['route', 'path', 'href', 'url', 'to', 'link'].some((token) =>
                    lowered.includes(token)
                  )
                ) {
                  collectFromObject(obj[key], into, depth + 1, limit);
                } else if (depth < 2) {
                  collectFromObject(obj[key], into, depth + 1, limit);
                }
                if (limit.count > 500) {
                  break;
                }
              }
            }
          };

          const globalWindow = window as unknown as Record<string, any>;
          const globalRouteSources = [
            globalWindow.__ROUTES__,
            globalWindow.__ROUTE_DATA__,
            globalWindow.__PAGE_LIST__,
            globalWindow.__PAGES__,
            globalWindow.__APP_DATA__,
            globalWindow.__STATE__,
            globalWindow.__NEXT_DATA__?.props?.pageProps,
            globalWindow.__NUXT__?.router?.options?.routes,
            globalWindow.__NUXT__?.data,
            globalWindow.__SAPPER__?.routes,
          ];

          globalRouteSources
            .filter((source) => source !== undefined && source !== null)
            .forEach((source) => collectFromObject(source, discovered));

          return Array.from(discovered);
        });
      },
      catch: () => [] as readonly string[],
    }).pipe(
      Effect.flatMap((links) =>
        Effect.forEach(
          links,
          (link) =>
            Effect.sync(() => {
              try {
                if (!link) {
                  return Option.none<string>();
                }

                const url = new URL(link);
                if (
                  (url.protocol !== 'http:' && url.protocol !== 'https:') ||
                  !hostMatchesFilters(url.hostname)
                ) {
                  return Option.none<string>();
                }

                url.hash = '';
                return Option.some(url.toString());
              } catch {
                return Option.none<string>();
              }
            }),
          {
            concurrency: Math.max(
              1,
              Math.min(LINK_FILTER_CONCURRENCY, Math.max(1, links.length))
            ),
          }
        ).pipe(
          Effect.map((options) => {
            const uniqueLinks = new Set<string>();
            for (const option of options) {
              if (Option.isSome(option)) {
                uniqueLinks.add(option.value);
              }
            }
            return Array.from(uniqueLinks);
          })
        )
      ),
      Effect.orElseSucceed(() => [] as readonly string[])
    );

  return { prepareForLinkDiscovery, extractLinks } satisfies LinkDiscoveryTools;
};

// --- Context Tags ---

export class CaptureConfigTag extends Context.Tag("CaptureConfig")<
  CaptureConfigTag,
  CaptureConfig
>() {}

// --- Service Definition ---

/**
 * UICaptureService
 *
 * Effect-based service that automates browser-driven UI capture for a website.
 *
 * Overview
 * - Manages a single headless Chromium browser instance used by a pool of worker
 *   contexts/pages to traverse a site's internal links, take screenshots in multiple
 *   formats, optionally record videos at multiple quality tiers, and persist
 *   machine- and human-readable reports.
 * - The service is implemented as an Effect.Service and exposes two primary
 *   asynchronous Effects: `captureWebsite` and `captureVideo`. All IO and side-effects
 *   are wrapped in Effect primitives and can be composed, retried, or scheduled by
 *   an Effect runtime.
 *
 * Behavior & Lifecycle
 * - Initialization / Cleanup:
 *   - `initialize` launches a Chromium instance (headless) with sandbox-avoiding args
 *     and ensures the configured output directory exists.
 *   - `cleanup` closes the browser and resets in-memory tracking structures (e.g. processedRoutes).
 * - Concurrency & Scheduling:
 *   - A bounded work queue is used with a configurable number of worker tasks
 *     (cfg.routeConcurrency). Each worker holds its own context + page pair.
 *   - Routes are scheduled with depth tracking and are deduplicated using an
 *     in-memory `processedRoutes` Set. A `pendingTasks` Ref monitors outstanding work
 *     and triggers graceful shutdown when no tasks remain.
 * - Link discovery:
 *   - `prepareForLinkDiscovery` and `extractLinks` utilities are used to find internal links.
 *   - Host filtering is enforced via allow-lists and optional subdomain inclusion.
 *
 * Important Concepts
 * - Config (cfg):
 *   - Controls outputDir, allowedHosts, includeSubdomains, viewports, captureVideo,
 *     ffmpegPath, waitTime, routeConcurrency, maxDepth, screenshotHideSelectors,
 *     menuInteractionSelectors, videoOptions, and retry policies.
 * - Host filtering:
 *   - `canonicalizeHost` normalizes host/origin inputs (lowercased, no protocol, no www).
 *   - `computeHostSuffixes` expands a host into suffixes (e.g. "a.b.c" -> ["a.b.c","b.c","c"]).
 *   - `hydrateDomainFilters` seeds in-memory allowedHostnames and hostSuffixes using the
 *     capture root and cfg.allowedHosts.
 *   - `hostMatchesFilters` decides whether a discovered hostname qualifies for crawling,
 *     honoring `cfg.includeSubdomains`.
 * - Normalization and idempotency:
 *   - `normalizeUrl` returns a canonical key used to deduplicate routes (origin + pathname,
 *     trailing slash removed).
 *   - `getRouteName` builds a filesystem-friendly slug for the pathname, falling back to
 *     `'root'` for "/" and `'invalid-url'` when parsing fails.
 *
 * Capture Pipeline
 * - createDirectories(routeDir)
 *   - Ensures directory hierarchy exists for screenshots (png/webp/jpg + history) and videos
 *     (per-quality directories) depending on cfg.captureVideo.
 *   - Returns an Effect that may fail with a FileSystemError on mkdir/write failures.
 *
 * - captureScreenshots(page, viewport, routeDir, timestamp)
 *   - Optionally injects a temporary <style> element to hide selectors specified in
 *     cfg.screenshotHideSelectors; the style is removed in a safe release action.
 *   - Sets viewport size (with retries), waits briefly, and captures screenshots:
 *     - PNG: lossless, saved as `<viewport>_<w>x<h>_latest.png` and history copy with timestamp.
 *     - WebP: uses JPEG options for pipeline conversion (quality tuned) — saved as `.webp`.
 *     - JPEG: saved with configurable quality.
 *   - Each screenshot operation is retried using captureRetryPolicy and each latest file is
 *     copied to a history file to preserve past runs.
 *   - Returns a ScreenshotPaths record with absolute paths to latest PNG/WEBP/JPG.
 *   - Errors surface as CaptureError or FileSystemError.
 *
 * - captureVideo(page, viewport, routeDir, timestamp)
 *   - Creates a separate browser context configured with Playwright's recordVideo for a
 *     master, high-quality recording (profile-driven scaling).
 *   - Navigates a new page to the current URL and optionally performs interactions
 *     (e.g. scroll passes) when cfg.videoOptions.interactions is true to create more
 *     representative recordings.
 *   - Closes the page/context to flush the recorded file, moves the raw file to a
 *     deterministic master path, and optionally transcodes the master recording into
 *     multiple lower-quality webm targets using ffmpeg (transcoding errors are logged
 *     per-profile and do not abort the whole service; failure is indicated by skipping
 *     that quality level).
 *   - Returns VideoQualityPaths containing high/medium/low file paths or fails with
 *     CaptureError/FileSystemError when critical operations fail.
 *
 * - capturePage(page, url)
 *   - Coordinates directory creation, waits for load state (`networkidle`), sleeps for
 *     cfg.waitTime, and runs the screenshot and optional video capture across all
 *     configured viewports. Each viewport capture runs sequentially (concurrency 1 by default).
 *   - Aggregates results into a CaptureResult containing url, route slug, per-viewport
 *     screenshot/video metadata, timestamp, and any error information.
 *
 * Worker & Queueing
 * - processRouteTask(page, task, results, scheduleNext, workerLabel)
 *   - Navigates to task.url, prepares the page for link discovery, extracts internal links
 *     (respecting max depth), captures the page (capturePage), stores the CaptureResult into
 *     the provided results Map keyed by task.normalizedUrl, and schedules discovered links
 *     via `scheduleNext`.
 *   - Errors during per-route processing are caught and logged per-worker; the worker ensures
 *     markTaskComplete is invoked so the shutdown logic functions correctly.
 *
 * Reporting
 * - generateReports(results)
 *   - Produces a JSON machine-readable `capture-report.json` and a human-friendly `REPORT.md`
 *     in cfg.outputDir. The JSON contains a CaptureReport with counts and per-route summaries.
 *   - generateMarkdown builds the Markdown report, listing screenshots and videos with
 *     relative links, and enumerates failed captures and their errors.
 *
 * Public API (returned as const)
 * - captureWebsite(url: string): Effect.Effect<Map<string, CaptureResult>, BrowserError | CaptureError | FileSystemError>
 *   - Entry point to capture an entire website starting from `url`.
 *   - Performs domain filter hydration, starts the browser (initialize), creates the worker
 *     pool and scheduling system, seeds the initial route, and waits for completion.
 *   - Produces a Map keyed by normalized URLs to CaptureResult objects representing each
 *     attempted capture.
 *   - Fails with:
 *     - BrowserError: critical failures during browser init/cleanup.
 *     - CaptureError: navigation, page manipulation, or capture-specific failures.
 *     - FileSystemError: failures writing files or creating directories.
 *   - Side effects:
 *     - Writes screenshots, videos, history copies, capture-report.json, and REPORT.md into cfg.outputDir.
 *     - Logs progress and errors to stdout/stderr.
 *
 * - captureVideo(page: Page, viewport: ViewportConfig, routeDir: string, timestamp: string):
 *   - Lower-level Effect exposed for recording video for a specific page/viewport pair.
 *   - Useful for programmatic reuse in other flows if the caller already has an active Page
 *     and a prepared routeDir. Returns VideoQualityPaths or fails with CaptureError/FileSystemError.
 *
 * Error Handling & Retries
 * - Many IO and browser interactions are wrapped in Effect.tryPromise and are retried
 *   according to configured retry policies (captureRetryPolicy, navigationRetryPolicy) where appropriate.
 * - Non-critical failures during per-viewport/transcoding steps are logged and cause the
 *   service to continue other work; critical initialization failures will abort the run.
 *
 * Notes & Best Practices
 * - The service uses an in-memory Set to track processed normalized URLs. For long-running
 *   or distributed runs where persistence across runs is required, persist this state externally.
 * - Ensure cfg.ffmpegPath points to a valid ffmpeg binary when video transcoding is required.
 * - When running in constrained CI environments, tune routeConcurrency and Chromium launch
 *   flags to suit resource limits.
 * - The Effects returned by the service are pure descriptions of work; they must be executed
 *   by an Effect runtime to take effect.
 *
 * Example (conceptual)
 * - const service = UICaptureService; // resolved via DI / effect environment
 * - service.captureWebsite("https://example.com") // => Effect that will perform the capture when run
 *
 * Type Aliases / Domain Models (referenced)
 * - CaptureResult: Aggregated result for a single route including screenshots, optional videos, timestamp, and error.
 * - ScreenshotPaths: { png: string; webp: string; jpg: string; } — absolute latest paths.
 * - VideoQualityPaths: { high: string; medium: string; low: string; } — absolute paths to webm files.
 * - CaptureError, BrowserError, FileSystemError: Domain-specific error wrappers used to provide contextual error metadata.
 *
 * @public
 */
export class UICaptureService extends Effect.Service<UICaptureService>()("UICaptureService", {
  effect: Effect.gen(function* () {
    const cfg = yield* CaptureConfigTag;

    let browser: Browser | null = null;
    const processedRoutes = new Set<string>();
    let allowedHostnames = new Set<string>();
    let hostSuffixes = new Set<string>();

    // Initialize browser
    const initialize = Effect.tryPromise({
      try: async () => {
        await fs.mkdir(cfg.outputDir, { recursive: true });
        
        browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
          ],
        });

        console.log('✓ Browser initialized');
        return browser;
      },
      catch: (error) => new BrowserError({ message: 'Failed to initialize browser', cause: error }),
    });

    // Cleanup browser
    const cleanup = Effect.tryPromise({
      try: async () => {
        if (browser) {
          await browser.close();
          browser = null;
        }
        processedRoutes.clear();
        console.log('✓ Browser cleanup complete');
      },
      catch: (error) => new BrowserError({ message: 'Failed to cleanup browser', cause: error }),
    });

    /**
     * Normalizes a hostname / origin string to a canonical lowercase form without protocols,
     * `www.` prefix, paths, or trailing slashes.
     *
     * @param host Raw host/origin string provided via config or discovered link.
     * @returns Canonical host string suitable for equality comparisons.
     */
    const canonicalizeHost = (host: string): string =>
      host
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./i, '')
        .toLowerCase();

    /**
     * Expands a host into all possible suffix combinations.
     * Example: `app.internal.example.com` => [
     *  `app.internal.example.com`, `internal.example.com`, `example.com`, `com`
     * ]
     *
     * Used to quickly assert that a given hostname falls under a whitelisted root.
     *
     * @param host Canonical host string.
     * @returns Array of suffixes ordered from most specific to least.
     */
    const computeHostSuffixes = (host: string): readonly string[] => {
      const segments = canonicalizeHost(host).split('.').filter(Boolean);
      const suffixes: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        suffixes.push(segments.slice(i).join('.'));
      }
      return suffixes;
    };

    /**
     * Populates the in-memory host allow-lists based on the root URL
     * passed to `captureWebsite` and any additional `allowedHosts`.
     *
     * @param primaryHost Root hostname derived from the starting URL.
     */
    const hydrateDomainFilters = (primaryHost: string): void => {
      const configuredHosts = (cfg.allowedHosts ?? []).map(canonicalizeHost);
      const normalizedPrimary = canonicalizeHost(primaryHost);
      allowedHostnames = new Set([normalizedPrimary, ...configuredHosts].filter(Boolean));
      hostSuffixes = new Set(
        Array.from(allowedHostnames).flatMap((host) => computeHostSuffixes(host))
      );
    };

    /**
     * Determines whether a hostname should be crawled, observing explicit allow lists
     * and the `includeSubdomains` flag.
     *
     * @param hostname Hostname extracted from a candidate URL.
     * @returns True if the URL should be included in the crawl graph.
     */
    const hostMatchesFilters = (hostname: string): boolean => {
      const normalized = canonicalizeHost(hostname);

      if (allowedHostnames.has(normalized)) {
        return true;
      }

      if (!cfg.includeSubdomains) {
        return false;
      }

      for (const suffix of hostSuffixes) {
        if (normalized === suffix || normalized.endsWith(`.${suffix}`)) {
          return true;
        }
      }

      return false;
    };

    // Normalize URL for comparison
    /**
     * Normalizes a URL string to `{origin}{pathname}` with a trailing slash removed.
     * Acts as a cache key to avoid re-processing identical routes.
     */
    const normalizeUrl = (url: string): Effect.Effect<string> =>
      Effect.sync(() => {
        try {
          const urlObj = new URL(url);
          const normalized = `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, '');
          return normalized || urlObj.origin + '/';
        } catch {
          return url;
        }
      });

    // Get route name from URL
    /**
     * Builds a filesystem-friendly slug from a URL pathname.
     * Defaults to `root` for `/` and `invalid-url` when parsing fails.
     */
    const getRouteName = (url: string): Effect.Effect<string> =>
      Effect.sync(() => {
        try {
          const urlObj = new URL(url);
          return urlObj.pathname
            .replace(/^\/|\/$/g, '')
            .replace(/[^a-z0-9]/gi, '-')
            .replace(/-+/g, '-')
            .toLowerCase() || 'root';
        } catch {
          return 'invalid-url';
        }
      });

    // Create directory structure
    /**
     * Ensures the necessary directory hierarchy exists for storing screenshots and videos.
     *
     * @param routeDir Absolute path for the current route capture output.
     */
    const createDirectories = (routeDir: string): Effect.Effect<void, FileSystemError> =>
      Effect.tryPromise({
        try: async () => {
          await fs.mkdir(path.join(routeDir, 'screenshots', 'png'), { recursive: true });
          await fs.mkdir(path.join(routeDir, 'screenshots', 'webp'), { recursive: true });
          await fs.mkdir(path.join(routeDir, 'screenshots', 'jpg'), { recursive: true });
          await fs.mkdir(path.join(routeDir, 'screenshots', 'png', 'history'), { recursive: true });
          await fs.mkdir(path.join(routeDir, 'screenshots', 'webp', 'history'), { recursive: true });
          await fs.mkdir(path.join(routeDir, 'screenshots', 'jpg', 'history'), { recursive: true });
          
          if (cfg.captureVideo) {
            await fs.mkdir(path.join(routeDir, 'videos', 'high-quality'), { recursive: true });
            await fs.mkdir(path.join(routeDir, 'videos', 'medium-quality'), { recursive: true });
            await fs.mkdir(path.join(routeDir, 'videos', 'low-quality'), { recursive: true });
          }
        },
        catch: (error) => new FileSystemError({
          path: routeDir,
          operation: 'mkdir',
          cause: error,
        }),
      });

    const { prepareForLinkDiscovery, extractLinks } = createLinkDiscoveryTools({
      hostMatchesFilters,
      menuInteractionSelectors: cfg.menuInteractionSelectors,
    });

    // Capture screenshot in all formats
    /**
     * Captures PNG/WEBP/JPEG screenshots for a single viewport configuration.
     *
     * @param page Playwright page instance.
     * @param viewport Viewport configuration entry.
     * @param routeDir Output directory for the route.
     * @param timestamp Timestamp suffix to keep assets unique.
     */
    const captureScreenshots = (
      page: Page,
      viewport: ViewportConfig,
      routeDir: string,
      timestamp: string
    ): Effect.Effect<ScreenshotPaths, CaptureError | FileSystemError> =>
      Effect.acquireUseRelease(
        cfg.screenshotHideSelectors.length > 0
          ? Effect.tryPromise({
              try: async () => {
                const styleId = `ui-capture-mask-${Date.now().toString(36)}-${Math.random()
                  .toString(36)
                  .slice(2)}`;
                await page.evaluate(
                  ({ id, selectors }: { id: string; selectors: readonly string[] }) => {
                    const css = selectors
                      .map((selector) => `${selector} { visibility: hidden !important; opacity: 0 !important; }`)
                      .join('\n');
                    const style = document.createElement('style');
                    style.id = id;
                    style.textContent = css;
                    document.head.appendChild(style);
                  },
                  { id: styleId, selectors: cfg.screenshotHideSelectors }
                );
                return styleId;
              },
              catch: (error) =>
                new CaptureError({
                  url: page.url(),
                  message: 'Failed to hide screenshot selectors',
                  cause: error,
                }),
            })
          : Effect.succeed<string | null>(null),
        () =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => page.setViewportSize({
                width: viewport.width,
                height: viewport.height,
              }),
              catch: (error) => new CaptureError({
                url: page.url(),
                message: 'Failed to set viewport',
                cause: error,
              }),
            }).pipe(Effect.retry(captureRetryPolicy));

            yield* Effect.sleep(1000);

            const baseFilename = `${viewport.name}_${viewport.width}x${viewport.height}`;

            const pngLatestPath = path.join(routeDir, 'screenshots', 'png', `${baseFilename}_latest.png`);
            const pngHistoryPath = path.join(routeDir, 'screenshots', 'png', 'history', `${baseFilename}_${timestamp}.png`);
            const webpLatestPath = path.join(routeDir, 'screenshots', 'webp', `${baseFilename}_latest.webp`);
            const webpHistoryPath = path.join(routeDir, 'screenshots', 'webp', 'history', `${baseFilename}_${timestamp}.webp`);
            const jpgLatestPath = path.join(routeDir, 'screenshots', 'jpg', `${baseFilename}_latest.jpg`);
            const jpgHistoryPath = path.join(routeDir, 'screenshots', 'jpg', 'history', `${baseFilename}_${timestamp}.jpg`);

            const screenshotSpecs = [
              {
                type: 'png' as const,
                latestPath: pngLatestPath,
                historyPath: pngHistoryPath,
                options: { type: 'png' as const },
              },
              {
                type: 'webp' as const,
                latestPath: webpLatestPath,
                historyPath: webpHistoryPath,
                options: { type: 'jpeg' as const, quality: 90 },
              },
              {
                type: 'jpg' as const,
                latestPath: jpgLatestPath,
                historyPath: jpgHistoryPath,
                options: { type: 'jpeg' as const, quality: 85 },
              },
            ];

            for (const spec of screenshotSpecs) {
              yield* Effect.tryPromise({
                try: () =>
                  page.screenshot({
                    path: spec.latestPath,
                    fullPage: true,
                    type: spec.options.type,
                    quality: spec.options.quality,
                  }),
                catch: (error) => new CaptureError({
                  url: page.url(),
                  message: `Failed to capture ${spec.type.toUpperCase()}`,
                  cause: error,
                }),
              }).pipe(Effect.retry(captureRetryPolicy));

              yield* Effect.tryPromise({
                try: () => fs.copyFile(spec.latestPath, spec.historyPath),
                catch: (error) => new FileSystemError({
                  path: spec.historyPath,
                  operation: 'copyFile',
                  cause: error,
                }),
              });
            }

            console.log(`    ✓ Screenshots saved: ${baseFilename} (latest + history)`);

            return new ScreenshotPaths({
              png: pngLatestPath,
              webp: webpLatestPath,
              jpg: jpgLatestPath,
            });
          }),
        (styleId) =>
          styleId
            ? Effect.tryPromise({
                try: () =>
                  page.evaluate((id: string) => {
                    const existing = document.getElementById(id);
                    if (existing && existing.parentNode) {
                      existing.parentNode.removeChild(existing);
                    }
                  }, styleId),
                catch: () => undefined,
              }).pipe(Effect.catchAll(() => Effect.void))
            : Effect.void
      );

    // Capture video for viewport
    /**
     * Records videos in multiple quality tiers for a viewport, if enabled.
     *
     * @param page Reference page (used for URL + wait timings).
     * @param viewport Active viewport configuration.
     * @param routeDir Output directory for video assets.
     * @param timestamp Unique suffix for filenames.
     */
    const captureVideo = (
      page: Page,
      viewport: ViewportConfig,
      routeDir: string,
      timestamp: string
    ): Effect.Effect<VideoQualityPaths, CaptureError | FileSystemError> =>
      Effect.gen(function* () {
        if (!browser) {
          return yield* Effect.fail(new CaptureError({
            url: page.url(),
            message: 'Browser not initialized',
            cause: null,
          }));
        }

        const baseFilename = `${viewport.name}_${viewport.width}x${viewport.height}_${timestamp}`;
        const masterProfile = VIDEO_QUALITY_PROFILES[0];
        const masterPath = path.join(routeDir, 'videos', masterProfile.dir, `${baseFilename}.webm`);

        const context = yield* Effect.tryPromise({
          try: () => browser!.newContext({
            recordVideo: {
              dir: path.join(routeDir, 'videos', masterProfile.dir),
              size: {
                width: Math.floor(viewport.width * masterProfile.scale),
                height: Math.floor(viewport.height * masterProfile.scale),
              },
            },
            viewport: { width: viewport.width, height: viewport.height },
          }),
          catch: (error) => new CaptureError({
            url: page.url(),
            message: 'Failed to create master video context',
            cause: error,
          }),
        }).pipe(Effect.retry(captureRetryPolicy));

        const videoPage = yield* Effect.tryPromise({
          try: () => context.newPage(),
          catch: (error) => new CaptureError({
            url: page.url(),
            message: 'Failed to create video page',
            cause: error,
          }),
        }).pipe(Effect.retry(captureRetryPolicy));

        yield* Effect.tryPromise({
          try: () => videoPage.goto(page.url(), { waitUntil: 'networkidle', timeout: 30000 }),
          catch: (error) => new CaptureError({
            url: page.url(),
            message: 'Failed to navigate video page',
            cause: error,
          }),
        }).pipe(Effect.retry(navigationRetryPolicy));

        yield* Effect.sleep(cfg.waitTime);

        if (cfg.videoOptions.interactions) {
          const scrollSteps = 5;
          const scrollDelay = cfg.videoOptions.duration / (scrollSteps + 1);

          for (let i = 0; i < scrollSteps; i++) {
            yield* Effect.tryPromise({
              try: () => videoPage.evaluate((step) => {
                window.scrollTo({
                  top: (document.body.scrollHeight / 5) * (step as number),
                  behavior: 'smooth',
                });
              }, i + 1),
              catch: (error) => new CaptureError({
                url: page.url(),
                message: 'Failed to run scroll interaction',
                cause: error,
              }),
            }).pipe(Effect.catchAll(() => Effect.void));
            yield* Effect.sleep(scrollDelay);
          }

          yield* Effect.tryPromise({
            try: () => videoPage.evaluate(() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }),
            catch: (error) => new CaptureError({
              url: page.url(),
              message: 'Failed to reset scroll position',
              cause: error,
            }),
          }).pipe(Effect.catchAll(() => Effect.void));
          yield* Effect.sleep(1000);
        } else {
          yield* Effect.sleep(cfg.videoOptions.duration);
        }

        yield* Effect.tryPromise({
          try: () => videoPage.close(),
          catch: (error) => new CaptureError({
            url: page.url(),
            message: 'Failed to close video page',
            cause: error,
          }),
        }).pipe(Effect.catchAll(() => Effect.void));

        const rawVideoPath = yield* Effect.tryPromise({
          try: async () => {
            const vp = await videoPage.video()?.path();
            await context.close();
            return vp;
          },
          catch: (error) => new CaptureError({
            url: page.url(),
            message: 'Failed to finalize video recording',
            cause: error,
          }),
        });

        if (!rawVideoPath) {
          return yield* Effect.fail(new CaptureError({
            url: page.url(),
            message: 'Video path is null',
            cause: null,
          }));
        }

        yield* Effect.tryPromise({
          try: () => fs.rename(rawVideoPath, masterPath),
          catch: (error) => new FileSystemError({
            path: masterPath,
            operation: 'rename',
            cause: error,
          }),
        });

        const videoPaths: Record<'high' | 'medium' | 'low', string> = {
          high: masterPath,
          medium: masterPath,
          low: masterPath,
        };

        for (const profile of VIDEO_QUALITY_PROFILES.slice(1)) {
          const targetPath = path.join(routeDir, 'videos', profile.dir, `${baseFilename}.webm`);
          const transcodeSucceeded = yield* transcodeVideo(
            cfg.ffmpegPath,
            masterPath,
            targetPath,
            profile.scale
          ).pipe(
            Effect.as(true),
            Effect.catchAll((error) => {
              console.error(`Failed to transcode ${profile.name} quality video:`, error);
              return Effect.succeed(false);
            })
          );

          if (transcodeSucceeded) {
            videoPaths[profile.name] = targetPath;
          }
        }
        
        console.log(`    ✓ Video recorded for ${viewport.name}`);

        return new VideoQualityPaths(videoPaths);
      });

    // Capture page across all viewports
    /**
     * Runs the full capture pipeline (screenshots + optional video) for every viewport.
     *
     * @param page Current Playwright page.
     * @param url Route URL being captured.
     * @returns Structured `CaptureResult` with asset metadata.
     */
    const capturePage = (page: Page, url: string): Effect.Effect<CaptureResult, CaptureError | FileSystemError> =>
      Effect.gen(function* () {
        const route = yield* getRouteName(url);
        const routeDir = path.join(cfg.outputDir, route);
        
        yield* createDirectories(routeDir);
        yield* Effect.tryPromise({
          try: () => page.waitForLoadState('networkidle'),
          catch: (error) => new CaptureError({ url, message: 'Failed to wait for page load', cause: error }),
        }).pipe(Effect.retry(captureRetryPolicy));
        yield* Effect.sleep(cfg.waitTime);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const screenshotResults = yield* Effect.all(
          cfg.viewports.map((viewport: ViewportConfig) =>
            Effect.gen(function* () {
              console.log(`  Capturing ${viewport.name} (${viewport.width}x${viewport.height})`);
              const screenshots = yield* captureScreenshots(page, viewport, routeDir, timestamp);
              
              const videos = cfg.captureVideo
                ? Option.some(yield* captureVideo(page, viewport, routeDir, timestamp))
                : Option.none();

              return [viewport.name, { screenshots, videos }] as const;
            })
          ),
          { concurrency: 1 }
        );

        const screenshots: Record<string, ScreenshotPaths> = {};
        const videos: Record<string, VideoQualityPaths> = {};

        for (const [name, data] of screenshotResults) {
          screenshots[name] = data.screenshots;
          if (Option.isSome(data.videos)) {
            videos[name] = data.videos.value;
          }
        }

        return new CaptureResult({
          url,
          route,
          screenshots,
          videos: Object.keys(videos).length > 0 ? videos : undefined,
          timestamp: Date.now(),
        });
      });

    /**
     * Processes a queued route using a persistent worker page, scheduling discovered links.
     */
    const processRouteTask = (
      page: Page,
      task: RouteTask,
      results: Map<string, CaptureResult>,
      scheduleNext: (url: string, depth: number) => Effect.Effect<void, never>,
      workerLabel: string
    ): Effect.Effect<void, CaptureError | FileSystemError> =>
      Effect.gen(function* () {
        const indent = '  '.repeat(task.depth);
        console.log(`\n${indent}[Worker ${workerLabel}] [Depth ${task.depth}] Capturing: ${task.url}`);

        yield* Effect.tryPromise({
          try: () => page.goto(task.url, { waitUntil: 'networkidle', timeout: 30000 }),
          catch: (error) => new CaptureError({ url: task.url, message: 'Failed to navigate', cause: error }),
        }).pipe(Effect.retry(navigationRetryPolicy));

        yield* prepareForLinkDiscovery(page, task.url);

        const discoveredLinks = task.depth < cfg.maxDepth
          ? yield* extractLinks(page)
          : [];

        console.log(`${indent}  Found ${discoveredLinks.length} internal links`);

        const result = yield* capturePage(page, task.url);
        results.set(task.normalizedUrl, result);

        if (discoveredLinks.length > 0) {
          const schedulingConcurrency = Math.max(
            1,
            Math.min(cfg.routeConcurrency, discoveredLinks.length)
          );
          yield* Effect.forEach(
            discoveredLinks,
            (link) => scheduleNext(link, task.depth + 1),
            { concurrency: schedulingConcurrency }
          );
        }
      });

    // Generate reports
    /**
     * Persists machine-readable (`capture-report.json`) and human-readable (`REPORT.md`) summaries.
     *
     * @param results Map of normalized URLs to their capture results.
     */
    const generateReports = (results: Map<string, CaptureResult>): Effect.Effect<void, FileSystemError> =>
      Effect.gen(function* () {
        const resultsArray = Array.from(results.values());
        const successful = resultsArray.filter((r) => !r.error);
        const failed = resultsArray.filter((r) => !!r.error);

        const report = new CaptureReport({
          timestamp: new Date().toISOString(),
          totalRoutes: results.size,
          successfulCaptures: successful.length,
          failedCaptures: failed.length,
          viewports: cfg.viewports,
          results: resultsArray.map((result) => ({
            url: result.url,
            route: result.route,
            screenshots: Object.keys(result.screenshots),
            hasVideo: !!result.videos,
            error: result.error,
          })),
        });

        yield* Effect.tryPromise({
          try: () => fs.writeFile(
            path.join(cfg.outputDir, 'capture-report.json'),
            JSON.stringify(report, null, 2)
          ),
          catch: (error) => new FileSystemError({
            path: path.join(cfg.outputDir, 'capture-report.json'),
            operation: 'writeFile',
            cause: error,
          }),
        });

        const markdown = generateMarkdown(results, successful, failed);
        yield* Effect.tryPromise({
          try: () => fs.writeFile(
            path.join(cfg.outputDir, 'REPORT.md'),
            markdown
          ),
          catch: (error) => new FileSystemError({
            path: path.join(cfg.outputDir, 'REPORT.md'),
            operation: 'writeFile',
            cause: error,
          }),
        });

        console.log('\n✓ Reports generated');
      });

    // Generate markdown report
    /**
     * Builds a Markdown report aggregating all successfully captured routes and failed attempts.
     *
     * @param results Full result map.
     * @param successful Subset of successful captures.
     * @param failed Subset of failed captures.
     * @returns Markdown document string.
     */
    const generateMarkdown = (
      results: Map<string, CaptureResult>,
      successful: CaptureResult[],
      failed: CaptureResult[]
    ): string => {
      let md = `# UI Capture Report\n\n`;
      md += `Generated: ${new Date().toISOString()}\n\n`;
      md += `## Summary\n\n`;
      md += `- Total Routes: ${results.size}\n`;
      md += `- Successful: ${successful.length}\n`;
      md += `- Failed: ${failed.length}\n\n`;

      md += `## Captured Routes\n\n`;
      for (const result of successful) {
        md += `### ${result.route}\n\n`;
        md += `**URL:** ${result.url}\n\n`;
        
        for (const [viewport, formats] of Object.entries(result.screenshots)) {
          md += `#### ${viewport.toUpperCase()} (Screenshots)\n\n`;
          const relPng = path.relative(cfg.outputDir, formats.png).replace(/\\/g, '/');
          const relWebp = path.relative(cfg.outputDir, formats.webp).replace(/\\/g, '/');
          const relJpg = path.relative(cfg.outputDir, formats.jpg).replace(/\\/g, '/');
          md += `- PNG (lossless): [View](${relPng})\n`;
          md += `- WebP (optimized): [View](${relWebp})\n`;
          md += `- JPEG (compatible): [View](${relJpg})\n\n`;
          
          if (result.videos && result.videos[viewport]) {
            md += `**${viewport.toUpperCase()} Videos:**\n\n`;
            const videos = result.videos[viewport];
            const relHigh = path.relative(cfg.outputDir, videos.high).replace(/\\/g, '/');
            const relMedium = path.relative(cfg.outputDir, videos.medium).replace(/\\/g, '/');
            const relLow = path.relative(cfg.outputDir, videos.low).replace(/\\/g, '/');
            md += `- High Quality (1:1 scale): [Watch](${relHigh})\n`;
            md += `- Medium Quality (0.75x scale): [Watch](${relMedium})\n`;
            md += `- Low Quality (0.5x scale): [Watch](${relLow})\n\n`;
          }
        }
        
        md += '---\n\n';
      }

      if (failed.length > 0) {
        md += `## Failed Captures\n\n`;
        for (const result of failed) {
          md += `- ${result.url}: ${result.error}\n`;
        }
      }

      return md;
    };

    // Main capture function
    /**
     * Public entry point for capturing an entire website.
     *
     * @param url Absolute URL to the root route.
     * @returns Map of normalized URLs to capture metadata.
     */
    const captureWebsite = (url: string): Effect.Effect<Map<string, CaptureResult>, BrowserError | CaptureError | FileSystemError> =>
      Effect.gen(function* () {
        console.log('Starting UI capture for:', url);
        const urlObj = new URL(url);
        hydrateDomainFilters(urlObj.hostname);

        const results = new Map<string, CaptureResult>();

        yield* Effect.acquireUseRelease(
          initialize,
          () => Effect.gen(function* () {
            if (!browser) {
              return yield* Effect.fail(new CaptureError({
                url,
                message: 'Browser not initialized',
                cause: null,
              }));
            }

            const queueCapacity = Math.max(32, cfg.routeConcurrency * 8);
            const taskQueue = yield* Queue.bounded<QueueTask>(queueCapacity);
            const pendingTasks = yield* Ref.make(0);
            const shutdownNotified = yield* Ref.make(false);

            const signalShutdown = (): Effect.Effect<void, never> =>
              Effect.gen(function* () {
                const already = yield* Ref.get(shutdownNotified);
                if (already) {
                  return;
                }
                yield* Ref.set(shutdownNotified, true);
                for (let i = 0; i < cfg.routeConcurrency; i++) {
                  yield* Queue.offer(taskQueue, ShutdownSignal);
                }
              });

            const scheduleRoute = (routeUrl: string, depth: number): Effect.Effect<void, never> =>
              Effect.gen(function* () {
                if (depth > cfg.maxDepth) {
                  return;
                }

                if (yield* Ref.get(shutdownNotified)) {
                  return;
                }

                let hostname: string;
                try {
                  hostname = new URL(routeUrl).hostname;
                } catch {
                  return;
                }

                if (!hostMatchesFilters(hostname)) {
                  return;
                }

                const normalizedUrl = yield* normalizeUrl(routeUrl);

                const taskOption = yield* Effect.sync(() => {
                  if (processedRoutes.has(normalizedUrl)) {
                    return Option.none<RouteTask>();
                  }

                  processedRoutes.add(normalizedUrl);
                  return Option.some<RouteTask>({
                    type: 'route',
                    url: routeUrl,
                    depth,
                    normalizedUrl,
                  });
                });

                if (Option.isSome(taskOption)) {
                  yield* Ref.update(pendingTasks, (count) => count + 1);
                  yield* Queue.offer(taskQueue, taskOption.value);
                }
              });

            const markTaskComplete = (): Effect.Effect<void, never> =>
              Effect.gen(function* () {
                const remaining = yield* Ref.updateAndGet(pendingTasks, (count) => Math.max(0, count - 1));
                if (remaining === 0) {
                  yield* signalShutdown();
                }
              });

            const workerLoop = (page: Page, workerId: number): Effect.Effect<void, CaptureError | FileSystemError> =>
              Effect.gen(function* () {
                while (true) {
                  const task = yield* Queue.take(taskQueue);

                  if (task.type === 'shutdown') {
                    return yield* Effect.void;
                  }

                  yield* processRouteTask(page, task, results, scheduleRoute, `#${workerId}`).pipe(
                    Effect.catchAll((error) => {
                      console.error(`[Worker ${workerId}] Failed to capture ${task.url}:`, error);
                      return Effect.void;
                    }),
                    Effect.ensuring(markTaskComplete())
                  );
                }
              });

            const createWorker = (workerId: number): Effect.Effect<void, CaptureError | FileSystemError> =>
              Effect.acquireUseRelease(
                Effect.gen(function* () {
                  if (!browser) {
                    return yield* Effect.fail(new CaptureError({
                      url,
                      message: 'Browser not initialized',
                      cause: null,
                    }));
                  }

                  const context = yield* Effect.tryPromise({
                    try: () => browser!.newContext(),
                    catch: (error) => new CaptureError({
                      url,
                      message: `Worker ${workerId}: Failed to create context`,
                      cause: error,
                    }),
                  });

                  const page = yield* Effect.tryPromise({
                    try: () => context.newPage(),
                    catch: (error) => new CaptureError({
                      url,
                      message: `Worker ${workerId}: Failed to create page`,
                      cause: error,
                    }),
                  });

                  console.log(`✓ Worker ${workerId} ready`);

                  return { context, page };
                }),
                ({ page }) => workerLoop(page, workerId),
                ({ context }) =>
                  Effect.tryPromise({
                    try: () => context.close(),
                    catch: () => undefined,
                  }).pipe(Effect.catchAll(() => Effect.void))
              );

            yield* scheduleRoute(url, 0);
            const initialPending = yield* Ref.get(pendingTasks);
            if (initialPending === 0) {
              yield* signalShutdown();
            }

            const workers = Array.from({ length: cfg.routeConcurrency }, (_, idx) =>
              createWorker(idx + 1)
            );

            yield* Effect.all(workers, { concurrency: cfg.routeConcurrency });
            yield* Queue.shutdown(taskQueue);

            yield* generateReports(results);
            console.log(`\n✓ Capture completed! Results saved to: ${cfg.outputDir}`);
          }),
          () => cleanup.pipe(Effect.orDie)
        );

        return results;
      });

    return { captureWebsite, captureVideo } as const;
  }),
}) {}

// --- Layer for providing configuration ---

/**
 * Convenience layer helper for injecting a `CaptureConfig` into Effect programs.
 */
export const CaptureConfigLive = (config?: CaptureConfig | CaptureConfigOverrides) =>
  Layer.succeed(
    CaptureConfigTag,
    config instanceof CaptureConfig ? config : createCaptureConfig(config)
  );

// --- Example Usage ---

const program = Effect.gen(function* () {
  const service = yield* UICaptureService;
  
  return yield* service.captureWebsite('https://mikeodnis.dev');
}).pipe(
  Effect.provide(UICaptureService.Default),
  Effect.provide(CaptureConfigLive({
    captureVideo: true,
    videoOptions: { duration: 15000, interactions: true },
    viewports: [
      { name: 'desktop', width: 1920, height: 1080 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'mobile', width: 390, height: 844 },
    ],
    menuInteractionSelectors: ['button[data-nav-toggle]', '[data-open-menu]'],
    screenshotHideSelectors: ['.cookie-banner', '#chat-widget'],
  }))
);

// Uncomment to run
Effect.runPromise(program).catch(console.error);

export default UICaptureService;