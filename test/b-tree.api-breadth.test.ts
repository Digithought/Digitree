import { expect } from 'chai';
import { BTree, NodeCapacity, Path } from '../src/index.js';
import { BranchNode, ITreeNode, LeafNode } from '../src/nodes.js';
import { assertTreeInvariants } from './helpers/invariants.js';
import { lcg, shuffle } from './helpers/rng.js';

// Breadth coverage for the keyFromEntry / compare parameterization and a handful of API edges that the
// rest of the suite never reaches - every other test uses numeric, ascending, identity keys, so the
// generic comparator / key-extractor machinery is essentially untested off the happy path:
//   * non-numeric (string) keys under an explicit comparator, built to multi-level size,
//   * a reverse (descending) comparator,
//   * compound {a,b} keys extracted via keyFromEntry,
//   * getCount edge cases (empty, crack path, first()/last(), agreement with iteration both ways),
//   * insert / upsert / merge entry-freezing (immutability),
//   * the compareKeys consistency guard firing through find / delete on a multi-level tree,
//   * duplicate-key rejection deep in a multi-level tree.
//
// Builds go through the public insert() API in seeded-shuffled order so real splits run. assertTreeInvariants
// (the prior ticket's deliverable) reads the tree's own compare / keyFromEntry, so it validates strict order,
// partition separation, bidirectional agreement and count under whatever comparator a test installs; the
// per-test assertions then layer the exact expected key set / API contract on top of that structural floor.

const C = NodeCapacity;	// 64
const DEEP = C * C + 1;	// 4097 -> reliably >= 3 levels, so "multi-level" is genuine (a 2-level tree tops out at C*C)

const SEED = 0xb1eadce5;

// Counts the entries an iterator yields. ascending()/descending() re-yield one mutated path, so callers must
// count (or read inside the loop) rather than spread into an array.
const countIter = (it: Iterable<unknown>): number => {
	let n = 0;
	for (const _ of it) n++;
	return n;
};

// Full in-order entry list via the public navigation API (read inside the loop; never spread).
const ascendingValues = <TKey, TEntry>(tree: BTree<TKey, TEntry>): TEntry[] => {
	const out: TEntry[] = [];
	for (const p of tree.ascending(tree.first())) out.push(tree.at(p)!);
	return out;
};

const descendingValues = <TKey, TEntry>(tree: BTree<TKey, TEntry>): TEntry[] => {
	const out: TEntry[] = [];
	for (const p of tree.descending(tree.last())) out.push(tree.at(p)!);
	return out;
};

// A shape fingerprint (partition keys + leaf fill counts, recursively); deep-equal before/after an op proves
// no split / rebalance / rebuild occurred. (Same fingerprint used by test/b-tree.mutation-ops.test.ts.)
const structureOf = (node: ITreeNode): any => {
	if (node instanceof LeafNode) return ['leaf', node.entries.length];
	const b = node as BranchNode<unknown>;
	return ['branch', [...b.partitions], b.nodes.map(structureOf)];
};
const shapeOf = (tree: BTree<any, any>) => structureOf((tree as any)['_root']);

