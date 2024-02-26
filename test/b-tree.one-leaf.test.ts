import { KeyBound, KeyRange } from '../src';
import { BTree } from '../src/b-tree';

describe('One leaf, key-only, B+Tree', () => {
  let tree: BTree<number, number>;

  beforeEach(() => {
    tree = new BTree<number, number>();
  });

	it('should insert a single entry correctly', () => {
		expect(tree.insert(5).on).toBe(false);
		expect(tree.insert(5).on).toBe(true);
		expect(tree.find(5).on).toBe(true);
		expect(tree.find(4).on).toBe(false);
	});

	it('should maintain sorted order after multiple insertions', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange())) {
			values.push(tree.at(path));
		}
		expect(values).toEqual([1, 2, 3]);
	});

	it('should find the first, last, and keyed entries', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.at(tree.first())).toBe(1);
		expect(tree.at(tree.last())).toBe(3);
		expect(tree.at(tree.find(2))).toBe(2);
		const path = tree.find(1.5);
		expect(path.on).toBe(false);
		expect(tree.next(path).on).toBe(true);
		expect(tree.at(tree.next(path))).toBe(2);
	});

	it('should advance paths', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const path = tree.find(2);
		tree.moveNext(path);
		expect(tree.at(path)).toBe(3);
		tree.movePrior(path);
		expect(tree.at(path)).toBe(2);
	});

	it('ranges work with inclusive and exclusive bounds', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange(new KeyBound(1), new KeyBound(3, false)))) {
			values.push(tree.at(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(3, false), new KeyBound(1), false))) {
			values.push(tree.at(path));
		}
		expect(values).toEqual([1, 2, 2, 1]);
	});

	it('inverted and empty ranges produce no results', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange(new KeyBound(1), new KeyBound(3, false), false))) {
			values.push(tree.at(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(3, false), new KeyBound(1)))) {
			values.push(tree.at(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(2, false), new KeyBound(2)))) {
			values.push(tree.at(path));
		}
		for (let path of tree.range(new KeyRange(new KeyBound(2), new KeyBound(2, false)))) {
			values.push(tree.at(path));
		}
		expect(values).toEqual([]);
	});

	it('should handle an empty tree', () => {
		expect(tree.first().on).toBe(false);
		expect(tree.last().on).toBe(false);
		expect(tree.find(5).on).toBe(false);
		for (let path of tree.range(new KeyRange(new KeyBound(0), new KeyBound(5, true)))) {
			throw new Error('Should not have found anything');
		}
		for (let path of tree.range(new KeyRange(new KeyBound(0), new KeyBound(5, false)))) {
			throw new Error('Should not have found anything');
		}
		for (let path of tree.ascending(tree.first())) {
			throw new Error('Should not have found anything');
		}
		for (let path of tree.descending(tree.first())) {
			throw new Error('Should not have found anything');
		}
	});

	it('should find a key that exists', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.find(2).on).toBe(true);
		expect(tree.find(4).on).toBe(false);
	});

	it('ascending() iterates starting from found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.ascending(tree.find(2))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([2, 3]);
	});

	it('ascending() iterates starting from not found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.ascending(tree.find(1.5))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([]);
		for (let path of tree.ascending(tree.find(3))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([3]);
		for (let path of tree.ascending(tree.last())) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([3, 3]);
		for (let path of tree.ascending(tree.next(tree.last()))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([3, 3]);
	});

	it('descending() iterates starting from found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.descending(tree.find(1.5))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([]);
		for (let path of tree.descending(tree.find(2))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([2, 1]);
		for (let path of tree.descending(tree.find(1))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([2, 1, 1]);
		for (let path of tree.descending(tree.first())) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([2, 1, 1, 1]);
		for (let path of tree.descending(tree.prior(tree.first()))) {
			items.push(tree.at(path));
		}
		expect(items).toEqual([2, 1, 1, 1]);
	});

	// Update tests
	it('should update a key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		let result = tree.updateAt(tree.find(2), 4);
		expect(result[0].on).toBe(true);	// success
		expect(result[1]).toBe(false); // delete/inserted
		result = tree.updateAt(tree.find(4), 4);
		expect(result[0].on).toBe(true);
		expect(result[1]).toBe(true);	// updated
		result = tree.updateAt(tree.find(2), 4);
		expect(result[0].on).toBe(false);
		expect(result[1]).toBe(true);
		result = tree.updateAt(tree.find(4), 3);
		expect(result[0].on).toBe(false);	// failed
		expect(result[1]).toBe(false);	// insert key already exists
		expect(tree.at(tree.find(4))).toBe(4);
		expect(tree.at(tree.find(2))).toBe(undefined);
	});

	it('should upsert a single entry correctly', () => {
		let result = tree.upsert(5);
		expect(result.on).toBe(false);	// inserted
		expect(tree.at(tree.next(result))).toBe(5);	// path left on "crack" before new row
		result = tree.upsert(5);
		expect(result.on).toBe(true);	// updated
		expect(tree.at(result)).toBe(5);	// path left on new row
		expect(tree.at(tree.find(5))).toBe(5);
	});

	it('should merge a single entry correctly', () => {
		let result = tree.merge(5, e => 6);	// insert 5
		expect(result[0].on).toBe(true);	// success
		expect(result[1]).toBe(false);	// inserted
		expect(tree.at(result[0])).toBe(5);	// path left on new row
		result = tree.merge(5, e => 6);	// update 5 to 6
		expect(result[0].on).toBe(true);	// success
		expect(result[1]).toBe(false);	// updated
		expect(tree.at(result[0])).toBe(6);	// path left on new row
		tree.insert(5);
		result = tree.merge(5, e => 6);	// should try to update 5 to 6 and encounter conflict
		expect(result[0].on).toBe(false);	// failure
		expect(result[1]).toBe(false);	// insert attempt
		expect(tree.at(tree.next(result[0]))).toBe(6);	// path left in "crack" before new row
		expect(tree.at(tree.first())).toBe(5);
		expect(tree.at(tree.last())).toBe(6);
		expect(tree.merge(6, prior => prior + 5)[0].on).toBe(true);
		expect(tree.at(tree.last())).toBe(11);
	});

	it('should delete a key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.deleteAt(tree.find(2))).toBe(true);
		expect(tree.deleteAt(tree.find(2))).toBe(false);
		expect(tree.at(tree.find(2))).toBe(undefined);
	});

});
