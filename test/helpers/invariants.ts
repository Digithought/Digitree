import { BranchNode, ITreeNode, LeafNode } from '../../src/nodes.js';
import { BTree, NodeCapacity } from '../../src/index.js';

/** Options controlling {@link assertTreeInvariants}. */
export interface InvariantOptions {
	/** When true (the default), the root node is exempt from the minimum-fill lower bound.
	 * A B+tree's root is legitimately allowed to be under half-full: it may hold as few as a
	 * single entry (single-leaf tree) or — when it is a branch — as few as two children. Set
	 * false only when validating a tree you expect to be deep/full at the root. */
	allowUnderfilledRoot?: boolean;
}

/** Minimum fill used by the tree's rebalancer.
 * Mirrors `rebalanceLeaf` (src/b-tree.ts) and `rebalanceBranch` (src/b-tree.ts), both `NodeCapacity >>> 1`. */
const MinFill = NodeCapacity >>> 1;

function describeKey(key: unknown): string {
	try {
		const json = JSON.stringify(key);
		return json === undefined ? String(key) : json;
	} catch {
		return String(key);
	}
}

/**
 * Recursively validates the structural invariants of a {@link BTree}, throwing an Error (naming the
 * offending node path and the violated rule) on the first violation found.
 *
 * Reaches the root via `(tree as any)['_root']` and the user-supplied comparator / key extractor via
 * `(tree as any)['compare']` and `(tree as any)['keyFromEntry']`, so it works for any key type.
 *
 * Rules checked:
 *   1. Uniform leaf depth — every leaf sits at the same depth.
 *   2. Fill bounds — every non-root node holds between `NodeCapacity>>>1` and `NodeCapacity` entries
 *      (leaf) / children (branch); the root is exempt from the lower bound unless
 *      `opts.allowUnderfilledRoot` is false. A root branch must still have >= 2 children.
 *   3. Shape — every branch has `partitions.length === nodes.length - 1`.
 *   4. Partition separation — for a branch, every key in subtree `nodes[i]` is `< partitions[i]`, and
 *      `partitions[i]` equals the minimum key of subtree `nodes[i+1]` ("partition[0] refers to the
 *      lowest key in nodes[1]", src/nodes.ts).
 *   5. Global order — a full in-order traversal yields strictly increasing keys (no drops, no repeats).
 *   6. Bidirectional agreement — `ascending(first())` keys === reverse of `descending(last())` keys
 *      === the in-order key list.
 *   7. Count — `getCount()` equals the number of entries reached by traversal.
 */
