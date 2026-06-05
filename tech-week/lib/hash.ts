/**
 * FNV-1a 32-bit string hash. Used to derive stable numeric event ids from
 * UIDs/slugs so two extractor runs over the same source produce the same
 * ids — that keeps geocode caches and any downstream dedup keys stable
 * across re-runs.
 *
 * Collisions over a few-hundred-event calendar are astronomically unlikely.
 */
export function fnv1a32(s: string): number {
	let h = 0x811c_9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x0100_0193);
	}
	return h >>> 0;
}
