import FireCrawlApp from '@mendable/firecrawl-js';
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('fire-crawl')
  .description('CLI tool for crawling websites using FireCrawl')
  .version('1.0.0');

program
  .command('crawl')
  .description('Crawl a website and map its structure')
  .requiredOption('-u, --url <url>', 'URL to crawl')
  .option('-s, --subdomains', 'Include subdomains', false)
  .option('-i, --ignore-sitemap', 'Ignore sitemap.xml', false)
  .option('-d, --max-depth <depth>', 'Maximum crawl depth', '10')
  .option('-c, --concurrency <number>', 'Number of concurrent requests', '5')
  .option('--ignore-files <extensions>', 'Comma-separated list of file extensions to ignore', 'js,css,txt,pdf,png,jpg,jpeg,gif,svg')
  .option('--ignore-paths <paths>', 'Comma-separated list of paths to ignore')
  .option('-o, --output <format>', 'Output format (json, console, or csv)', 'console')
  .option('-f, --output-file <filename>', 'Output file name (when using json or csv output)')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--timeout <seconds>', 'Request timeout in seconds', '30')
  .option('--retry <count>', 'Number of retries for failed requests', '3')
  .option('--respect-robots', 'Respect robots.txt rules', false)
  .option('--user-agent <agent>', 'Custom user agent string')
  .option('--summary', 'Show summary statistics only', false)
  .option('--filter-status <codes>', 'Filter results by status code (e.g., 200,404)', '')
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

      // Validate URL format
      try {
        new URL(options.url);
      } catch (e) {
        spinner.fail('Invalid URL');
        console.error(chalk.red(`Invalid URL format: ${options.url}`));
        process.exit(1);
      }

      // Validate numeric inputs
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
      
      // Prepare ignore patterns for file extensions
      const ignoreFileExtensions = options.ignoreFiles.split(',').map((ext: string) => ext.trim());
      const ignoreFilePatterns = ignoreFileExtensions.map((ext: string) => `*.${ext}`);
      
      // Prepare ignore paths if provided
      const ignorePaths = options.ignorePaths ? options.ignorePaths.split(',').map((path: string) => path.trim()) : [];
      
      // Build the configuration object
      const config = {
        includeSubdomains: options.subdomains,
        ignoreSitemap: options.ignoreSitemap,
        maxDepth: numericOptions.maxDepth,
        concurrency: numericOptions.concurrency,
        ignorePatterns: [...ignoreFilePatterns, ...ignorePaths],
        timeout: numericOptions.timeout * 1000, // Convert to milliseconds
        retryCount: numericOptions.retry,
        respectRobotsTxt: options.respectRobots,
        userAgent: options.userAgent || 'FireCrawl-CLI/1.0.0'
      };
      
      console.log(chalk.cyan('Starting crawl of ') + chalk.bold(options.url) + chalk.cyan(' with the following configuration:'));
      console.log(chalk.gray(JSON.stringify(config, null, 2)));
      
      if (options.verbose) {
        console.log(chalk.gray("API Key (first few chars): ") + chalk.dim(apiKey.substring(0, 5) + "..."));
      }
      
      // Execute the crawl
      const startTime = Date.now();
      const mapResult = await app.mapUrl(options.url, config);
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      spinner.succeed(`Crawl completed in ${duration} seconds`);
      
      // Check if the response was successful
      if (!mapResult.success) {
        console.error(chalk.red(`Crawl failed: ${mapResult.error || 'Unknown error'}`));
        process.exit(1);
      }
      
      // Filter results if requested
      let links = mapResult.links || [];
      if (options.filterStatus) {
        // Note: We may need to adjust filtering based on actual link structure
        const statusCodes = options.filterStatus.split(',').map((s: string) => parseInt(s.trim()));
        // This filtering logic may need to be updated based on actual link structure
      }
      
      // Generate summary statistics if needed
      const totalLinks = links.length;
      
      // Display summary if requested
      if (options.summary || options.verbose) {
        console.log(chalk.green('\nCrawl Summary:'));
        console.log(chalk.white(`Total links found: ${totalLinks}`));
        
        // Additional summary logic would go here
      }
      
      // Handle output based on format option
      if (options.output === 'json' && options.outputFile) {
        // Ensure directory exists
        const dir = path.dirname(options.outputFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        await Bun.write(options.outputFile, JSON.stringify(links, null, 2));
        console.log(chalk.green(`Results saved to ${options.outputFile}`));
      } else if (options.output === 'csv' && options.outputFile) {
        // Create CSV output - adjust based on actual link structure
        const csvContent = links.join('\n');
        
        // Ensure directory exists
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
          console.error(chalk.red(`  Response data: ${JSON.stringify(response.data || 'No data')}`));
        }
        
        if (options.verbose && error.stack) {
          console.error(chalk.gray('\nStack trace:'));
          console.error(chalk.gray(error.stack));
        }
      } else {
        console.error(chalk.red(String(error)));
      }
      
      process.exit(1);
    }
  });

// Add a validate command to check API key and configuration
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
      
      // Use mapUrl with minimal parameters to validate the API key
      try {
        // Make a simple request to validate the API key
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

// Add a setup command to help users create their .env file
program
  .command('setup')
  .description('Setup your environment configuration')
  .action(async () => {
    console.log(chalk.cyan('Setting up FireCrawl CLI'));
    
    // Check if .env exists
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
    
    // Create or update .env file
    await Bun.write('.env', `FIRECRAWL_API_KEY=${apiKey}\n`);
    console.log(chalk.green('.env file created successfully!'));
    console.log(chalk.cyan('You can now use the FireCrawl CLI.'));
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command is provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}