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

import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { bearer } from "@elysiajs/bearer";
import { cors } from "@elysiajs/cors";
import { opentelemetry, record } from "@elysiajs/opentelemetry";
import { serverTiming } from "@elysiajs/server-timing";
import { swagger } from "@elysiajs/swagger";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { SocketAddress } from "bun";
import { Elysia, t } from "elysia";
import { ip } from "elysia-ip";
import { DefaultContext, type Generator, rateLimit } from "elysia-rate-limit";
import { elysiaHelmet } from "elysiajs-helmet";
import jwt from "jsonwebtoken";
import logixlysia from "logixlysia";

const authRegisterSchema = t.Object(
	{
		token: t.String(),
		privateKey: t.String(),
	},
	{ description: "Response from authentication register endpoint" },
);

/**
 * Stringifies an object with 2-space indentation.
 * @param {object} o - The object to stringify.
 * @returns {string} The pretty-printed JSON string.
 */
const Stringify = (o: object): string => JSON.stringify(o, null, 2);

/**
 * Generates a unique identifier for rate limiting based on the request's IP address.
 * @param {*} _r - The request object (unused).
 * @param {*} _s - The response object (unused).
 * @param {{ ip: SocketAddress }} param2 - The context containing the IP address.
 * @returns {string} The IP address or 'unknown' if not available.
 */
const ipGenerator: Generator<{ ip: SocketAddress }> = (_r, _s, { ip }) =>
	ip?.address ?? "unknown";

/**
 * The current application version, loaded from package.json.
 * @type {string}
 */
const version: string =
	(await import("./package.json")
		.then((t) => t.default.version)
		.catch(console.error)) || "N/A";

/**
 * Checks if Docker is running on the system.
 * @async
 * @returns {Promise<boolean>} True if Docker is active, false otherwise.
 */
const checkDocker = async (): Promise<boolean> => {
	try {
		const { stdout } = await Bun.$`systemctl is-active docker`;
		return stdout.toString().trim() === "active";
	} catch (error) {
		console.error("Docker is not running or systemctl command failed:", error);
		return false;
	}
};

/**
 * Starts a Jaeger tracing container using Docker.
 * Logs output to ./logs/jaeger.log.
 * @see http://localhost:16686/search
 */
const runJaeger = (): void => {
	const [out, err] = Array(2).fill(fs.openSync("./logs/jaeger.log", "a"));

	const jaeger = spawn(
		"docker",
		[
			"run",
			"--rm",
			"--name",
			"jaeger",
			"-p",
			"5778:5778",
			"-p",
			"16686:16686",
			"-p",
			"4317:4317",
			"-p",
			"4318:4318",
			"-p",
			"14250:14250",
			"-p",
			"14268:14268",
			"-p",
			"9411:9411",
			"jaegertracing/jaeger:2.1.0",
		],
		{
			detached: true,
			stdio: ["ignore", out, err],
		},
	);

	jaeger.unref();
};

/**
 * Middleware for timing and logging the duration of each request.
 * Adds a `start` timestamp to the store before handling,
 * and logs the duration after handling.
 */
const timingMiddleware = new Elysia()
	.state({ start: 0 })
	.onBeforeHandle(({ store }) => (store.start = Date.now()))
	.onAfterHandle(({ path, store: { start } }) =>
		console.info(`[Elysia] ${path} took ${Date.now() - start}ms to execute`),
	);

/**
 * The secret used for signing and verifying JWT tokens.
 * @type {string}
 */
const JWT_SECRET: string = Bun.env.JWT_SECRET || "dev_secret";

/**
 * Authentication route for registering a new user.
 * Generates an RSA key pair and returns a JWT and the private key.
 */
