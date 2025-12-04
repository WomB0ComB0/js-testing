import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

/**
 * Represents a job listing parsed from GitHub repositories.
 * Contains all relevant information about a job posting including company, role, and application details.
 */
interface JobListing {
  /** Company name offering the position */
  company: string;
  /** Job role/title */
  role: string;
  /** Job location(s) - filtered to US only */
  location: string;
  /** Employment terms (e.g., "Spring 2026", "Fall 2025") or "N/A" if not specified */
  terms: string;
  /** Direct link to the job application */
  applicationLink: string;
  /** Age of the posting (e.g., "5d", "2mo") */
  age: string;
  /** ISO timestamp when the job was added to our database */
  dateAdded: string;
  /** Source URL where this job was found */
  source: string;
}

/**
 * Tracks which job applications have been processed to prevent duplicates.
 * Uses a Set for O(1) lookup performance.
 */
interface ProcessedJobsData {
  /** Set of application links that have already been processed */
  processedLinks: Set<string>;
  /** ISO timestamp of the last update */
  lastUpdated: string;
  /** Total count of processed jobs */
  totalProcessed: number;
}

/**
 * Main database structure for storing job listings.
 * Separates unprocessed jobs from processed ones for efficient workflow management.
 */
interface JobsDatabase {
  /** Array of jobs that haven't been reviewed/applied to yet */
  unprocessed: JobListing[];
  /** Array of application links that have been processed */
  processed: string[];
  /** Metadata about data sources */
  sources: {
    /** Last update info for Summer 2026 internships */
    summer2026Internships: string;
    /** Last update info for new grad positions */
    newGrad: string;
    /** Last update info for off-season internships */
    offSeason: string;
  };
}

/**
 * Application configuration constants.
 * Controls batch sizes, file paths, data sources, and filtering criteria.
 */
const CONFIG = {
  BATCH_SIZE: 5,
  DATA_DIR: "./job-data",
  JOBS_FILE: "./job-data/jobs.json",
  PROCESSED_FILE: "./job-data/processed.json",
  GITHUB_SOURCES: [
    {
      name: "summer2026Internships",
      url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md",
      displayUrl: "https://github.com/SimplifyJobs/Summer2026-Internships/blob/dev/README.md",
      type: "internship" as const,
    },
    {
      name: "newGrad",
      url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
      displayUrl: "https://github.com/SimplifyJobs/New-Grad-Positions",
      type: "newgrad" as const,
    },
    {
      name: "offSeason",
      url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README-Off-Season.md",
      displayUrl: "https://github.com/SimplifyJobs/Summer2026-Internships/blob/dev/README-Off-Season.md",
      type: "internship" as const,
    },
  ],
  MAX_AGE_DAYS: 30,
} as const;

/**
 * Initializes the data directory if it doesn't exist.
 * Creates the directory structure needed for storing job data.
 * 
 * @returns Promise that resolves when directory is created or already exists
 */
