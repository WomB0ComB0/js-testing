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

import { measurePerformance } from "./performance.js";

if (require.main === module) {
	(async () => {
		const standardMapAlgorithm = {
			name: "StandardMap",
			fn: async (size: number, calls: number) => {
				const arr = Array.from({ length: size }, (_, i) => i);
				for (let i = 0; i < calls; i++) {
					arr.map((x) => x * 2);
				}
			},
		};

		function* lazyMap<T, R>(arr: T[], fn: (item: T) => R) {
			for (const item of arr) {
				yield fn(item);
			}
		}

		const lazyMapAlgorithm = {
			name: "LazyMap",
			fn: async (size: number, calls: number) => {
				const arr = Array.from({ length: size }, (_, i) => i);
				for (let i = 0; i < calls; i++) {
					[...lazyMap(arr, (x) => x * 2)];
				}
			},
		};

		async function* lazyMapAsync<T, R>(arr: T[], fn: (item: T) => Promise<R>) {
			for (const item of arr) {
				yield await fn(item);
			}
		}

		const lazyMapAsyncAlgorithm = {
			name: "LazyMapAsync",
			fn: async (size: number, calls: number) => {
				const arr = Array.from({ length: size }, (_, i) => i);
				for (let i = 0; i < calls; i++) {
					const result: number[] = [];
					for await (const item of lazyMapAsync(arr, async (x) => x * 2)) {
						result.push(item);
					}
				}
			},
		};

		const sizes = [1_000, 10_000, 100_000, 1_000_000];

		const results = await measurePerformance(
			[standardMapAlgorithm, lazyMapAlgorithm, lazyMapAsyncAlgorithm],
			sizes,
			true, // warm up the functions
			20 * 5, // number of iterations
			30000, // max execution time in ms
			1_000, // chunk size for parallel execution
		);

		Object.entries(results).forEach(([name, data]) => {
			console.log(`${name} Results:`);
			console.log(`Duration: ${data.duration.toFixed(6)}ms`);
			console.log(
				`Complexity: `,
				JSON.stringify(data.estimatedDomains, null, 2),
			);
			console.log();
		});
	})();
}