const authRoute = new Elysia().post(
	"/auth/register",
	() => {
		const { publicKey, privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
		});

		const token = jwt.sign(
			{ pub: publicKey.export({ type: "pkcs1", format: "pem" }) },
			JWT_SECRET,
			{ algorithm: "HS256", expiresIn: 30 },
		);

		return {
			token,
			privateKey: privateKey.export({ type: "pkcs1", format: "pem" }),
		};
	},
	{ body: authRegisterSchema },
);

/**
 * Middleware to require JWT Bearer authentication.
 * Throws an error if the token is missing or invalid.
 */
const requireAuth = new Elysia().use(bearer()).derive(({ bearer }) => {
	if (!bearer) throw new Error("Missing Bearer token");
	try {
		const payload = jwt.verify(bearer, JWT_SECRET) as { pub: string };
		return { publicKey: payload.pub };
	} catch {
		throw new Error("Invalid or expired token");
	}
});

/**
 * Utility routes for root, status, version, info, and health endpoints.
 * Includes CORS preflight, HEAD, and GET handlers.
 */
const utilityRoute = new Elysia()
	.use(timingMiddleware)
	.get(
		"/",
		() =>
			record("root.get", () => {
				return Stringify({
					message: `Welcome to the API. Don't be naughty >:(`,
					status: 200,
				});
			}),
		{
			detail: {
				summary: "Root endpoint",
				description: "Welcome message for the API",
				tags: ["Utility"],
			},
		},
	)
	.head(
		"/",
		({ set }) =>
			record("root.head", () => {
				set.status = 200;
				return;
			}),
		{
			detail: {
				summary: "Root HEAD",
				description: "HEAD for root endpoint",
				tags: ["Utility"],
			},
		},
	)
	.options(
		"/",
		() =>
			record("root.options", () => {
				return Stringify({
					message: "CORS preflight response",
					status: 204,
					allow: "GET,OPTIONS,HEAD",
				});
			}),
		{
			detail: {
				summary: "Root OPTIONS",
				description: "CORS preflight for root",
				tags: ["Utility"],
			},
		},
	)
	.get(
		"/status",
		async () =>
			record("status.get", async () => {
				const uptime = process.uptime();
				const memoryUsage = process.memoryUsage();
				const appVersion = version;
				return Stringify({
					message: "Application status",
					status: 200,
					data: {
						uptime: `${uptime.toFixed(2)} seconds`,
						memory: {
							rss: `${(memoryUsage.rss / 1_024 / 1_024).toFixed(2)} MB`,
							heapTotal: `${(memoryUsage.heapTotal / 1_024 / 1_024).toFixed(2)} MB`,
							heapUsed: `${(memoryUsage.heapUsed / 1_024 / 1_024).toFixed(2)} MB`,
							external: `${(memoryUsage.external / 1_024 / 1_024).toFixed(2)} MB`,
						},
						version: appVersion,
						environment: Bun.env.NODE_ENV || "development",
					},
				});
			}),
		{
			detail: {
				summary: "Get application status",
				description: "Returns uptime, memory usage, version, and environment",
				tags: ["Utility"],
			},
		},
	)
	.head(
		"/status",
		({ set }) =>
			record("status.head", () => {
				set.status = 200;
				return;
			}),
		{
			detail: {
				summary: "Status HEAD",
				description: "HEAD for status endpoint",
				tags: ["Utility"],
			},
		},
	)
	.options(
		"/status",
		() =>
			record("status.options", () => {
				return Stringify({
					message: "CORS preflight response",
					status: 204,
					allow: "GET,OPTIONS,HEAD",
				});
			}),
		{
			detail: {
				summary: "Status OPTIONS",
				description: "CORS preflight for status",
				tags: ["Utility"],
			},
		},
	)
	.get(
		"/version",
		async () =>
			record("version.get", async () => {
				const appVersion = version;
				return Stringify({
					version: appVersion,
					status: 200,
				});
			}),
		{
			detail: {
				summary: "Get API version",
				description: "Returns the current API version",
				tags: ["Info"],
			},
		},
	)
	.head(
		"/version",
		({ set }) =>
			record("version.head", () => {
				set.status = 200;
				return;
			}),
		{
			detail: {
				summary: "Version HEAD",
				description: "HEAD for version endpoint",
				tags: ["Info"],
			},
		},
	)
	.options(
		"/version",
		() =>
			record("version.options", () => {
				return Stringify({
					message: "CORS preflight response",
					status: 204,
					allow: "GET,OPTIONS,HEAD",
				});
			}),
		{
			detail: {
				summary: "Version OPTIONS",
				description: "CORS preflight for version",
				tags: ["Info"],
			},
		},
	)
	.get(
		"/info",
		() =>
			record("info.get", () => {
				return Stringify({
					message: `Information about the API`,
					status: 200,
					data: {
						contact: `example@example.com`,
						documentationUrl: "https://docs.your-api.com",
					},
				});
			}),
		{
			detail: {
				summary: "Get API info",
				description: "Returns information about the API",
				tags: ["Info"],
			},
		},
	)
	.head(
		"/info",
		({ set }) =>
			record("info.head", () => {
				set.status = 200;
				return;
			}),
		{
			detail: {
				summary: "Info HEAD",
				description: "HEAD for info endpoint",
				tags: ["Info"],
			},
		},
	)
	.options(
		"/info",
		() =>
			record("info.options", () => {
				return Stringify({
					message: "CORS preflight response",
					status: 204,
					allow: "GET,OPTIONS,HEAD",
				});
			}),
		{
			detail: {
				summary: "Info OPTIONS",
				description: "CORS preflight for info",
				tags: ["Info"],
			},
		},
	)
	.get(
		"/health",
		async () =>
			record("health.get", () => {
				return Stringify({ message: "ok", status: 200 });
			}),
		{
			detail: {
				summary: "Health check",
				description: "Returns ok if the API is healthy",
				tags: ["Health"],
			},
		},
	)
	.head(
		"/health",
		({ set }) =>
			record("health.head", () => {
				set.status = 200;
				return;
			}),
		{
			detail: {
				summary: "Health HEAD",
				description: "HEAD for health endpoint",
				tags: ["Health"],
			},
		},
	)
	.options(
		"/health",
		() =>
			record("health.options", () => {
				return Stringify({
					message: "CORS preflight response",
					status: 204,
					allow: "GET,OPTIONS,HEAD",
				});
			}),
		{
			detail: {
				summary: "Health OPTIONS",
				description: "CORS preflight for health",
				tags: ["Health"],
			},
		},
	);

