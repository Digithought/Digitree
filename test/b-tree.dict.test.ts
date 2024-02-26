import { KeyBound, KeyRange, NodeCapacity } from '../src';
import { BTree } from '../src/b-tree';

describe('Dictionary BTree', () => {
	interface Entry { id: number, value: string };

  let tree: BTree<number, Entry>;

  beforeEach(() => {
    tree = new BTree<number, Entry>(e => e.id);
  });

	it('build and gut a large tree randomly', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRandom(0, count - 1);
		expectRange(0, count);
		expect(tree.getCount()).toBe(count);
		// Gut randomly
		deleteRandom(0, count - 1);
		expect(tree.getCount()).toBe(0);
	});

	it('build a large tree randomly, operate on', () => {
		const count = NodeCapacity * NodeCapacity + 1;
		addRandom(0, count - 1);
		expectRange(0, count);
		expect(tree.getCount()).toBe(count);

		// Range scan
		const values: Entry[] = [];
		for (let path of tree.range(new KeyRange(new KeyBound(100), new KeyBound(200, false)))) {
			values.push(tree.at(path)!);
		}
		expect(values).toStrictEqual([...Array(100).keys()].map(i => ({ id: i + 100, value: (i + 100).toString() })));

		// Gut randomly
		deleteRandom(0, count - 1);
		expect(tree.getCount()).toBe(0);
	});

	function addRandom(start: number, end: number) {
		const range = [...Array(end - start + 1).keys()];
		while (range.length) {
			const index = Math.floor(Math.random() * range.length);
			const n = range.splice(index, 1)[0];
			if (!tree.insert({ id: n, value: n.toString() }).on) {
				throw new Error("Failed to insert " + index);
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
			expect(tree.at(path)).toStrictEqual({ id: i, value: i.toString() });
			i += s;
		}
		expect(i).toBe(starting + count);
	}
});
