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

#!/usr/bin/env bun

/**
 * FireCrawl CLI
 * 
 * A command line interface for crawling websites using the FireCrawl service.
 * 
 * @module fire-crawl-cli
 */

import FireCrawlApp, { MapParams } from '@mendable/firecrawl-js';
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import fs from 'node:fs';
import fsPromises from 'fs/promises';
import path from 'node:path';
import ora from 'ora';
import chalk from 'chalk';

/**
 * Load environment variables from .env file
 */
dotenv.config();

const program = new Command();

program
  .name('fire-crawl')
  .description('CLI tool for crawling websites using FireCrawl')
  .version('1.0.0');

/**
 * Main crawl command
 * 
 * Crawls a website and maps its structure based on provided options.
 * 
 * Options:
 * - url: Required. The URL to crawl
 * - subdomains: Include subdomains in the crawl
 * - ignoreSitemap: Skip checking sitemap.xml
 * - maxDepth: Maximum depth to crawl (default: 10)
 * - concurrency: Number of concurrent requests (default: 5)
 * - output: Output format - json, console, or csv (default: console)
 * - outputFile: File to save results to when using json/csv output
 * - verbose: Enable detailed logging
 * - timeout: Request timeout in seconds (default: 30)
 * - retry: Number of retry attempts for failed requests (default: 3)
 * - respectRobots: Honor robots.txt rules
 * - userAgent: Custom user agent string
 * - summary: Show only summary statistics
 * - filterStatus: Filter results by HTTP status codes
 * - filterDepth: Filter to only include links one level deep
 */