/**
 * Protected route that requires authentication.
 * Returns the user's public key if access is granted.
 */
const protectedRoute = new Elysia()
	.use(requireAuth)
	.get(
		"/example",
		(ctx: { publicKey: string }) =>
			record("protected.example.get", () => {
				return Stringify({
					message: "You have access!",
					yourPublicKey: ctx.publicKey,
				});
			}),
		{
			detail: {
				summary: "Protected Example",
				description: "An example endpoint that requires authentication",
				tags: ["Protected"],
			},
		},
	)
	.head(
		"/example",
		({ set }) =>
			record("protected.example.head", () => {
				set.status = 200;
				return;
			}),
		{
			detail: {
				summary: "Protected Example HEAD",
				description: "HEAD for protected example endpoint",
				tags: ["Protected"],
			},
		},
	)
	.options(
		"/example",
		() =>
			record("protected.example.options", () => {
				return Stringify({
					message: "CORS preflight response",
					status: 204,
					allow: "GET,OPTIONS,HEAD",
				});
			}),
		{
			detail: {
				summary: "Protected Example OPTIONS",
				description: "CORS preflight for protected example",
				tags: ["Protected"],
			},
		},
	);

/**
 * OpenTelemetry resource for Jaeger tracing.
 */
const otelResource = resourceFromAttributes({
	[ATTR_SERVICE_NAME]: "elysia-api",
});

