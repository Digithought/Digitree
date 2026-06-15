import { expect } from 'chai';
import { BTree, NodeCapacity } from '../src/index.js';
import { assertTreeInvariants } from './helpers/invariants.js';
import { lcg } from './helpers/rng.js';

// Regression guard for a tree-integrity bug in the delete/rebalance path of src/b-tree.ts (fixed in
// rebalanceBranch's merge-right case): a borrow/merge left a stale branch partition, so find() could no
// longer locate a key that was still present (still reachable via ascending()) - the stale partition
// mis-routed the search. The seeded structural validator (this ticket's deliverable) surfaced it
// deterministically; this test pins it.
//
// The bug only surfaced on a deep (4-level, >NodeCapacity^3 entries) tree under random deletion; it does
// not appear on the 2-3 level trees the other suites exercise, which is why this dedicated deep-tree case
// exists. It must stay un-skipped: it fails against the pre-fix b-tree.ts and passes against the fix.
describe('BTree delete integrity (deep trees)', () => {
	it('random deletion of a deep tree must not corrupt branch partitions', () => {
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

		// Gut randomly (find-nearest), validating structure periodically. Against the pre-fix b-tree.ts this
		// throws after a few hundred thousand deletions (a stale branch partition); against the fix it runs clean.
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