describe('API breadth: non-numeric keys / custom comparators', () => {
	it('string keys with an explicit string comparator hold order at multi-level size', () => {
		const strCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
		const tree = new BTree<string, string>(s => s, strCompare);
		const rng = lcg(SEED);
		// Zero-padded so lexicographic order matches the numeric index - the expected order is then obvious.
		const keys = [...Array(DEEP).keys()].map(i => `key-${i.toString().padStart(6, '0')}`);
		for (const s of shuffle(keys, rng)) expect(tree.insert(s).on, `insert ${s}`).to.be.true;

		assertTreeInvariants(tree);
		expect(tree.find('key-002048').branches.length, 'genuinely multi-level').to.be.greaterThanOrEqual(2);

		const expected = [...keys].sort(strCompare);
		expect(ascendingValues(tree)).to.deep.equal(expected);
		expect(descendingValues(tree)).to.deep.equal([...expected].reverse());
		expect(tree.getCount()).to.equal(DEEP);
		expect(tree.get('key-001000')).to.equal('key-001000');
		expect(tree.get('nope')).to.be.undefined;
	}).timeout(15000);

	it('a reverse comparator yields descending iteration with partitions consistent under it', () => {
		// Reverse sign of the default: comparator order is numeric-descending.
		const desc = (a: number, b: number): number => a < b ? 1 : a > b ? -1 : 0;
		const tree = new BTree<number, number>(k => k, desc);
		const rng = lcg(SEED);
		for (const k of shuffle([...Array(DEEP).keys()], rng)) expect(tree.insert(k).on).to.be.true;

		assertTreeInvariants(tree);	// validates partition separation under `desc`, not the default order
		expect(tree.find(2048).branches.length, 'genuinely multi-level').to.be.greaterThanOrEqual(2);

		// first()/last() and ascending() follow comparator order, which here is numeric-descending.
		expect(tree.at(tree.first())).to.equal(DEEP - 1);
		expect(tree.at(tree.last())).to.equal(0);
		const downward = [...Array(DEEP).keys()].map(i => DEEP - 1 - i);
		expect(ascendingValues(tree)).to.deep.equal(downward);
		expect(descendingValues(tree)).to.deep.equal([...downward].reverse());
	}).timeout(15000);

	it('compound {a,b} keys via keyFromEntry sort lexicographically at multi-level size', () => {
		interface Key { a: number; b: number }
		interface Row { a: number; b: number; seq: number }
		const lex = (x: Key, y: Key): number => {
			const c = x.a - y.a || x.b - y.b;
			return c < 0 ? -1 : c > 0 ? 1 : 0;
		};
		const tree = new BTree<Key, Row>(e => ({ a: e.a, b: e.b }), lex);
		const rng = lcg(SEED);
		// Distinct (a,b) pairs whose lexicographic order is exactly the index order.
		const rows: Row[] = [...Array(DEEP).keys()].map(i => ({ a: Math.floor(i / C), b: i % C, seq: i }));
		for (const r of shuffle(rows, rng)) expect(tree.insert(r).on, `insert ${r.seq}`).to.be.true;

		assertTreeInvariants(tree);
		expect(tree.find({ a: 32, b: 0 }).branches.length, 'genuinely multi-level').to.be.greaterThanOrEqual(2);

		expect(ascendingValues(tree).map(r => r.seq)).to.deep.equal([...Array(DEEP).keys()]);
		expect(descendingValues(tree).map(r => r.seq)).to.deep.equal([...Array(DEEP).keys()].reverse());
		// Keyed lookup routed through the extractor + comparator (fresh key object, not an entry).
		expect(tree.get({ a: 10, b: 5 })!.seq).to.equal(10 * C + 5);
		expect(tree.get({ a: 10, b: 5 })!.seq).to.equal(645);
		expect(tree.find({ a: 999, b: 0 }).on, 'absent compound key').to.be.false;
	}).timeout(15000);
});

