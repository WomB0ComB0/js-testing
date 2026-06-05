/**
 * Minimal CLI flag parsing shared across tech-week scripts.
 *
 * Pattern: `--flag value` or boolean `--flag`. Values can't start with `--`.
 * Order-independent. No subcommands, no clustering.
 */

export function getArg(flag: string): string | undefined {
	const idx = process.argv.indexOf(flag);
	if (idx === -1) return undefined;
	const next = process.argv[idx + 1];
	if (!next || next.startsWith("--")) return undefined;
	return next;
}

export function hasFlag(flag: string): boolean {
	return process.argv.includes(flag);
}
