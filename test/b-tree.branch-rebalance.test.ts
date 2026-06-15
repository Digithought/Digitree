import { expect } from 'chai';
import { BTree, NodeCapacity } from '../src/index.js';
import { BranchNode, ITreeNode, LeafNode } from '../src/nodes.js';
import { assertTreeInvariants } from './helpers/invariants.js';
import { lcg, shuffle } from './helpers/rng.js';

// Deterministic coverage of the BRANCH-level rebalance paths in rebalanceBranch (src/b-tree.ts):
// borrow-left, borrow-right, merge-left, merge-right, root-collapse, and a multi-level cascade.
//
// The existing borrow/merge tests in b-tree.branching.test.ts all operate on two leaves under one root,
// so they exercise rebalanceLeaf only - the branch paths are hit only incidentally by the random
// "gut a large tree" tests, never in isolation. These tests build trees >= 3 levels deep by manual
// construction (assigning (tree as any)['_root'] directly, the pattern used by the bug #1 and root-split
// tests) and arrange a single branch to sit exactly at minimum fill so one delete forces each case alone.
//
// Geometry: NodeCapacity = 64, so MinFill = 32. A non-root branch underflows the instant it drops below
// 32 children. A leaf-branch at exactly 32 leaves (each at exactly 32 entries) loses a child when one of
// its leaves merges (31 + 32 = 63 <= 64), dropping the branch to 31 children and triggering the branch
// rebalance we want to observe.

