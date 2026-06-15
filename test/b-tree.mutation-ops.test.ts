import { expect } from 'chai';
import { BTree, NodeCapacity } from '../src/index.js';
import { BranchNode, ITreeNode, LeafNode } from '../src/nodes.js';
import { assertTreeInvariants } from './helpers/invariants.js';
import { lcg, lcgInt, shuffle } from './helpers/rng.js';

// Multi-level (>= 2-level, > NodeCapacity entries) coverage for the three mutation entry points that the
// rest of the suite only exercises on a single 3-element leaf (test/b-tree.one-leaf.test.ts): upsert,
// merge, and updateAt - including updateAt's key-change path, which does an insert + delete
// (src/b-tree.ts internalUpdate) and so drives both split and rebalance at branch scale.
//
// Two construction styles are used, matching the rest of the suite:
//   * Manual node assembly (assigning (tree as any)['_root'] directly, as in b-tree.branch-rebalance.test
//     and the bug #1 / root-split cases in b-tree.branching.test) when a test needs a leaf to sit at a
//     known fill so a single op deterministically forces a split or a rebalance.
//   * The public insert() API for value-only tests, where only depth (not exact fill) matters.
//
// assertTreeInvariants (the prior ticket's deliverable) is asserted after every structural op; it already
// checks fill bounds, partition separation, strict global order, bidirectional agreement and count, so the
// per-test assertions layer the operation's own contract (return-path `on`/`wasUpdate` semantics and the
// exact surviving key set) on top of that structural floor.

interface Entry { id: number; value: string }

const C = NodeCapacity;	// 64
const MIN = C >>> 1;	// 32 = minimum fill for a non-root leaf

// --- construction / inspection helpers ---------------------------------------------------------------

// Minimum key reachable from a node (descend leftmost), used to derive branch partitions.
const minKey = (node: ITreeNode): number => {
	let n: any = node;
	while (n instanceof BranchNode) n = n.nodes[0];
	return (n as LeafNode<number>).entries[0];
};

// A branch whose partitions follow the tree's invariant: partition[i] === min key of nodes[i+1].
const branchOf = (children: ITreeNode[]): BranchNode<number> =>
	new BranchNode<number>(children.slice(1).map(minKey), children);

const leafOf = (entries: number[]): LeafNode<number> => new LeafNode(entries);

// Contiguous run [start, start + count).
const seq = (start: number, count: number): number[] => Array.from({ length: count }, (_, i) => start + i);

// Full in-order entry list via the public navigation API. ascending() re-yields the same mutated path, so
// the entry must be read inside the loop (never spread into an array).
const ascendingValues = <T>(tree: BTree<any, T>): T[] => {
	const out: T[] = [];
	for (const p of tree.ascending(tree.first())) out.push(tree.at(p)!);
	return out;
};

// A shape fingerprint (partition keys + leaf fill counts, recursively) - deep-equal before/after a
// value-only op proves no split/rebalance/rebuild occurred.
const structureOf = (node: ITreeNode): any => {
	if (node instanceof LeafNode) return ['leaf', node.entries.length];
	const b = node as BranchNode<unknown>;
	return ['branch', [...b.partitions], b.nodes.map(structureOf)];
};
const shapeOf = (tree: BTree<any, any>) => structureOf((tree as any)['_root']);

