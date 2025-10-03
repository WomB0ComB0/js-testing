#!/usr/bin/env node
// -*- typescript -*-
// @ts-check
'use strict'

/**
 * @file This script automates the process of reorganizing project files.
 * @author Jane Doe
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const main = async () => {
  console.log('Starting the script...');
  // --- Your logic here ---
}
export default main;

const shutdown = async () => {
  console.log('Shutting down the script...');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('Script failed with an error:', err);
  shutdown();
});