import { expect } from 'chai';
import { KeyBound, KeyRange, NodeCapacity, BTree } from '../src/index.js';
import { BranchNode, LeafNode } from '../src/nodes.js';

describe('Branching BTree', () => {
	let tree: BTree<number, number>;

	beforeEach(() => {
		tree = new BTree<number, number>();
	});

	it('should grow to multiple branches right', () => {
		addRange(0, NodeCapacity + 1);
		expectRange(0, NodeCapacity + 1);
		expect((tree as any)["_root"]["nodes"].length).to.equal(2);
	});

	it('should grow to multiple branches left', () => {
		addRange(0, -(NodeCapacity + 1));
		expectRange(0, -(NodeCapacity + 1));
		expect((tree as any)["_root"]["nodes"].length).to.equal(2);
	});

	// Iterate ascending across branches
	it('should iterate ascending across branches', () => {
		addRange(0, NodeCapacity + 1);
		let i = 0;
		for (let path of tree.range(new KeyRange(new KeyBound(0), new KeyBound(NodeCapacity)))) {
			expect(tree.at(path)).to.equal(i);
			++i;
		}
	});

	// Iterate descending across branches
	it('should iterate descending across branches', () => {
		addRange(0, NodeCapacity + 1);
		let i = NodeCapacity;
		for (let path of tree.range(new KeyRange(new KeyBound(NodeCapacity), new KeyBound(0), false))) {
			expect(tree.at(path)).to.equal(i);
			--i;
		}
	});

	it('should borrow right', () => {
		const halfCap = NodeCapacity / 2;
		const gap = 100;
		addRange(0, halfCap);
		addRange(gap, halfCap + 1);	// push to split between 31-100
		tree.insert(halfCap);	// Add onto tail of leaf 0
		tree.deleteAt(tree.find(gap + halfCap));	// Remove from tail of leaf 1
		tree.deleteAt(tree.find(gap + halfCap - 1));	// Remove again from tail of leaf 1 - drops below half capacity and should borrow from leaf 0
		expectRange(0, halfCap + 1);
		expectRange(gap, halfCap - 1);
		expect(tree.find(halfCap - 1).branches[0].index).to.equal(0);
		expect(tree.find(halfCap).branches[0].index).to.equal(1);	// previous insert should now be on leaf 1
	});

	it('should borrow left', () => {
		const halfCap = NodeCapacity / 2;
		const gap = 100;
		addRange(0, halfCap);
		addRange(gap, halfCap + 1);	// push to split between 31-100
		tree.deleteAt(tree.find(halfCap - 1));	// Remove from tail of leaf 0
		expectRange(0, halfCap - 1);
		expectRange(gap, halfCap + 1);
		expect(tree.find(gap).branches[0].index).to.equal(0);	// head of leaf 1 should now be tail of leaf 0
		expect(tree.find(gap + 1).branches[0].index).to.equal(1);
	});

	it('should merge right', () => {
		const halfCap = NodeCapacity / 2;
		const gap = 100;
		addRange(0, halfCap);
		addRange(gap, halfCap + 1);	// push to split between 31-100
		tree.deleteAt(tree.find(gap));	// remove from right, so the capacity will be below half
		tree.deleteAt(tree.find(halfCap - 1));	// remove an entry, should suffice for the two nodes to be merged
		expectRange(0, halfCap - 1);
		expectRange(gap + 1, halfCap);
		expect(tree.getCount()).to.equal(NodeCapacity - 1);
		expect((tree as any)["_root"] instanceof LeafNode).to.be.true;
	});

	it('should merge right', () => {
		const halfCap = NodeCapacity / 2;
		const gap = 100;
		addRange(0, halfCap);
		addRange(gap, halfCap + 1);	// push to split between 31-100
		tree.deleteAt(tree.find(gap + halfCap));	// remove from right, so the capacity will be below half
		tree.deleteAt(tree.find(gap + halfCap - 1));	// remove an entry, should suffice for the two nodes to be merged
		expectRange(0, halfCap);
		expectRange(gap, halfCap - 1);
		expect(tree.getCount()).to.equal(NodeCapacity - 1);
		expect((tree as any)["_root"] instanceof LeafNode).to.be.true;
	});

	it('should not corrupt tree when deleting index 0 causes leaf to become empty (bug #1)', () => {
		// Bug: internalDelete accessed entries[0] after deletion even when leaf became empty
		// This happens when:
		// 1. leaf is not root (has branches)
		// 2. we delete entry at leafIndex === 0
		// 3. leaf becomes empty after deletion
		// 4. the leaf's branch index > 0 (so updatePartition actually writes to partitions array)
		// The bug causes undefined to be stored as a partition key, corrupting the tree
		
		// Setup: Create a tree with 3 leaves where the MIDDLE leaf has only 1 entry
		// [left leaf] [middle leaf with 1 entry] [right leaf]
		// Partitions: [middleKey, rightKey]
		// The middle leaf is at branch index 1, so updatePartition will write partitions[0]
		
		const halfCap = NodeCapacity / 2;	// 32
		
		const leftLeaf = new LeafNode([...Array(halfCap).keys()]);	// [0..31]
		const middleLeaf = new LeafNode([50]);	// Single entry - will be deleted
		const rightLeaf = new LeafNode([...Array(halfCap).keys()].map(i => i + 100));	// [100..131]
		const rootBranch = new BranchNode<number>([50, 100], [leftLeaf, middleLeaf, rightLeaf]);
		(tree as any)['_root'] = rootBranch;
		
		// Verify setup
		expect(tree.getCount()).to.equal(halfCap * 2 + 1);
		expect(tree.find(50).on).to.be.true;
		
		// Find the middle entry - it should be at leafIndex 0 with branch index 1
		const path = tree.find(50);
		expect(path.leafIndex).to.equal(0);
		expect(path.branches.length).to.equal(1);
		expect(path.branches[0].index).to.equal(1);	// Middle leaf is at index 1
		
		// Delete the only entry in the middle leaf
		// Before the fix: this calls updatePartition with keyFromEntry(entries[0]) 
		// where entries is now empty, storing undefined as partitions[0]
		const deleted = tree.deleteAt(path);
		expect(deleted).to.be.true;
		
		// Verify tree is not corrupted - all partition keys should be valid numbers
		// After rebalancing the tree structure changes, but we should never have undefined partitions
		function checkPartitions(node: any) {
			if (node.partitions) {
				for (const partition of node.partitions) {
					expect(partition, 'Partition should not be undefined').to.not.be.undefined;
					expect(typeof partition, 'Partition should be a number').to.equal('number');
				}
				for (const child of node.nodes) {
					checkPartitions(child);
				}
			}
		}
		checkPartitions((tree as any)['_root']);
		
		// Tree should still be valid and navigable
		expect(tree.find(50).on).to.be.false;
		expect(tree.find(0).on).to.be.true;
		expect(tree.find(100).on).to.be.true;
		expect(tree.getCount()).to.equal(halfCap * 2);
	});

	it('build a large tree - right', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(0, count);
		expectRange(0, count);
		// cut a gap in the middle
		deleteRange((count >> 1) - 128, 256);
		expectRange(0, (count >> 1) - 128);
		expectRange((count >> 1) + 128, count - ((count >> 1) + 128));
		expect(tree.getCount()).to.equal(count - 256);
		// fill the gap back in
		addRange((count >> 1) - 128, 256);
		expectRange(0, count);
		expect(tree.getCount()).to.equal(count);
		// Gut from the right
		deleteRange(count - 1, -count);
		expect(tree.getCount()).to.equal(0);
	});

	it('build a large tree - left', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(count - 1, -count);
		expectRange(0, count);
		// cut a gap in the middle
		deleteRange((count >> 1) + 128, -256);
		expectRange(0, (count >> 1) - 128);
		expectRange((count >> 1) + 128 + 1, count - ((count >> 1) + 128 + 1));
		expect(tree.getCount()).to.equal(count - 256);
		// fill the gap back in
		addRange((count >> 1) + 128, -256);
		expectRange(0, count);
		expect(tree.getCount()).to.equal(count);
		// Gut from the left
		deleteRange(0, count);
		expect(tree.getCount()).to.equal(0);
	});

	it('should correctly form path when a branch split causes root to split under specific conditions', () => {
		const C = NodeCapacity; // Typically 64
		const K_TARGET_LEAF_INDEX = ((C + 1) >>> 1) - 1; // Index of the leaf we'll cause to split, e.g., 31 for C=64

		// Manual Tree Setup:
		// Create a root BranchNode R with C children LeafNodes (L_0 to L_{C-1}).
		// Each L_i is full with C sorted entries: L_i = [i*C, ..., (i+1)*C - 1].
		// R's partitions are [C, 2*C, ..., (C-1)*C].
		// R is full of children.

		const leaves: LeafNode<number>[] = [];
		for (let i = 0; i < C; i++) {
			const entries: number[] = [];
			for (let j = 0; j < C; j++) {
				entries.push(i * C + j);
			}
			leaves.push(new LeafNode(entries));
		}

		const partitions: number[] = [];
		for (let i = 1; i < C; i++) { // Partitions are keys of L_1 onwards
			partitions.push(i * C);
		}

		const rootBranchNode = new BranchNode(partitions, leaves); // Access BranchNode constructor
		(tree as any)['_root'] = rootBranchNode;

		// Critical Insertion:
		// Target leaf L_k where k = K_TARGET_LEAF_INDEX (e.g., L_31).
		// L_k contains [k*C, ..., (k+1)*C - 1].
		// Insert V = (k+1)*C - 0.5. This is unique and larger than all entries in L_k,
		// ensuring it splits L_k and V goes into the right part of L_k's split.
		// e.g., L_31 = [1984..2047]. V = (31+1)*64 - 0.5 = 2047.5.
		const V = (K_TARGET_LEAF_INDEX + 1) * C - 0.5;

		// This insertion is designed to:
		// 1. Cause L_k to split. V goes to L_k_right (childSplit.indexDelta = 1).
		// 2. Split propagates to R (current root). Original index of L_k in R is K_TARGET_LEAF_INDEX.
		//    Effective path index in R (for L_k_right) becomes K_TARGET_LEAF_INDEX + 1.
		// 3. R is full, so R itself splits. Midpoint for R's node array split is (C+1)>>>1.
		//    The condition (path_idx_in_R == midPoint_of_R_split) is met:
		//    (K_TARGET_LEAF_INDEX + 1) == ((C+1)>>>1) because K_TARGET_LEAF_INDEX = ((C+1)>>>1) - 1.
		//    - Correct R_split.indexDelta (for new root G) should be 1.
		//    - The old buggy logic would result in R_split.indexDelta = 0.
		const pathV = tree.insert(V);

		expect(tree.at(pathV)).to.equal(V, "Inserted value should be retrievable via the returned path.");

		// Path: NewRoot_G -> R_right -> L_k_right_leaf
		// branches[0] is for NewRoot_G. branches[1] is for R_right.
		expect(pathV.branches.length).to.be.greaterThanOrEqual(2, "Path should have at least two branches after root split.");

		const G_info = pathV.branches[0]; // Info for the new root node G
		const R_right_node_from_path = pathV.branches[1].node; // The actual R_right node from the path

		// G_info.index should be 1, as G.nodes = [R_left, R_right], and the path to V goes through R_right.
		expect(G_info.index).to.equal(1, "Path branch for new root (G_info.index) should point to the right-hand split of the old root (R_right).");

		// Further check: Ensure G_info.index correctly identifies R_right_node_from_path within G_info.node.nodes array.
		const R_right_actual_node_from_G_nodes_array = G_info.node.nodes[G_info.index];
		expect(R_right_actual_node_from_G_nodes_array).to.equal(R_right_node_from_path, "New root's (G) path branch index correctly leads to the R_right child node.");
	});

	it('build a large tree - randomly', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRandom(0, count - 1);
		expectRange(0, count);
		expect(tree.getCount()).to.equal(count);
		// Gut randomly
		deleteRandom(0, count - 1);
		expect(tree.getCount()).to.equal(0);
	});

	it('build a larger tree - randomly', () => {
		class FastTree extends BTree<number, number> {	// Faster comparison - don't bother ensuring consistency for speed
			compareKeys(a: number, b: number) {
				return a - b;
			}
		}
		tree = new FastTree();
		const count = NodeCapacity * NodeCapacity * NodeCapacity * 4;	// ~ 1 million
		const randomStart = performance.now();
		for (let i = 0; i !== count; ++i) {
			Math.random();
		}
		const randomTime = performance.now() - randomStart;
		const insertStart = performance.now();
		for (let i = 0; i !== count; ++i) {
			tree.insert(Math.random());
		}
		const insertTime = performance.now() - insertStart;
		console.log(`Random: ${randomTime}ms, Insert: ${insertTime}ms, Net: ${insertTime - randomTime}ms`);
		expect(tree.getCount()).to.be.closeTo(count, 2);
		// Gut randomly
		while (tree.first().on) {
			const path = tree.find(Math.random());
			if (!path.on) {
				tree.moveNext(path);
			}
			if (!path.on) {
				tree.movePrior(path);
			}
			tree.deleteAt(path);
		}
		expect(tree.getCount()).to.equal(0);
	}).timeout(10000);

	it('getCount should give the correct number, whether ascending or descending, with a starting path, or not', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(0, count);
		expect(tree.getCount()).to.equal(count);
		expect(tree.getCount({ path: tree.find(count >>> 1), ascending: false })).to.equal(count - (count >>> 1));
		expect(tree.getCount({ path: tree.find(count >>> 1) })).to.equal(count - (count >>> 1));
	});

	it('ascending and descending should work over large trees', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(0, count);
		let i = 0;
		for (const { } of tree.ascending(tree.first())) {
			++i;
		}
		expect(i).to.equal(count);
		for (const { } of tree.descending(tree.last())) {
			--i;
		}
		expect(i).to.equal(0);
	});

	function addRange(starting: number, count: number) {
		const s = Math.sign(count);
		for (let i = 0; i !== count; i += s) {
			const path = tree.insert(i + starting);
			if (!path.on) {	// Expects here is slow
				throw new Error("Failed to insert " + (i + starting));
			}
			if (tree.at(path) !== i + starting) {
				throw new Error(`Path not maintained: Expected ${i + starting} but got ${tree.at(path)}`);
			}
		}
	}

	function addRandom(start: number, end: number) {
		const range = [...Array(end - start + 1).keys()];
		while (range.length) {
			const index = Math.floor(Math.random() * range.length);
			const value = range.splice(index, 1)[0];
			const path = tree.insert(value);
			if (!path.on) {
				throw new Error("Failed to insert " + index);
			}
			if (tree.at(path) !== value) {
				throw new Error(`Path not maintained: Expected ${value} but got ${tree.at(path)}`);
			}
		}
	}

	function deleteRange(starting: number, count: number) {
		const s = Math.sign(count);
		for (let i = 0; i !== count; i += s) {
			if (!tree.deleteAt(tree.find(i + starting))) {
				throw new Error("Failed to delete " + (i + starting));
			}
		}
	}

	function deleteRandom(start: number, end: number) {
		const range = [...Array(end - start + 1).keys()];
		while (range.length) {
			const index = Math.floor(Math.random() * range.length);
			if (!tree.deleteAt(tree.find(range.splice(index, 1)[0]))) {
				throw new Error("Failed to delete " + index);
			}
		}
	}

	function expectRange(starting: number, count: number) {
		const s = Math.sign(count);
		let i = starting;
		for (let path of tree.range(new KeyRange(new KeyBound(starting), new KeyBound(starting + count + -s), s > 0))) {
			expect(tree.at(path)).to.equal(i);
			i += s;
		}
		expect(i).to.equal(starting + count);
	}

	// Helper function to shuffle an array
	function shuffleArray<T>(array: T[]): T[] {
		const newArray = [...array];
		for (let i = newArray.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[newArray[i], newArray[j]] = [newArray[j], newArray[i]];
		}
		return newArray;
	}

	// Helper function to validate a path to an existing key
	function validatePathToKey(tree: BTree<number, number>, key: number) {
		const path = tree.find(key);
		expect(path.on).to.be.equal(true, `Path for key ${key} should be 'on'.`);
		expect(tree.at(path)).to.equal(key, `tree.at(path) for key ${key} should return the key.`);
		expect(path.leafNode.entries[path.leafIndex]).to.equal(key, `Leaf entry for key ${key} is incorrect.`);

		let currentExpectedChildNode: any = path.leafNode; // Use 'any' if ITreeNode is not easily importable here
		for (let i = path.branches.length - 1; i >= 0; i--) {
			const b = path.branches[i];
			expect(b.index).to.be.greaterThanOrEqual(0, `Branch index for key ${key} at branch level ${i} is out of bounds (negative).`);
			// If path.on is true, the branch index must point to an actual child node in the path.
			expect(b.index).to.be.lessThan(b.node.nodes.length, `Branch index for key ${key} at branch level ${i} is out of bounds (too large).`);
			expect(b.node.nodes[b.index]).to.equal(currentExpectedChildNode, `Branch linkage for key ${key} at branch level ${i} is incorrect.`);
			currentExpectedChildNode = b.node;
		}
		expect((tree as any)['_root']).to.equal(currentExpectedChildNode, `Path for key ${key} does not lead back to the tree root.`);
	}

	function verifyAllPresentKeys(tree: BTree<number, number>, presentKeys: Set<number>) {
		if (presentKeys.size === 0) {
			const root = (tree as any)['_root'];
			expect(root instanceof LeafNode).to.be.equal(true, 'Root should be an empty LeafNode when tree is empty.');
			expect((root as any).entries.length).to.equal(0, 'Root leaf should have no entries when tree is empty.');
			return;
		}
		for (const k of presentKeys) {
			validatePathToKey(tree, k);
		}
	}

	it('paths remain valid and correct through randomized insertions and deletions', function() {
		// Using a traditional function for 'this' context if needed for long-running test timeout, though not strictly necessary here.
		// this.timeout(10000); // Example: Increase timeout for a potentially long test if using Mocha specific features

		const C = NodeCapacity;
		const N = C * 2; // Number of items to insert and delete. C*2 should be enough for 2-3 levels.

		const presentKeys = new Set<number>();
		const itemsToInsert = shuffleArray([...Array(N).keys()].map(k => k + 0.1)); // Use non-integers to avoid conflicts with partition logic if it assumes integers
		const itemsToDelete = shuffleArray([...itemsToInsert]);

		// Insertion Phase
		for (let i = 0; i < N; i++) {
			const val = itemsToInsert[i];
			const returnedPath = tree.insert(val);

			expect(returnedPath.on).to.be.equal(true, `Path for inserted key ${val} should be 'on'.`);
			expect(tree.at(returnedPath)).to.equal(val, `tree.at(path) for inserted key ${val} should return the key.`);
			presentKeys.add(val);
			if (i % Math.max(1, Math.floor(N / 20)) === 0 || i === N -1 ) { // Verify all keys periodically and at the end
				verifyAllPresentKeys(tree, presentKeys);
			}
		}
		verifyAllPresentKeys(tree, presentKeys); // Final check after all insertions

		// Deletion Phase
		for (let i = 0; i < N; i++) {
			const val = itemsToDelete[i];
			const pathToDelete = tree.find(val);
			expect(pathToDelete.on).to.be.equal(true, `Path for key ${val} to be deleted should be 'on' before deletion.`);

			const deleteSucceeded = tree.deleteAt(pathToDelete);
			expect(deleteSucceeded).to.be.equal(true, `Deletion of key ${val} should succeed.`);
			expect(pathToDelete.on).to.be.equal(false, `Path for key ${val} should be 'off' after deleteAt modifies it.`);

			const pathAfterDelete = tree.find(val);
			expect(pathAfterDelete.on).to.be.equal(false, `Path for key ${val} should be 'off' after finding it post-deletion.`);
			presentKeys.delete(val);
			if (i % Math.max(1, Math.floor(N / 20)) === 0 || i === N - 1) { // Verify all keys periodically and at the end
				verifyAllPresentKeys(tree, presentKeys);
			}
		}
		verifyAllPresentKeys(tree, presentKeys); // Final check after all deletions (presentKeys should be empty)

		expect(presentKeys.size).to.equal(0, 'All keys should be deleted.');
		expect(tree.getCount()).to.equal(0, 'Tree count should be 0 after all deletions.');
	});
});
