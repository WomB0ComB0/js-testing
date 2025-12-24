import { checkbox, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ms from "ms";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import ora from "ora";

/**
 * Represents a job listing parsed from GitHub repositories.
 */
interface JobListing {
  company: string;
  role: string;
  location: string;
  terms: string;
  applicationLink: string;
  age: string;
  dateAdded: string;
  source: string;
  parsedDate?: Date; // For datetime ordering
}

/**
 * Tracks processed applications.
 */
interface ProcessedJobsData {
  processedLinks: Set<string>;
  lastUpdated: string;
  totalProcessed: number;
}

/**
 * Main database structure.
 * Now includes currentIndex to remember user position.
 */
interface JobsDatabase {
  unprocessed: JobListing[];
  processed: string[];
  /** Remembers where the user left off in the unprocessed list */
  currentIndex: number;
  sources: {
    summer2026Internships: string;
    newGrad: string;
    offSeason: string;
  };
}

/**
 * User preferences for filtering job titles.
 */
interface UserPreferences {
  acceptedTitles: Set<string>;
  rejectedTitles: Set<string>;
  presets?: FilterPreset[];
}

/**
 * Named filter presets for quick switching
 */
interface FilterPreset {
  name: string;
  acceptedTitles: string[];
  rejectedTitles: string[];
  createdAt: string;
}

/**
 * Session statistics tracking
 */
interface SessionStats {
  startTime: number;
  jobsViewed: number;
  jobsMarked: number;
  batchesProcessed: number;
}

/**
 * Undo operation data
 */
interface UndoOperation {
  type: 'mark_batch' | 'mark_single';
  links: string[];
  timestamp: number;
}

const CONFIG = {
  BATCH_SIZE: 5,
  DATA_DIR: "./job-data",
  JOBS_FILE: "./job-data/jobs.json",
  PROCESSED_FILE: "./job-data/processed.json",
  PREFERENCES_FILE: "./job-data/preferences.json",
  EXPORTS_DIR: "./job-data/exports",
  // SimplifyJobs sources with year templates
  GITHUB_SOURCES: [
    {
      name: "summerInternships",
      urlTemplate: "https://raw.githubusercontent.com/SimplifyJobs/Summer{YEAR}-Internships/dev/README.md",
      displayUrlTemplate: "https://github.com/SimplifyJobs/Summer{YEAR}-Internships/blob/dev/README.md",
      type: "internship" as const,
    },
    {
      name: "newGrad",
      urlTemplate: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
      displayUrlTemplate: "https://github.com/SimplifyJobs/New-Grad-Positions",
      type: "newgrad" as const,
    },
    {
      name: "offSeason",
      urlTemplate: "https://raw.githubusercontent.com/SimplifyJobs/Summer{YEAR}-Internships/dev/README-Off-Season.md",
      displayUrlTemplate: "https://github.com/SimplifyJobs/Summer{YEAR}-Internships/blob/dev/README-Off-Season.md",
      type: "internship" as const,
    },
  ],
  MAX_AGE_DAYS: 30,
  // DateTime ordering configuration
  JOB_ORDERING: "newest" as "newest" | "oldest",
  BASE_YEAR: new Date().getFullYear(),
  // Jobright-AI sources - Design, Engineering, Data, Product (New Grad + Internship)
  JOBRIGHT_AI_SOURCES: [
    // === NEW GRAD ===
    {
      name: "softwareEngineerNewGrad",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Software-Engineer-New-Grad/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Software-Engineer-New-Grad",
      type: "newgrad" as const,
      category: "Software-Engineer",
    },
    {
      name: "engineeringNewGrad",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Engineering-New-Grad/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Engineering-New-Grad",
      type: "newgrad" as const,
      category: "Engineering",
    },
    {
      name: "dataAnalysisNewGrad",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Data-Analysis-New-Grad/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Data-Analysis-New-Grad",
      type: "newgrad" as const,
      category: "Data-Analysis",
    },
    {
      name: "designNewGrad",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Design-New-Grad/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Design-New-Grad",
      type: "newgrad" as const,
      category: "Design",
    },
    {
      name: "productManagementNewGrad",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Product-Management-New-Grad/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Product-Management-New-Grad",
      type: "newgrad" as const,
      category: "Product-Management",
    },
    // === INTERNSHIPS ===
    {
      name: "softwareEngineerInternship",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Software-Engineer-Internship/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Software-Engineer-Internship",
      type: "internship" as const,
      category: "Software-Engineer",
    },
    {
      name: "engineerInternship",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Engineer-Internship/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Engineer-Internship",
      type: "internship" as const,
      category: "Engineering",
    },
    {
      name: "dataAnalysisInternship",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Data-Analysis-Internship/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Data-Analysis-Internship",
      type: "internship" as const,
      category: "Data-Analysis",
    },
    {
      name: "designInternship",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Design-Internship/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Design-Internship",
      type: "internship" as const,
      category: "Design",
    },
    {
      name: "productManagementInternship",
      urlTemplate: "https://raw.githubusercontent.com/jobright-ai/{YEAR}-Product-Management-Internship/master/README.md",
      displayUrlTemplate: "https://github.com/jobright-ai/{YEAR}-Product-Management-Internship",
      type: "internship" as const,
      category: "Product-Management",
    },
  ],
} as const;

// Session state (not persisted)
let currentSession: SessionStats | null = null;
let lastUndoOperation: UndoOperation | null = null;

// --- FILE SYSTEM HELPERS ---

async function initializeDataDirectory(): Promise<void> {
  if (!existsSync(CONFIG.DATA_DIR)) {
    await mkdir(CONFIG.DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${CONFIG.DATA_DIR}`);
  }
}

async function loadUserPreferences(): Promise<UserPreferences> {
  try {
    if (existsSync(CONFIG.PREFERENCES_FILE)) {
      const data = await readFile(CONFIG.PREFERENCES_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return {
        acceptedTitles: new Set(parsed.acceptedTitles || []),
        rejectedTitles: new Set(parsed.rejectedTitles || []),
      };
    }
  } catch (error) {
    // Ignore error
  }
  return { acceptedTitles: new Set(), rejectedTitles: new Set() };
}

async function saveUserPreferences(prefs: UserPreferences): Promise<void> {
  const serializable = {
    acceptedTitles: Array.from(prefs.acceptedTitles),
    rejectedTitles: Array.from(prefs.rejectedTitles),
  };
  await writeFile(CONFIG.PREFERENCES_FILE, JSON.stringify(serializable, null, 2), "utf-8");
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
    // Ignore
  }
  return { processedLinks: new Set(), lastUpdated: new Date().toISOString(), totalProcessed: 0 };
}

async function saveProcessedJobs(data: ProcessedJobsData): Promise<void> {
  const serializable = {
    processedLinks: Array.from(data.processedLinks),
    lastUpdated: new Date().toISOString(),
    totalProcessed: data.totalProcessed,
  };
  await writeFile(CONFIG.PROCESSED_FILE, JSON.stringify(serializable, null, 2), "utf-8");
}

async function loadJobsDatabase(): Promise<JobsDatabase> {
  try {
    if (existsSync(CONFIG.JOBS_FILE)) {
      const data = await readFile(CONFIG.JOBS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    // Ignore
  }
  return {
    unprocessed: [],
    processed: [],
    currentIndex: 0,
    sources: { summer2026Internships: "", newGrad: "", offSeason: "" },
  };
}

async function saveJobsDatabase(db: JobsDatabase): Promise<void> {
  await writeFile(CONFIG.JOBS_FILE, JSON.stringify(db, null, 2), "utf-8");
}

// --- PARSING HELPERS ---

function parseAgeInDays(ageText: string): number | null {
  const trimmed = ageText.trim().toLowerCase();
  const match = trimmed.match(/(\d+)\s*(d|day|days|mo|month|months|w|week|weeks)/i);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('d')) return value;
  if (unit.startsWith('mo')) return value * 30;
  if (unit.startsWith('w')) return value * 7;
  return null;
}

function isUSLocation(location: string): boolean {
  const usStates = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|VI|GU|AS|MP)\b/i;
  const usPatterns = /\b(USA|United States|U\.S\.|Remote.*USA?|Nationwide)\b/i;
  const nonUSPatterns = /\b(UK|United Kingdom|Canada|Germany|France|India|China|Japan|Australia|Europe|Asia|EMEA|London|Toronto|Vancouver|Berlin|Paris|Munich|Bangalore|Beijing|Shanghai|Tokyo|Sydney|Melbourne|Edinburgh|Banbury)\b/i;
  
  if (nonUSPatterns.test(location)) return false;
  return usStates.test(location) || usPatterns.test(location);
}

/**
 * Extracts normalized keywords from job titles for grouping.
 */
function extractRoleKeywords(role: string): string[] {
  const normalized = role.toLowerCase();
  const keywords: string[] = [];
  
  const rolePatterns = [
    /software engineer/i, /backend/i, /frontend/i, /full[- ]?stack/i, /mobile/i,
    /ios/i, /android/i, /web/i, /machine learning/i, /\bml\b/i, /\bai\b/i,
    /data scien/i, /data engineer/i, /devops/i, /sre/i, /cloud/i, /security/i,
    /embedded/i, /firmware/i, /qa/i, /test/i, /product manager/i, /\bpm\b/i,
    /quant/i, /hardware/i, /intern/i, /new grad/i, /research/i
  ];
  
  for (const pattern of rolePatterns) {
    if (pattern.test(normalized)) {
      // Clean up the regex source to look nice
      const cleanName = pattern.source.replace(/\\b/g, '').replace(/\\/g, '').replace(/\[.*?\]/g, '');
      keywords.push(cleanName);
    }
  }
  return keywords;
}

/**
 * Checks if a job title passes the user's preference filters.
 */
function matchesPreferences(role: string, prefs: UserPreferences): boolean {
  const normalized = role.toLowerCase();
  
  // 1. Check Rejections first (Strict filter)
  for (const rejected of prefs.rejectedTitles) {
    if (normalized.includes(rejected.toLowerCase())) return false;
  }
  
  // 2. If Accepted list is empty, allow everything (that wasn't rejected)
  if (prefs.acceptedTitles.size === 0) return true;
  
  // 3. If Accepted list exists, must match at least one
  for (const accepted of prefs.acceptedTitles) {
    if (normalized.includes(accepted.toLowerCase())) return true;
  }
  
  return false;
}

function parseHTMLTable(html: string, sourceUrl: string): JobListing[] {
  const jobs: JobListing[] = [];
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/g);
  if (!tbodyMatch) return jobs;
  
  for (const tbody of tbodyMatch) {
    const rows = tbody.match(/<tr>([\s\S]*?)<\/tr>/g);
    if (!rows) continue;
    
    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
      if (!cells || cells.length < 5) continue;
      
      const cleanCells = cells.map(cell => cell.replace(/<td[^>]*>/, '').replace(/<\/td>/, '').trim());
      const hasTermsColumn = cleanCells.length >= 6;
      
      const companyCell = cleanCells[0];
      const roleCell = cleanCells[1];
      const locationCell = cleanCells[2];
      const termsCell = hasTermsColumn ? cleanCells[3] : '';
      const applicationCell = hasTermsColumn ? cleanCells[4] : cleanCells[3];
      const ageCell = hasTermsColumn ? cleanCells[5] : cleanCells[4];
      
      let company = companyCell.replace(/<[^>]*>|\[([^\]]+)\]\([^)]+\)|🔥/g, (match, p1) => p1 || '').trim();
      let role = roleCell.replace(/<[^>]*>|🎓|🛂|🇺🇸/g, '').trim();
      let location = locationCell.replace(/<details>.*?<\/details>|<[^>]*>|<\/br>/g, (match) => match === '</br>' ? ', ' : '').trim();
      
      if (!isUSLocation(location)) continue;
      
      const age = ageCell.replace(/<[^>]*>/g, '').trim();
      const ageInDays = parseAgeInDays(age);
      if (ageInDays !== null && ageInDays > CONFIG.MAX_AGE_DAYS) continue;
      
      const hrefMatches = Array.from(applicationCell.matchAll(/href="([^"]+)"/g));
      if (hrefMatches.length === 0) continue;
      
      let applicationLink = '';
      for (const match of hrefMatches) {
        if (!match[1].includes('simplify.jobs')) {
          applicationLink = match[1];
          break;
        }
      }
      if (!applicationLink && hrefMatches.length > 0) applicationLink = hrefMatches[0][1];
      if (!applicationLink) continue;
      
      const terms = termsCell ? termsCell.replace(/<[^>]*>/g, '').trim() : 'N/A';
      
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

async function fetchJobsFromGitHub(sourceUrl: string, displayUrl: string): Promise<JobListing[]> {
  const spinner = ora(`Fetching ${displayUrl}...`).start();
  
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    const jobs = parseHTMLTable(content, displayUrl);
    
    spinner.succeed(`Found ${chalk.bold.green(jobs.length)} jobs from ${displayUrl}`);
    return jobs;
  } catch (error) {
    spinner.fail(`Failed to fetch ${displayUrl}`);
  console.error(chalk.red(`Error: ${error}`));
    return [];
  }
}

// --- JOBRIGHT-AI FETCH & PARSE FUNCTIONS ---

/**
 * Result of a fetch attempt with year detection
 */
interface FetchResult {
  success: boolean;
  year: number;
  content?: string;
  error?: string;
}

/**
 * Fetch with year fallback - detects 404 and increments year until valid
 */
async function fetchWithYearFallback(
  urlTemplate: string,
  startYear: number,
  maxRetries: number = 3
): Promise<FetchResult> {
  let currentYear = startYear;
  
  for (let attempts = 0; attempts < maxRetries; attempts++) {
    const url = urlTemplate.replace("{YEAR}", String(currentYear));
    
    try {
      const response = await fetch(url);
      
      if (response.status === 404) {
        // Year likely not yet created - try next year
        currentYear++;
        continue;
      }
      
      if (!response.ok) {
        return { success: false, year: currentYear, error: `HTTP ${response.status}` };
      }
      
      const content = await response.text();
      return { success: true, year: currentYear, content };
      
    } catch (error) {
      return { success: false, year: currentYear, error: String(error) };
    }
  }
  
  return { success: false, year: currentYear, error: "Max retries exceeded" };
}

/**
 * Parse date from jobright-ai format "Mon Day" (e.g., "Dec 23")
 */
function parseJobrightDate(dateStr: string, year: number): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  
  const match = dateStr.trim().match(/^(\w{3})\s+(\d{1,2})$/i);
  if (!match) return null;
  
  const month = months[match[1].toLowerCase()];
  const day = parseInt(match[2]);
  
  if (month === undefined || isNaN(day)) return null;
  
  return new Date(year, month, day);
}

/**
 * Sort jobs by parsed date according to ordering config
 */
function sortJobsByDate(jobs: JobListing[], order: "newest" | "oldest"): JobListing[] {
  return [...jobs].sort((a, b) => {
    const dateA = a.parsedDate?.getTime() ?? 0;
    const dateB = b.parsedDate?.getTime() ?? 0;
    return order === "newest" ? dateB - dateA : dateA - dateB;
  });
}

/**
 * Parse jobright-ai table format
 * Columns: Company, Job Title, Location, Work Model, Date Posted
 */
function parseJobrightAITable(markdown: string, sourceUrl: string, year: number): JobListing[] {
  const jobs: JobListing[] = [];
  
  // Split into lines and find markdown table rows (start with |)
  const lines = markdown.split('\n');
  
  for (const line of lines) {
    // Skip non-table lines, header row, and separator row
    if (!line.startsWith('|')) continue;
    if (line.includes('Company') && line.includes('Job Title')) continue; // Header
    if (line.includes('-----')) continue; // Separator
    
    // Parse markdown table row: | Company | Job Title | Location | Work Model | Date |
    const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 5) continue;
    
    const [companyCell, roleCell, locationCell, workModelCell, dateCell] = cells;
    
    // Handle continuation rows (↳ means same company as previous)
    if (companyCell === '↳') continue; // Skip for now, or handle differently
    
    // Extract company name from **[Company](url)** or **[Company](url)**
    const companyMatch = companyCell.match(/\*\*\[([^\]]+)\]/);
    const company = companyMatch ? companyMatch[1] : companyCell.replace(/\*\*/g, '').trim();
    
    // Extract role and application link from **[Job Title](url)**
    const roleMatch = roleCell.match(/\*\*\[([^\]]+)\]\(([^)]+)\)/);
    const role = roleMatch ? roleMatch[1] : roleCell.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    const applicationLink = roleMatch ? roleMatch[2] : '';
    
    // Location and work model
    const location = locationCell;
    const terms = workModelCell; // On Site, Remote, Hybrid
    
    // Parse date (e.g., "Dec 23")
    const dateText = dateCell;
    const parsedDate = parseJobrightDate(dateText, year);
    
    if (!applicationLink) continue;
    if (!isUSLocation(location)) continue;

    jobs.push({
      company: company || 'Unknown',
      role: role || 'Unknown Role',
      location,
      terms,
      applicationLink,
      age: dateText,
      dateAdded: new Date().toISOString(),
      source: sourceUrl,
      parsedDate: parsedDate ?? undefined,
    });
  }
  
  return jobs;
}

/**
 * Fetch all jobright-ai sources with dynamic year detection
 */
async function fetchJobrightAISources(): Promise<JobListing[]> {
  const allJobs: JobListing[] = [];
  const currentYear = CONFIG.BASE_YEAR;
  
  console.log(chalk.bold.cyan("\n🔍 Fetching jobright-ai sources..."));
  
  for (const source of CONFIG.JOBRIGHT_AI_SOURCES) {
    const spinner = ora(`Fetching ${source.name}...`).start();
    const result = await fetchWithYearFallback(source.urlTemplate, currentYear);
    
    if (!result.success || !result.content) {
      spinner.fail(`Failed to fetch ${source.name}: ${result.error}`);
      continue;
    }
    
    const displayUrl = source.displayUrlTemplate.replace("{YEAR}", String(result.year));
    const jobs = parseJobrightAITable(result.content, displayUrl, result.year);
    allJobs.push(...jobs);
    
    spinner.succeed(`Found ${chalk.bold.green(jobs.length)} jobs from ${source.name} (${result.year})`);
  }
  
  return sortJobsByDate(allJobs, CONFIG.JOB_ORDERING);
}

// --- UTILITY FUNCTIONS ---

/**
 * Convert age string to relative time
 */
function getRelativeTime(ageText: string): string {
  const days = parseAgeInDays(ageText);
  if (days === null) return ageText;
  
  const msAgo = days * 24 * 60 * 60 * 1000;
  return ms(msAgo, { long: true }) + ' ago';
}

/**
 * Initialize session tracking
 */
function startSession(): void {
  currentSession = {
    startTime: Date.now(),
    jobsViewed: 0,
    jobsMarked: 0,
    batchesProcessed: 0,
  };
}

/**
 * Display session summary
 */
function showSessionSummary(): void {
  if (!currentSession) return;
  
  const duration = Date.now() - currentSession.startTime;
  const durationStr = ms(duration, { long: true });
  
  console.log("\\n" + chalk.bold.magenta("╔" + "═".repeat(58) + "╗"));
  console.log(chalk.bold.magenta("║") + chalk.bold.white(" 📊  SESSION SUMMARY".padEnd(58)) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("╠" + "═".repeat(58) + "╣"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Duration:            ${chalk.cyan(durationStr)}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Jobs Viewed:         ${chalk.yellow(currentSession.jobsViewed)}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Jobs Marked:         ${chalk.green(currentSession.jobsMarked)}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Batches Processed:   ${chalk.blue(currentSession.batchesProcessed)}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("╚" + "═".repeat(58) + "╝"));
  console.log("");
}

/**
 * Export jobs to CSV
 */
async function exportToCSV(jobs: JobListing[], filename: string): Promise<void> {
  if (!existsSync(CONFIG.EXPORTS_DIR)) {
    await mkdir(CONFIG.EXPORTS_DIR, { recursive: true });
  }
  
  const headers = "Company,Role,Location,Terms,Age,Application Link,Source\\n";
  const rows = jobs.map(job => {
    const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
    return [
      escape(job.company),
      escape(job.role),
      escape(job.location),
      escape(job.terms),
      escape(job.age),
      escape(job.applicationLink),
      escape(job.source),
    ].join(',');
  }).join('\\n');
  
  const filepath = `${CONFIG.EXPORTS_DIR}/${filename}`;
  await writeFile(filepath, headers + rows, 'utf-8');
  console.log(chalk.green(`\\n✓ Exported ${jobs.length} jobs to ${filepath}`));
}

/**
 * Export jobs to JSON
 */
async function exportToJSON(jobs: JobListing[], filename: string): Promise<void> {
  if (!existsSync(CONFIG.EXPORTS_DIR)) {
    await mkdir(CONFIG.EXPORTS_DIR, { recursive: true });
  }
  
  const data = {
    exportedAt: new Date().toISOString(),
    totalJobs: jobs.length,
    jobs,
  };
  
  const filepath = `${CONFIG.EXPORTS_DIR}/${filename}`;
  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(chalk.green(`\\n✓ Exported ${jobs.length} jobs to ${filepath}`));
}

/**
 * Calculate job analytics/insights
 */
function analyzeJobs(jobs: JobListing[]): void {
  if (jobs.length === 0) return;
  
  // Location analysis
  const locationCounts = new Map<string, number>();
  jobs.forEach(job => {
    const loc = job.location.split(',')[0].trim(); // First part
    locationCounts.set(loc, (locationCounts.get(loc) || 0) + 1);
  });
  
  // Company analysis
  const companyCounts = new Map<string, number>();
  jobs.forEach(job => {
    companyCounts.set(job.company, (companyCounts.get(job.company) || 0) + 1);
  });
  
  // Role analysis
  const roleKeywords = new Map<string, number>();
  jobs.forEach(job => {
    const keywords = extractRoleKeywords(job.role);
    keywords.forEach(kw => {
      roleKeywords.set(kw, (roleKeywords.get(kw) || 0) + 1);
    });
  });
  
  // Calculate average age
  const ages = jobs.map(j => parseAgeInDays(j.age)).filter(a => a !== null) as number[];
  const avgAge = ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
  
  // Top 5 of each
  const topLocations = Array.from(locationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topCompanies = Array.from(companyCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topRoles = Array.from(roleKeywords.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  console.log("\\n" + chalk.bold.cyan("╔" + "═".repeat(58) + "╗"));
  console.log(chalk.bold.cyan("║") + chalk.bold.white(" 📈  JOB INSIGHTS & ANALYTICS".padEnd(58)) + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("╠" + "═".repeat(58) + "╣"));
  console.log(chalk.bold.cyan("║") + chalk.bold.yellow(" Top Locations:".padEnd(58)) + chalk.bold.cyan("║"));
  topLocations.forEach(([loc, count]) => {
    const pct = ((count / jobs.length) * 100).toFixed(1);
    console.log(chalk.bold.cyan("║") + chalk.white(`   ${loc.padEnd(35)} ${chalk.cyan(count)} (${chalk.yellow(pct + '%')})`).padEnd(67) + chalk.bold.cyan("║"));
  });
  console.log(chalk.bold.cyan("║") + " ".repeat(58) + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("║") + chalk.bold.green(" Top Companies:".padEnd(58)) + chalk.bold.cyan("║"));
  topCompanies.forEach(([company, count]) => {
    console.log(chalk.bold.cyan("║") + chalk.white(`   ${company.slice(0, 35).padEnd(35)} ${chalk.green(count)} jobs`).padEnd(67) + chalk.bold.cyan("║"));
  });
  console.log(chalk.bold.cyan("║") + " ".repeat(58) + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("║") + chalk.bold.magenta(" Top Role Types:".padEnd(58)) + chalk.bold.cyan("║"));
  topRoles.forEach(([role, count]) => {
    console.log(chalk.bold.cyan("║") + chalk.white(`   ${role.padEnd(35)} ${chalk.magenta(count)}`).padEnd(67) + chalk.bold.cyan("║"));
  });
  console.log(chalk.bold.cyan("║") + " ".repeat(58) + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("║") + chalk.white(`  Average Posting Age: ${chalk.yellow(avgAge + ' days')}`).padEnd(67) + chalk.bold.cyan("║"));
  console.log(chalk.bold.cyan("╚" + "═".repeat(58) + "╝"));
  console.log("");
}

/**
 * Save undo operation for potential reversal
 */
function saveUndoOperation(type: UndoOperation['type'], links: string[]): void {
  lastUndoOperation = {
    type,
    links,
    timestamp: Date.now(),
  };
}

/**
 * Perform undo of last operation
 */
async function performUndo(): Promise<boolean> {
  if (!lastUndoOperation) {
    console.log(chalk.yellow("\\n⚠ No operation to undo."));
    return false;
  }
  
  const age = Date.now() - lastUndoOperation.timestamp;
  if (age > 60000) { // 1 minute timeout
    console.log(chalk.yellow("\\n⚠ Undo expired (>1 minute old)."));
    lastUndoOperation = null;
    return false;
  }
  
  // Restore jobs by removing from processed and adding back to unprocessed
  const processedData = await loadProcessedJobs();
  const db = await loadJobsDatabase();
  
  // Remove from processed
  lastUndoOperation.links.forEach(link => {
    processedData.processedLinks.delete(link);
  });
  processedData.totalProcessed = processedData.processedLinks.size;
  await saveProcessedJobs(processedData);
  
  // Note: We don't re-add to unprocessed because they should still be in the original fetch
  // Just removing from processed is enough
  
  console.log(chalk.green(`\n✓ Undid marking of ${lastUndoOperation.links.length} job(s).`));
  const undoneCount = lastUndoOperation.links.length;
  lastUndoOperation = null;
  
  if (currentSession) {
    currentSession.jobsMarked -= undoneCount;
  }
  
  return true;
}

/**
 * Save a filter preset
 */
async function saveFilterPreset(name: string, prefs: UserPreferences): Promise<void> {
  const preset: FilterPreset = {
    name,
    acceptedTitles: Array.from(prefs.acceptedTitles),
    rejectedTitles: Array.from(prefs.rejectedTitles),
    createdAt: new Date().toISOString(),
  };
  
  if (!prefs.presets) {
    prefs.presets = [];
  }
  
  // Replace if exists
  const existingIndex = prefs.presets.findIndex(p => p.name === name);
  if (existingIndex >= 0) {
    prefs.presets[existingIndex] = preset;
  } else {
    prefs.presets.push(preset);
  }
  
  await saveUserPreferences(prefs);
  console.log(chalk.green(`\\n✓ Saved filter preset: "${name}"`));
}

/**
 * Load a filter preset
 */
async function loadFilterPreset(name: string): Promise<UserPreferences | null> {
  const prefs = await loadUserPreferences();
  
  if (!prefs.presets) {
    console.log(chalk.yellow("\\n⚠ No presets found."));
    return null;
  }
  
  const preset = prefs.presets.find(p => p.name === name);
  if (!preset) {
    console.log(chalk.yellow(`\\n⚠ Preset "${name}" not found.`));
    return null;
  }
  
  prefs.acceptedTitles = new Set(preset.acceptedTitles);
  prefs.rejectedTitles = new Set(preset.rejectedTitles);
  
  await saveUserPreferences(prefs);
  console.log(chalk.green(`\\n✓ Loaded filter preset: "${name}"`));
  
  return prefs;
}

/**
 * List all filter presets
 */
async function listFilterPresets(): Promise<void> {
  const prefs = await loadUserPreferences();
  
  if (!prefs.presets || prefs.presets.length === 0) {
    console.log(chalk.yellow("\\nNo saved presets."));
    return;
  }
  
  console.log("\\n" + chalk.bold.blue("Saved Filter Presets:"));
  prefs.presets.forEach((preset, idx) => {
    console.log(chalk.cyan(`  ${idx + 1}. ${chalk.bold(preset.name)}`));
    console.log(chalk.gray(`     Accepted: ${preset.acceptedTitles.length}, Rejected: ${preset.rejectedTitles.length}`));
    console.log(chalk.gray(`     Created: ${new Date(preset.createdAt).toLocaleDateString()}`));
  });
  console.log("");
}

// --- NEW FEATURE: DYNAMIC TITLE GROUPING ---

/**
 * Analyzes jobs and presents interactive title selection to user
 */
async function promptForTitlePreferences(jobs: JobListing[]): Promise<UserPreferences> {
  const prefs = await loadUserPreferences();
  
  // Extract and count role keywords
  const keywordCounts = new Map<string, number>();
  for (const job of jobs) {
    const keywords = extractRoleKeywords(job.role);
    for (const keyword of keywords) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
    }
  }
  
  // Sort by frequency
  const sortedKeywords = Array.from(keywordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25); // Top 25 most common
  
  if (sortedKeywords.length === 0) {
    return prefs;
  }
  
  console.log("\n" + chalk.cyan("═".repeat(60)));
  console.log(chalk.bold.cyan("🎯  JOB TITLE FILTER CONFIGURATION"));
  console.log(chalk.cyan("═".repeat(60)));
  console.log(chalk.white(`Found ${chalk.bold.yellow(sortedKeywords.length)} common role types\n`));
  
  // Show current preferences
  if (prefs.acceptedTitles.size > 0 || prefs.rejectedTitles.size > 0) {
    console.log(chalk.bold.white("Current Filters:"));
    if (prefs.acceptedTitles.size > 0) {
      console.log(chalk.green(`  ✓ Accepted: ${Array.from(prefs.acceptedTitles).join(', ')}`));
    }
    if (prefs.rejectedTitles.size > 0) {
      console.log(chalk.red(`  ✗ Rejected: ${Array.from(prefs.rejectedTitles).join(', ')}`));
    }
    console.log("");
  }
  
  // Ask if user wants to update
  const shouldUpdate = await confirm({
    message: "Update title filters?",
    default: prefs.acceptedTitles.size === 0 && prefs.rejectedTitles.size === 0,
  });
  
  if (!shouldUpdate) {
    return prefs;
  }
  
  // Create choices with frequency counts
  const choices = sortedKeywords.map(([keyword, count]) => ({
    name: `${keyword} (${count} jobs)`,
    value: keyword,
    checked: false,
  }));
  
  console.log(chalk.gray("\n💡 Tip: Use ") + chalk.bold.white("↑/↓") + chalk.gray(" to navigate, ") + chalk.bold.white("Space") + chalk.gray(" to select, ") + chalk.bold.white("Enter") + chalk.gray(" to confirm, ") + chalk.bold.white("a") + chalk.gray(" to toggle all\n"));
  
  // ACCEPTED TITLES - Multi-select
  const acceptedChoices = choices.map(c => ({
    ...c,
    checked: prefs.acceptedTitles.has(c.value),
  }));
  
  const acceptedTitles = await checkbox({
    message: "Select job titles to ACCEPT (leave empty to accept all):",
    choices: acceptedChoices,
    pageSize: 15,
  });
  
  // REJECTED TITLES - Multi-select
  const rejectedChoices = choices.map(c => ({
    ...c,
    checked: prefs.rejectedTitles.has(c.value),
  }));
  
  const rejectedTitles = await checkbox({
    message: "Select job titles to REJECT (these will be filtered out):",
    choices: rejectedChoices,
    pageSize: 15,
  });
  
  // Update preferences
  prefs.acceptedTitles = new Set(acceptedTitles);
  prefs.rejectedTitles = new Set(rejectedTitles);
  
  await saveUserPreferences(prefs);
  
  // Show summary
  console.log("\n" + chalk.green("─".repeat(60)));
  console.log(chalk.bold.green("✓ Filters Updated:"));
  if (acceptedTitles.length > 0) {
    console.log(chalk.green(`  ✓ Accepting: `) + chalk.white(acceptedTitles.join(', ')));
  } else {
    console.log(chalk.green(`  ✓ Accepting: `) + chalk.yellow(`ALL (no whitelist)`));
  }
  if (rejectedTitles.length > 0) {
    console.log(chalk.red(`  ✗ Rejecting: `) + chalk.white(rejectedTitles.join(', ')));
  }
  console.log(chalk.green("─".repeat(60)) + "\n");
  
  return prefs;
}

// --- CORE ACTIONS ---

async function updateAllSources(): Promise<void> {
  await initializeDataDirectory();
  
  const db = await loadJobsDatabase();
  const processedData = await loadProcessedJobs();
  
  console.log("\n" + chalk.bold.blue("╔" + "═".repeat(58) + "╗"));
  console.log(chalk.bold.blue("║") + chalk.bold.cyan(" 🌐  FETCHING JOBS FROM SOURCES".padEnd(58)) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("╚" + "═".repeat(58) + "╝"));
  
  // 1. Fetch all raw jobs first (SimplifyJobs sources with year templates)
  const allFetchedJobs: JobListing[] = [];
  const currentYear = CONFIG.BASE_YEAR;
  
  for (const source of CONFIG.GITHUB_SOURCES) {
    const result = await fetchWithYearFallback(source.urlTemplate, currentYear);
    
    if (!result.success || !result.content) {
      console.log(chalk.yellow(`⚠ Failed to fetch ${source.name}: ${result.error}`));
      continue;
    }
    
    const displayUrl = source.displayUrlTemplate.replace("{YEAR}", String(result.year));
    const jobs = parseHTMLTable(result.content, displayUrl);
    allFetchedJobs.push(...jobs);
    console.log(chalk.green(`✓ Found ${jobs.length} jobs from ${source.name} (${result.year})`));
  }
  
  // 2. Fetch jobright-ai sources with dynamic year detection
  const jobrightJobs = await fetchJobrightAISources();
  allFetchedJobs.push(...jobrightJobs);
  
  // 3. Sort all jobs by date according to ordering config
  const sortedJobs = sortJobsByDate(allFetchedJobs, CONFIG.JOB_ORDERING);
  console.log(chalk.gray(`\n📅 Jobs sorted by: ${CONFIG.JOB_ORDERING === "newest" ? "newest first" : "oldest first"}`));
  
  // 4. Prompt for Title Preferences
  const prefs = await promptForTitlePreferences(sortedJobs);
  
  console.log("\n" + chalk.cyan("⚙️  Applying filters and updating database..."));
  
  let totalNewJobs = 0;
  let totalAlreadyProcessed = 0;
  let totalFilteredOut = 0;
  
  // Track seen links to prevent duplicates within the database
  const seenLinks = new Set<string>(db.unprocessed.map(j => j.applicationLink));
  
  for (const job of sortedJobs) {
    // Check global processed list
    if (processedData.processedLinks.has(job.applicationLink)) {
      totalAlreadyProcessed++;
      continue;
    }
    
    // Check User Preferences
    if (!matchesPreferences(job.role, prefs)) {
      totalFilteredOut++;
      continue;
    }
    
    // Check if already in unprocessed queue
    if (!seenLinks.has(job.applicationLink)) {
      db.unprocessed.push(job);
      seenLinks.add(job.applicationLink);
      totalNewJobs++;
    }
  }
  
  // 5. Sort the unprocessed queue by date as well
  db.unprocessed = sortJobsByDate(db.unprocessed, CONFIG.JOB_ORDERING);
  
  await saveJobsDatabase(db);
  
  console.log("\n" + chalk.bold.magenta("╔" + "═".repeat(58) + "╗"));
  console.log(chalk.bold.magenta("║") + chalk.bold.white(" 📊  UPDATE SUMMARY".padEnd(58)) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("╠" + "═".repeat(58) + "╣"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Fetched Total:      ${chalk.bold.cyan(sortedJobs.length.toString().padStart(5))}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  New Added:          ${chalk.bold.green(totalNewJobs.toString().padStart(5))}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Filtered (Title):   ${chalk.bold.yellow(totalFilteredOut.toString().padStart(5))}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Already Processed:  ${chalk.bold.gray(totalAlreadyProcessed.toString().padStart(5))}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Total Queue Size:   ${chalk.bold.blue(db.unprocessed.length.toString().padStart(5))}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("╚" + "═".repeat(58) + "╝"));
  console.log("\n" + chalk.bold.green("✓ Update complete!") + "\n");
  
  // Show analytics if we have new jobs
  if (sortedJobs.length > 0) {
    analyzeJobs(sortedJobs);
  }
}

async function markJobsAsProcessed(links: string[]): Promise<void> {
  const processedData = await loadProcessedJobs();
  
  links.forEach((link) => processedData.processedLinks.add(link));
  processedData.totalProcessed = processedData.processedLinks.size;
  await saveProcessedJobs(processedData);

  const db = await loadJobsDatabase();
  db.processed.push(...links);
  
  const linksSet = new Set(links);
  db.unprocessed = db.unprocessed.filter(
    (job) => !linksSet.has(job.applicationLink)
  );
  
  // If we removed jobs, ensure currentIndex is still valid
  if (db.currentIndex >= db.unprocessed.length) {
    db.currentIndex = Math.max(0, db.unprocessed.length - 1);
  }
  
  await saveJobsDatabase(db);
}

/**
 * Main application loop with advanced features
 */
async function openJobsInBatches(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  // Initialize session tracking
  startSession();

  try {
    const db = await loadJobsDatabase();

    if (db.unprocessed.length === 0) {
      console.log(chalk.yellow("No unprocessed jobs found. Run ") + chalk.cyan("'update'") + chalk.yellow(" command first."));
      return;
    }

    // Use stored index
    let startIndex = db.currentIndex || 0;
    if (startIndex === undefined || startIndex === null) {
      startIndex = 0;
    }
    
    console.log("\n" + chalk.bold.blue("╔" + "═".repeat(58) + "╗"));
    console.log(chalk.bold.blue("║") + chalk.bold.cyan(" 💼  JOB APPLICATION QUEUE".padEnd(58)) + chalk.bold.blue("║"));
    console.log(chalk.bold.blue("╠" + "═".repeat(58) + "╣"));
    console.log(chalk.bold.blue("║") + chalk.white(`  Total Unprocessed:  ${chalk.bold.yellow(db.unprocessed.length)}`).padEnd(67) + chalk.bold.blue("║"));
    console.log(chalk.bold.blue("║") + chalk.white(`  Starting from:      ${chalk.bold.green(startIndex)}`).padEnd(67) + chalk.bold.blue("║"));
    console.log(chalk.bold.blue("╚" + "═".repeat(58) + "╝"));
    console.log(chalk.gray("\n💡 Shortcuts: ") + chalk.white("1-5") + chalk.gray(" mark job | ") + chalk.white("s") + chalk.gray(" skip | ") + chalk.white("a") + chalk.gray(" mark all | ") + chalk.white("p#") + chalk.gray(" preview | ") + chalk.white("u") + chalk.gray(" undo | ") + chalk.white("/") + chalk.gray(" search | ") +chalk.white("q") + chalk.gray(" quit"));
    
    while (startIndex < db.unprocessed.length) {
      const endIndex = Math.min(startIndex + CONFIG.BATCH_SIZE, db.unprocessed.length);
      const batch = db.unprocessed.slice(startIndex, endIndex);
      
      // Update session stats
      if (currentSession) {
        currentSession.jobsViewed += batch.length;
      }
      
      console.log("\n" + chalk.bold.cyan("┌" + "─".repeat(58) + "┐"));
      console.log(chalk.bold.cyan("│") + chalk.bold.white(` 📦 Batch [Jobs ${startIndex+1}-${endIndex}] of ${db.unprocessed.length}`.padEnd(58)) + chalk.bold.cyan("│"));
      console.log(chalk.bold.cyan("└" + "─".repeat(58) + "┘"));

      // Display jobs with smart company grouping (O(n) single pass)
      let lastCompany = '';
      batch.forEach((job, idx) => {
        const jobNum = chalk.bold.cyan(`${startIndex + idx + 1}.`);
        const isSameCompany = job.company === lastCompany;
        const relTime = chalk.green(getRelativeTime(job.age));
        
        if (isSameCompany) {
          // Grouped job under same company - show with continuation arrow
          const role = chalk.yellow(job.role);
          console.log(`\n${jobNum} ${chalk.gray('└─')} ${role}`);
          console.log(chalk.gray(`      📍 ${job.location} ${chalk.dim('|')} 📅 ${job.terms} ${chalk.dim('|')} ⏰ ${relTime}`));
        } else {
          // New company - show full header
          const company = chalk.bold.white(job.company);
          const role = chalk.yellow(job.role);
          console.log(`\n${jobNum} ${company} ${chalk.gray('·')} ${role}`);
          console.log(chalk.gray(`   📍 ${job.location} ${chalk.dim('|')} 📅 ${job.terms} ${chalk.dim('|')} ⏰ ${relTime}`));
          lastCompany = job.company;
        }
      });

      console.log("\n" + chalk.gray("─".repeat(60)));
      const answer = (await rl.question(chalk.bold.white("\n❯ ") + "Your action: "))
        .trim()
        .toLowerCase();

      // QUICK ACTIONS
      
      // 1-5: Mark specific job
      if (answer >= '1' && answer <= '5') {
        const jobIndex = parseInt(answer) - 1;
        if (jobIndex < batch.length) {
          const job = batch[jobIndex];
          const links = [job.applicationLink];
          saveUndoOperation('mark_single', links);
          await markJobsAsProcessed(links);
          console.log(chalk.green(`\n✓ Marked job #${startIndex + jobIndex + 1}: ${job.company} - ${job.role}`));
          if (currentSession) currentSession.jobsMarked++;
          const freshDb = await loadJobsDatabase();
          db.unprocessed = freshDb.unprocessed;
          continue;
        } else {
          console.log(chalk.yellow(`\n⚠ Invalid job number. This batch has ${batch.length} jobs.`));
          continue;
        }
      }
      
      // s: Skip
      if (answer === 's' || answer === 'skip') {
        startIndex += CONFIG.BATCH_SIZE;
        db.currentIndex = startIndex;
        await saveJobsDatabase(db);
        console.log(chalk.cyan("\n→ Skipped batch"));
        if (currentSession) currentSession.batchesProcessed++;
        continue;
      }
      
      // a: Mark all
      if (answer === 'a' || answer === 'all') {
        const links = batch.map(j => j.applicationLink);
        saveUndoOperation('mark_batch', links);
        await markJobsAsProcessed(links);
        console.log(chalk.bold.green(`\n✓ Marked all ${batch.length} jobs as processed!`));
        if (currentSession) {
          currentSession.jobsMarked += batch.length;
          currentSession.batchesProcessed++;
        }
        const freshDb = await loadJobsDatabase();
        db.unprocessed = freshDb.unprocessed;
        continue;
      }
      
      // p#: Preview
      if (answer.startsWith('p')) {
        const numStr = answer.substring(1).trim();
        const jobIndex = parseInt(numStr) - 1;
        if (!isNaN(jobIndex) && jobIndex >= 0 && jobIndex < batch.length) {
          const job = batch[jobIndex];
          console.log("\n" + chalk.bold.blue("═".repeat(60)));
          console.log(chalk.bold.cyan("📋 JOB PREVIEW"));
          console.log(chalk.bold.blue("═".repeat(60)));
          console.log(chalk.white(`Company:  ${chalk.bold(job.company)}`));
          console.log(chalk.white(`Role:     ${chalk.yellow(job.role)}`));
          console.log(chalk.white(`Location: ${chalk.gray(job.location)}`));
          console.log(chalk.white(`Terms:    ${chalk.gray(job.terms)}`));
          console.log(chalk.white(`Age:      ${chalk.green(getRelativeTime(job.age))}`));
          console.log(chalk.white(`Link:     ${chalk.cyan(job.applicationLink)}`));
          console.log(chalk.white(`Source:   ${chalk.dim(job.source)}`));
          console.log(chalk.bold.blue("═".repeat(60)));
          continue;
        } else {
          console.log(chalk.yellow("\n⚠ Invalid job number for preview"));
          continue;
        }
      }
      
      // u: Undo
      if (answer === 'u' || answer === 'undo') {
        await performUndo();
        const freshDb = await loadJobsDatabase();
        db.unprocessed = freshDb.unprocessed;
        continue;
      }
      
      // /: Search (basic implementation)
      if (answer === '/' || answer === 'search') {
        const query = await rl.question(chalk.cyan("\nSearch (company or role): "));
        const searchTerm = query.toLowerCase();
        const filteredJobs = db.unprocessed.filter(job => 
          job.company.toLowerCase().includes(searchTerm) || 
          job.role.toLowerCase().includes(searchTerm)
        );
        
        if (filteredJobs.length === 0) {
          console.log(chalk.yellow(`\n⚠ No jobs found matching "${query}"`));
        } else {
          console.log(chalk.green(`\n✓ Found ${filteredJobs.length} jobs matching "${query}":`));
          filteredJobs.slice(0, 10).forEach((job, idx) => {
            console.log(chalk.white(`  ${idx + 1}. ${chalk.bold(job.company)} - ${chalk.yellow(job.role)}`));
          });
          if (filteredJobs.length > 10) {
            console.log(chalk.gray(`  ... and ${filteredJobs.length - 10} more`));
          }
        }
        continue;
      }

      // q: Quit
      if (answer === 'q' || answer === 'quit') {
        db.currentIndex = startIndex;
        await saveJobsDatabase(db);
        showSessionSummary();
        console.log(chalk.green("\n👋 Goodbye!\n"));
        break;
      }

      // m: Mark batch
      if (answer === 'm' || answer === 'mark') {
        const links = batch.map((job) => job.applicationLink);
        saveUndoOperation('mark_batch', links);
        await markJobsAsProcessed(links);
        console.log(chalk.bold.green("\n✓ Batch marked as processed!"));
        if (currentSession) {
          currentSession.jobsMarked += batch.length;
          currentSession.batchesProcessed++;
        }
        const freshDb = await loadJobsDatabase();
        db.unprocessed = freshDb.unprocessed;
        continue; 
      }

      // n: Next
      if (answer === 'n' || answer === 'next' || answer === 'no') {
        startIndex += CONFIG.BATCH_SIZE;
        db.currentIndex = startIndex;
        await saveJobsDatabase(db);
        if (currentSession) currentSession.batchesProcessed++;
        continue;
      }

      // y: Yes, open
      if (answer.startsWith('y') || answer === 'yes') {
        await Promise.all(
          batch.map((job) => Bun.$`xdg-open ${job.applicationLink}`.nothrow())
        );

        const markAnswer = (
          await rl.question(chalk.white("\nMark as processed? (y/n) "))
        ).trim().toLowerCase();

        if (markAnswer.startsWith('y')) {
          const links = batch.map((job) => job.applicationLink);
          saveUndoOperation('mark_batch', links);
          await markJobsAsProcessed(links);
          console.log(chalk.bold.green("\n✓ Batch processed!"));
          if (currentSession) {
            currentSession.jobsMarked += batch.length;
            currentSession.batchesProcessed++;
          }
          const freshDb = await loadJobsDatabase();
          db.unprocessed = freshDb.unprocessed;
        } else {
          startIndex += CONFIG.BATCH_SIZE;
          db.currentIndex = startIndex;
          await saveJobsDatabase(db);
        }
        continue;
      }
      
      // Invalid command
      console.log(chalk.yellow("\n⚠ Invalid command. Try: y/n/m/q or 1-5/s/a/p#/u/"));
    }
    
    if (startIndex >= db.unprocessed.length && db.unprocessed.length > 0) {
      console.log("\n" + chalk.bold.green("🎉 Reached end of job list!"));
      const reset = await rl.question(chalk.bold.white("\n❯ ") + "Start over from beginning? (y/n) ");
      if (reset.toLowerCase().startsWith('y')) {
        db.currentIndex = 0;
        await saveJobsDatabase(db);
        console.log(chalk.green("\n✓ Reset to beginning.\n"));
      }
    }

  } finally {
    rl.close();
  }
}

