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
import { Context, Effect, Layer, Option, Queue, Ref } from "effect";
import fs from 'node:fs/promises';
import path from 'node:path';
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

// --- Context Tags ---

export class CaptureConfigTag extends Context.Tag("CaptureConfig")<
  CaptureConfigTag,
  CaptureConfig
>() {}

// --- Service Definition ---

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

    // Extract same-origin links
    const linkFilterConcurrency = 32;

    /**
     * Extracts eligible links from the current page, normalizing and deduplicating them.
     * Filtering occurs concurrently to keep up with link-dense pages.
     *
     * @param page Playwright page currently being captured.
     * @returns Array of absolute URLs that satisfy domain constraints.
     */
    const extractLinks = (page: Page): Effect.Effect<readonly string[], never> =>
      Effect.tryPromise({
        try: async () => {
          return await page.$$eval('a[href]', (anchors) =>
            Array.from(anchors, (anchor) => (anchor as HTMLAnchorElement).href)
          );
        },
        catch: () => [] as readonly string[],
      }).pipe(
        Effect.flatMap((links) =>
          Effect.forEach(
            links,
            (link) =>
              Effect.sync(() => {
                try {
                  if (link === '#' || link.endsWith('#')) {
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
                Math.min(linkFilterConcurrency, Math.max(1, links.length))
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
    ): Effect.Effect<ScreenshotPaths, CaptureError> =>
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
        });

        yield* Effect.sleep(1000);

        const baseFilename = `${viewport.name}_${viewport.width}x${viewport.height}_${timestamp}`;

        const pngPath = path.join(routeDir, 'screenshots', 'png', `${baseFilename}.png`);
        const webpPath = path.join(routeDir, 'screenshots', 'webp', `${baseFilename}.webp`);
        const jpgPath = path.join(routeDir, 'screenshots', 'jpg', `${baseFilename}.jpg`);

        yield* Effect.all([
          Effect.tryPromise({
            try: () => page.screenshot({ path: pngPath, fullPage: true, type: 'png' }),
            catch: (error) => new CaptureError({
              url: page.url(),
              message: 'Failed to capture PNG',
              cause: error,
            }),
          }),
          Effect.tryPromise({
            try: () => page.screenshot({ path: webpPath, fullPage: true, type: 'jpeg', quality: 90 }),
            catch: (error) => new CaptureError({
              url: page.url(),
              message: 'Failed to capture WebP',
              cause: error,
            }),
          }),
          Effect.tryPromise({
            try: () => page.screenshot({ path: jpgPath, fullPage: true, type: 'jpeg', quality: 85 }),
            catch: (error) => new CaptureError({
              url: page.url(),
              message: 'Failed to capture JPEG',
              cause: error,
            }),
          }),
        ], { concurrency: 3 });

        console.log(`    ✓ Screenshots saved: ${baseFilename}`);

        return new ScreenshotPaths({ png: pngPath, webp: webpPath, jpg: jpgPath });
      });

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
        const qualities = [
          { name: 'high' as const, scale: 1.0, dir: 'high-quality' },
          { name: 'medium' as const, scale: 0.75, dir: 'medium-quality' },
          { name: 'low' as const, scale: 0.5, dir: 'low-quality' },
        ];

        const paths = yield* Effect.all(
          qualities.map((quality) =>
            Effect.gen(function* () {
              const context = yield* Effect.tryPromise({
                try: () => browser!.newContext({
                  recordVideo: {
                    dir: path.join(routeDir, 'videos', quality.dir),
                    size: {
                      width: Math.floor(viewport.width * quality.scale),
                      height: Math.floor(viewport.height * quality.scale),
                    },
                  },
                  viewport: { width: viewport.width, height: viewport.height },
                }),
                catch: (error) => new CaptureError({
                  url: page.url(),
                  message: `Failed to create ${quality.name} quality context`,
                  cause: error,
                }),
              });

              const videoPage = yield* Effect.tryPromise({
                try: () => context.newPage(),
                catch: (error) => new CaptureError({
                  url: page.url(),
                  message: 'Failed to create video page',
                  cause: error,
                }),
              });

              yield* Effect.tryPromise({
                try: () => videoPage.goto(page.url(), { waitUntil: 'networkidle', timeout: 30000 }),
                catch: (error) => new CaptureError({
                  url: page.url(),
                  message: 'Failed to navigate video page',
                  cause: error,
                }),
              });

              yield* Effect.sleep(cfg.waitTime);

              // Perform interactions if enabled
              if (cfg.videoOptions.interactions) {
                const scrollSteps = 5;
                const scrollDelay = cfg.videoOptions.duration / (scrollSteps + 1);

                for (let i = 0; i < scrollSteps; i++) {
                  yield* Effect.tryPromise({
                    try: () => videoPage.evaluate((step) => {
                      window.scrollTo({
                        top: (document.body.scrollHeight / 5) * step,
                        behavior: 'smooth',
                      });
                    }, i + 1),
                    catch: () => undefined,
                  });
                  yield* Effect.sleep(scrollDelay);
                }

                yield* Effect.tryPromise({
                  try: () => videoPage.evaluate(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }),
                  catch: () => undefined,
                });
                yield* Effect.sleep(1000);
              } else {
                yield* Effect.sleep(cfg.videoOptions.duration);
              }

              yield* Effect.tryPromise({
                try: () => videoPage.close(),
                catch: () => undefined,
              });

              const videoPath = yield* Effect.tryPromise({
                try: async () => {
                  const vp = await videoPage.video()?.path();
                  await context.close();
                  return vp;
                },
                catch: (error) => new CaptureError({
                  url: page.url(),
                  message: 'Failed to get video path',
                  cause: error,
                }),
              });

              if (!videoPath) {
                return yield* Effect.fail(new CaptureError({
                  url: page.url(),
                  message: 'Video path is null',
                  cause: null,
                }));
              }

              const newPath = path.join(routeDir, 'videos', quality.dir, `${baseFilename}.webm`);
              yield* Effect.tryPromise({
                try: () => fs.rename(videoPath, newPath),
                catch: (error) => new FileSystemError({
                  path: newPath,
                  operation: 'rename',
                  cause: error,
                }),
              });

              return [quality.name, newPath] as const;
            }).pipe(
              Effect.catchAll((error) => {
                console.error(`Failed to capture ${quality.name} quality video:`, error);
                return Effect.succeed([quality.name, ''] as const);
              })
            )
          ),
          { concurrency: 1 }
        );

        const videoPaths: Record<'high' | 'medium' | 'low', string> = {
          high: paths[0][1],
          medium: paths[1][1],
          low: paths[2][1],
        };
        
        console.log(`    ✓ Videos saved: ${baseFilename}`);

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
        });
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
        });

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
  }))
);

// Uncomment to run
Effect.runPromise(program).catch(console.error);

export default UICaptureService;