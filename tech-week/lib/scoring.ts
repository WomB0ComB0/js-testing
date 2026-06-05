/**
 * Keyword scoring shared by the calendar scrapers. Two callers, two profiles:
 *
 *   PRIORITY_KEYWORDS_TECH (the export here)
 *     Precision-first. Multi-word phrases (`"AI startup"`, `"developer
 *     meetup"`) instead of bare ambiguous terms (`"AI"`, `"founder"`). Pair
 *     with NEGATIVE_KEYWORDS to drop obvious non-tech event titles.
 *     Used by scrape-luma.ts and extract-calendar-from-ics.ts where the
 *     source feed is a general-audience calendar (Luma /nyc, public ICS).
 *
 *   PRIORITY_KEYWORDS_BROAD (callers define their own)
 *     Recall-first. scrape-partiful.ts uses this because tech-week.com has
 *     already filtered to tech events upstream — the broader list catches
 *     more variation without producing false positives.
 *
 * The `buildScorer` factory lets each caller supply its own keyword list.
 */

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface PriorityScore {
	score: number;
	matches: string[];
}

export interface Scorer {
	score(text: string): PriorityScore;
	keywords: readonly string[];
}

/**
 * Build a word-boundary regex matcher per keyword and aggregate matches
 * into a {score, matches} result.
 */
export function buildScorer(keywords: readonly string[]): Scorer {
	const regexes = keywords.map((kw) => ({
		kw,
		re: new RegExp(`\\b${escapeRegex(kw)}\\b`, "i"),
	}));
	return {
		keywords,
		score(text: string): PriorityScore {
			const matches: string[] = [];
			for (const { kw, re } of regexes) {
				if (re.test(text)) matches.push(kw);
			}
			return { score: matches.length, matches };
		},
	};
}

/**
 * Build a single OR-joined regex over a negative-keyword list. Used to drop
 * events whose TITLE contains an obvious non-tech phrase ("5k", "cocktail
 * party", "yoga"). Title-only because legit tech event descriptions often
 * mention parties/drinks without being non-tech.
 */
export function buildNegativeMatcher(
	keywords: readonly string[],
): (name: string) => string | null {
	const joined = keywords.map(escapeRegex).join("|");
	const re = new RegExp(`\\b(${joined})\\b`, "i");
	return (name: string) => {
		const m = name.match(re);
		return m ? m[1] : null;
	};
}

// ---------------------------------------------------------------------------
// Default keyword lists for general-audience tech-week-style sources.
// ---------------------------------------------------------------------------

export const PRIORITY_KEYWORDS_TECH: readonly string[] = [
	// --- Stage / fundraising (specific) ---
	"startup",
	"startups",
	"founders",
	"founding engineer",
	"technical cofounder",
	"seed round",
	"pre-seed",
	"series A",
	"series B",
	"series C",
	"early stage",
	"demo day",
	"pitch competition",
	"pitch event",
	"raising",
	"fundraising",
	"fundraise",
	"GTM",
	// --- Investors ---
	"VC",
	"VCs",
	"venture capital",
	"investor",
	"investors",
	"angel investor",
	"limited partner",
	"LP",
	"GP",
	// --- AI / ML — require tech context, no bare "AI" ---
	"AI startup",
	"AI agent",
	"AI agents",
	"AI engineer",
	"AI developer",
	"AI infrastructure",
	"AI platform",
	"AI model",
	"AI models",
	"AI tool",
	"AI tools",
	"AI/ML",
	"ML engineer",
	"LLM",
	"LLMs",
	"machine learning",
	"deep learning",
	"agentic",
	"GenAI",
	"generative AI",
	// --- Tech themes ---
	"deep tech",
	"frontier tech",
	"hardware startup",
	"robotics",
	// --- Engineering / builder ---
	"developer",
	"developers",
	"developer meetup",
	"dev meetup",
	"dev tools",
	"devtools",
	"tech meetup",
	"tech talk",
	"API",
	"APIs",
	"SDK",
	"open source",
	"hackathon",
];

export const NEGATIVE_KEYWORDS_DEFAULT: readonly string[] = [
	// food / drink-themed
	"cocktail party",
	"wine tasting",
	"fancy food",
	"watch party",
	// craft / lifestyle
	"craft night",
	"book club",
	"reading club",
	"art opening",
	"film screening",
	// fitness / running
	"5k",
	"10k",
	"marathon",
	"mile",
	"yoga",
	"pilates",
	"spin class",
	"bootcamp",
];
