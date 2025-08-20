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

type TimerHandle = NodeJS.Timeout | NodeJS.Immediate;

interface TimerEntry {
	id: TimerHandle;
	type: "timeout" | "interval" | "immediate";
	created: number;
	callback: () => void;
}

class TimerManager {
	private timers = new Map<TimerHandle, TimerEntry>();
	private disposed = false;

	/**
	 * Creates a timeout that will be automatically tracked and cleaned up
	 */
	timeout(ms: number, callback: () => void): NodeJS.Timeout {
		this.checkDisposed();
		const id = setTimeout(() => {
			this.timers.delete(id);
			callback();
		}, ms);

		this.timers.set(id, {
			id,
			type: "timeout",
			created: Date.now(),
			callback,
		});

		return id;
	}

	/**
	 * Creates an interval that will be automatically tracked and cleaned up
	 */
	interval(ms: number, callback: () => void): NodeJS.Timeout {
		this.checkDisposed();
		const id = setInterval(callback, ms);

		this.timers.set(id, {
			id,
			type: "interval",
			created: Date.now(),
			callback,
		});

		return id;
	}

	/**
	 * Creates an immediate that will be automatically tracked and cleaned up
	 */
	immediate(callback: () => void): NodeJS.Immediate {
		this.checkDisposed();
		const id = setImmediate(() => {
			this.timers.delete(id);
			callback();
		});

		this.timers.set(id, {
			id,
			type: "immediate",
			created: Date.now(),
			callback,
		});

		return id;
	}

	/**
	 * Clears specific timers and removes them from tracking
	 */
	clear(...timers: TimerHandle[]): void {
		timers.forEach((timer) => {
			if (this.timers.has(timer)) {
				const entry = this.timers.get(timer)!;
				switch (entry.type) {
					case "timeout":
					case "interval":
						clearTimeout(timer as NodeJS.Timeout);
						break;
					case "immediate":
						clearImmediate(timer as NodeJS.Immediate);
						break;
				}
				this.timers.delete(timer);
			}
		});
	}

	/**
	 * Clears all tracked timers
	 */
	clearAll(): void {
		const timers = Array.from(this.timers.keys());
		this.clear(...timers);
	}

	/**
	 * Clears only timers of a specific type
	 */
	clearByType(type: "timeout" | "interval" | "immediate"): void {
		const timers = Array.from(this.timers.entries())
			.filter(([, entry]) => entry.type === type)
			.map(([id]) => id);
		this.clear(...timers);
	}

	/**
	 * Returns the number of active timers
	 */
	get activeCount(): number {
		return this.timers.size;
	}

	/**
	 * Returns information about all active timers
	 */
	getActiveTimers(): Array<{ type: string; created: number; age: number }> {
		const now = Date.now();
		return Array.from(this.timers.values()).map((entry) => ({
			type: entry.type,
			created: entry.created,
			age: now - entry.created,
		}));
	}

	/**
	 * Executes a function with automatic cleanup of all timers created during execution
	 */
	async withTimers<T>(fn: (tm: TimerManager) => Promise<T>): Promise<T> {
		this.checkDisposed();
		const initialTimers = new Set(this.timers.keys());

		try {
			const result = await fn(this);
			return result;
		} finally {
			// Clear only timers created during this execution
			const newTimers = Array.from(this.timers.keys()).filter(
				(timer) => !initialTimers.has(timer),
			);
			this.clear(...newTimers);
		}
	}

	/**
	 * Disposes the timer manager and clears all timers
	 */
	dispose(): void {
		if (!this.disposed) {
			this.clearAll();
			this.disposed = true;
		}
	}

	private checkDisposed(): void {
		if (this.disposed) {
			throw new Error("TimerManager has been disposed");
		}
	}
}

const exitWithCode = (code: number): never => process.exit(code);

async function main(): Promise<number> {
	const timerManager = new TimerManager();

	return timerManager.withTimers(async (tm) => {
		const t = tm.timeout(1000, () => console.log("test"));
		const i = tm.interval(1000, () => console.log("test"));
		const r = tm.immediate(() => console.log("test"));

		try {
			console.log("Running script...");

			// ?...<...expression(s)>>>...
			Promise.all([]);

			tm.clear(t);
			return 0;
		} catch (error) {
			console.error("\x1b[31m[Script]: Fatal error\x1b[0m", error);
			return 1;
		}
	});
}

if (require.main === module) {
	(async () => {
		try {
			const exitCode = await main();
			console.log("\x1b[32m[Script]: Completed successfully\x1b[0m");
			exitWithCode(exitCode);
		} catch (error) {
			console.error("\x1b[31m[Script]: Fatal error\x1b[0m", error);
			exitWithCode(1);
		}
	})();
}

const timerManager = new TimerManager();
export { timerManager, TimerManager, exitWithCode };
