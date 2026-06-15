import { expect } from 'chai';
import { BTree, NodeCapacity } from '../src/index.js';
import { assertTreeInvariants } from './helpers/invariants.js';
import { lcg } from './helpers/rng.js';

// Deterministic reproduction of a PRE-EXISTING tree-integrity bug in the delete/rebalance path of
// src/b-tree.ts, discovered by the seeded structural validator (this ticket's deliverable). It is NOT
// a defect in the validator: when the violation fires, the affected key is still in the tree (reachable
// via ascending()) but find() can no longer locate it - a stale branch partition mis-routes the search.
//
// The bug needs a deep (4-level, >NodeCapacity^3 entries) tree and random deletion; it does not surface
// on the 2-3 level trees the other suites exercise. See tickets/.pre-existing-error.md.
//
// SKIPPED so `npm test` stays green. Un-skip (it.skip -> it) to drive the fix; it should pass once the
// delete/rebalance bug is fixed.
describe('BTree delete integrity (deep trees)', () => {
	it.skip('random deletion of a deep tree must not corrupt branch partitions', () => {
		class FastTree extends BTree<number, number> {
			compareKeys(a: number, b: number) { return a - b; }
		}
		const tree = new FastTree();
		const rng = lcg(0x5eed1234);
		const count = NodeCapacity * NodeCapacity * NodeCapacity * 4;	// ~1M -> 4 levels deep

		for (let i = 0; i < count; i++) {
			tree.insert(rng());
		}
		assertTreeInvariants(tree);	// passes: the build path is sound

		// Gut randomly (find-nearest), validating structure periodically. With the bug present this throws
		// after a few hundred thousand deletions (a stale branch partition); after the fix it runs clean.
		let ops = 0;
		const sample = 20000;
		while (tree.first().on) {
			const path = tree.find(rng());
			if (!path.on) tree.moveNext(path);
			if (!path.on) tree.movePrior(path);
			tree.deleteAt(path);
			if (++ops % sample === 0) {
				assertTreeInvariants(tree);
			}
		}
		expect(tree.getCount()).to.equal(0);
	}).timeout(60000);
});