/**
 * OTLP trace exporter for sending traces to Jaeger.
 */
const otlpExporter = new OTLPTraceExporter({
	url: "http://localhost:4318/v1/traces",
	// compression: 'gzip',
	keepAlive: true,
	// httpAgentOptions: { keepAlive: true },
});

/**
 * Batch span processor for OpenTelemetry.
 */
const batchSpanProcessor = new BatchSpanProcessor(otlpExporter, {
	maxExportBatchSize: 512, // Default: 512
	scheduledDelayMillis: 5_000, // Default: 5000ms (5s)
	exportTimeoutMillis: 30_000, // Default: 30000ms (30s)
	maxQueueSize: 2_048, // Default: 2048
});

/**
 * Content Security Policy and permissions constants for Helmet.
 */
const permission = {
	SELF: "'self'",
	UNSAFE_INLINE: "'unsafe-inline'",
	HTTPS: "https:",
	DATA: "data:",
	NONE: "'none'",
	BLOB: "blob:",
} as const;

/**
 * Main API application instance with all middleware and routes.
 * Includes tracing, logging, security, CORS, rate limiting, authentication, and utility/protected routes.
 */
const api = new Elysia({ prefix: "/api/v1" })
	.trace(async ({ onBeforeHandle, onAfterHandle, onError }) => {
		onBeforeHandle(({ begin, onStop }) => {
			onStop(({ end }) => {
				console.log("BeforeHandle took", end - begin, "ms");
			});
		});
		onAfterHandle(({ begin, onStop }) => {
			onStop(({ end }) => {
				console.log("AfterHandle took", end - begin, "ms");
			});
		});
		onError(({ begin, onStop }) => {
			onStop(({ end, error }) => {
				console.error("Error occurred after", end - begin, "ms", error);
			});
		});
	})
	.use(
		logixlysia({
			config: {
				showStartupMessage: true,
				startupMessageFormat: "simple",
				timestamp: {
					translateTime: "yyyy-mm-dd HH:MM:ss.SSS",
				},
				logFilePath: "./logs/server.log",
				ip: true,
				customLogFormat:
					"🦊 {now} {level} {duration} {method} {pathname} {status} {message} {ip}",
			},
		}),
	)
	.use(
		elysiaHelmet({
			csp: {
				defaultSrc: [permission.SELF],
				scriptSrc: [permission.SELF, permission.UNSAFE_INLINE],
				styleSrc: [permission.SELF, permission.UNSAFE_INLINE],
				imgSrc: [permission.SELF, permission.DATA, permission.HTTPS],
				useNonce: true,
			},
			hsts: {
				maxAge: 31_536_000,
				includeSubDomains: true,
				preload: true,
			},
			frameOptions: "DENY",
			referrerPolicy: "strict-origin-when-cross-origin",
			permissionsPolicy: {
				camera: [permission.NONE],
				microphone: [permission.NONE],
			},
		}),
	)
	.use(ip())
	.use(
		opentelemetry({
			resource: otelResource,
			spanProcessors: [batchSpanProcessor],
		}),
	)
	.use(
		serverTiming({
			trace: {
				request: true,
				parse: true,
				transform: true,
				beforeHandle: true,
				handle: true,
				afterHandle: true,
				error: true,
				mapResponse: true,
				total: true,
			},
		}),
	)
	.use(
		cors({
			origin: `http://localhost:3000`,
			methods: ["GET", "POST", "OPTIONS", "HEAD"],
			exposeHeaders: ["Content-Type", "Authorization"],
			maxAge: 86_400,
			credentials: true,
		}),
	)
	.use(
		rateLimit({
			duration: 60_000,
			max: 100,
			headers: true,
			scoping: "scoped",
			countFailedRequest: true,
			errorResponse: new Response(
				Stringify({
					error: `Too many requests`,
				}),
				{ status: 429 },
			),
			generator: ipGenerator,
			context: new DefaultContext(10_000),
		}),
	)
	.use(authRoute)
	.use(requireAuth)
	.use(protectedRoute)
	.use(utilityRoute)
	.onError(({ code, error, set }) => {
		console.error(Stringify({ ERROR: error }));
		set.status = code === "NOT_FOUND" ? 404 : 500;
		return Stringify({
			error: Error.isError(error) ? Stringify({ error }) : Stringify({ error }),
			status: set.status,
		});
	});

