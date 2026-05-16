/**
 * Extracts tech-week calendar data from a captured HAR file into the
 * `{ events, source, generatedAt, pagesCaptured, reportedTotal, uniqueEventCount }`
 * envelope consumed by scrape-partiful.ts.
 *
 * The site uses paginated tRPC calls to /calendar/api/trpc/calendar.events.
 * Each response is shaped:
 *   [{"result":{"data":{"page":N,"perPage":48,"total":T,"results":[...events]}}}]
 *
 * Usage:
 *   bun run extract-calendar-from-har.ts \
 *     --har www.tech-week-boston.com.har \
 *     --out tech-week-boston-calendar.json
 *
 * If --out is omitted, the output filename is derived from the HAR filename.
 */

import { basename, dirname, join, resolve } from "node:path";

type CliArgs = {
	har: string;
	out: string;
};

function parseArgs(argv: string[]): CliArgs {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				args[key] = next;
				i += 1;
			} else {
				args[key] = "true";
			}
		}
	}
	if (!args.har) {
		console.error("Usage: extract-calendar-from-har.ts --har <file.har> [--out <out.json>]");
		process.exit(1);
	}
	const har = resolve(args.har);
	const out =
		args.out !== undefined
			? resolve(args.out)
			: join(
					dirname(har),
					`${basename(har, ".har")
						.replace(/^www\./, "")
						.replace(/\.com$/, "")
						.replace(/[^A-Za-z0-9-]/g, "-")}-calendar.json`,
				);
	return { har, out };
}

type EventRecord = {
	id: number;
	name: string;
	externalHref: string | null;
	city?: string;
	date?: string;
	time?: string;
	location?: string | null;
	company?: string | null;
	isInviteOnly?: boolean;
	facets?: unknown;
};

type TrpcEnvelope = Array<{
	result?: {
		data?: {
			page?: number;
			perPage?: number;
			total?: number;
			results?: EventRecord[];
		};
	};
}>;

type HarEntry = {
	request?: { method?: string; url?: string };
	response?: {
		content?: { text?: string; size?: number; encoding?: string };
	};
};

function decodeContent(content: HarEntry["response"] extends infer R
	? R extends { content?: infer C }
		? C
		: never
	: never): string | null {
	if (!content) return null;
	const text = content.text;
	if (typeof text !== "string") return null;
	if (content.encoding === "base64") {
		try {
			return Buffer.from(text, "base64").toString("utf8");
		} catch {
			return null;
		}
	}
	return text;
}

async function main(): Promise<void> {
	const { har, out } = parseArgs(process.argv.slice(2));

	const harBlob = await Bun.file(har).json();
	const entries: HarEntry[] = harBlob?.log?.entries ?? [];

	const trpc = entries.filter(
		(e) =>
			e.request?.method === "POST" &&
			(e.request?.url ?? "").includes("/trpc/calendar.events"),
	);

	if (trpc.length === 0) {
		console.error("No tRPC calendar.events POSTs found in HAR.");
		process.exit(1);
	}

	const byId = new Map<number, EventRecord>();
	let reportedTotal = 0;
	let pagesCaptured = 0;
	const cities = new Set<string>();

	for (const entry of trpc) {
		const text = decodeContent(entry.response?.content);
		if (!text) continue;
		let envelope: TrpcEnvelope;
		try {
			envelope = JSON.parse(text) as TrpcEnvelope;
		} catch (err) {
			console.warn("  skipping unparseable response:", (err as Error).message);
			continue;
		}
		for (const item of envelope) {
			const data = item?.result?.data;
			if (!data) continue;
			pagesCaptured += 1;
			if (data.total && data.total > reportedTotal) reportedTotal = data.total;
			for (const ev of data.results ?? []) {
				if (typeof ev?.id !== "number") continue;
				if (ev.city) cities.add(ev.city);
				if (!byId.has(ev.id)) byId.set(ev.id, ev);
			}
		}
	}

	const events = [...byId.values()].sort((a, b) => {
		const d = (a.date ?? "").localeCompare(b.date ?? "");
		if (d !== 0) return d;
		return (a.time ?? "").localeCompare(b.time ?? "");
	});

	const output = {
		events,
		source: basename(har),
		generatedAt: new Date().toISOString(),
		pagesCaptured,
		reportedTotal,
		uniqueEventCount: events.length,
		cities: [...cities].sort(),
	};

	await Bun.write(out, JSON.stringify(output, null, 2));
	console.log(
		`Wrote ${out}\n` +
			`  pagesCaptured=${pagesCaptured} reportedTotal=${reportedTotal} ` +
			`unique=${events.length} cities=${[...cities].join(",")}`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