async function initializeDataDirectory(): Promise<void> {
  if (!existsSync(CONFIG.DATA_DIR)) {
    await mkdir(CONFIG.DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${CONFIG.DATA_DIR}`);
  }
}

/**
 * Loads the list of previously processed job applications from disk.
 * Returns a fresh data structure if the file doesn't exist or can't be read.
 * 
 * @returns Promise resolving to ProcessedJobsData with Set of processed links
 */
async function loadProcessedJobs(): Promise<ProcessedJobsData> {
  try {
    if (existsSync(CONFIG.PROCESSED_FILE)) {
      const data = await readFile(CONFIG.PROCESSED_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return {
        processedLinks: new Set(parsed.processedLinks || []),
        lastUpdated: parsed.lastUpdated || new Date().toISOString(),
        totalProcessed: parsed.totalProcessed || 0,
      };
    }
  } catch (error) {
    console.warn("Could not load processed jobs, starting fresh");
  }

  return {
    processedLinks: new Set(),
    lastUpdated: new Date().toISOString(),
    totalProcessed: 0,
  };
}

/**
 * Persists processed jobs data to disk.
 * Converts Set to Array for JSON serialization.
 * 
 * @param data - The processed jobs data to save
 * @returns Promise that resolves when data is written to disk
 */
async function saveProcessedJobs(data: ProcessedJobsData): Promise<void> {
  const serializable = {
    processedLinks: Array.from(data.processedLinks),
    lastUpdated: new Date().toISOString(),
    totalProcessed: data.totalProcessed,
  };

  await writeFile(
    CONFIG.PROCESSED_FILE,
    JSON.stringify(serializable, null, 2),
    "utf-8"
  );
  console.log(`Saved ${data.totalProcessed} processed jobs to ${CONFIG.PROCESSED_FILE}`);
}

/**
 * Loads the main jobs database from disk.
 * Returns an empty database structure if file doesn't exist or can't be read.
 * 
 * @returns Promise resolving to JobsDatabase with unprocessed and processed jobs
 */
async function loadJobsDatabase(): Promise<JobsDatabase> {
  try {
    if (existsSync(CONFIG.JOBS_FILE)) {
      const data = await readFile(CONFIG.JOBS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("Could not load jobs database, starting fresh");
  }

  return {
    unprocessed: [],
    processed: [],
    sources: {
      summer2026Internships: "",
      newGrad: "",
      offSeason: "",
    },
  };
}

/**
 * Persists the jobs database to disk.
 * 
 * @param db - The jobs database to save
 * @returns Promise that resolves when database is written to disk
 */
async function saveJobsDatabase(db: JobsDatabase): Promise<void> {
  await writeFile(CONFIG.JOBS_FILE, JSON.stringify(db, null, 2), "utf-8");
  console.log(`Saved ${db.unprocessed.length} unprocessed jobs to ${CONFIG.JOBS_FILE}`);
}

/**
 * Parses age text like "5d", "2mo", "1w" into number of days.
 * Used to filter out jobs older than MAX_AGE_DAYS.
 * 
 * @param ageText - Age string from job posting (e.g., "5d", "2mo", "1w")
 * @returns Number of days, or null if unable to parse
 * 
 * @example
 * parseAgeInDays("5d")   // returns 5
 * parseAgeInDays("2mo")  // returns 60
 * parseAgeInDays("1w")   // returns 7
 */
function parseAgeInDays(ageText: string): number | null {
  const trimmed = ageText.trim().toLowerCase();
  
  // Match patterns like "5d", "2mo", "1w"
  const match = trimmed.match(/(\d+)\s*(d|day|days|mo|month|months|w|week|weeks)/i);
  
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  if (unit.startsWith('d')) {
    return value;
  } else if (unit.startsWith('mo')) {
    return value * 30;
  } else if (unit.startsWith('w')) {
    return value * 7;
  }
  
  return null;
}

/**
 * Determines if a location string represents a US location.
 * Checks for US state abbreviations, common US patterns, and excludes non-US countries.
 * 
 * @param location - Location string from job posting
 * @returns true if location is in the US, false otherwise
 * 
 * @example
 * isUSLocation("New York, NY")           // true
 * isUSLocation("Remote - USA")           // true
 * isUSLocation("London, UK")             // false
 * isUSLocation("Toronto, Canada")        // false
 */
function isUSLocation(location: string): boolean {
  // US state abbreviations (includes DC and territories)
  const usStates = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|VI|GU|AS|MP)\b/i;
  
  // Common US city patterns or "USA" mentions
  const usPatterns = /\b(USA|United States|U\.S\.|Remote.*USA?|Nationwide)\b/i;
  
  // Exclude non-US countries/regions
  const nonUSPatterns = /\b(UK|United Kingdom|Canada|Germany|France|India|China|Japan|Australia|Europe|Asia|EMEA|London|Toronto|Vancouver|Berlin|Paris|Munich|Bangalore|Beijing|Shanghai|Tokyo|Sydney|Melbourne|Edinburgh|Banbury)\b/i;
  
  // First check if it explicitly mentions non-US locations
  if (nonUSPatterns.test(location)) {
    return false;
  }
  
  // Then check for US indicators
  return usStates.test(location) || usPatterns.test(location);
}

/**
 * Parses HTML tables from GitHub markdown READMEs to extract job listings.
 * Handles both 5-column and 6-column table formats.
 * Filters for US locations only and jobs within MAX_AGE_DAYS.
 * 
 * @param html - Raw HTML content containing job tables
 * @param sourceUrl - Source URL for attribution in job listings
 * @returns Array of parsed JobListing objects
 * 
 * @remarks
 * - 5 columns: Company, Role, Location, Application, Age
 * - 6 columns: Company, Role, Location, Terms, Application, Age
 * - Prefers direct application links over Simplify links
 * - Combines multiple regex operations for performance
 */
function parseHTMLTable(html: string, sourceUrl: string): JobListing[] {
  const jobs: JobListing[] = [];
  
  // Extract all <tr> elements from <tbody>
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/g);
  if (!tbodyMatch) return jobs;
  
  for (const tbody of tbodyMatch) {
    // Extract all rows
    const rows = tbody.match(/<tr>([\s\S]*?)<\/tr>/g);
    if (!rows) continue;
    
    for (const row of rows) {
      // Extract all cells
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
      if (!cells || cells.length < 5) continue;
      
      // Clean up cell content
      const cleanCells = cells.map(cell => {
        return cell
          .replace(/<td[^>]*>/, '')
          .replace(/<\/td>/, '')
          .trim();
      });
      
      // Handle both 5-column and 6-column tables
      // 5 columns: Company, Role, Location, Application, Age
      // 6 columns: Company, Role, Location, Terms, Application, Age
      const hasTermsColumn = cleanCells.length >= 6;
      
      const companyCell = cleanCells[0];
      const roleCell = cleanCells[1];
      const locationCell = cleanCells[2];
      const termsCell = hasTermsColumn ? cleanCells[3] : '';
      const applicationCell = hasTermsColumn ? cleanCells[4] : cleanCells[3];
      const ageCell = hasTermsColumn ? cleanCells[5] : cleanCells[4];
      
      // Extract company name - combine regex replacements for efficiency
      let company = companyCell
        .replace(/<[^>]*>|\[([^\]]+)\]\([^)]+\)|🔥/g, (match, p1) => p1 || '')
        .trim();
      
      // Extract role - combine regex replacements for efficiency
      let role = roleCell
        .replace(/<[^>]*>|🎓|🛂|🇺🇸/g, '')
        .trim();
      
      // Extract location - combine regex replacements for efficiency
      let location = locationCell
        .replace(/<details>.*?<\/details>|<[^>]*>|<\/br>/g, (match) => match === '</br>' ? ', ' : '')
        .trim();
      
      // Filter for US locations only
      if (!isUSLocation(location)) {
        continue;
      }
      
      // Extract age
      const age = ageCell.replace(/<[^>]*>/g, '').trim();
      
      // Check age filter
      const ageInDays = parseAgeInDays(age);
      if (ageInDays !== null && ageInDays > CONFIG.MAX_AGE_DAYS) {
        continue;
      }
      
      // Extract application link
      const hrefMatches = Array.from(applicationCell.matchAll(/href="([^"]+)"/g));
      if (hrefMatches.length === 0) continue;
      
      // Prefer non-simplify links
      let applicationLink = '';
      for (const match of hrefMatches) {
        const url = match[1];
        if (!url.includes('simplify.jobs')) {
          applicationLink = url;
          break;
        }
      }
      
      // Fallback to first link
      if (!applicationLink && hrefMatches.length > 0) {
        applicationLink = hrefMatches[0][1];
      }
      
      if (!applicationLink) continue;
      
      // Extract terms (if available)
      const terms = termsCell
        ? termsCell.replace(/<[^>]*>/g, '').trim()
        : 'N/A';
      
      jobs.push({
        company: company || 'Unknown',
        role: role || 'Unknown Role',
        location,
        terms,
        applicationLink,
        age,
        dateAdded: new Date().toISOString(),
        source: sourceUrl,
      });
    }
  }
  
  return jobs;
}

/**
 * Fetches and parses job listings from a GitHub raw content URL.
 * 
 * @param sourceUrl - Raw GitHub URL to fetch
 * @param displayUrl - Human-readable URL for display/logging
 * @returns Promise resolving to array of JobListing objects
 * 
 * @remarks
 * Includes error handling and returns empty array on failure.
 * Logs progress and table count for debugging.
 */
async function fetchJobsFromGitHub(sourceUrl: string, displayUrl: string): Promise<JobListing[]> {
  try {
    console.log(`Fetching ${sourceUrl}...`);
    
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const content = await response.text();
    
    // Debug: Check if we have table content
    const tableCount = (content.match(/<table>/g) || []).length;
    console.log(`  Found ${tableCount} HTML tables`);
    
    const jobs = parseHTMLTable(content, displayUrl);
    
    console.log(`✓ Parsed ${jobs.length} US jobs from ${displayUrl}`);
    return jobs;
  } catch (error) {
    console.error(`Error fetching ${sourceUrl}:`, error);
    return [];
  }
}

/**
 * Main update function that fetches jobs from all configured GitHub sources.
 * Deduplicates jobs and filters out already-processed applications.
 * Uses efficient Set-based duplicate detection during insertion (O(n) instead of O(n²)).
 * 
 * @returns Promise that resolves when all sources are fetched and database is updated
 * 
 * @remarks
 * Performs duplicate detection at insertion time for better performance.
 * Tracks statistics separately for each source.
 */
async function updateAllSources(): Promise<void> {
  await initializeDataDirectory();
  
  const db = await loadJobsDatabase();
  const processedData = await loadProcessedJobs();
  
  console.log("\n" + "=".repeat(60));
  console.log("UPDATING JOBS FROM ALL SOURCES");
  console.log("=".repeat(60));
  
  let totalNewJobs = 0;
  let totalAlreadyProcessed = 0;
  
  // Track seen links across all sources for efficient duplicate detection
  const seenLinks = new Set<string>(db.unprocessed.map(j => j.applicationLink));
  
  for (const source of CONFIG.GITHUB_SOURCES) {
    const jobs = await fetchJobsFromGitHub(source.url, source.displayUrl);
    
    let sourceNewJobs = 0;
    let sourceAlreadyProcessed = 0;
    
    // Filter and deduplicate in a single pass
    for (const job of jobs) {
      if (processedData.processedLinks.has(job.applicationLink)) {
        sourceAlreadyProcessed++;
      } else if (!seenLinks.has(job.applicationLink)) {
        db.unprocessed.push(job);
        seenLinks.add(job.applicationLink);
        sourceNewJobs++;
      }
    }
    
    console.log(`\n${source.name}:`);
    console.log(`  New jobs found: ${jobs.length}`);
    console.log(`  Already processed: ${sourceAlreadyProcessed}`);
    console.log(`  To be added: ${sourceNewJobs}`);
    
    totalNewJobs += sourceNewJobs;
    totalAlreadyProcessed += sourceAlreadyProcessed;
  }
  
  // No need for separate deduplication - already done above
  /* Removed inefficient post-processing:
  const seen = new Set<string>();
  db.unprocessed = db.unprocessed.filter((job) => {
  */
  
  await saveJobsDatabase(db);
  
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total new jobs added: ${totalNewJobs}`);
  console.log(`Already processed: ${totalAlreadyProcessed}`);
  console.log(`Total unprocessed jobs: ${db.unprocessed.length}`);
  console.log("\n✓ Update complete!");
}

/**
 * Marks a batch of jobs as processed by moving them from unprocessed to processed lists.
 * Uses Set for O(1) lookup performance when filtering unprocessed jobs.
 * 
 * @param links - Array of application links to mark as processed
 * @returns Promise that resolves when both databases are updated
 * 
 * @remarks
 * Updates both processed.json and jobs.json atomically.
 * Uses Set-based filtering for O(n) performance instead of O(n²).
 */
async function markJobsAsProcessed(links: string[]): Promise<void> {
  const processedData = await loadProcessedJobs();
  
  links.forEach((link) => processedData.processedLinks.add(link));
  processedData.totalProcessed = processedData.processedLinks.size;
  
  await saveProcessedJobs(processedData);

  // Update jobs database
  const db = await loadJobsDatabase();
  db.processed.push(...links);
  
  // Remove from unprocessed - use Set for O(1) lookups instead of O(n) includes
  const linksSet = new Set(links);
  db.unprocessed = db.unprocessed.filter(
    (job) => !linksSet.has(job.applicationLink)
  );
  
  await saveJobsDatabase(db);
}

/**
 * Interactive command to review and apply to jobs in batches.
 * Displays job details, opens applications in browser, and tracks which jobs are processed.
 * 
 * @returns Promise that resolves when user finishes processing or quits
 * 
 * @remarks
 * - Supports resuming from a specific index via START_INDEX env variable
 * - Allows marking jobs as processed without opening ("mark" command)
 * - Shows progress with batch numbers and job indices
 */
async function openJobsInBatches(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    const db = await loadJobsDatabase();

    if (db.unprocessed.length === 0) {
      console.log("No unprocessed jobs found. Run 'update' command first.");
      return;
    }

    const startIndexRaw = process.env.START_INDEX ?? "0";
    let startIndex = parseInt(startIndexRaw, 10);
    if (isNaN(startIndex) || startIndex < 0 || startIndex >= db.unprocessed.length) {
      startIndex = 0;
    }

    const jobsSlice = db.unprocessed.slice(startIndex);
    const chunks = chunk(jobsSlice, CONFIG.BATCH_SIZE);

    console.log(`\nTotal unprocessed jobs: ${db.unprocessed.length}`);
    console.log(`Starting from index: ${startIndex}`);
    console.log(`Batches: ${chunks.length}\n`);

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      const globalBatchIndex = startIndex + i * CONFIG.BATCH_SIZE;

      console.log(`\n${"=".repeat(60)}`);
      console.log(`Batch ${i + 1}/${chunks.length} [Jobs ${globalBatchIndex}–${globalBatchIndex + batch.length - 1}]`);
      console.log("=".repeat(60));

      batch.forEach((job, idx) => {
        console.log(`\n${idx + 1}. ${job.company} - ${job.role}`);
        console.log(`   Location: ${job.location}`);
        console.log(`   Terms: ${job.terms}`);
        console.log(`   Age: ${job.age}`);
        console.log(`   Link: ${job.applicationLink}`);
      });

      const answer = (await rl.question("\nOpen this batch? (y/n/mark) "))
        .trim()
        .toLowerCase();

      if (answer === "mark") {
        // Mark as processed without opening
        const links = batch.map((job) => job.applicationLink);
        await markJobsAsProcessed(links);
        console.log("✓ Marked batch as processed");
        continue;
      }

      if (!answer.startsWith("y")) {
        const nextStartIndex = startIndex + (i + 1) * CONFIG.BATCH_SIZE;
        console.log("\nStopping as requested.");
        console.log(`To resume: START_INDEX=${nextStartIndex} bun run apply`);
        return;
      }

      // Open jobs
      await Promise.all(
        batch.map((job) => Bun.$`xdg-open ${job.applicationLink}`.nothrow())
      );

      const markAnswer = (
        await rl.question("Mark this batch as processed? (y/n) ")
      )
        .trim()
        .toLowerCase();

      if (markAnswer.startsWith("y")) {
        const links = batch.map((job) => job.applicationLink);
        await markJobsAsProcessed(links);
        console.log("✓ Batch marked as processed");
      }
    }

    console.log("\n✓ All jobs processed!");
  } finally {
    rl.close();
  }
}