/**
 * Root application instance, includes Swagger documentation and the main API.
 */
const root = new Elysia()
	.use(
		swagger({
			path: "/swagger",
			documentation: {
				info: {
					title: "🦊 Elysia Advanced API",
					version: "1.0.0",
					description: `
Welcome to the **Elysia Advanced API**! 
This API demonstrates advanced features including authentication, 
security, observability, and more.

- 🚀 **Fast** and modern API with [ElysiaJS](https://elysiajs.com)
- 🔒 Security best practices (Helmet, Rate Limiting, CORS)
- 📊 Observability (OpenTelemetry, Jaeger)
- 📝 Auto-generated OpenAPI docs

> **Contact:** [Your Name](mailto:example@example.com)  
> **Docs:** [API Docs](https://docs.your-api.com)
          `,
					termsOfService: "https://your-api.com/terms",
					contact: {
						name: "API Support",
						url: "https://your-api.com/support",
						email: "support@your-api.com",
					},
					license: {
						name: "MIT",
						url: "https://opensource.org/licenses/MIT",
					},
				},
				externalDocs: {
					description: "Find more info here",
					url: "https://github.com/your-org/your-repo",
				},
				tags: [
					{
						name: "Utility",
						description: "Endpoints for status, version, and root  API info.",
					},
					{
						name: "Health",
						description: "Health check endpoints for uptime  monitoring.",
					},
					{
						name: "Info",
						description: "General API information endpoints.",
					},
					{
						name: "Protected",
						description: "Endpoints that require authentication  (JWT Bearer).",
					},
				],
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
							bearerFormat: "JWT",
							description:
								"Enter your JWT Bearer token to access  protected endpoints.",
						},
					},
				},
			},
		}),
	)
	.use(api)
	.listen(3_000);

/**
 * The Elysia API application type.
 * @typedef {typeof api} App
 */
export type App = typeof api;

/**
 * Gracefully shuts down the application and flushes telemetry.
 * @async
 * @returns {Promise<void>}
 */
const shutdown = async (): Promise<void> => {
	console.info("Shutting down 🦊 Elysia");
	await batchSpanProcessor.forceFlush();
	await root.stop();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * Initializes Jaeger tracing by checking Docker and starting the Jaeger container if needed.
 * Logs the server address on success.
 * @async
 * @returns {Promise<void>}
 */
const initializeJaeger = async (): Promise<void> => {
	if (await checkDocker()) {
		console.info("Docker is running. Checking for Jaeger container...");
		try {
			await Bun.$`docker inspect -f {{.State.Running}} jaeger`.text();
			console.info("Jaeger container is already running.");
		} catch {
			console.info(
				"Jaeger container not found or not running. Starting Jaeger...",
			);
			runJaeger();
		}
	} else {
		console.error(
			"Docker is not running. Please start Docker to use Jaeger tracing.",
		);
		process.exit(1);
	}

	console.info(
		`🦊 Elysia is running at ${root.server?.hostname}:${root.server?.port}`,
	);
};

// Only initialize Jaeger if this file is the entry point.
require.main === module && initializeJaeger();

/**
 * @fileoverview
 * This file defines the advanced Elysia API server with authentication, security, observability,
 * and documentation features. All major functions, classes, and constants are documented using JSDoc.
 * For more on JSDoc best practices, see:
 * https://www.pullrequest.com/blog/leveraging-jsdoc-for-better-code-documentation-in-javascript/
 */
