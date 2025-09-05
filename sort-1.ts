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

/**
 * @file algorithms.ts
 * @fileoverview Contains implementations of various sorting algorithms with detailed performance analysis.
 * @module Algorithms
 * @author [Mike Odnis](https://github.com/WomB0ComB0)
 * @version 1.0.0
 * @license MIT
 * @description This class provides implementations of common sorting algorithms including:
 * - Bubble Sort: Simple comparison-based algorithm with O(n²) time complexity
 * - Selection Sort: In-place comparison sort with O(n²) time complexity
 * - Insertion Sort: Efficient for small data sets and nearly sorted arrays
 * Each algorithm is implemented with optimizations where possible and includes detailed
 * performance characteristics.
 */
export class Algorithms {
	/**
	 * The array to be sorted.
	 * @private
	 * @name _array
	 * @type {number[]}
	 * @description Stores the input array in a protected manner to prevent external modification.
	 * A copy is made during initialization to preserve the original array.
	 */
	private readonly _array: number[];

	/**
	 * Creates an instance of Algorithms with sorting methods.
	 * @constructor
	 * @param {number[]} array - The input array to be sorted
	 * @description Initializes a new instance with a deep copy of the input array.
	 * The original array remains unmodified throughout all sorting operations.
	 * @example
	 * ```typescript
	 * const sorter = new Algorithms([3, 1, 4, 1, 5, 9]);
	 * ```
	 */
	constructor(array: number[]) {
		this._array = [...array];
	}

