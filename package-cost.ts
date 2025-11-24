#!/usr/bin/env bun
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

// -*- typescript -*-

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageJson } from "type-fest";

const packageJsonPath = join(process.cwd(), "package.json");
const packageJson = JSON.parse(
	readFileSync(packageJsonPath, "utf-8"),
) as PackageJson;
const dependencies = Object.keys(packageJson.dependencies || {});
const devDependencies = Object.keys(packageJson.devDependencies || {});
const allDependencies = [...dependencies, ...devDependencies];
const OUTPUT_DIR = `${process.cwd()}/out`;

const getPackageSize = (
	packageName: string,
): { name: string; size: number } | null => {
	try {
		const result = execSync(
			`npm view ${packageName} dist.unpackedSize --json`,
			{
				encoding: "utf-8",
			},
		);
		const size = JSON.parse(result) as number;
		return {
			name: packageName,
			size: size,
		};
	} catch (error) {
		console.error(
			`Failed to get size for ${packageName}:`,
			error instanceof Error ? error.message : error,
		);
		return null;
	}
};

const isNotNull = <Value>(value: Value): value is Exclude<Value, null> => {
	return value !== null;
};

const packageSizes = allDependencies
	.map((packageName) => getPackageSize(packageName))
	.filter(Boolean)
	.filter(isNotNull);

const sortedPackageSizes = packageSizes.sort((a, b) => b.size - a.size);

// Categorize packages by size
const LOW_THRESHOLD = 1_000_000; // 1 MB
const MEDIUM_THRESHOLD = 10_000_000; // 10 MB

const categorizedPackages = {
	high: sortedPackageSizes.filter((pkg) => pkg.size > MEDIUM_THRESHOLD),
	medium: sortedPackageSizes.filter(
		(pkg) => pkg.size > LOW_THRESHOLD && pkg.size <= MEDIUM_THRESHOLD,
	),
	low: sortedPackageSizes.filter((pkg) => pkg.size <= LOW_THRESHOLD),
};

// Ensure output directory exists
try {
	mkdirSync(OUTPUT_DIR, { recursive: true });
} catch (e) {
	// Ignore error if directory already exists
}

writeFileSync(
	`${OUTPUT_DIR}/package-sizes.json`,
	JSON.stringify(sortedPackageSizes, null, 2),
	{
		flag: "w",
	},
);

writeFileSync(
	`${OUTPUT_DIR}/package-sizes-categorized.json`,
	JSON.stringify(categorizedPackages, null, 2),
	{
		flag: "w",
	},
);

// Log summary
console.log("\n📦 Package Size Summary:");
console.log(
	`   🔴 High (> 10 MB): ${categorizedPackages.high.length} packages`,
);
console.log(
	`   🟡 Medium (1-10 MB): ${categorizedPackages.medium.length} packages`,
);
console.log(`   🟢 Low (< 1 MB): ${categorizedPackages.low.length} packages`);
console.log(
	`\n📊 Total size: ${(sortedPackageSizes.reduce((sum, pkg) => sum + pkg.size, 0) / 1_000_000).toFixed(2)} MB`,
);
console.log(
	`\n📄 Results saved to ${OUTPUT_DIR}/package-sizes-categorized.json`,
);
