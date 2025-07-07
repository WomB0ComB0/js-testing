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

import { env, argv, $ } from 'bun';
import { Logger } from './logger.js';
import { Octokit } from '@octokit/rest';

function selfExecute<T extends { new(...args: any[]): {} }>(constructor: T): T {
  new constructor();
  return constructor;
}

type Result<T, E extends BaseError = BaseError> = { success: true, result: T } | { success: false, error: E };

class BaseError extends Error {
  public readonly context?: Record<string, unknown>;

  constructor(message: string, options: { cause?: Error; context?: Record<string, unknown> } = {}) {
    const { cause, context } = options;
    super(message, { cause });
    this.name = this.constructor.name;
    this.context = context;
  }
}

class GitError extends BaseError {
  constructor(message: string, options?: { cause?: Error; context?: Record<string, unknown> }) {
    super(message, options);
  }
}

function ensureError(value: unknown): Error {
  if (value instanceof Error) return value;

  let stringified = '[Unable to stringify the thrown value]';
  try {
    stringified = JSON.stringify(value);
  } catch {}

  return new Error(`This value was thrown as is, not through an Error: ${stringified}`);
}

@selfExecute
class Main {
  private octokit: Octokit;
  private args: [string, ...string[]] = argv.slice(2) as [string, ...string[]];
  private logger: Logger;
  private readonly lfsExtensions = [
    '*.7z', '*.br', '*.gz', '*.tar', '*.zip',  // Archives
    '*.pdf',  // Documents
    '*.gif', '*.ico', '*.jpg', '*.png', '*.psd', '*.webp',  // Images
    '*.woff2',  // Fonts
    '*.exe'  // Executables
  ];

  constructor() {
    this.logger = new Logger('TerminalGit');
    if (!env.GITHUB_TOKEN) {
      throw new GitError('GITHUB_TOKEN environment variable is required');
    }
    
    this.octokit = new Octokit({ auth: env.GITHUB_TOKEN });

    if (this.args.length < 2) {
      throw new GitError('Owner and repo arguments are required');
    }

    if (require.main === module) {
      this.run();
    } else {
      this.logger.info('This script is not meant to be imported');
    }
  }

  private async initLFS(o: string, r: string): Promise<Result<void>> {
    try {
      // Create .gitattributes content
      const gitattributes = [
        '# Set default behavior to automatically normalize line endings.',
        '* text=auto',
        '',
        '# Force batch scripts to always use CRLF line endings',
        '*.{cmd,[cC][mM][dD]} text eol=crlf',
        '*.{bat,[bB][aA][tT]} text eol=crlf',
        '',
        '# Force bash scripts to always use LF line endings',
        '*.sh text eol=lf',
        '',
        '# Git LFS',
        ...this.lfsExtensions.map(ext => `${ext} filter=lfs diff=lfs merge=lfs -text`)
      ].join('\n');

      await this.octokit.repos.createOrUpdateFileContents({
        owner: o,
        repo: r,
        path: '.gitattributes',
        message: 'Initialize Git LFS configuration',
        content: Buffer.from(gitattributes).toString('base64')
      });

      this.logger.info('Initialized Git LFS configuration');
      return { success: true, result: undefined };
    } catch (err) {
      const error = ensureError(err);
      return {
        success: false,
        error: new GitError('Failed to initialize Git LFS', {
          cause: error,
          context: { owner: o, repo: r }
        })
      };
    }
  }

  async run(): Promise<Result<void>> {
    /*
     * o: owner
     * r: repo
     * p: path
     * f: file
     * --init: initialize LFS
     * --batch: batch upload mode
    */
    const [o, r, p = '.', f = '', ...flags] = this.args;
    
    if (flags.includes('--init')) {
      return this.initLFS(o, r);
    }

    if (flags.includes('--batch')) {
      this.logger.info('Batch upload mode enabled');
      // List all matching files
      const files = await $`find ${p} -type f -name "${f || '*'}"`.text();
      const fileList = files.split('\n').filter(Boolean);
      
      for (const file of fileList) {
        await this.uploadFile(o, r, file);
      }
      return { success: true, result: undefined };
    }

    return this.uploadFile(o, r, `${p}/${f}`);
  }

  private async uploadFile(o: string, r: string, filepath: string): Promise<Result<void>> {
    try {
      const content = Buffer.from(await $`echo $(cat ${filepath})`.text()).toString('base64');
      
      if (!content) {
        return { 
          success: false, 
          error: new GitError('File not found', { context: { path: filepath } })
        };
      }

      const { data } = await this.octokit.repos.getContent({
        owner: o,
        repo: r,
        path: filepath,
      });

      await this.octokit.repos.createOrUpdateFileContents({
        owner: o,
        repo: r,
        path: filepath,
        content,
        message: `Update ${filepath}`,
        sha: (data as any).sha
      });

      this.logger.info(`Updated ${filepath}`);
      return { success: true, result: undefined };

    } catch (err) {
      const error = ensureError(err);

      if (error.message.includes('404')) {
        try {
          await this.octokit.repos.createOrUpdateFileContents({
            owner: o,
            repo: r,
            path: filepath,
            content: Buffer.from(await $`echo $(cat ${filepath})`.text()).toString('base64'),
            message: `Create ${filepath}`,
          });

          this.logger.info(`Created ${filepath}`);
          return { success: true, result: undefined };

        } catch (createErr) {
          const wrappedError = ensureError(createErr);
          return {
            success: false,
            error: new GitError('Failed to create file', {
              cause: wrappedError,
              context: { path: filepath, owner: o, repo: r }
            })
          };
        }
      }

      return {
        success: false,
        error: new GitError('Failed to update file', {
          cause: error,
          context: { path: filepath, owner: o, repo: r }
        })
      };
    }
  }
}