	/**
	 * Swaps two elements in an array.
	 * @private
	 * @static
	 * @param {number[]} arr - The array containing elements to swap
	 * @param {number} i - First index
	 * @param {number} j - Second index
	 * @throws {Error} If indices are out of bounds
	 * @description Performs an in-place swap of two elements using destructuring assignment.
	 * Includes bounds checking to prevent array access errors.
	 * @example
	 * ```typescript
	 * Algorithms.swap([1, 2], 0, 1); // [2, 1]
	 * ```
	 */
	private static swap(arr: number[], i: number, j: number): void {
		if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) {
			throw new Error("Swap indices out of array bounds");
		}
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}

	/**
	 * Performs Bubble Sort with optimized early termination.
	 * @static
	 * @param {number[]} arr - Array to be sorted
	 * @returns {number[]} Sorted array
	 * @description
	 * Implements bubble sort with the following characteristics:
	 * - Time Complexity: O(n²) worst and average case, O(n) best case
	 * - Space Complexity: O(1)
	 * - Stable: Yes
	 * - In-place: Yes
	 *
	 * Optimizations:
	 * - Early termination if no swaps occur in a pass
	 * - Reduces the inner loop range by i each iteration
	 *
	 * Best used for:
	 * - Small datasets
	 * - Nearly sorted arrays
	 * - Educational purposes
	 *
	 * @example
	 * ```typescript
	 * Algorithms.bubbleSort([64, 34, 25, 12, 22, 11, 90]);
	 * // returns [11, 12, 22, 25, 34, 64, 90]
	 * ```
	 */
	public static bubbleSort(arr: number[]): number[] {
		if (!arr || arr.length <= 1) return arr;

		const n = arr.length;
		for (let i = 0; i < n - 1; i++) {
			let swapped = false;

			for (let j = 0; j < n - i - 1; j++) {
				if (arr[j] > arr[j + 1]) {
					Algorithms.swap(arr, j, j + 1);
					swapped = true;
				}
			}

			if (!swapped) break;
		}
		return arr;
	}

	/**
	 * Performs Selection Sort.
	 * @static
	 * @param {number[]} arr - Array to be sorted
	 * @param {number} [size] - Optional size parameter (defaults to full array length)
	 * @returns {number[]} Sorted array
	 * @description
	 * Implements selection sort with the following characteristics:
	 * - Time Complexity: O(n²) for all cases
	 * - Space Complexity: O(1)
	 * - Stable: No
	 * - In-place: Yes
	 *
	 * Algorithm steps:
	 * 1. Find minimum element in unsorted portion
	 * 2. Swap with first unsorted position
	 * 3. Repeat until array is sorted
	 *
	 * Best used for:
	 * - Small arrays
	 * - Arrays with large elements but small keys
	 * - When memory is limited
	 *
	 * @example
	 * ```typescript
	 * Algorithms.selectionSort([64, 25, 12, 22, 11]);
	 * // returns [11, 12, 22, 25, 64]
	 * ```
	 */
	public static selectionSort(arr: number[], size?: number): number[] {
		if (!arr || arr.length <= 1) return arr;

		const n = size ?? arr.length;

		for (let i = 0; i < n - 1; i++) {
			let minIndex = i;

			for (let j = i + 1; j < n; j++) {
				if (arr[j] < arr[minIndex]) {
					minIndex = j;
				}
			}

			if (minIndex !== i) {
				Algorithms.swap(arr, i, minIndex);
			}
		}
		return arr;
	}

	/**
	 * Performs Insertion Sort.
	 * @static
	 * @param {number[]} arr - Array to be sorted
	 * @returns {number[]} Sorted array
	 * @description
	 * Implements insertion sort with the following characteristics:
	 * - Time Complexity: O(n²) worst/average case, O(n) best case
	 * - Space Complexity: O(1)
	 * - Stable: Yes
	 * - In-place: Yes
	 *
	 * Key features:
	 * - Efficient for small data sets
	 * - Adaptive: O(n) when nearly sorted
	 * - Online: can sort as data arrives
	 *
	 * Best used for:
	 * - Small datasets
	 * - Nearly sorted arrays
	 * - Online/streaming data
	 * - When stable sort is required
	 *
	 * @example
	 * ```typescript
	 * Algorithms.insertionSort([5, 2, 4, 6, 1, 3]);
	 * // returns [1, 2, 3, 4, 5, 6]
	 * ```
	 */
	public static insertionSort(arr: number[]): number[] {
		if (!arr || arr.length <= 1) return arr;

		const n = arr.length;

		for (let i = 1; i < n; i++) {
			const key = arr[i];
			let j = i - 1;

			while (j >= 0 && arr[j] > key) {
				arr[j + 1] = arr[j];
				j--;
			}

			arr[j + 1] = key;
		}
		return arr;
	}

	/**
	 * Provides a method to sort the instance's array using a specified sorting algorithm.
	 * @param {'bubble' | 'selection' | 'insertion'} [method='bubble'] - The sorting method to use
	 * @returns {number[]} Sorted array
	 * @description
	 * Factory method that provides a unified interface to all sorting algorithms.
	 * Creates a copy of the internal array before sorting to maintain immutability.
	 *
	 * Available methods:
	 * - 'bubble': Bubble sort, good for nearly sorted arrays
	 * - 'selection': Selection sort, minimizes swaps
	 * - 'insertion': Insertion sort, efficient for small arrays
	 *
	 * @example
	 * ```typescript
	 * const sorter = new Algorithms([3, 1, 4, 1, 5, 9]);
	 * const sorted = sorter.sort('insertion');
	 * ```
	 */
	public sort(
		method: "bubble" | "selection" | "insertion" = "bubble",
	): number[] {
		const arrayCopy = [...this._array];

		switch (method) {
			case "bubble":
				return Algorithms.bubbleSort(arrayCopy);
			case "selection":
				return Algorithms.selectionSort(arrayCopy);
			case "insertion":
				return Algorithms.insertionSort(arrayCopy);
		}
	}

	/**
	 * Compares performance of different sorting algorithms.
	 * @returns {Record<string, number>} Performance metrics for each sorting method
	 * @description
	 * Benchmarks all available sorting algorithms using performance.now().
	 * Returns an object containing execution times in milliseconds for each method.
	 *
	 * Measured algorithms:
	 * - Bubble Sort
	 * - Selection Sort
	 * - Insertion Sort
	 *
	 * Note: Results may vary based on:
	 * - Input size
	 * - Input distribution
	 * - System performance
	 * - Current CPU load
	 *
	 * @example
	 * ```typescript
	 * const sorter = new Algorithms([]);
	 * const metrics = sorter.comparePerformance();
	 * console.log(metrics);
	 * // Output: { bubble: 0.5, selection: 0.3, insertion: 0.4 }
	 * ```
	 */
	public comparePerformance(): Record<string, number> {
		const methods = ["bubble", "selection", "insertion"] as const;
		const results: Record<string, number> = {};

		methods.forEach((method) => {
			const start = performance.now();
			this.sort(method);
			const end = performance.now();
			results[method] = end - start;
		});

		return results;
	}
}
