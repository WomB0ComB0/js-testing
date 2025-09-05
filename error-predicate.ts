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

// Safe Error wrapper that won't trigger runtime errors
class SafeError implements Error {
	name: string = "Error";
	message: string;
	stack?: string;

	constructor(message: string = "") {
		this.message = message;
		this.stack = new Error().stack;
	}

	toString() {
		return `${this.name}: ${this.message}`;
	}
}

// Extend Error detection to include SafeError
declare global {
	interface ErrorConstructor {
		isError(value: any): value is Error;
	}
}

Error.isError = (value: any): value is Error => {
	return (
		value instanceof Error ||
		value instanceof SafeError ||
		(value &&
			typeof value === "object" &&
			"name" in value &&
			"message" in value &&
			typeof value.message === "string")
	);
};

const error = <I, O>(
	e: I,
	fn?: (error: I, ...args: any[]) => O,
	...opts: any[]
): I | O => {
	const isError = Error.isError(e);
	return isError ? (fn ? fn(e, ...opts) : e) : e;
};

(async () => {
	// Test 1: Passing a SafeError object, no fn
	console.log("Test 1:", error(new SafeError("Something went wrong")));

	// Test 2: Passing a SafeError object, with fn
	const fn = (err: SafeError) => `Handled: ${err.message}`;
	console.log(
		"Test 2:",
		error<SafeError, string>(new SafeError("Something went wrong"), fn),
	);

	// Test 3: Passing a non-error value
	const notError = "Just a string";
	console.log("Test 3:", error(notError));

	// Test 4: Passing a non-error value with fn
	console.log("Test 4:", error(notError));

	// Test 5: Passing a SafeError object with fn and extra opts
	const fnWithOpts = (err: SafeError, prefix: string) =>
		`${prefix}: ${err.message}`;
	console.log(
		"Test 5:",
		error<SafeError, string>(
			new SafeError("Something went wrong"),
			fnWithOpts,
			"Oops",
		),
	);

	// Test 6: Still works with actual Error objects
	try {
		throw new Error("Real error");
	} catch (e) {
		console.log(
			"Test 6:",
			error(e as Error, (err) => `Caught: ${err.message}`),
		);
	}

	// Test 7: Fetch example with SafeError
	try {
		const response = await Bun.fetch(`https://example.com`);
		const data = await response.json();
		console.log("Fetched successfully");
	} catch (e) {
		console.log(`Test 7: Error predicate`);
		const safeError = new SafeError(`${e}`);
		const result = error(safeError, (err) => err.message ?? String(err));
		console.log("Result:", result);
	}
})();

const isJson = <V>(value: V): value is V => {
	return typeof value === "object";
};