/**
 * Splits an array into chunks of specified size.
 * 
 * @param arr - Array to split into chunks
 * @param size - Size of each chunk
 * @returns Array of arrays, each containing up to 'size' elements
 * 
 * @example
 * chunk([1, 2, 3, 4, 5], 2) // [[1, 2], [3, 4], [5]]
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Displays help information about available commands and usage.
 * 
 * @returns Promise that resolves after help text is printed
 */
async function showHelp(): Promise<void> {
  console.log(`
Job Application Manager (Automated)
====================================

Commands:
  help              Show this help message
  update            Automatically fetch and update jobs from all sources
  apply             Open and process jobs in batches
  stats             Show statistics
  reset             Reset all data (careful!)

Environment Variables:
  START_INDEX       Resume from specific job index (for 'apply' command)

Examples:
  bun run job-manager.ts update
  bun run job-manager.ts apply
  START_INDEX=10 bun run job-manager.ts apply

Sources (automatically fetched):
  - Summer 2026 Internships
  - New Grad Positions
  - Off-Season Internships
`);
}

/**
 * Displays statistics about processed and unprocessed jobs.
 * Shows job counts and source URLs.
 * 
 * @returns Promise that resolves after stats are printed
 */
async function showStats(): Promise<void> {
  const db = await loadJobsDatabase();
  const processedData = await loadProcessedJobs();

  console.log(`
Job Application Statistics
===========================

Unprocessed Jobs:    ${db.unprocessed.length}
Processed Jobs:      ${processedData.totalProcessed}
Total Jobs Tracked:  ${db.unprocessed.length + processedData.totalProcessed}

Last Updated:        ${processedData.lastUpdated}

Sources:
  - Summer 2026 Internships: ${CONFIG.GITHUB_SOURCES[0].displayUrl}
  - New Grad Positions:      ${CONFIG.GITHUB_SOURCES[1].displayUrl}
  - Off-Season Internships:  ${CONFIG.GITHUB_SOURCES[2].displayUrl}
`);
}

