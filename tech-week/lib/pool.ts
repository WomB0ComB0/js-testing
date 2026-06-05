/**
 * Bounded-concurrency worker pool. Items are consumed from a shared cursor
 * so progress is global, not per-worker. `perWorkerDelayMs` staggers
 * non-zero workers so they don't all slam an upstream service on T0.
 */

export interface PoolOptions {
	concurrency: number;
	/** Per-worker startup stagger in ms (workerId > 0 only). 0 disables. */
	perWorkerDelayMs?: number;
}

export async function pool<T>(
	items: T[],
	options: PoolOptions,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	const { concurrency, perWorkerDelayMs = 0 } = options;
	let cursor = 0;
	const total = items.length;
	const runners = Array.from({ length: concurrency }, async (_, workerId) => {
		while (cursor < total) {
			const index = cursor;
			cursor += 1;
			if (perWorkerDelayMs > 0 && workerId > 0) {
				await new Promise((r) => setTimeout(r, perWorkerDelayMs));
			}
			await worker(items[index], index);
		}
	});
	await Promise.all(runners);
}
