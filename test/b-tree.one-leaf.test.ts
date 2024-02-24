import { KeyBound, KeyRange } from '../src';
import { BTree } from '../src/b-tree';

describe('One leaf, key-only, B+Tree', () => {
  let tree: BTree<number, number>;

  beforeEach(() => {
    tree = new BTree<number, number>();
  });

	it('should insert a single entry correctly', () => {
		expect(tree.insert(5)).toBe(true);
		expect(tree.find(5).isMatch).toBe(true);
	});

	it('should not allow duplicate entries', () => {
		tree.insert(5);
		expect(tree.insert(5)).toBe(false);
	});

	it('should maintain sorted order after multiple insertions', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range({isAscending: true})) {
			values.push(tree.entryAt(path));
		}
		expect(values).toEqual([1, 2, 3]);
	});

	// Find tests
	it('should find the first, last, and keyed entries', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.entryAt(tree.first())).toBe(1);
		expect(tree.entryAt(tree.last())).toBe(3);
		expect(tree.entryAt(tree.find(2))).toBe(2);
		const path = tree.find(1.5);
		expect(path.isMatch).toBe(false);
		expect(tree.near(path)).toBe(true);
		expect(tree.entryAt(path)).toBe(2);
	});

	it('ranges work with inclusive and exclusive bounds', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange(new KeyBound(1), new KeyBound(3, false)))) {
			values.push(tree.entryAt(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(3, false), new KeyBound(1), false))) {
			values.push(tree.entryAt(path));
		}
		expect(values).toEqual([1, 2, 2, 1]);
	});

	it('inverted and empty ranges produce no results', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange(new KeyBound(1), new KeyBound(3, false), false))) {
			values.push(tree.entryAt(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(3, false), new KeyBound(1)))) {
			values.push(tree.entryAt(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(2, false), new KeyBound(2)))) {
			values.push(tree.entryAt(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(2), new KeyBound(2, false)))) {
			values.push(tree.entryAt(path));
		}
		expect(values).toEqual([]);
	});

	it('should find the first and last entries', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.entryAt(tree.first())).toBe(1);
		expect(tree.entryAt(tree.last())).toBe(3);
	});

	it('should find a key that exists', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.find(2).isMatch).toBe(true);
		expect(tree.find(4).isMatch).toBe(false);
	});

	it('ascending() iterates starting from found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.ascending(tree.find(2))) {
			items.push(tree.entryAt(path));
		}
		expect(items).toEqual([2, 3]);
	});

	it('ascending() iterates starting from not found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.ascending(tree.find(1.5))) {
			items.push(tree.entryAt(path));
		}
		expect(items).toEqual([2, 3]);
	});

	it('descending() iterates starting from found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.descending(tree.find(2))) {
			items.push(tree.entryAt(path));
		}
		expect(items).toEqual([2, 1]);
	});

	// Update tests
	it('should update a key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.updateAt(tree.find(2), 4)).toBe(true);
		expect(tree.updateAt(tree.find(4), 4)).toBe(true);
		expect(tree.updateAt(tree.find(2), 4)).toBe(false);
		expect(tree.entryAt(tree.find(4))).toBe(4);
		expect(tree.entryAt(tree.find(2))).toBe(undefined);
	});

	it('should insert a single entry correctly', () => {
		expect(tree.upsert(5)).toBe(true);
		expect(tree.entryAt(tree.find(5))).toBe(5);
		expect(tree.upsert(5)).toBe(false);
	});

	it('should insert a single entry correctly', () => {
		expect(tree.insdate(5, () => 5, () => 6)).toBe(true);
		expect(tree.entryAt(tree.find(5))).toBe(5);
		expect(tree.insdate(5, () => 5, () => 6)).toBe(false);
		expect(tree.entryAt(tree.first())).toBe(6);
		expect(tree.insdate(6, () => 5, prior => prior + 5)).toBe(false);
		expect(tree.entryAt(tree.first())).toBe(11);
	});

	it('should delete a key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.deleteAt(tree.find(2))).toBe(true);
		expect(tree.deleteAt(tree.find(2))).toBe(false);
		expect(tree.entryAt(tree.find(2))).toBe(undefined);
	});

});
