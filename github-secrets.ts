/**
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
 * Note: Make sure you have a .env file in the root directory with the necessary environment variables.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Octokit } from '@octokit/rest';
import sodium from 'libsodium-wrappers';
import fs from 'node:fs';

// Load .env file from the root directory
const envPath = resolve(process.cwd(), '.env');
const envConfig = config({ path: envPath });

if (envConfig.error) {
  throw new Error('Could not load .env file');
}

const API_KEY = ''! as string

if (!(typeof API_KEY === 'string')) { 
  throw new Error('Invalid key')
}

const octokit = new Octokit({ auth: API_KEY });

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
    await addSecret(owner, repo, key, value);
  }
}

main().catch(console.error);