program
  .command('crawl')
  .description('Crawl a website and map its structure')
  .requiredOption('-u, --url <url>', 'URL to crawl')
  .option('-s, --subdomains', 'Include subdomains', false)
  .option('-i, --ignore-sitemap', 'Ignore sitemap.xml', false)
  .option('-d, --max-depth <depth>', 'Maximum crawl depth', '10')
  .option('-c, --concurrency <number>', 'Number of concurrent requests', '5')
  .option('-o, --output <format>', 'Output format (json, console, or csv)', 'console')
  .option('-f, --output-file <filename>', 'Output file name (when using json or csv output)')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--timeout <seconds>', 'Request timeout in seconds', '30')
  .option('--retry <count>', 'Number of retries for failed requests', '3')
  .option('--respect-robots', 'Respect robots.txt rules', false)
  .option('--user-agent <agent>', 'Custom user agent string')
  .option('--summary', 'Show summary statistics only', false)
  .option('--filter-status <codes>', 'Filter results by status code (e.g., 200,404)', '')
  .option('--filter-depth <depth>', 'Filter links to only include those that are one sub-route deep', 'one')
  .action(async (options) => {
    const spinner = ora('Crawling in progress...').start();
    
    try {
      const apiKey = process.env.FIRECRAWL_API_KEY;
      
      if (!apiKey) {
        spinner.fail('API key not found');
        console.error(chalk.red('Error: FIRECRAWL_API_KEY environment variable is not set'));
        console.log(chalk.yellow('Set it by creating a .env file with FIRECRAWL_API_KEY=your_key or export it in your shell'));
        process.exit(1);
      }

      try {
        new URL(options.url);
      } catch (e) {
        spinner.fail('Invalid URL');
        console.error(chalk.red(`Invalid URL format: ${options.url}`));
        process.exit(1);
      }

      const numericOptions = {
        maxDepth: parseInt(options.maxDepth), 
        concurrency: parseInt(options.concurrency),
        timeout: parseInt(options.timeout),
        retry: parseInt(options.retry)
      };
      
      for (const [key, value] of Object.entries(numericOptions)) {
        if (isNaN(value) || value < 0) {
          spinner.fail('Invalid parameter');
          console.error(chalk.red(`Invalid ${key} value: ${value}. Must be a positive number.`));
          process.exit(1);
        }
      }

      const app = new FireCrawlApp({ apiKey });
            
      const config: MapParams = {
        search: options.search,
        ignoreSitemap: options.ignoreSitemap,
        includeSubdomains: options.subdomains,
        sitemapOnly: options.sitemapOnly,
        limit: numericOptions.maxDepth > 0 ? numericOptions.maxDepth : undefined,
        timeout: options.timeout ? numericOptions.timeout * 1000 : undefined
      };
      
      console.log(chalk.cyan('Starting crawl of ') + chalk.bold(options.url) + chalk.cyan(' with the following configuration:'));
      console.log(chalk.gray(JSON.stringify(config, null, 2)));
      
      if (options.verbose) {
        console.log(chalk.gray("API Key (first few chars): ") + chalk.dim(apiKey.substring(0, 5) + "..."));
      }
      
      if (options.respectRobots && options.verbose) {
        try {
          const urlObj = new URL(options.url);
          const robotsUrl = `${urlObj.protocol}//${urlObj.hostname}/robots.txt`;
          console.log(chalk.yellow(`Checking robots.txt at ${robotsUrl}...`));
          
          const response = await fetch(robotsUrl);
          if (response.ok) {
            const robotsTxt = await response.text();
            console.log(chalk.gray('robots.txt content:'));
            console.log(chalk.gray(robotsTxt));
          } else {
            console.log(chalk.yellow(`Could not fetch robots.txt (status: ${response.status})`));
          }
        } catch (e) {
          console.log(chalk.yellow(`Error fetching robots.txt: ${e instanceof Error ? e.message : String(e)}`));
        }
      }
      
      const startTime = Date.now();
      spinner.text = 'Sending request to FireCrawl API...';
      
      if (options.verbose) {
        console.log(chalk.gray('Sending request to:'), chalk.dim(`${app.apiUrl}/map`));
      }
      
      const mapResult = await app.mapUrl(options.url, config);
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      spinner.succeed(`Crawl completed in ${duration} seconds`);
      
      if (!mapResult.success) {
        console.error(chalk.red(`Crawl failed: ${mapResult.error || 'Unknown error'}`));
        process.exit(1);
      }
      
      let links = mapResult.links || [];
      
      const totalLinks = links.length;
      
      if (options.filterDepth === 'one') {
        const baseUrl = new URL(options.url);
        const basePathSegments = baseUrl.pathname.split('/').filter(Boolean).length;
        
        links = links.filter(link => {
          try {
            const linkUrl = new URL(link);
            if (linkUrl.origin !== baseUrl.origin) return false;
            
            if (link === options.url || link === options.url + '/') return false;
            
            const path = linkUrl.pathname.endsWith('/') 
              ? linkUrl.pathname.slice(0, -1) 
              : linkUrl.pathname;
            
            const segments = path.split('/').filter(Boolean);
            
            return segments.length === basePathSegments + 1 && 
              path.startsWith(baseUrl.pathname === '/' ? '/' : baseUrl.pathname);
          } catch (e) {
            return false;
          }
        });
        
        console.log(chalk.cyan(`Filtered to ${links.length} links that are one level deep from ${options.url}`));
      }
      
      if (options.summary || options.verbose) {
        console.log(chalk.green('\nCrawl Summary:'));
        console.log(chalk.white(`Total links found: ${totalLinks}`));
        
        if (totalLinks > 0) {
          console.log(chalk.white(`First few links:`));
          links.slice(0, 5).forEach(link => {
            console.log(chalk.gray(`  - ${link}`));
          });
        }
      }
      
      if (options.output === 'json' && options.outputFile) {
        const dir = path.dirname(options.outputFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        await Bun.write(options.outputFile, JSON.stringify(links, null, 2));
        console.log(chalk.green(`Results saved to ${options.outputFile}`));
      } else if (options.output === 'csv' && options.outputFile) {
        const csvContent = links.join('\n');
        
        const dir = path.dirname(options.outputFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        await Bun.write(options.outputFile, csvContent);
        console.log(chalk.green(`CSV results saved to ${options.outputFile}`));
      } else if (!options.summary) {
        console.log(chalk.green('Crawl Results:'));
        console.log(JSON.stringify(links, null, 2));
      }
    } catch (error) {
      spinner.fail('Error during crawl');
      
      console.error(chalk.red('Error details:'));
      if (error instanceof Error) {
        console.error(chalk.red(`  Message: ${error.message}`));
        
        if ('response' in error && error.response) {
          const response = error.response as any;
          console.error(chalk.red(`  Status: ${response.status || 'Unknown'}`));
          console.error(chalk.red(`  Response data: ${JSON.stringify(response.data || 'No data', null, 2)}`));
          
          if (options.verbose) {
            console.error(chalk.gray('\nRequest details:'));
            if (error.response && typeof error.response === 'object' && 'config' in error.response) {
              const config = error.response.config as { url?: string; method?: string; headers?: Record<string, unknown>; data?: unknown };
              console.error(chalk.gray(`  URL: ${config.url || 'Unknown'}`));
              console.error(chalk.gray(`  Method: ${config.method?.toUpperCase() || 'Unknown'}`));
              console.error(chalk.gray(`  Headers: ${JSON.stringify(config.headers || {}, null, 2)}`));
              console.error(chalk.gray(`  Data: ${JSON.stringify(config.data || {}, null, 2)}`));
            }
          }
        }
        
        if (options.verbose && error.stack) {
          console.error(chalk.gray('\nStack trace:'));
          console.error(chalk.gray(error.stack));
        }
      } else {
        console.error(chalk.red(String(error)));
      }
      
      console.log(chalk.yellow('\nTroubleshooting tips:'));
      console.log(chalk.yellow('1. Check if the URL is accessible and not blocked by robots.txt'));
      console.log(chalk.yellow('2. Try with a simpler configuration (fewer options)'));
      console.log(chalk.yellow('3. Verify your API key with the "validate" command'));
      console.log(chalk.yellow('4. Try with a different website to rule out site-specific issues'));
      console.log(chalk.yellow('5. Check the FireCrawl API documentation for parameter requirements'));
      
      process.exit(1);
    }
  });

/**
 * Validate command
 * 
 * Validates the API key and configuration by making a test request.
 * Useful for verifying setup and connectivity.
 */
program
  .command('validate')
  .description('Validate your API key and configuration')
  .action(async () => {
    const spinner = ora('Validating API key').start();
    
    try {
      const apiKey = process.env.FIRECRAWL_API_KEY;
      
      if (!apiKey) {
        spinner.fail('No API key found');
        console.error(chalk.red('FIRECRAWL_API_KEY environment variable is not set'));
        process.exit(1);
      }
      
      const app = new FireCrawlApp({ apiKey });
      
      try {
        const result = await app.mapUrl('https://example.com', { 
          limit: 1 
        });
        
        if (result.success) {
          spinner.succeed('API key is valid');
          console.log(chalk.green('Connection to FireCrawl API successful'));
        } else {
          spinner.fail('API key validation failed');
          console.error(chalk.red(`Error: ${result.error || 'Unknown error'}`));
          process.exit(1);
        }
      } catch (error) {
        spinner.fail('API key validation failed');
        console.error(chalk.red('Error details:'));
        if (error instanceof Error) {
          console.error(chalk.red(`  Message: ${error.message}`));
        } else {
          console.error(chalk.red(String(error)));
        }
        process.exit(1);
      }
    } catch (error) {
      spinner.fail('Validation failed');
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

/**
 * Setup command
 * 
 * Interactive setup wizard that helps configure the environment.
 * Creates/updates .env file with API key.
 */
program
  .command('setup')
  .description('Setup your environment configuration')
  .action(async () => {
    console.log(chalk.cyan('Setting up FireCrawl CLI'));
    
    const envExists = fs.existsSync('.env');
    
    if (envExists) {
      console.log(chalk.yellow('A .env file already exists. Do you want to modify it? (y/n)'));
      const response = await new Promise<string>(resolve => {
        process.stdin.once('data', (data) => {
          resolve(data.toString().trim().toLowerCase());
        });
      });
      
      if (response !== 'y') {
        console.log(chalk.gray('Setup cancelled.'));
        process.exit(0);
      }
    }
    
    console.log(chalk.cyan('Please enter your FireCrawl API key:'));
    const apiKey = await new Promise<string>(resolve => {
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });
    
    if (!apiKey) {
      console.log(chalk.red('No API key provided. Setup cancelled.'));
      process.exit(1);
    }
    
    await Bun.write('.env', `FIRECRAWL_API_KEY=${apiKey}\n`);
    console.log(chalk.green('.env file created successfully!'));
    console.log(chalk.cyan('You can now use the FireCrawl CLI.'));
  });

if (require.main === module) {
  program.parse(process.argv);
  if (!process.argv.slice(2).length) program.outputHelp();
}