describe('API breadth: getCount edge cases', () => {
	it('an empty tree counts 0 (no-arg and from first()/last())', () => {
		const tree = new BTree<number, number>();
		expect(tree.getCount()).to.equal(0);
		expect(tree.getCount({ path: tree.first(), ascending: true })).to.equal(0);
		expect(tree.getCount({ path: tree.last(), ascending: false })).to.equal(0);
	});

	it('agrees with iteration from first(), last() and interior on-paths (both directions)', () => {
		const tree = new BTree<number, number>();
		const rng = lcg(SEED);
		for (const k of shuffle([...Array(DEEP).keys()], rng)) tree.insert(k);
		assertTreeInvariants(tree);

		expect(tree.getCount(), 'no-arg total').to.equal(DEEP);

		// Endpoints: from first() the whole tree lies ahead and only itself behind; mirror for last().
		expect(tree.getCount({ path: tree.first(), ascending: true })).to.equal(DEEP);
		expect(tree.getCount({ path: tree.first(), ascending: false })).to.equal(1);
		expect(tree.getCount({ path: tree.last(), ascending: true })).to.equal(1);
		expect(tree.getCount({ path: tree.last(), ascending: false })).to.equal(DEEP);

		// Interior on-paths at known sorted positions (each key is its own position). Hit leaf-fill seams
		// (31/32/63/64) plus arbitrary deep keys, and cross-check the computed count against actual navigation.
		for (const k of [0, 1, 31, 32, 63, 64, 1000, DEEP - 2, DEEP - 1]) {
			const fwd = tree.getCount({ path: tree.find(k), ascending: true });
			const bwd = tree.getCount({ path: tree.find(k), ascending: false });
			expect(fwd, `forward count from key ${k}`).to.equal(DEEP - k);
			expect(bwd, `backward count from key ${k}`).to.equal(k + 1);
			expect(countIter(tree.ascending(tree.find(k))), `ascending iter from ${k}`).to.equal(fwd);
			expect(countIter(tree.descending(tree.find(k))), `descending iter from ${k}`).to.equal(bwd);
		}
	}).timeout(15000);

	it('from a not-on ("crack") path counts 0, consistent with iteration yielding nothing', () => {
		const tree = new BTree<number, number>();
		const rng = lcg(SEED ^ 0x55);
		for (const k of shuffle([...Array(DEEP).keys()], rng)) tree.insert(k);

		// An interior crack, a before-first crack, and an after-last crack. A crack path has on === false, and
		// ascending()/descending() yield nothing from one (see test/b-tree.one-leaf.test.ts "ascending()
		// iterates starting from not found key"); getCount mirrors that, so all three count 0.
		for (const crackKey of [100.5, -0.5, DEEP + 0.5]) {
			const crack = tree.find(crackKey);
			expect(crack.on, `find(${crackKey}) is a crack`).to.be.false;
			expect(tree.getCount({ path: crack, ascending: true }), `fwd from crack ${crackKey}`).to.equal(0);
			expect(tree.getCount({ path: crack, ascending: false }), `bwd from crack ${crackKey}`).to.equal(0);
			expect(countIter(tree.ascending(tree.find(crackKey))), `ascending iter from crack ${crackKey}`).to.equal(0);
			expect(countIter(tree.descending(tree.find(crackKey))), `descending iter from crack ${crackKey}`).to.equal(0);
		}
	}).timeout(15000);
});

