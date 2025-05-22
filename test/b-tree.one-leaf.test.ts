import { expect } from 'chai';
import { BTree, KeyBound, KeyRange } from '../src/index.js';

describe('One leaf, key-only, B+Tree', () => {
  let tree: BTree<number, number>;

  beforeEach(() => {
    tree = new BTree<number, number>();
  });

	it('should insert a single entry correctly', () => {
		expect(tree.insert(5).on).to.be.true;
		expect(tree.insert(5).on).to.be.false;
		expect(tree.find(5).on).to.be.true;
		expect(tree.find(4).on).to.be.false;
	});

	it('should maintain sorted order after multiple insertions', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange())) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([1, 2, 3]);
	});

	it('should find the first, last, and keyed entries', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.at(tree.first())).to.equal(1);
		expect(tree.at(tree.last())).to.equal(3);
		expect(tree.at(tree.find(2))).to.equal(2);
		expect(tree.get(2)).to.equal(2);
		expect(tree.get(4)).to.be.undefined;
		const path = tree.find(1.5);
		expect(path.on).to.be.false;
		expect(tree.next(path).on).to.be.true;
		expect(tree.at(tree.next(path))).to.equal(2);
	});

	it('should advance paths', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const path = tree.find(2);
		tree.moveNext(path);
		expect(tree.at(path)).to.equal(3);
		tree.movePrior(path);
		expect(tree.at(path)).to.equal(2);
	});

	it('ranges work with inclusive, exclusive, and no bounds, ascending and descending', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		pushRange(tree, values, new KeyRange(new KeyBound(1), new KeyBound(3, false)));
		expect(values).to.deep.equal([1, 2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(3, false), new KeyBound(1), false));
		expect(values).to.deep.equal([2, 1]); values.length = 0;
		pushRange(tree, values, new KeyRange(undefined, new KeyBound(1)));
		expect(values).to.deep.equal([1]); values.length = 0;
		pushRange(tree, values, new KeyRange(undefined, new KeyBound(3), false));
		expect(values).to.deep.equal([3]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(3), undefined));
		expect(values).to.deep.equal([3]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(1), undefined, false));
		expect(values).to.deep.equal([1]);
	});

	it('ranges that miss', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		pushRange(tree, values, new KeyRange(new KeyBound(1.5), new KeyBound(2.5)));
		expect(values).to.deep.equal([2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(1.5, false), new KeyBound(2.5, false)));
		expect(values).to.deep.equal([2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(1.5), new KeyBound(2.5, false)));
		expect(values).to.deep.equal([2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(1.5, false), new KeyBound(2.5)));
		expect(values).to.deep.equal([2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(2.5), new KeyBound(1.5), false));
		expect(values).to.deep.equal([2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(2.5, false), new KeyBound(1.5, false), false));
		expect(values).to.deep.equal([2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(2.5), new KeyBound(1.5, false), false));
		expect(values).to.deep.equal([2]); values.length = 0;
		pushRange(tree, values, new KeyRange(new KeyBound(2.5, false), new KeyBound(1.5), false));
		expect(values).to.deep.equal([2]);
	});

	it('inverted and empty ranges produce no results', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange(new KeyBound(1), new KeyBound(3, false), false))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([]);
		for (let path of tree.range(new KeyRange(new KeyBound(3, false), new KeyBound(1)))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([]);
		for (let path of tree.range(new KeyRange(new KeyBound(2, false), new KeyBound(2)))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([]);
		for (let path of tree.range(new KeyRange(new KeyBound(2), new KeyBound(2, false)))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([]);
		for (let path of tree.range(new KeyRange(new KeyBound(2, false), new KeyBound(3, false)))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([]);
		for (let path of tree.range(new KeyRange(new KeyBound(2, false), new KeyBound(3, false), false))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([]);
	});

	it('single-item ranges produce one row', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const values: any = [];
		for (let path of tree.range(new KeyRange(new KeyBound(2), new KeyBound(2)))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([2]);
		for (let path of tree.range(new KeyRange(new KeyBound(2), new KeyBound(2), false))) {
			values.push(tree.at(path));
		}
		expect(values).to.deep.equal([2,2]);
	});

	it('should handle an empty tree', () => {
		expect(tree.first().on).to.be.false;
		expect(tree.last().on).to.be.false;
		expect(tree.find(5).on).to.be.false;
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
		expect(tree.find(2).on).to.be.true;
		expect(tree.find(4).on).to.be.false;
	});

	it('ascending() iterates starting from found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.ascending(tree.find(2))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([2, 3]);
	});

	it('ascending() iterates starting from not found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.ascending(tree.find(1.5))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([]);
		for (let path of tree.ascending(tree.find(3))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([3]);
		for (let path of tree.ascending(tree.last())) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([3, 3]);
		for (let path of tree.ascending(tree.next(tree.last()))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([3, 3]);
	});

	it('descending() iterates starting from found key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		const items = [];
		for (let path of tree.descending(tree.find(1.5))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([]);
		for (let path of tree.descending(tree.find(2))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([2, 1]);
		for (let path of tree.descending(tree.find(1))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([2, 1, 1]);
		for (let path of tree.descending(tree.first())) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([2, 1, 1, 1]);
		for (let path of tree.descending(tree.prior(tree.first()))) {
			items.push(tree.at(path));
		}
		expect(items).to.deep.equal([2, 1, 1, 1]);
	});

	// Update tests
	it('should update a key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		let result = tree.updateAt(tree.find(2), 4);
		expect(result[0].on).to.be.true;	// success
		expect(result[1]).to.be.false; // delete/inserted
		result = tree.updateAt(tree.find(4), 4);
		expect(result[0].on).to.be.true;
		expect(result[1]).to.be.true;	// updated
		result = tree.updateAt(tree.find(2), 4);
		expect(result[0].on).to.be.false;
		expect(result[1]).to.be.true;
		result = tree.updateAt(tree.find(4), 3);
		expect(result[0].on).to.be.false;	// failed
		expect(result[1]).to.be.false;	// insert key already exists
		expect(tree.at(tree.find(4))).to.equal(4);
		expect(tree.at(tree.find(2))).to.be.undefined;
	});

	it('should upsert a single entry correctly', () => {
		let result = tree.upsert(5);
		expect(result.on).to.be.false;	// inserted
		expect(tree.at(tree.next(result))).to.equal(5);	// path left on "crack" before new row
		result = tree.upsert(5);
		expect(result.on).to.be.true;	// updated
		expect(tree.at(result)).to.equal(5);	// path left on new row
		expect(tree.at(tree.find(5))).to.equal(5);
	});

	it('should merge a single entry correctly', () => {
		let result = tree.merge(5, e => 6);	// insert 5
		expect(result[0].on).to.be.true;	// success
		expect(result[1]).to.be.false;	// inserted
		expect(tree.at(result[0])).to.equal(5);	// path left on new row
		result = tree.merge(5, e => 6);	// update 5 to 6
		expect(result[0].on).to.be.true;	// success
		expect(result[1]).to.be.false;	// updated
		expect(tree.at(result[0])).to.equal(6);	// path left on new row
		tree.insert(5);
		result = tree.merge(5, e => 6);	// should try to update 5 to 6 and encounter conflict
		expect(result[0].on).to.be.false;	// failure
		expect(result[1]).to.be.false;	// insert attempt
		expect(tree.at(tree.next(result[0]))).to.equal(6);	// path left in "crack" before new row
		expect(tree.at(tree.first())).to.equal(5);
		expect(tree.at(tree.last())).to.equal(6);
		expect(tree.merge(6, prior => prior + 5)[0].on).to.be.true;
		expect(tree.at(tree.last())).to.equal(11);
	});

	it('should delete a key', () => {
		tree.insert(3);
		tree.insert(1);
		tree.insert(2);
		expect(tree.deleteAt(tree.find(2))).to.be.true;
		expect(tree.deleteAt(tree.find(2))).to.be.false;
		expect(tree.at(tree.find(2))).to.be.undefined;
	});

	it('should detect non-deterministic compare', () => {
		const tree = new BTree<number, number>(k => k, (a, b) => a < b ? -1 : a > b ? -1 : 0);
		tree.insert(1);
		expect(() => tree.insert(2)).to.throw();
	});

});
function pushRange<TKey, TValue>(tree: BTree<TKey, TValue>, values: any, range: KeyRange<TKey>) {
	for (let path of tree.range(range)) {
		values.push(tree.at(path));
	}
}

