import { expect } from 'chai';
import { BTree, KeyBound, KeyRange, NodeCapacity } from '../src/index.js';
import { assertTreeInvariants } from './helpers/invariants.js';
import { lcg } from './helpers/rng.js';

describe('Dictionary BTree', () => {
	interface Entry { id: number, value: string };

  let tree: BTree<number, Entry>;
	// Seeded RNG for reproducible build/gut ordering; reset per test.
	const SEED = 0xd1c70123;
	let rng: () => number;

  beforeEach(() => {
    tree = new BTree<number, Entry>(e => e.id);
		rng = lcg(SEED);
  });

	it('build and gut a large tree randomly', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		const checkInterval = 256;	// sample structural invariants periodically (not every op)
		addRandom(0, count - 1, checkInterval);
		assertTreeInvariants(tree);
		expectRange(0, count);
		expect(tree.getCount()).to.equal(count);
		// Gut randomly
		deleteRandom(0, count - 1, checkInterval);
		assertTreeInvariants(tree);
		expect(tree.getCount()).to.equal(0);
	});

	it('build a large tree randomly, operate on', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRandom(0, count - 1, 256);
		assertTreeInvariants(tree);
		expectRange(0, count);
		expect(tree.getCount()).to.equal(count);

		// Range scan
		const values: Entry[] = [];
		for (let path of tree.range(new KeyRange(new KeyBound(100), new KeyBound(200, false)))) {
			values.push(tree.at(path)!);
		}
		expect(values).to.deep.equal([...Array(100).keys()].map(i => ({ id: i + 100, value: (i + 100).toString() })));

		// Gut randomly
		deleteRandom(0, count - 1);
		expect(tree.getCount()).to.equal(0);
	});

	function addRandom(start: number, end: number, checkInterval = 0) {
		const range = [...Array(end - start + 1).keys()];
		let ops = 0;
		while (range.length) {
			const index = Math.floor(rng() * range.length);
			const n = range.splice(index, 1)[0];
			if (!tree.insert({ id: n, value: n.toString() }).on) {
				throw new Error("Failed to insert " + index);
			}
			if (checkInterval && (++ops % checkInterval === 0)) {
				assertTreeInvariants(tree);
			}
		}
	}

	function deleteRandom(start: number, end: number, checkInterval = 0) {
		const range = [...Array(end - start + 1).keys()];
		let ops = 0;
		while (range.length) {
			const index = Math.floor(rng() * range.length);
			if (!tree.deleteAt(tree.find(range.splice(index, 1)[0]))) {
				throw new Error("Failed to delete " + index);
			}
			if (checkInterval && (++ops % checkInterval === 0)) {
				assertTreeInvariants(tree);
			}
		}
	}

	function expectRange(starting: number, count: number) {
		const s = Math.sign(count);
		let i = starting;
		for (let path of tree.range(new KeyRange(new KeyBound(starting), new KeyBound(starting + count + -s), s > 0))) {
			expect(tree.at(path)).to.deep.equal({ id: i, value: i.toString() });
			i += s;
		}
		expect(i).to.equal(starting + count);
	}
});