export function assertTreeInvariants<TKey, TEntry>(tree: BTree<TKey, TEntry>, opts: InvariantOptions = {}): void {
	const allowUnderfilledRoot = opts.allowUnderfilledRoot ?? true;
	const anyTree = tree as any;
	const root = anyTree['_root'] as ITreeNode | undefined;
	const compare = anyTree['compare'] as (a: TKey, b: TKey) => number;
	const keyFromEntry = anyTree['keyFromEntry'] as (entry: TEntry) => TKey;

	if (!root) {
		throw new Error('assertTreeInvariants: could not reach the tree root via _root');
	}
	if (typeof compare !== 'function' || typeof keyFromEntry !== 'function') {
		throw new Error('assertTreeInvariants: could not reach compare/keyFromEntry on the tree');
	}

	const leafDepths = new Set<number>();
	const orderedKeys: TKey[] = [];	// full in-order key list, built during recursion (rule 5)

	function checkFill(count: number, isRoot: boolean, isLeaf: boolean, path: string): void {
		const kind = isLeaf ? 'leaf' : 'branch';
		const unit = isLeaf ? 'entries' : 'children';
		if (count > NodeCapacity) {
			throw new Error(`Fill violation (rule 2) at ${kind} ${path}: ${count} ${unit} exceeds NodeCapacity (${NodeCapacity}).`);
		}
		if (!isRoot && count < MinFill) {
			throw new Error(`Fill violation (rule 2) at ${kind} ${path}: ${count} ${unit} below minimum fill (${MinFill}).`);
		}
		if (isRoot && !allowUnderfilledRoot && count < MinFill) {
			throw new Error(`Fill violation (rule 2) at root ${kind} ${path}: ${count} ${unit} below minimum fill (${MinFill}) with allowUnderfilledRoot=false.`);
		}
	}

	// Validates the subtree rooted at `node` and returns its [min, max] key, or null for an empty leaf
	// (only legal at the root of an empty tree).
	function recurse(node: ITreeNode, depth: number, isRoot: boolean, path: string): { min: TKey, max: TKey } | null {
		if (node instanceof LeafNode) {
			leafDepths.add(depth);
			const entries = node.entries as TEntry[];
			checkFill(entries.length, isRoot, true, path);
			if (entries.length === 0) {
				return null;	// empty leaf: only valid for the root of an empty tree
			}
			let min!: TKey;
			let max!: TKey;
			for (let i = 0; i < entries.length; i++) {
				const key = keyFromEntry(entries[i]);
				// Rule 5: a single running check across all leaves covers within-leaf order and cross-leaf seams.
				if (orderedKeys.length > 0 && compare(orderedKeys[orderedKeys.length - 1], key) >= 0) {
					throw new Error(`Order violation (rule 5) at leaf ${path}[${i}]: key ${describeKey(key)} is not strictly greater than prior key ${describeKey(orderedKeys[orderedKeys.length - 1])}.`);
				}
				if (i === 0) {
					min = key;
				}
				max = key;
				orderedKeys.push(key);
			}
			return { min, max };
		}

		if (node instanceof BranchNode) {
			const branch = node as BranchNode<TKey>;
			// Rule 3: shape
			if (branch.partitions.length !== branch.nodes.length - 1) {
				throw new Error(`Shape violation (rule 3) at branch ${path}: partitions.length (${branch.partitions.length}) !== nodes.length - 1 (${branch.nodes.length - 1}).`);
			}
			// Rule 2: fill bounds on child count
			checkFill(branch.nodes.length, isRoot, false, path);
			if (isRoot && branch.nodes.length < 2) {
				throw new Error(`Structure violation (rule 2) at root branch ${path}: a root branch must have >= 2 children but has ${branch.nodes.length}.`);
			}

			const childBounds: ({ min: TKey, max: TKey } | null)[] = [];
			for (let i = 0; i < branch.nodes.length; i++) {
				childBounds.push(recurse(branch.nodes[i], depth + 1, false, `${path}.${i}`));
			}

			// Rule 4: partition separation
			for (let i = 0; i < branch.partitions.length; i++) {
				const left = childBounds[i];
				const right = childBounds[i + 1];
				if (!left || !right) {
					throw new Error(`Partition violation (rule 4) at branch ${path}: subtree adjacent to partition[${i}] is empty.`);
				}
				const p = branch.partitions[i];
				// Every key in nodes[i] < partitions[i]; max of the (sorted) left subtree suffices.
				if (compare(left.max, p) >= 0) {
					throw new Error(`Partition violation (rule 4) at branch ${path}: max key of nodes[${i}] (${describeKey(left.max)}) is not < partition[${i}] (${describeKey(p)}).`);
				}
				// partitions[i] === minimum key of nodes[i+1].
				if (compare(p, right.min) !== 0) {
					throw new Error(`Partition violation (rule 4) at branch ${path}: partition[${i}] (${describeKey(p)}) does not equal the minimum key of nodes[${i + 1}] (${describeKey(right.min)}).`);
				}
			}

			const first = childBounds.find(b => b !== null);
			let last: { min: TKey, max: TKey } | null = null;
			for (let i = childBounds.length - 1; i >= 0; i--) {
				if (childBounds[i]) {
					last = childBounds[i];
					break;
				}
			}
			if (!first || !last) {
				throw new Error(`Structure violation at branch ${path}: branch subtree contains no entries.`);
			}
			return { min: first.min, max: last.max };
		}

		throw new Error(`Unknown node type at ${path}: ${Object.prototype.toString.call(node)}.`);
	}

	recurse(root, 0, true, 'root');

	// Rule 1: uniform leaf depth
	if (leafDepths.size > 1) {
		throw new Error(`Depth violation (rule 1): leaves occur at differing depths {${[...leafDepths].sort((a, b) => a - b).join(', ')}}.`);
	}

	// Rules 6 & 7 use the public navigation API. ascending()/descending() mutate and re-yield the same
	// path object, so the key must be read inside the loop (never spread into an array).
	const ascKeys: TKey[] = [];
	for (const p of tree.ascending(tree.first())) {
		ascKeys.push(keyFromEntry(p.leafNode.entries[p.leafIndex]));
	}
	const descKeys: TKey[] = [];
	for (const p of tree.descending(tree.last())) {
		descKeys.push(keyFromEntry(p.leafNode.entries[p.leafIndex]));
	}

	// Rule 6: ascending() === in-order key list
	if (ascKeys.length !== orderedKeys.length) {
		throw new Error(`Traversal mismatch (rule 6): ascending() yielded ${ascKeys.length} keys but the in-order structure has ${orderedKeys.length}.`);
	}
	for (let i = 0; i < orderedKeys.length; i++) {
		if (compare(ascKeys[i], orderedKeys[i]) !== 0) {
			throw new Error(`Traversal mismatch (rule 6) at index ${i}: ascending() key ${describeKey(ascKeys[i])} !== in-order key ${describeKey(orderedKeys[i])}.`);
		}
	}
	// Rule 6: reverse of descending() === in-order key list
	if (descKeys.length !== orderedKeys.length) {
		throw new Error(`Traversal mismatch (rule 6): descending() yielded ${descKeys.length} keys but the in-order structure has ${orderedKeys.length}.`);
	}
	for (let i = 0; i < orderedKeys.length; i++) {
		const mirrored = descKeys[descKeys.length - 1 - i];
		if (compare(mirrored, orderedKeys[i]) !== 0) {
			throw new Error(`Bidirectional mismatch (rule 6) at index ${i}: descending() (reversed) key ${describeKey(mirrored)} !== ascending key ${describeKey(orderedKeys[i])}.`);
		}
	}

	// Rule 7: count
	const count = tree.getCount();
	if (count !== orderedKeys.length) {
		throw new Error(`Count violation (rule 7): getCount() returned ${count} but traversal found ${orderedKeys.length} entries.`);
	}
}
