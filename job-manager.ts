import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

interface JobListing {
  company: string;
  role: string;
  location: string;
  terms: string;
  applicationLink: string;
  age: string;
  dateAdded: string;
  source: string;
}

interface ProcessedJobsData {
  processedLinks: Set<string>;
  lastUpdated: string;
  totalProcessed: number;
}

interface JobsDatabase {
  unprocessed: JobListing[];
  processed: string[];
  sources: {
    summer2026Internships: string;
    newGrad: string;
    offSeason: string;
  };
}

const CONFIG = {
  BATCH_SIZE: 5,
  DATA_DIR: "./job-data",
  JOBS_FILE: "./job-data/jobs.json",
  PROCESSED_FILE: "./job-data/processed.json",
  GITHUB_SOURCES: [
    {
      name: "summer2026Internships",
      url: "https://github.com/SimplifyJobs/Summer2026-Internships/blob/dev/README.md",
      type: "internship" as const,
    },
    {
      name: "newGrad",
      url: "https://github.com/SimplifyJobs/New-Grad-Positions",
      type: "newgrad" as const,
    },
    {
      name: "offSeason",
      url: "https://github.com/SimplifyJobs/Summer2026-Internships/blob/dev/README-Off-Season.md",
      type: "internship" as const,
    },
  ],
  MAX_AGE_DAYS: 30,
} as const;