describe('API breadth: immutability (frozen entries)', () => {
	type Entry = { id: number; value: string };

	it('insert freezes the entry; mutation attempts throw and leave tree state unchanged', () => {
		const tree = new BTree<number, Entry>(e => e.id);
		const entry: Entry = { id: 5, value: 'orig' };
		const path = tree.insert(entry);

		expect(path.on).to.be.true;
		expect(Object.isFrozen(entry), 'the passed entry object is frozen in place').to.be.true;
		const stored = tree.at(path)!;
		expect(stored, 'the stored entry is the same (frozen) object').to.equal(entry);
		expect(Object.isFrozen(stored)).to.be.true;
		// ESM runs in strict mode, so writes to a frozen entry throw rather than silently no-op.
		expect(() => { (stored as any).value = 'hacked'; }, 'value write rejected').to.throw(TypeError);
		expect(() => { (stored as any).id = 9999; }, 'key write rejected').to.throw(TypeError);
		expect(tree.get(5)!.value, 'tree state unchanged').to.equal('orig');
		expect(tree.get(9999), 'no phantom entry from the rejected key write').to.be.undefined;
	});

	it('upsert freezes both newly-inserted and replacement entries', () => {
		const tree = new BTree<number, Entry>(e => e.id);
		const inserted: Entry = { id: 1, value: 'a' };
		const r1 = tree.upsert(inserted);	// new key
		expect(r1.on, 'new-key upsert leaves the path on the crack before the new row').to.be.false;
		expect(Object.isFrozen(inserted)).to.be.true;
		expect(tree.get(1), 'inserted object is the one stored').to.equal(inserted);

		const replacement: Entry = { id: 1, value: 'b' };
		const r2 = tree.upsert(replacement);	// existing key
		expect(r2.on, 'existing-key upsert leaves the path on the entry').to.be.true;
		expect(tree.at(r2)).to.equal(replacement);
		expect(Object.isFrozen(replacement)).to.be.true;
		expect(() => { (replacement as any).value = 'x'; }).to.throw(TypeError);
		expect(tree.get(1)!.value).to.equal('b');
	});

	it('merge freezes both the inserted entry and a getUpdated replacement', () => {
		const tree = new BTree<number, Entry>(e => e.id);
		const fresh: Entry = { id: 7, value: 'new' };
		const [p1, was1] = tree.merge(fresh, () => { throw new Error('getUpdated must not run for an absent key'); });
		expect(was1, 'absent key -> inserted, not updated').to.be.false;
		expect(p1.on, 'merge leaves the path on the new row').to.be.true;
		expect(tree.at(p1)).to.equal(fresh);
		expect(Object.isFrozen(fresh)).to.be.true;

		// Present key: merge delegates to updateAt, which freezes the getUpdated result.
		const updated: Entry = { id: 7, value: 'merged' };
		const [p2, was2] = tree.merge({ id: 7, value: 'ignored' }, () => updated);
		expect(was2, 'present key, unchanged id -> value update').to.be.true;
		expect(tree.at(p2)).to.equal(updated);
		expect(Object.isFrozen(updated)).to.be.true;
		expect(() => { (updated as any).value = 'z'; }).to.throw(TypeError);
		expect(tree.get(7)!.value).to.equal('merged');
	});
});

describe('API breadth: compareKeys consistency guard on a multi-level tree', () => {
	// The one-leaf suite fires the guard on insert into a single leaf. compareKeys is the single comparison
	// chokepoint for the whole API, so here we drive it through find / get / delete-by-key on a >= 3-level
	// tree. POISON is never inserted; the comparator mishandles it (order-independent result), so only queries
	// touching POISON trip the guard - every real-key operation stays valid.
	const POISON = -1;
	const compare = (a: number, b: number): number => {
		if (a === POISON || b === POISON) return -1;	// inconsistent: compare(x,POISON) === compare(POISON,x)
		return a < b ? -1 : a > b ? 1 : 0;
	};

	it('guards find / get and the delete-by-key flow without blocking valid operations', () => {
		const tree = new BTree<number, number>(k => k, compare);
		const rng = lcg(SEED);
		for (const k of shuffle([...Array(DEEP).keys()], rng)) tree.insert(k);	// keys 0..DEEP-1; POISON absent

		assertTreeInvariants(tree);
		const deep = 2048;
		expect(tree.find(deep).branches.length, 'target sits deep (multi-level)').to.be.greaterThanOrEqual(2);
		expect(tree.find(deep).on, 'a real key is found fine under the (consistent-for-real-keys) comparator').to.be.true;

		const before = tree.getCount();
		// The guard fires during descent (the first inconsistent comparison is at a branch on a multi-level tree).
		expect(() => tree.find(POISON), 'find').to.throw(/[Ii]nconsistent/);
		expect(() => tree.get(POISON), 'get').to.throw(/[Ii]nconsistent/);
		// deleteAt itself does no comparison; its locating find is what the guard protects, so a corrupting
		// delete driven by a bad comparator can never start.
		expect(() => tree.deleteAt(tree.find(POISON)), 'delete-by-key').to.throw(/[Ii]nconsistent/);

		expect(tree.getCount(), 'the guarded throws left the tree untouched').to.equal(before);
		assertTreeInvariants(tree);

		// And a genuine delete still succeeds - the guard does not block consistent comparisons.
		expect(tree.deleteAt(tree.find(deep)), 'a valid delete still succeeds').to.be.true;
		expect(tree.getCount()).to.equal(before - 1);
		expect(tree.find(deep).on).to.be.false;
	}).timeout(15000);
});

