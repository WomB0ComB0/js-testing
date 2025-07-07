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
 * This script automates the process of adding secrets from a local .env file to a GitHub repository.
 * It uses the GitHub API to encrypt and store secrets securely using libsodium encryption.
 * 
 * @module github-secrets
 * 
 * How to run this script:
 * 
 * For npm:
 * 1. Install dependencies: npm install
 * 2. Run the script: node <filename>
 * 
 * For yarn:
 * 1. Install dependencies: yarn
 * 2. Run the script: yarn <filename>
 * 
 * For pnpm:
 * 1. Install dependencies: pnpm install
 * 2. Run the script: pnpm <filename>
 * 
 * For bun:
 * 1. Install dependencies: bun install
 * 2. Run the script: bun <filename>
 * 
 * @requires dotenv - For loading environment variables
 * @requires path - For resolving file paths
 * @requires @octokit/rest - GitHub API client
 * @requires libsodium-wrappers - For encryption
 * @requires fs - For file system operations
 * 
 * Note: Make sure you have a .env file in the root directory with the necessary environment variables:
 * - GITHUB_OWNER (optional): GitHub username/organization (defaults to 'WomB0ComB0')
 * - GITHUB_REPO (optional): Repository name (defaults to 'portfolio')
 * - Any other variables you want to add as secrets
 */

import { config, DotenvConfigOutput } from 'dotenv';
import { resolve } from 'node:path';
import { Octokit } from '@octokit/rest';
import sodium from 'libsodium-wrappers';
import fs from 'node:fs';

const envPath: string = resolve(process.cwd(), '.env');
const envConfig: DotenvConfigOutput = config({ path: envPath }) || (() => {
  throw new Error('Could not load .env file');
})();

const API_KEY = ''! as string

if (!(typeof API_KEY === 'string')) { 
  throw new Error('Invalid key')
}

const octokit = new Octokit({ auth: API_KEY });

/**
 * Adds or updates a secret in a GitHub repository.
 * The secret is encrypted using libsodium before being sent to GitHub.
 * 
 * @async
 * @param {Object} params - The parameters for adding a secret
 * @param {string} params.owner - The GitHub repository owner (username or organization)
 * @param {string} params.repo - The repository name
 * @param {string} params.secretName - The name of the secret to add/update
 * @param {string} params.secretValue - The value of the secret
 * @returns {Promise<void>}
 * @throws {Error} If there's an issue with the GitHub API or encryption process
 */
async function addSecret({ owner, repo, secretName, secretValue }:{
  owner: string;
  repo: string;
  secretName: string;
  secretValue: string;
}): Promise<void> {
  try {
    // Get the public key for the repository
    const { data: publicKey } = await octokit.actions.getRepoPublicKey({
      owner,
      repo,
    });

    // Encrypt the secret using libsodium
    await sodium.ready;
    const binKey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    const binValue = sodium.from_string(secretValue);
    const encBytes = sodium.crypto_box_seal(binValue, binKey);
    const encrypted = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

    // Create or update the secret in the GitHub repository
    await octokit.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value: encrypted,
      key_id: publicKey.key_id,
    });

    console.log(`Secret ${secretName} added successfully.`);
  } catch (error) {
    console.error(`Error adding secret ${secretName}:`, error);
  }
}

/**
 * Main function that reads the .env file and adds each variable as a secret to GitHub.
 * 
 * @async
 * @returns {Promise<void>}
 * @throws {Error} If the .env file cannot be read or parsed
 */
async function main(): Promise<void> {
  const owner = process.env.GITHUB_OWNER as string || 'WomB0ComB0';
  const repo = process.env.GITHUB_REPO as string || 'portfolio';

  // Read and parse the .env file manually
  const envFileContent = fs.readFileSync(envPath, 'utf-8');
  const envVariables = envFileContent
    .split('\n')
    .filter((line: any) => line.trim() && !line.startsWith('#')) // Filter out empty lines and comments
    .reduce((acc: any, line: any) => {
      const [key, value] = line.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {});

  for (const [key, value] of Object.entries(envVariables)) {
    await addSecret({ owner, repo, secretName: key, secretValue: value as string });
  }
}

main().catch(console.error);