async function initializeDataDirectory(): Promise<void> {
  if (!existsSync(CONFIG.DATA_DIR)) {
    await mkdir(CONFIG.DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${CONFIG.DATA_DIR}`);
  }
}

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

async function saveJobsDatabase(db: JobsDatabase): Promise<void> {
  await writeFile(CONFIG.JOBS_FILE, JSON.stringify(db, null, 2), "utf-8");
  console.log(`Saved ${db.unprocessed.length} unprocessed jobs to ${CONFIG.JOBS_FILE}`);
}

function generateScraperScript(maxAgeDays: number = 30): string {
  return `
// Run this script in the browser console on the GitHub README page
(function extractJobListings() {
  const table = document.querySelector('table');
  
  if (!table) {
    console.error('Table not found');
    return null;
  }

  const rows = table.querySelectorAll('tbody tr');
  const results = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return;

    const ageCell = cells[cells.length - 1];
    const ageText = ageCell.textContent.trim();
    
    let dayAge = null;
    if (ageText.includes('d')) {
      dayAge = parseInt(ageText);
    } else if (ageText.includes('mo')) {
      dayAge = parseInt(ageText) * 30;
    }

    if (dayAge !== null && dayAge <= ${maxAgeDays}) {
      const companyCell = cells[0];
      const roleCell = cells[1];
      const locationCell = cells[2];
      const termsCell = cells[3];
      const applicationCell = cells[4];
      const link = applicationCell.querySelector('a');
      
      if (link) {
        results.push({
          company: companyCell.textContent.trim(),
          role: roleCell.textContent.trim(),
          location: locationCell.textContent.trim(),
          terms: termsCell.textContent.trim(),
          applicationLink: link.href,
          age: ageText,
          dateAdded: new Date().toISOString(),
          source: window.location.href
        });
      }
    }
  });

  console.log(\`Found \${results.length} jobs within last ${maxAgeDays} days\`);
  console.log('Copy this JSON data:');
  console.log(JSON.stringify(results, null, 2));
  
  // Try to copy to clipboard
  navigator.clipboard.writeText(JSON.stringify(results, null, 2))
    .then(() => console.log('✓ Data copied to clipboard!'))
    .catch(() => console.log('Could not auto-copy, please copy manually'));
    
  return results;
})();
`;
}

async function updateJobsFromSource(
  sourceName: string,
  newJobs: JobListing[]
): Promise<void> {
  await initializeDataDirectory();
  
  const db = await loadJobsDatabase();
  const processedData = await loadProcessedJobs();

  // Filter out already processed jobs
  const unprocessedJobs = newJobs.filter(
    (job) => !processedData.processedLinks.has(job.applicationLink)
  );

  console.log(`\n${sourceName}:`);
  console.log(`  New jobs found: ${newJobs.length}`);
  console.log(`  Already processed: ${newJobs.length - unprocessedJobs.length}`);
  console.log(`  To be added: ${unprocessedJobs.length}`);

  // Add to unprocessed list
  db.unprocessed.push(...unprocessedJobs);
  
  // Remove duplicates based on application link
  const seen = new Set<string>();
  db.unprocessed = db.unprocessed.filter((job) => {
    if (seen.has(job.applicationLink)) return false;
    seen.add(job.applicationLink);
    return true;
  });

  await saveJobsDatabase(db);
}

async function markJobsAsProcessed(links: string[]): Promise<void> {
  const processedData = await loadProcessedJobs();
  
  links.forEach((link) => processedData.processedLinks.add(link));
  processedData.totalProcessed = processedData.processedLinks.size;
  
  await saveProcessedJobs(processedData);

  // Update jobs database
  const db = await loadJobsDatabase();
  db.processed.push(...links);
  
  // Remove from unprocessed
  db.unprocessed = db.unprocessed.filter(
    (job) => !links.includes(job.applicationLink)
  );
  
  await saveJobsDatabase(db);
}

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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function showHelp(): Promise<void> {
  console.log(`
Job Application Manager
=======================

Commands:
  help              Show this help message
  scraper           Generate browser scraper script
  update [source]   Update jobs from scraped data (paste JSON)
  apply             Open and process jobs in batches
  stats             Show statistics
  reset             Reset all data (careful!)

Environment Variables:
  START_INDEX       Resume from specific job index (for 'apply' command)

Examples:
  bun run job-manager.ts scraper
  bun run job-manager.ts update
  bun run job-manager.ts apply
  START_INDEX=10 bun run job-manager.ts apply
`);
}

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
  - Summer 2026 Internships: ${CONFIG.GITHUB_SOURCES[0].url}
  - New Grad Positions:      ${CONFIG.GITHUB_SOURCES[1].url}
  - Off-Season Internships:  ${CONFIG.GITHUB_SOURCES[2].url}
`);
}

async function generateScraper(): Promise<void> {
  const script = generateScraperScript(CONFIG.MAX_AGE_DAYS);
  
  console.log("\n" + "=".repeat(70));
  console.log("BROWSER SCRAPER SCRIPT");
  console.log("=".repeat(70));
  console.log("\nInstructions:");
  console.log("1. Navigate to one of these URLs:");
  CONFIG.GITHUB_SOURCES.forEach((source) => {
    console.log(`   - ${source.url}`);
  });
  console.log("2. Open browser Developer Console (F12)");
  console.log("3. Copy and paste the script below");
  console.log("4. Copy the JSON output");
  console.log("5. Run: bun run job-manager.ts update");
  console.log("6. Paste the JSON when prompted");
  console.log("\n" + "=".repeat(70));
  console.log(script);
  console.log("=".repeat(70) + "\n");
}

async function updateFromScrapedData(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("\nPaste the JSON data from browser scraper (press Ctrl+D when done):");
    
    let jsonData = "";
    for await (const line of rl) {
      jsonData += line;
    }

    const jobs: JobListing[] = JSON.parse(jsonData);
    
    if (!Array.isArray(jobs)) {
      throw new Error("Invalid JSON format");
    }

    const sourceName = jobs[0]?.source || "Unknown Source";
    await updateJobsFromSource(sourceName, jobs);
    
    console.log("\n✓ Successfully updated jobs database!");
    await showStats();
  } catch (error) {
    console.error("Error parsing JSON:", error);
  } finally {
    rl.close();
  }
}

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

async function main() {
  await initializeDataDirectory();

  const command = process.argv[2] || "help";

  switch (command) {
    case "help":
      await showHelp();
      break;
    case "scraper":
      await generateScraper();
      break;
    case "update":
      await updateFromScrapedData();
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