describe('API breadth: Path.isEqual', () => {
	// isEqual compares (leafNode, leafIndex, on, version). It is public API (a Path method) but unexercised by
	// the rest of the suite. Build a multi-leaf tree so two keys can share a leaf or land in different leaves,
	// then drive each of the four short-circuiting comparisons to both outcomes.
	const build = (): BTree<number, number> => {
		const tree = new BTree<number, number>();
		for (let i = 0; i < C * 2; i++) tree.insert(i);	// > 1 leaf, so different keys can sit in different leaves
		return tree;
	};

	it('is true for two equal paths and reflexively for a clone', () => {
		const tree = build();
		expect(tree.find(0).isEqual(tree.find(0)), 'two finds of the same key').to.be.true;
		const p = tree.find(5);
		expect(p.isEqual(p.clone()), 'a clone equals its source').to.be.true;
	});

	it('is false when any one of leafNode / leafIndex / on / version differs', () => {
		const tree = build();
		const p0 = tree.find(0);
		// leafNode differs: key 0 and the last key sit in different leaves.
		expect(tree.find(0).isEqual(tree.find(C * 2 - 1)), 'different leaf').to.be.false;
		// leafIndex differs (same leaf): keys 0 and 1 share the first leaf.
		expect(tree.find(0).leafNode, 'same leaf for 0 and 1').to.equal(tree.find(1).leafNode);
		expect(tree.find(0).isEqual(tree.find(1)), 'same leaf, different index').to.be.false;
		// on differs (same leaf + index): the crack before key 0 sits at leafIndex 0 with on === false.
		const crack = tree.find(-0.5);
		expect(crack.on, 'crack before first key').to.be.false;
		expect(crack.leafNode, 'crack shares the first leaf').to.equal(p0.leafNode);
		expect(crack.leafIndex, 'crack at index 0').to.equal(p0.leafIndex);
		expect(p0.isEqual(crack), 'same leaf+index, different on').to.be.false;
		// version differs (all else equal): forge a path identical to p0 but with a bumped version.
		const stale = new Path(p0.branches, p0.leafNode, p0.leafIndex, p0.on, p0.version + 1);
		expect(p0.isEqual(stale), 'same leaf+index+on, different version').to.be.false;
	});
});

describe('API breadth: duplicate-key rejection at scale', () => {
	type Entry = { id: number; value: string };

	it('re-inserting a key deep in a multi-level tree returns a not-on path and does not mutate structure', () => {
		const tree = new BTree<number, Entry>(e => e.id);
		const rng = lcg(SEED);
		for (const id of shuffle([...Array(DEEP).keys()], rng)) {
			expect(tree.insert({ id, value: `v${id}` }).on, `insert ${id}`).to.be.true;
		}
		assertTreeInvariants(tree);

		const deep = 2048;
		expect(tree.find(deep).branches.length, 'target sits deep (multi-level)').to.be.greaterThanOrEqual(2);
		const shapeBefore = shapeOf(tree);
		const rootBefore = (tree as any)['_root'];
		const countBefore = tree.getCount();

		const result = tree.insert({ id: deep, value: 'DUP' });

		expect(result.on, 'duplicate insert returns a not-on (conflict) path').to.be.false;
		expect((tree as any)['_root'], 'no rebuild').to.equal(rootBefore);
		expect(shapeOf(tree), 'structure untouched (no split, no shift)').to.deep.equal(shapeBefore);
		expect(tree.getCount(), 'count unchanged').to.equal(countBefore);
		expect(tree.get(deep)!.value, 'existing value not overwritten').to.equal(`v${deep}`);
		assertTreeInvariants(tree);
	}).timeout(15000);
});
