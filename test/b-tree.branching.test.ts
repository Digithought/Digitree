import { KeyBound, KeyRange, NodeCapacity, BTree } from '../src';
import { LeafNode } from '../src/nodes';

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
		expect((tree as any)["_root"] instanceof LeafNode).toBe(true);
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
		expect((tree as any)["_root"] instanceof LeafNode).toBe(true);
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
		expect(tree.getCount()).toBeCloseTo(count, 2);
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
		expect(tree.getCount()).toBe(0);
	});

	it('getCount should give the correct number, whether ascending or descending, with a starting path, or not', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(0, count);
		expect(tree.getCount()).toBe(count);
		expect(tree.getCount({ path: tree.find(count >>> 1), ascending: false })).toBe(count - (count >>> 1));
		expect(tree.getCount({ path: tree.find(count >>> 1) })).toBe(count - (count >>> 1));
	});

	it('ascending and descending should work over large trees', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRange(0, count);
		let i = 0;
		for (const {} of tree.ascending(tree.first())) {
			++i;
		}
		expect(i).toBe(count);
		for (const {} of tree.descending(tree.last())) {
			--i;
		}
		expect(i).toBe(0);
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
			expect(tree.at(path)).toBe(i);
			i += s;
		}
		expect(i).toBe(starting + count);
	}
});
