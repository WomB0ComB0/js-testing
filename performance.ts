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

import type { ComplexityDomain } from "@jsheaven/perf";
import { perf } from "@jsheaven/perf";

export interface Algorithm {
	name: string;
	fn: (size: number, callIndex: number, input?: string) => Promise<any> | any;
}

type PerformanceResult = {
	duration: number;
	estimatedDomains: ComplexityDomain[];
};

/**
 * Measures the performance characteristics of one or more algorithms
 * @param algorithms Single algorithm or array of algorithms to measure
 * @returns Object containing performance measurements for each algorithm
 */
export const measurePerformance = async (
	algorithms: Algorithm | Algorithm[],
	sizes?: number[],
	warm?: boolean,
	iterations?: number,
	maxExecutionTime?: number,
	chunkSize?: number | boolean,
): Promise<Record<string, PerformanceResult>> => {
	const algorithmArray = Array.isArray(algorithms) ? algorithms : [algorithms];

	try {
		const results = await perf(
			algorithmArray,
			sizes,
			warm,
			iterations,
			maxExecutionTime,
			chunkSize,
		);
		return Object.entries(results).reduce(
			(acc, [name, data]) => ({
				...acc,
				[name]: {
					duration: data.duration,
					estimatedDomains: data.estimatedDomains,
				},
			}),
			{} as Record<string, PerformanceResult>,
		);
	} catch (error) {
		console.error("Error measuring performance:", error);
		throw error;
	}
};

/**
 * Example usage:
 *
 * const bubbleSort: Algorithm = {
 *   name: 'BubbleSort',
 *   fn: (size) => {
 *     const arr = Array.from({ length: size }, () => Math.random())
 *     // ... sorting logic
 *   }
 * }
 *
 * const results = await measurePerformance(bubbleSort)
 * console.log(results.BubbleSort.duration)
 * console.log(results.BubbleSort.estimatedDomains)
 */