/**
 * Resets all job data after user confirmation.
 * Clears both the jobs database and processed jobs tracking.
 * 
 * @returns Promise that resolves after data is reset or user cancels
 * 
 * @remarks
 * Requires explicit "yes" confirmation to prevent accidental data loss.
 */
async function resetData(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  
  try {
    const answer = (
      await rl.question("Are you sure you want to reset all data? (yes/no) ")
    ).trim().toLowerCase();

    if (answer === "yes") {
      await writeFile(CONFIG.JOBS_FILE, JSON.stringify({
        unprocessed: [],
        processed: [],
        sources: {
          summer2026Internships: "",
          newGrad: "",
          offSeason: "",
        },
      }, null, 2));
      
      await writeFile(CONFIG.PROCESSED_FILE, JSON.stringify({
        processedLinks: [],
        lastUpdated: new Date().toISOString(),
        totalProcessed: 0,
      }, null, 2));
      
      console.log("✓ All data reset!");
    } else {
      console.log("Reset cancelled.");
    }
  } finally {
    rl.close();
  }
}

/**
 * Main entry point for the application.
 * Routes to appropriate command handler based on argv.
 * 
 * @remarks
 * Available commands: help, update, apply, stats, reset
 * Exits with code 1 on unknown command.
 */
async function main() {
  await initializeDataDirectory();

  const command = process.argv[2] || "help";

  switch (command) {
    case "help":
      await showHelp();
      break;
    case "update":
      await updateAllSources();
      break;
    case "apply":
      await openJobsInBatches();
      break;
    case "stats":
      await showStats();
      break;
    case "reset":
      await resetData();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      await showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});