// --- BOILERPLATE HELPERS ---

async function showHelp(): Promise<void> {
  console.log("\n" + chalk.bold.blue("╔" + "═".repeat(58) + "╗"));
  console.log(chalk.bold.blue("║") + chalk.bold.cyan(" 💼  JOB APPLICATION MANAGER".padEnd(58)) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("╠" + "═".repeat(58) + "╣"));
  console.log(chalk.bold.blue("║") + chalk.bold.white(" Commands:" .padEnd(58)) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.cyan('update')}       Fetch, filter, and save jobs`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.cyan('apply')}        Process jobs (smart shortcuts)`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.cyan('stats')}        Show database statistics`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.cyan('insights')}     Analytics & job insights`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.cyan('export')}       Export jobs (csv/json)`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.cyan('preset')}       Manage filter presets`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.cyan('reset')}        Wipe all data`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("╠" + "═".repeat(58) + "╣"));
  console.log(chalk.bold.blue("║") + chalk.bold.yellow(" Apply Mode Shortcuts:".padEnd(58)) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('1-5')}         Mark specific job`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('s')}           Skip batch`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('a')}           Mark all in batch`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('p#')}          Preview job details (e.g., p1)`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('u')}           Undo last mark (<1min)`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('/')}           Search jobs`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('y')}           Open jobs in browser`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('m')}           Mark batch processed`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('n')}           Next batch`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("║") + chalk.white(`   ${chalk.green('q')}           Quit (saves session stats)`).padEnd(67) + chalk.bold.blue("║"));
  console.log(chalk.bold.blue("╚" + "═".repeat(58) + "╝"));
  console.log("");
}

