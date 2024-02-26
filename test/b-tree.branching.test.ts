import { KeyBound, KeyRange, NodeCapacity } from '../src';
import { BTree } from '../src/b-tree';

describe('Branching BTree', () => {
  let tree: BTree<number, number>;

  beforeEach(() => {
    tree = new BTree<number, number>();
  });

	it('should grow to multiple branches right', () => {
		addRange(0, NodeCapacity + 1);
		expectRange(0, NodeCapacity + 1);
		expect((tree as any)["_root"]["nodes"].length).toBe(2);
	});

	it('should grow to multiple branches left', () => {
		addRange(0, -(NodeCapacity + 1));
		expectRange(0, -(NodeCapacity + 1));
		expect((tree as any)["_root"]["nodes"].length).toBe(2);
	});

	// Iterate ascending across branches
	it('should iterate ascending across branches', () => {
		addRange(0, NodeCapacity + 1);
		let i = 0;
		for (let path of tree.range(new KeyRange(new KeyBound(0), new KeyBound(NodeCapacity)))) {
			expect(tree.at(path)).toBe(i);
			++i;
		}
	});

	// Iterate descending across branches
	it('should iterate descending across branches', () => {
		addRange(0, NodeCapacity + 1);
		let i = NodeCapacity;
		for (let path of tree.range(new KeyRange(new KeyBound(NodeCapacity), new KeyBound(0), false))) {
			expect(tree.at(path)).toBe(i);
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
		expect(tree.find(halfCap - 1).branches[0].index).toBe(0);
		expect(tree.find(halfCap).branches[0].index).toBe(1);	// previous insert should now be on leaf 1
	});

	it('should borrow left', () => {
		const halfCap = NodeCapacity / 2;
		const gap = 100;
		addRange(0, halfCap);
		addRange(gap, halfCap + 1);	// push to split between 31-100
		tree.deleteAt(tree.find(halfCap - 1));	// Remove from tail of leaf 0
		expectRange(0, halfCap - 1);
		expectRange(gap, halfCap + 1);
		expect(tree.find(gap).branches[0].index).toBe(0);	// head of leaf 1 should now be tail of leaf 0
		expect(tree.find(gap + 1).branches[0].index).toBe(1);
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
		expect(tree.getCount()).toBe(NodeCapacity - 1);
		expect((tree as any)["_root"]["isLeaf"]).toBe(true);
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
		expect(tree.getCount()).toBe(NodeCapacity - 1);
		expect((tree as any)["_root"]["isLeaf"]).toBe(true);
	});

	it('build a large tree - right', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(0, count);
		expectRange(0, count);
		// cut a gap in the middle
		deleteRange((count >> 1) - 128, 256);
		expectRange(0, (count >> 1) - 128);
		expectRange((count >> 1) + 128, count - ((count >> 1) + 128));
		expect(tree.getCount()).toBe(count - 256);
		// fill the gap back in
		addRange((count >> 1) - 128, 256);
		expectRange(0, count);
		expect(tree.getCount()).toBe(count);
		// Gut from the right
		deleteRange(count - 1, -count);
		expect(tree.getCount()).toBe(0);
	});

	it('build a large tree - left', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(count - 1, -count);
		expectRange(0, count);
		// cut a gap in the middle
		deleteRange((count >> 1) + 128, -256);
		expectRange(0, (count >> 1) - 128);
		expectRange((count >> 1) + 128 + 1, count - ((count >> 1) + 128 + 1));
		expect(tree.getCount()).toBe(count - 256);
		// fill the gap back in
		addRange((count >> 1) + 128, -256);
		expectRange(0, count);
		expect(tree.getCount()).toBe(count);
		// Gut from the left
		deleteRange(0, count);
		expect(tree.getCount()).toBe(0);
	});

	it('build a large tree - randomly', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRandom(0, count - 1);
		expectRange(0, count);
		expect(tree.getCount()).toBe(count);
		// Gut randomly
		deleteRandom(0, count - 1);
		expect(tree.getCount()).toBe(0);
	});

	function addRange(starting: number, count: number) {
		const s = Math.sign(count);
		for (let i = 0; i !== count; i += s) {
			if (!tree.insert(i + starting)) {	// Expects here is slow
				throw new Error("Failed to insert " + (i + starting));
			}
		}
	}

	function addRandom(start: number, end: number) {
		const range = [...Array(end - start + 1).keys()];
		while (range.length) {
			const index = Math.floor(Math.random() * range.length);
			if (!tree.insert(range.splice(index, 1)[0])) {
				throw new Error("Failed to insert " + index);
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
			expect(tree.at(path)).toBe(i);
			i += s;
		}
		expect(i).toBe(starting + count);
	}
});
