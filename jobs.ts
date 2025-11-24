import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const BATCH_SIZE = 5; // how many URLs to open per "window"/batch

async function main() {
	const rl = readline.createInterface({ input, output });

	try {
    /**
     * @file jobs-console-script.js
    */
		const { default: jobs } = await import("./jobs.json", {
			assert: { type: "json" },
		});

		// Optional resume support: use START_INDEX env var if provided
		const startIndexRaw = process.env.START_INDEX ?? "0";
		let startIndex = Number.parseInt(startIndexRaw, 10);
		if (Number.isNaN(startIndex) || startIndex < 0 || startIndex >= jobs.length) {
			startIndex = 0;
		}

		const jobsSlice = (jobs as string[]).slice(startIndex);
		const chunks = chunk(jobsSlice, BATCH_SIZE);

		console.log(
			`Total jobs: ${jobs.length}. Starting from index ${startIndex}. Batches: ${chunks.length}`,
		);

		for (let i = 0; i < chunks.length; i++) {
			const batch = chunks[i];

			const globalBatchIndex = startIndex + i * BATCH_SIZE;
			console.log(
				`Opening batch ${i + 1}/${chunks.length} (${batch.length} items) [jobs ${globalBatchIndex}–${globalBatchIndex + batch.length - 1}]`,
			);

			// Open this batch in parallel (within the batch size)
			await Promise.all(
				batch.map((job) => Bun.$`xdg-open ${job}`.nothrow()),
			);

			// If there are more batches, ask if we should continue
			if (i < chunks.length - 1) {
				const answer = (
					await rl.question("Open next batch? (y/n) ")
				).trim().toLowerCase();

				if (!answer.startsWith("y")) {
					const nextStartIndex = startIndex + (i + 1) * BATCH_SIZE;
					console.log("Stopping as requested.");
					console.log(
						`If you want to resume later, run again with:\n  START_INDEX=${nextStartIndex} bun script.ts`,
					);
					return;
				}
			}
		}

		console.log("All jobs opened.");
	} finally {
		// Always close readline
		rl.close();
	}
}

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		out.push(arr.slice(i, i + size));
	}
	return out;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