describe('Multi-level mutation ops (upsert / merge / updateAt)', () => {

	describe('upsert', () => {
		let tree: BTree<number, number>;
		beforeEach(() => { tree = new BTree<number, number>(); });

		it('inserting a new key splits a full leaf (split lands in the old leaf, delta 0)', () => {
			// root -> 4 full leaves, spaced so a fresh key lands strictly inside the second leaf.
			const root = branchOf([leafOf(seq(0, C)), leafOf(seq(1000, C)), leafOf(seq(2000, C)), leafOf(seq(3000, C))]);
			(tree as any)['_root'] = root;
			assertTreeInvariants(tree);
			const before = ascendingValues(tree);	// 256 keys

			const NEW = 1030.5;	// between 1030 and 1031 -> crack at index 31 of the full leaf [1000..1063]
			const result = tree.upsert(NEW);

			expect(result.on, 'new-key upsert leaves the path on the crack before the new row').to.be.false;
			expect(tree.at(tree.next(result)), 'next() off the crack lands on the new entry').to.equal(NEW);
			assertTreeInvariants(tree);
			expect(root.nodes.length, 'the leaf split added one child to the root branch').to.equal(5);
			expect(tree.find(NEW).branches.length, 'height unchanged (still 2-level)').to.equal(1);
			expect(tree.get(NEW)).to.equal(NEW);
			expect(ascendingValues(tree)).to.deep.equal([...before, NEW].sort((a, b) => a - b));
		});

		it('inserting a new key at a full leaf tail splits with the new key in the new leaf (delta 1)', () => {
			const root = branchOf([leafOf(seq(0, C)), leafOf(seq(1000, C)), leafOf(seq(2000, C))]);
			(tree as any)['_root'] = root;
			assertTreeInvariants(tree);
			const before = ascendingValues(tree);

			const NEW = 1500;	// > 1063, <= next leaf min -> crack at the tail (index 64) of the full leaf
			const result = tree.upsert(NEW);

			expect(result.on).to.be.false;
			expect(tree.at(tree.next(result))).to.equal(NEW);
			assertTreeInvariants(tree);
			expect(root.nodes.length).to.equal(4);
			expect(tree.get(NEW)).to.equal(NEW);
			expect(ascendingValues(tree)).to.deep.equal([...before, NEW].sort((a, b) => a - b));
		});

		it('upserting an existing key replaces the value in place with no structural change', () => {
			// Value-only semantics need a dict tree (key distinct from value); depth (not fill) is what matters,
			// so build via the public API.
			const dict = new BTree<number, Entry>(e => e.id);
			for (const id of seq(0, 300)) dict.insert({ id, value: `v${id}` });
			assertTreeInvariants(dict);

			const target = 150;
			expect(dict.find(target).branches.length, 'target sits below a branch (multi-level)').to.be.greaterThan(0);
			const beforeShape = shapeOf(dict);
			const rootBefore = (dict as any)['_root'];

			const result = dict.upsert({ id: target, value: 'UPDATED' });

			expect(result.on, 'existing-key upsert leaves the path on the entry').to.be.true;
			expect(dict.at(result)).to.deep.equal({ id: target, value: 'UPDATED' });
			expect(dict.get(target)!.value).to.equal('UPDATED');
			expect((dict as any)['_root'], 'same root object: no rebuild').to.equal(rootBefore);
			expect(shapeOf(dict), 'identical shape: no split/rebalance').to.deep.equal(beforeShape);
			expect(dict.getCount()).to.equal(300);
			assertTreeInvariants(dict);
		});
	});

	describe('merge', () => {
		let tree: BTree<number, number>;
		beforeEach(() => { tree = new BTree<number, number>(); });

		it('insert branch: a merge of an absent key splits a full leaf and leaves the path on the new row', () => {
			const root = branchOf([leafOf(seq(0, C)), leafOf(seq(1000, C)), leafOf(seq(2000, C))]);
			(tree as any)['_root'] = root;
			assertTreeInvariants(tree);
			const before = ascendingValues(tree);

			const NEW = 1020.5;
			const [path, wasUpdate] = tree.merge(NEW, () => { throw new Error('getUpdated must not run on the insert branch'); });

			expect(wasUpdate, 'absent key -> inserted, not updated').to.be.false;
			expect(path.on, 'merge leaves the path ON the new row (unlike upsert)').to.be.true;
			expect(tree.at(path)).to.equal(NEW);
			assertTreeInvariants(tree);
			expect(root.nodes.length, 'the insert split added a child').to.equal(4);
			expect(ascendingValues(tree)).to.deep.equal([...before, NEW].sort((a, b) => a - b));
		});

		it('update branch: a merge of a present key updates the value in place with no structural change', () => {
			const dict = new BTree<number, Entry>(e => e.id);
			for (const id of seq(0, 300)) dict.insert({ id, value: `v${id}` });
			assertTreeInvariants(dict);

			const target = 120;
			expect(dict.find(target).branches.length).to.be.greaterThan(0);
			const beforeShape = shapeOf(dict);

			// newEntry is ignored because the key is present; getUpdated keeps the same id (so it is a value-only
			// update, no key change) and bumps the value.
			const [path, wasUpdate] = dict.merge({ id: target, value: 'IGNORED' }, existing => ({ id: existing.id, value: existing.value + '!' }));

			expect(wasUpdate, 'present key -> updated').to.be.true;
			expect(path.on).to.be.true;
			expect(dict.at(path)).to.deep.equal({ id: target, value: `v${target}!` });
			expect(shapeOf(dict), 'value-only update preserves shape').to.deep.equal(beforeShape);
			expect(dict.getCount()).to.equal(300);
			assertTreeInvariants(dict);
		});

		it('conflict: getUpdated returning an already-present key leaves the path off and the tree unchanged', () => {
			const root = branchOf([leafOf(seq(0, MIN)), leafOf(seq(100, MIN)), leafOf(seq(200, MIN))]);
			(tree as any)['_root'] = root;
			assertTreeInvariants(tree);
			const before = ascendingValues(tree);
			const beforeShape = shapeOf(tree);

			// 5 is present; getUpdated relocates it onto 205, which is also present -> the underlying insert fails.
			const [path, wasUpdate] = tree.merge(5, () => 205);

			expect(path.on, 'conflict -> returned path not on').to.be.false;
			expect(wasUpdate, 'key-change attempt is reported as a non-update').to.be.false;
			expect(tree.get(5), 'original key still present').to.equal(5);
			expect(tree.get(205), 'conflicting key still present').to.equal(205);
			expect(ascendingValues(tree), 'no key moved').to.deep.equal(before);
			expect(shapeOf(tree), 'tree shape untouched').to.deep.equal(beforeShape);
			assertTreeInvariants(tree);
		});
	});

	describe('updateAt — same key (value only)', () => {
		it('updating with an unchanged key deep in the tree preserves structure and order', () => {
			const dict = new BTree<number, Entry>(e => e.id);
			for (const id of seq(0, 5000)) dict.insert({ id, value: `v${id}` });
			assertTreeInvariants(dict);

			const target = 2500;
			expect(dict.find(target).branches.length, 'genuinely deep (>= 3 levels)').to.be.greaterThanOrEqual(2);
			const beforeShape = shapeOf(dict);
			const rootBefore = (dict as any)['_root'];

			const [path, wasUpdate] = dict.updateAt(dict.find(target), { id: target, value: 'DEEP' });

			expect(wasUpdate, 'same key -> update, not insert').to.be.true;
			expect(path.on).to.be.true;
			expect(dict.at(path)).to.deep.equal({ id: target, value: 'DEEP' });
			expect((dict as any)['_root'], 'no rebuild').to.equal(rootBefore);
			expect(shapeOf(dict), 'no split/rebalance').to.deep.equal(beforeShape);
			expect(dict.getCount()).to.equal(5000);
			assertTreeInvariants(dict);
		});
	});

	describe('updateAt — key change', () => {
		let tree: BTree<number, number>;
		beforeEach(() => { tree = new BTree<number, number>(); });

		it('(a) the new key lands in a different full leaf, forcing a split there', () => {
			// Old key lives in a leaf with spare room (its delete won't rebalance), isolating the split that the
			// inserted new key forces in the full middle leaf.
			const root = branchOf([leafOf(seq(0, MIN + 4)), leafOf(seq(1000, C)), leafOf(seq(2000, MIN + 4))]);
			(tree as any)['_root'] = root;
			assertTreeInvariants(tree);
			const before = ascendingValues(tree);

			const OLD = 2010, NEW = 1030.5;	// NEW lands strictly inside the full leaf [1000..1063]
			const [path, wasUpdate] = tree.updateAt(tree.find(OLD), NEW);

			expect(wasUpdate, 'a key change is reported as an insert (wasUpdate false)').to.be.false;
			expect(path.on).to.be.true;
			expect(tree.at(path)).to.equal(NEW);
			assertTreeInvariants(tree);
			expect(root.nodes.length, 'the insert split added a child; the unrelated delete did not rebalance').to.equal(4);
			expect(tree.get(OLD), 'old key removed').to.be.undefined;
			expect(tree.get(NEW), 'new key present').to.equal(NEW);
			expect(ascendingValues(tree)).to.deep.equal(before.filter(k => k !== OLD).concat(NEW).sort((a, b) => a - b));
		});

		it('(b) removing the old entry forces a leaf merge while the new key inserts elsewhere', () => {
			// root -> [ A(32), B(32), C(32), D(36) ].  NEW inserts into D (room, no split); deleting OLD from B
			// drops it to 31 - no sibling has a spare child (A, C are at the minimum), so B absorbs C (merge right)
			// and the root loses a child.
			const root = branchOf([leafOf(seq(0, MIN)), leafOf(seq(100, MIN)), leafOf(seq(200, MIN)), leafOf(seq(300, MIN + 4))]);
			(tree as any)['_root'] = root;
			assertTreeInvariants(tree);
			const before = ascendingValues(tree);

			const OLD = 110, NEW = 310.5;	// OLD mid-leaf B; NEW strictly inside D
			const [path, wasUpdate] = tree.updateAt(tree.find(OLD), NEW);

			expect(wasUpdate).to.be.false;
			expect(path.on).to.be.true;
			expect(tree.at(path)).to.equal(NEW);
			assertTreeInvariants(tree);
			expect(root.nodes.length, 'B merged C away -> one fewer child').to.equal(3);
			expect(tree.get(OLD)).to.be.undefined;
			expect(tree.get(NEW)).to.equal(NEW);
			expect(ascendingValues(tree)).to.deep.equal(before.filter(k => k !== OLD).concat(NEW).sort((a, b) => a - b));
		});

		it('(c) the new key already exists -> failure path, tree left unchanged', () => {
			const root = branchOf([leafOf(seq(0, MIN)), leafOf(seq(100, MIN)), leafOf(seq(200, MIN))]);
			(tree as any)['_root'] = root;
			assertTreeInvariants(tree);
			const before = ascendingValues(tree);
			const beforeShape = shapeOf(tree);

			const OLD = 110, NEW = 210;	// NEW already present in the last leaf
			const [path, wasUpdate] = tree.updateAt(tree.find(OLD), NEW);

			expect(path.on, 'failure: new key already present').to.be.false;
			expect(wasUpdate).to.be.false;
			expect(tree.get(OLD), 'old entry untouched - no delete happened').to.equal(OLD);
			expect(tree.get(NEW), 'pre-existing key still present').to.equal(NEW);
			expect(ascendingValues(tree)).to.deep.equal(before);
			expect(shapeOf(tree), 'tree shape untouched').to.deep.equal(beforeShape);
			assertTreeInvariants(tree);
		});
	});

	describe('randomized stream vs shadow Map', () => {
		it('a seeded mix of insert/upsert/merge/updateAt/delete stays consistent with a shadow Map', () => {
			const dict = new BTree<number, Entry>(e => e.id);
			const shadow = new Map<number, string>();
			const rng = lcg(0x0badf00d);
			const RANGE = 6000;

			// A present id chosen via the seeded rng (-1 when empty). O(n) per call, fine at test scale.
			const pickPresent = (): number => {
				if (shadow.size === 0) return -1;
				const keys = [...shadow.keys()];
				return keys[lcgInt(rng, 0, keys.length)];
			};

			const checkConsistency = () => {
				const entries = ascendingValues(dict) as Entry[];
				const expectedIds = [...shadow.keys()].sort((a, b) => a - b);
				expect(entries.map(e => e.id)).to.deep.equal(expectedIds);
				for (const e of entries) expect(e.value, `value for id ${e.id}`).to.equal(shadow.get(e.id));
				assertTreeInvariants(dict);
			};

			// Phase 1: bulk-build a genuinely multi-level tree from distinct ids (seeded shuffle for reproducible
			// order) so the mixed stream operates at branch scale. C*C+1 random inserts reliably reach 3 levels.
			for (const id of shuffle(seq(0, C * C + 1), rng)) {
				expect(dict.insert({ id, value: `i${id}` }).on).to.be.true;
				shadow.set(id, `i${id}`);
			}
			assertTreeInvariants(dict);
			expect(dict.find(2048).branches.length, '>= 3 levels deep').to.be.greaterThanOrEqual(2);

			// Phase 2: mixed op stream, sampling full set-equality + structural invariants periodically.
			const OPS = 6000;
			const sampleEvery = 250;
			for (let i = 0; i < OPS; i++) {
				const value = `s${i}`;
				switch (lcgInt(rng, 0, 5)) {
					case 0: {	// insert (no-op when the key is already present)
						const id = lcgInt(rng, 0, RANGE);
						const on = dict.insert({ id, value }).on;
						if (shadow.has(id)) {
							expect(on, `insert of present id ${id} must report on=false`).to.be.false;
						} else {
							expect(on).to.be.true;
							shadow.set(id, value);
						}
						break;
					}
					case 1: {	// upsert (always applies)
						const id = lcgInt(rng, 0, RANGE);
						const r = dict.upsert({ id, value });
						expect(r.on, `upsert path.on for ${shadow.has(id) ? 'existing' : 'new'} id ${id}`).to.equal(shadow.has(id));
						shadow.set(id, value);
						break;
					}
					case 2: {	// merge (insert if absent, value-update if present; getUpdated keeps the key)
						const id = lcgInt(rng, 0, RANGE);
						const present = shadow.has(id);
						const [p, wasUpdate] = dict.merge({ id, value }, existing => ({ id: existing.id, value }));
						expect(p.on).to.be.true;
						expect(wasUpdate, `merge wasUpdate for id ${id}`).to.equal(present);
						shadow.set(id, value);
						break;
					}
					case 3: {	// updateAt, possibly changing the key
						const oldId = pickPresent();
						if (oldId < 0) break;
						const newId = lcgInt(rng, 0, RANGE);
						const [p, wasUpdate] = dict.updateAt(dict.find(oldId), { id: newId, value });
						if (newId === oldId) {	// same-key value update
							expect(p.on).to.be.true;
							expect(wasUpdate).to.be.true;
							shadow.set(oldId, value);
						} else if (shadow.has(newId)) {	// conflict -> no change
							expect(p.on, `conflict updateAt ${oldId}->${newId} must leave path off`).to.be.false;
						} else {	// relocate old -> new
							expect(p.on).to.be.true;
							expect(wasUpdate).to.be.false;
							shadow.delete(oldId);
							shadow.set(newId, value);
						}
						break;
					}
					case 4: {	// delete
						const id = pickPresent();
						if (id < 0) break;
						expect(dict.deleteAt(dict.find(id)), `delete present id ${id}`).to.be.true;
						shadow.delete(id);
						break;
					}
				}
				if (i % sampleEvery === 0) checkConsistency();
			}
			checkConsistency();

			// Final exhaustive comparison.
			const finalEntries = ascendingValues(dict) as Entry[];
			expect(finalEntries.map(e => e.id)).to.deep.equal([...shadow.keys()].sort((a, b) => a - b));
			for (const e of finalEntries) expect(e.value).to.equal(shadow.get(e.id));
		}).timeout(20000);
	});
});