describe('Branch-level rebalance (rebalanceBranch)', () => {
	const C = NodeCapacity;	// 64
	const MIN = C >>> 1;	// 32 = minimum fill for leaves (entries) and branches (children)

	let tree: BTree<number, number>;
	beforeEach(() => {
		tree = new BTree<number, number>();
	});

	// --- construction helpers -------------------------------------------------------------------------
	// Keys are laid out as a single ascending contiguous run (0, 1, 2, ...) drawn from a shared cursor, so
	// the survivor set after deleting one key is simply [0..total) minus that key, and partition keys fall
	// out of the min-key-of-next-child rule automatically.

	const minKey = (node: ITreeNode): number => {
		let n: any = node;
		while (n instanceof BranchNode) n = n.nodes[0];
		return (n as LeafNode<number>).entries[0];
	};

	// Builds a branch whose partitions are the minimum key of each child after the first (the invariant the
	// tree maintains: partition[i] === min key of nodes[i+1]).
	const branchOf = (children: ITreeNode[]): BranchNode<number> =>
		new BranchNode<number>(children.slice(1).map(minKey), children);

	// `leafCount` leaves of `per` sequential entries each, drawn from the cursor.
	const leaves = (cur: { next: number }, leafCount: number, per: number): LeafNode<number>[] => {
		const out: LeafNode<number>[] = [];
		for (let i = 0; i < leafCount; i++) {
			const entries: number[] = [];
			for (let j = 0; j < per; j++) entries.push(cur.next++);
			out.push(new LeafNode(entries));
		}
		return out;
	};

	// A level-2 branch (children are leaves).
	const leafBranch = (cur: { next: number }, leafCount: number, per: number): BranchNode<number> =>
		branchOf(leaves(cur, leafCount, per));

	// A level-1 branch (children are level-2 leaf-branches).
	const branchBranch = (cur: { next: number }, l2: number, leafCount: number, per: number): BranchNode<number> => {
		const kids: BranchNode<number>[] = [];
		for (let i = 0; i < l2; i++) kids.push(leafBranch(cur, leafCount, per));
		return branchOf(kids);
	};

	// --- assertion helpers ----------------------------------------------------------------------------

	const ascendingKeys = (): number[] => {
		const out: number[] = [];
		for (const p of tree.ascending(tree.first())) out.push(tree.at(p)!);
		return out;
	};

	const descendingKeys = (): number[] => {
		const out: number[] = [];
		for (const p of tree.descending(tree.last())) out.push(tree.at(p)!);
		return out;
	};

	// The full survivor set, forward and reverse (the ticket's "full key set, forward and reverse").
	const expectSurvivors = (total: number, removed: number) => {
		const expected: number[] = [];
		for (let i = 0; i < total; i++) if (i !== removed) expected.push(i);
		expect(ascendingKeys()).to.deep.equal(expected);
		expect(descendingKeys()).to.deep.equal([...expected].reverse());
		expect(tree.getCount()).to.equal(total - 1);
	};

	// Re-finds each probe key and verifies that every branch index along the returned path points back to
	// the expected child node, all the way to the root. This is the targeted check for the path-index
	// adjustments inside rebalanceBranch (e.g. the `pathBranch.index += 1` on borrow-from-left).
	const expectPathLinkage = (key: number) => {
		const path = tree.find(key);
		expect(path.on, `find(${key}).on`).to.be.true;
		expect(tree.at(path), `at(find(${key}))`).to.equal(key);
		let child: ITreeNode = path.leafNode;
		for (let i = path.branches.length - 1; i >= 0; i--) {
			const b = path.branches[i];
			expect(b.index, `branch[${i}].index lower bound`).to.be.greaterThanOrEqual(0);
			expect(b.index, `branch[${i}].index upper bound`).to.be.lessThan(b.node.nodes.length);
			expect(b.node.nodes[b.index], `branch[${i}] linkage for key ${key}`).to.equal(child);
			child = b.node;
		}
		expect((tree as any)['_root'], `root linkage for key ${key}`).to.equal(child);
	};

	// The leaf at index 1 of a leaf-branch is always non-empty after a single delete and never at branch
	// index 0, so deleting its last entry drives the branch to underflow without tripping the leafIndex===0
	// partition-update special case in internalDelete. Returns the deleted key.
	const deleteToUnderflow = (leafBranchNode: BranchNode<number>): number => {
		const target = leafBranchNode.nodes[1] as LeafNode<number>;
		const key = target.entries[target.entries.length - 1];
		expect(tree.deleteAt(tree.find(key)), `delete ${key}`).to.be.true;
		return key;
	};

	// =================================================================================================

	it('borrow from right sibling', () => {
		// root -> [ Bmid(32 leaves), Bright(33 leaves) ].  Bmid underflows to 31; its right sibling has a
		// spare child, so a child rotates left through the parent partition.
		const cur = { next: 0 };
		const Bmid = leafBranch(cur, MIN, MIN);
		const Bright = leafBranch(cur, MIN + 1, MIN);
		const root = branchOf([Bmid, Bright]);
		(tree as any)['_root'] = root;
		const total = cur.next;
		assertTreeInvariants(tree);

		const d = deleteToUnderflow(Bmid);

		assertTreeInvariants(tree);
		expect(root.nodes.length).to.equal(2);
		expect(Bmid.nodes.length).to.equal(MIN);	// 31 -> 32 (absorbed a child from the right)
		expect(Bright.nodes.length).to.equal(MIN);	// 33 -> 32 (donated its first child)
		expect(tree.find(0).branches.length).to.equal(2);	// height unchanged (3-level tree)
		expectSurvivors(total, d);
		for (const k of [0, total - 1, d - 1, d + 1, minKey(Bright)]) expectPathLinkage(k);
	});

	it('borrow from left sibling', () => {
		// root -> [ Bleft(33 leaves), Bmid(32 leaves) ].  Bmid is the last child (no right sibling), so the
		// right paths are skipped and it borrows from the left - exercising the pathBranch.index adjustment.
		const cur = { next: 0 };
		const Bleft = leafBranch(cur, MIN + 1, MIN);
		const Bmid = leafBranch(cur, MIN, MIN);
		const root = branchOf([Bleft, Bmid]);
		(tree as any)['_root'] = root;
		const total = cur.next;
		assertTreeInvariants(tree);

		const d = deleteToUnderflow(Bmid);

		assertTreeInvariants(tree);
		expect(root.nodes.length).to.equal(2);
		expect(Bleft.nodes.length).to.equal(MIN);	// 33 -> 32 (donated its last child)
		expect(Bmid.nodes.length).to.equal(MIN);	// 31 -> 32 (absorbed a child onto the front)
		expect(tree.find(0).branches.length).to.equal(2);
		expectSurvivors(total, d);
		for (const k of [0, total - 1, d - 1, d + 1, minKey(Bmid)]) expectPathLinkage(k);
	});

	it('merge right sibling into self', () => {
		// root -> [ Ba(32), Bmid(32), Bright(32) ].  No sibling has spare children, so Bmid (now 31) absorbs
		// its right sibling; the right sibling is removed from the parent.
		const cur = { next: 0 };
		const Ba = leafBranch(cur, MIN, MIN);
		const Bmid = leafBranch(cur, MIN, MIN);
		const Bright = leafBranch(cur, MIN, MIN);
		const root = branchOf([Ba, Bmid, Bright]);
		(tree as any)['_root'] = root;
		const total = cur.next;
		assertTreeInvariants(tree);

		const d = deleteToUnderflow(Bmid);

		assertTreeInvariants(tree);
		expect(root.nodes.length).to.equal(2);	// Bright removed
		expect(root.nodes[1]).to.equal(Bmid);	// Bmid is the surviving (absorbing) sibling
		expect(Bmid.nodes.length).to.equal(2 * MIN - 1);	// 31 + 32 = 63
		expect(tree.find(0).branches.length).to.equal(2);
		expectSurvivors(total, d);
		for (const k of [0, total - 1, d - 1, d + 1]) expectPathLinkage(k);
	});

	it('merge self into left sibling', () => {
		// root -> [ Ba(32), Bleft(32), Bmid(32) ].  Bmid is the last child, so it merges INTO its left
		// sibling (the shape most analogous to the leaf bug that escaped downstream): the left sibling
		// absorbs Bmid's separator + partitions + children, and Bmid is removed from the parent.
		const cur = { next: 0 };
		const Ba = leafBranch(cur, MIN, MIN);
		const Bleft = leafBranch(cur, MIN, MIN);
		const Bmid = leafBranch(cur, MIN, MIN);
		const root = branchOf([Ba, Bleft, Bmid]);
		(tree as any)['_root'] = root;
		const total = cur.next;
		assertTreeInvariants(tree);

		const d = deleteToUnderflow(Bmid);

		assertTreeInvariants(tree);
		expect(root.nodes.length).to.equal(2);	// Bmid removed
		expect(root.nodes[1]).to.equal(Bleft);	// Bleft is the surviving (absorbing) sibling
		expect(Bleft.nodes.length).to.equal(2 * MIN - 1);	// 32 + 31 = 63
		expect(tree.find(total - 1).branches.length).to.equal(2);
		expectSurvivors(total, d);
		for (const k of [0, total - 1, d - 1, d + 1]) expectPathLinkage(k);
	});

	it('root collapse: a 2-child root drops a level when its children merge', () => {
		// root -> [ Ba(32), Bb(32) ].  Bb (last child) merges into Ba; the root is left with a single child
		// and collapses, so the merged child Ba becomes the new root and the tree loses a level.
		const cur = { next: 0 };
		const Ba = leafBranch(cur, MIN, MIN);
		const Bb = leafBranch(cur, MIN, MIN);
		const root = branchOf([Ba, Bb]);
		(tree as any)['_root'] = root;
		const total = cur.next;
		assertTreeInvariants(tree);
		expect(tree.find(0).branches.length).to.equal(2);	// 3-level tree before the delete

		const d = deleteToUnderflow(Bb);

		assertTreeInvariants(tree);
		expect((tree as any)['_root']).to.equal(Ba);	// the former child is the new root
		expect(Ba.nodes.length).to.equal(2 * MIN - 1);	// 32 + 31 = 63 leaves
		expect(tree.find(0).branches.length).to.equal(1);	// height dropped by one
		expectSurvivors(total, d);
		for (const k of [0, total - 1, d - 1, d + 1]) expectPathLinkage(k);
	});

	it('cascading branch merges up two levels in one delete', () => {
		// A 4-level tree.  root -> [ B1a, B1left, B1 ] where each B1* is a level-1 branch of 32 level-2
		// branches of 32 leaves of 32 entries.  Deleting one entry from B1's last level-2 branch cascades:
		//   leaf merge -> level-2 branch (B2) merges into its left sibling -> B1 drops to 31 children and
		//   merges into B1left -> root drops to 2 children (but does NOT collapse).
		const cur = { next: 0 };
		const B1a = branchBranch(cur, MIN, MIN, MIN);
		const B1left = branchBranch(cur, MIN, MIN, MIN);
		const B1 = branchBranch(cur, MIN, MIN, MIN);
		const root = branchOf([B1a, B1left, B1]);
		(tree as any)['_root'] = root;
		const total = cur.next;	// 3 * 32^3 = 98304
		assertTreeInvariants(tree);
		expect(tree.find(0).branches.length).to.equal(3);	// 4-level tree

		// Target a leaf inside B1's last level-2 branch so both the level-2 and level-1 merges go leftward.
		const B2 = B1.nodes[B1.nodes.length - 1] as BranchNode<number>;
		const d = deleteToUnderflow(B2);

		assertTreeInvariants(tree);
		expect(root.nodes.length).to.equal(2);	// B1 merged away; root did not collapse
		expect(root.nodes[1]).to.equal(B1left);
		expect(B1left.nodes.length).to.equal(2 * MIN - 1);	// 32 + 31 = 63 level-2 children
		expect(tree.find(0).branches.length).to.equal(3);	// height maintained at 4 levels

		// The survivor set here is ~98k keys; rely on assertTreeInvariants (which already verifies strict
		// order, bidirectional agreement and count) plus exact-removal spot checks rather than a full
		// element-wise compare of a 98k array.
		expect(tree.getCount()).to.equal(total - 1);
		expect(tree.find(d).on, `deleted key ${d} absent`).to.be.false;
		for (const k of [0, total - 1, d - 1, d + 1]) expectPathLinkage(k);
	});

	it('seeded randomized multi-level gut keeps invariants', () => {
		// Build a genuine multi-level tree through the public API, then gut it in seeded-random order,
		// validating structure after every Nth delete. Seeded so any failure is reproducible.
		const rng = lcg(0x5eed1234);
		const N = 6000;	// > C*C (4096) guarantees at least 3 levels
		for (const k of shuffle([...Array(N).keys()], rng)) tree.insert(k);
		assertTreeInvariants(tree);
		expect(tree.find(0).branches.length).to.be.greaterThanOrEqual(2);	// >= 3 levels deep

		let ops = 0;
		const checkEvery = 250;
		for (const k of shuffle([...Array(N).keys()], rng)) {
			expect(tree.deleteAt(tree.find(k)), `delete ${k}`).to.be.true;
			if (++ops % checkEvery === 0) assertTreeInvariants(tree);
		}
		assertTreeInvariants(tree);
		expect(tree.getCount()).to.equal(0);
	});
});
