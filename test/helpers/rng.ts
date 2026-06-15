// Seeded pseudo-random helpers for deterministic, reproducible tests. Replaces unseeded Math.random(),
// so a failure from a corrupting borrow/merge can be reproduced from its seed.

/**
 * Linear congruential generator (Numerical Recipes constants: a=1664525, c=1013904223, m=2^32).
 * Full period over 2^32, which is plenty for test-scale sequences.
 * @param seed any integer; coerced to an unsigned 32-bit value.
 * @returns a function that yields successive floats in the half-open range [0, 1).
 */
export function lcg(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		// Math.imul performs the multiply with correct 32-bit overflow; >>> 0 keeps state unsigned.
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;	// divide by 2^32 -> [0, 1)
	};
}

/**
 * Draws an integer in the half-open range [lo, hi) from the given generator.
 * @param rng a generator as returned by {@link lcg}.
 * @param lo inclusive lower bound.
 * @param hi exclusive upper bound (must be > lo).
 */
export function lcgInt(rng: () => number, lo: number, hi: number): number {
	return lo + Math.floor(rng() * (hi - lo));
}

/**
 * Fisher–Yates shuffle. Non-mutating: returns a new array with the elements of `arr` in shuffled order.
 * @param arr the array to shuffle (left untouched).
 * @param rng a generator as returned by {@link lcg}.
 */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}