async function showStats(): Promise<void> {
  const db = await loadJobsDatabase();
  const processed = await loadProcessedJobs();
  const prefs = await loadUserPreferences();
  
  console.log("\n" + chalk.bold.magenta("╔" + "═".repeat(58) + "╗"));
  console.log(chalk.bold.magenta("║") + chalk.bold.white(" 📊  DATABASE STATISTICS".padEnd(58)) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("╠" + "═".repeat(58) + "╣"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Unprocessed Jobs:    ${chalk.bold.yellow(db.unprocessed.length)}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Processed Jobs:      ${chalk.bold.green(processed.totalProcessed)}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Current Index:       ${chalk.bold.cyan(db.currentIndex || 0)}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("╠" + "═".repeat(58) + "╣"));
  console.log(chalk.bold.magenta("║") + chalk.bold.white(" 🎯  FILTER PREFERENCES".padEnd(58)) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Accepted Keywords:   ${chalk.bold.green(prefs.acceptedTitles.size || 'All')}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("║") + chalk.white(`  Rejected Keywords:   ${chalk.bold.red(prefs.rejectedTitles.size || 'None')}`).padEnd(67) + chalk.bold.magenta("║"));
  console.log(chalk.bold.magenta("╚" + "═".repeat(58) + "╝"));
  console.log("");
}

async function resetData(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const ans = await rl.question("Reset ALL data? (y/n) ");
  if (ans.toLowerCase() === 'y') {
    await writeFile(CONFIG.JOBS_FILE, JSON.stringify({ unprocessed: [], processed: [], currentIndex: 0, sources: {} }));
    await writeFile(CONFIG.PROCESSED_FILE, JSON.stringify({ processedLinks: [], totalProcessed: 0 }));
    console.log("Data reset.");
  }
  rl.close();
}

async function main() {
  await initializeDataDirectory();
  const command = process.argv[2] || "help";
  const arg = process.argv[3];
  
  switch (command) {
    case "update": 
      await updateAllSources(); 
      break;
      
    case "apply": 
      await openJobsInBatches(); 
      break;
      
    case "stats": 
      await showStats(); 
      break;
      
    case "insights":
    case "analytics":
      const db = await loadJobsDatabase();
      if (db.unprocessed.length > 0) {
        analyzeJobs(db.unprocessed);
      } else {
        console.log(chalk.yellow("No jobs to analyze. Run 'update' first."));
      }
      break;
      
    case "export":
      if (!arg || !['csv', 'json'].includes(arg)) {
        console.log(chalk.yellow("\nUsage: bun run job-manager.ts export <csv|json>"));
        break;
      }
      const exportDb = await loadJobsDatabase();
      if (exportDb.unprocessed.length === 0) {
        console.log(chalk.yellow("No jobs to export. Run 'update' first."));
        break;
      }
      const timestamp = new Date().toISOString().split('T')[0];
      if (arg === 'csv') {
        await exportToCSV(exportDb.unprocessed, `jobs_${timestamp}.csv`);
      } else {
        await exportToJSON(exportDb.unprocessed, `jobs_${timestamp}.json`);
      }
      break;
      
    case "preset":
      if (!arg) {
        await listFilterPresets();
        break;
      }
      if (arg === 'list') {
        await listFilterPresets();
      } else if (arg === 'save') {
        const name = process.argv[4];
        if (!name) {
          console.log(chalk.yellow("\nUsage: bun run job-manager.ts preset save <name>"));
          break;
        }
        const prefs = await loadUserPreferences();
        await saveFilterPreset(name, prefs);
      } else if (arg === 'load') {
        const name = process.argv[4];
        if (!name) {
          console.log(chalk.yellow("\nUsage: bun run job-manager.ts preset load <name>"));
          break;
        }
        await loadFilterPreset(name);
      } else {
        console.log(chalk.yellow("\nUsage: bun run job-manager.ts preset <list|save|load> [name]"));
      }
      break;
      
    case "reset": 
      await resetData(); 
      break;
      
    default: 
      await showHelp();
  }
}

main().catch(console.error);