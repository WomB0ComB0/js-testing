#!/usr/bin/env node

/**
 * Copyright 2025 Mike Odnis
 *
 * This script is a comprehensive tool to manage license headers in a source repository.
 * It has been optimized for performance by processing files in parallel and minimizing disk I/O.
 *
 * Features:
 * - Applies license headers to a wide variety of file types.
 * - Detects comment styles automatically.
 * - Finds files using git-ls-files (with a fallback to glob).
 * - Excludes files based on command-line arguments.
 * - Can overwrite existing headers with --force.
 * - Can check for missing headers with --check.
 * - Supports dry-runs to preview changes.
 */

// --- Imports ---
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { glob } from "glob";
import { minimatch } from "minimatch";
import kleur from "kleur";

// --- Types and Constants ---

type LicenseType = "apache-2.0" | "mit" | "gpl-3.0" | "bsd-3-clause";

const LICENSE_TEMPLATES = {
  "apache-2.0": (author: string, year: string) => `Copyright ${year} ${author}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,

  "mit": (author: string, year: string) => `Copyright (c) ${year} ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,

  "gpl-3.0": (author: string, year: string) => `Copyright (C) ${year} ${author}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.`,

  "bsd-3-clause": (author: string, year: string) => `Copyright (c) ${year}, ${author}
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
};

type CommentStyle =
  | { kind: "block"; open: string; line: string; close: string }
  | { kind: "line"; line: string };

interface FormatType {
  test: (path: string, content?: string) => boolean;
  style: CommentStyle;
  name: string;
}

const FORMAT_TYPES: FormatType[] = [
    { name: "JavaScript/TypeScript", test: p => /\.[cm]?[jt]sx?$/i.test(p), style: { kind: "block", open: "/**", line: " *", close: " */" } },
    { name: "CSS/SCSS/LESS", test: p => /\.(s?css|less|styl)$/i.test(p), style: { kind: "block", open: "/**", line: " *", close: " */" } },
    { name: "C-family/Java/Kotlin/Swift", test: p => /\.(c|cc|cpp|h|hpp|cs|java|kt|kts|swift|m|mm)$/i.test(p), style: { kind: "block", open: "/**", line: " *", close: " */" } },
    { name: "Go/Rust/PHP/Dart/Scala", test: p => /\.(go|rs|php|dart|scala|groovy|gradle)$/i.test(p), style: { kind: "block", open: "/**", line: " *", close: " */" } },
    { name: "HTML/XML/Markdown", test: p => /\.(html?|xml|xhtml|svg|md|rst|xsl|xslt)$/i.test(p), style: { kind: "block", open: "<!--", line: " ", close: "-->" } },
    { name: "AsciiDoc", test: p => /\.(adoc|asciidoc)$/i.test(p), style: { kind: "block", open: "////", line: "", close: "////" } },
    { name: "Shell/Python/Ruby/Perl", test: (p, c) => /\.(sh|bash|zsh|py[w3]?|rb|pl|pm)$/i.test(p) || /(^|\/)(Rakefile|Gemfile)$/i.test(p) || !!c?.startsWith("#!/"), style: { kind: "line", line: "#" } },
    { name: "Config/Makefile/Dockerfile", test: p => /\.(yml|yaml|toml|ini|cfg|conf|env|dotenv|mk|make)$/i.test(p) || /(^|\/)(Makefile|Dockerfile|\.env|\.gitignore|\.dockerignore)$/i.test(p), style: { kind: "line", line: "#" } },
    { name: "SQL/Lua/Haskell", test: p => /\.(sql|lua|hs)$/i.test(p), style: { kind: "line", line: "--" } },
];

const FALLBACK_EXCLUDES = [
	'**/.git/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/out/**', '**/.next/**', '**/coverage/**',
	'**/*.lock', '**/*.log', '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml',
] as const;

const HEADER_REGEX = /copyright\s*(\(c\)\s*)?\d{4}|SPDX-License-Identifier:/i;
const SHEBANG_REGEX = /^#![^\r\n]+/;

// --- Argument Parsing ---

interface Args {
  license: LicenseType;
  author: string;
  year: string;
  force: boolean;
  dryRun: boolean;
  check: boolean;
  verbose: boolean;
  help: boolean;
  glob: string[];
  ext: string[];
  exclude: string[];
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      license: { type: "string", short: "l", default: "mit" },
      author: { type: "string", short: "a", default: "Mike Odnis" },
      year: { type: "string", short: "y", default: new Date().getFullYear().toString() },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
      glob: { type: "string", multiple: true, default: [] },
      ext: { type: "string", default: "" },
      exclude: { type: "string", short: "e", multiple: true, default: [] },
    },
  });

  return {
    license: values.license as LicenseType,
    author: values.author!,
    year: values.year!,
    force: values.force!,
    dryRun: values["dry-run"]!,
    check: values.check!,
    verbose: values.verbose!,
    help: values.help!,
    glob: values.glob!,
    ext: values.ext!.split(",").map(e => e.trim().toLowerCase()).filter(Boolean),
    exclude: values.exclude!,
  };
}

function showHelp() {
  console.log(`
  Usage: copyright [options]

  A tool to apply license headers to source files.

  Options:
    -l, --license <type>    License type (apache-2.0, mit, etc.)
    -a, --author <name>     Author name for copyright
    -y, --year <year>       Copyright year
    --glob <pattern>        Glob pattern for files to process (can be used multiple times)
    --ext <extensions>      Comma-separated extensions to filter by (e.g., .ts,.js)
    -e, --exclude <pattern> Pattern to exclude files/folders (can be used multiple times)
    --force                 Overwrite existing license headers
    --dry-run               Show what would change without writing files
    --check                 Exit with an error if any files are missing headers
    -v, --verbose           Verbose output
    -h, --help              Show this help message
  `);
}

// --- File Discovery ---

function getGitFiles(): string[] {
  try {
    const stdout = execSync("git ls-files && git ls-files -o --exclude-standard", { encoding: "utf8" });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function findFilesToProcess(args: Args): Promise<string[]> {
  let files: string[];

  if (args.glob.length > 0) {
    if (args.verbose) console.log(kleur.gray(`  Searching with user-provided glob patterns...`));
    const ignore = [...FALLBACK_EXCLUDES, ...args.exclude];
    files = await glob(args.glob, { nodir: true, dot: true, ignore });
  } else {
    const gitFiles = getGitFiles();
    if (gitFiles.length > 0) {
      if (args.verbose) console.log(kleur.gray(`  Found ${gitFiles.length} files from git. Applying --exclude patterns...`));
      files = args.exclude.length > 0
        ? gitFiles.filter(file => !args.exclude.some(pattern => minimatch(file, pattern, { dot: true })))
        : gitFiles;
    } else {
      console.warn(kleur.yellow("Not a git repository. Falling back to scanning all files."));
      const ignore = [...FALLBACK_EXCLUDES, ...args.exclude];
      if (args.verbose) console.log(kleur.gray(`  Scanning all files with ${ignore.length} default ignore patterns...`));
      files = await glob("**/*", { nodir: true, dot: true, ignore });
    }
  }

  if (args.verbose) {
      console.log(kleur.gray(`  Found ${files.length} files after initial discovery and filtering.`));
  }

  if (args.ext.length > 0) {
    const extensions = new Set(args.ext.map(e => e.startsWith('.') ? e : `.${e}`));
    files = files.filter(file => extensions.has(extname(file).toLowerCase()));
    if (args.verbose) {
      console.log(kleur.gray(`  Found ${files.length} files after filtering by extension.`));
    }
  }

  return files;
}


// --- Header Logic ---

function buildHeader(style: CommentStyle, license: LicenseType, author: string, year: string): string {
  const body = LICENSE_TEMPLATES[license](author, year);
  const lines = body.split("\n");

  if (style.kind === "block") {
    const content = lines.map((l) => `${style.line} ${l}`.trimEnd()).join("\n");
    return `${style.open}\n${content}\n${style.close}\n\n`;
  } else {
    const content = lines.map((l) => `${style.line} ${l}`.trimEnd()).join("\n");
    return `${content}\n\n`;
  }
}

function getFormatStyle(path: string, content: string): CommentStyle | null {
    const format = FORMAT_TYPES.find((f) => f.test(path, content));
    return format?.style ?? null;
}

function hasHeader(content: string): boolean {
  const first20Lines = content.split("\n").slice(0, 20).join("\n");
  return HEADER_REGEX.test(first20Lines);
}

function prependHeader(content: string, header: string): string {
  const shebangMatch = content.match(SHEBANG_REGEX);
  if (shebangMatch) {
    const shebang = shebangMatch[0];
    const restOfContent = content.slice(shebang.length).trimStart();
    return `${shebang}\n${header}${restOfContent}`;
  }
  return header + content;
}

type ProcessResult = {
    status: 'updated' | 'skipped' | 'missing' | 'error';
    path: string;
}

// --- Main Execution ---

async function main() {
  const args = parseCliArgs();

  if (args.help) {
    showHelp();
    return;
  }

  console.log(kleur.bold().yellow(`Finding files...`));
  const files = await findFilesToProcess(args);

  if (files.length === 0) {
    console.log(kleur.gray("No files found to process."));
    return;
  }

  console.log(`Found ${files.length} files. Checking for license headers...`);
  if (args.dryRun) console.log(kleur.cyan().bold("\n[DRY RUN MODE]"));
  if (args.force) console.log(kleur.magenta().bold("[FORCE MODE] Overwriting existing headers."));

  // OPTIMIZATION: Process files in parallel
  const results: ProcessResult[] = await Promise.all(
    files.map(async (file): Promise<ProcessResult> => {
      try {
        // OPTIMIZATION: Read file only once
        const content = await readFile(file, "utf8");

        const style = getFormatStyle(file, content);
        if (!style) {
          if (args.verbose) console.log(kleur.gray(`- Skipping unsupported file: ${file}`));
          return { status: 'skipped', path: file };
        }

        if (hasHeader(content) && !args.force) {
          if (args.verbose) console.log(kleur.gray(`- Skipping (has header): ${file}`));
          return { status: 'skipped', path: file };
        }

        if (args.check) {
            return { status: 'missing', path: file };
        }

        const header = buildHeader(style, args.license, args.author, args.year);
        const newContent = prependHeader(content, header);

        if (args.dryRun) {
          console.log(kleur.green(`  + Would update: ${file}`));
          return { status: 'updated', path: file };
        }

        await writeFile(file, newContent, "utf8");
        if (args.verbose) console.log(kleur.green(`  + Updated: ${file}`));
        return { status: 'updated', path: file };

      } catch (err) {
        console.error(kleur.red(`\nError processing ${file}: ${err instanceof Error ? err.message : String(err)}`));
        return { status: 'error', path: file };
      }
    })
  );

  // Tally results
  const summary = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {} as Record<ProcessResult['status'], number>);
  
  const updated = summary.updated || 0;
  const skipped = summary.skipped || 0;
  const missing = summary.missing || 0;
  const errors = summary.error || 0;

  console.log(kleur.bold("\n--- Summary ---"));
  if (args.check) {
    if (missing > 0) {
      console.error(kleur.red(`❌ ${missing} files are missing license headers.`));
      process.exit(1);
    } else {
      console.log(kleur.green("✅ All files have license headers."));
    }
  } else {
    console.log(kleur.green(`Updated: ${updated}`));
    console.log(kleur.gray(`Skipped: ${skipped}`));
    if (errors > 0) console.log(kleur.red(`Errors: ${errors}`));
    console.log(`Total processed: ${results.length}`);
  }
}

main().catch((err) => {
  console.error(kleur.red("An unexpected fatal error occurred:"), err);
  process.exit(1);
});