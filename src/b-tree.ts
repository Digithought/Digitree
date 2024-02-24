import { BranchNode, ITreeNode, KeyRange, LeafNode, Path, PathBranch } from ".";

// Capacity not configurable - not worth the runtime memory, when almost nobody will touch this
export const NodeCapacity = 64;

/**
 * Represents a lightweight B+(ish)Tree (data at leaves, but no linked list of leaves).
 * Allows for efficient storage and retrieval of data in a sorted manner.
 * @template TEntry The type of entries stored in the B-tree.
 * @template TKey The type of keys used for indexing the entries.  This might be an element of TEntry, or TEntry itself.
 */
export class BTree<TKey, TEntry> {
	private _root: ITreeNode;

	/**
	 * @param [compare=(a: TKey, b: TKey) => a < b ? -1 : a > b ? 1 : 0] a comparison function for keys.  The default uses < and > operators.
	 * @param [keyFromEntry=(entry: TEntry) => entry as unknown as TKey] a function to extract the key from an entry.  The default assumes the key is the entry itself.
	 */
	constructor(
		private readonly keyFromEntry = (entry: TEntry) => entry as unknown as TKey,
		private readonly compare = (a: TKey, b: TKey) => a < b ? -1 : a > b ? 1 : 0,
	) {
		this._root = new LeafNode([]);
	}

	/** @returns a path to the first entry (isMatch = false if no entries) */
	first(): Path<TKey, TEntry> {
		return this.getFirst(this._root);
	}

	/** @returns a path to the last entry (isMatch = false if no entries) */
	last(): Path<TKey, TEntry> {
		return this.getLast(this._root);
	}

	/** Attempts to find the given key
	 * If isMatch is true on the resulting path, a match was found.  Use near() to try to move the path to the nearest match. */
	find(key: TKey): Path<TKey, TEntry> {
		return this.getPath(this._root, key);
	}

	/** Iterates based on the given range */
	*range(range: KeyRange<TKey>): Generator<Path<TKey, TEntry>, void, void> {
		if (range.first && range.last) {
			// Ensure not inverted or empty range
			const comp = this.compareKeys(range.first.key, range.last.key);
			if ((comp === 0 && (!range.first.inclusive || !range.last.inclusive))
				|| comp === (range.isAscending ? 1 : -1)
			) {
				return;
			}
		}
		const startPath = range.first
			? this.find(range.first.key)
			: (range.isAscending ? this.first() : this.last());
		const iterable = range.isAscending
			? this.ascending(startPath)
			: this.descending(startPath);
		const iter = iterable[Symbol.iterator]();
		if (range.first && !range.first.inclusive) {
			iter.next();
		}
		const endPath = range.last
			? this.find(range.last.key)
			: (range.isAscending ? this.last() : this.first());
		for (let item of iter) {
			if (item.isEqual(endPath)) {
				if (!range.last || range.last.inclusive) {
					yield item;
				}
				break;
			}
			yield item;
		}
	}

	/**
	 * Adds a value to the tree.  Be sure to check the result, as the tree does not allow duplicate keys.
	 * Added entries are frozen to ensure immutability
	 * @returns true if the insert succeeded (there wasn't already an entry for the key); false otherwise. */
	insert(entry: TEntry): boolean {
		Object.freeze(entry);	// Ensure immutability
		const path = this.find(this.keyFromEntry(entry));
		if (path.isMatch) {
			return false;
		}
		this.insertAt(path, entry);
		return true;
	}

	/** Updates the entry at the given path to the given value.
	 * The isMatch property of the path will be cleared if the update causes the current path to no longer match the key.
	 * @returns true if the update succeeded (the key was unchanged, or the new key wasn't a duplicate); false otherwise. */
	updateAt(path: Path<TKey, TEntry>, newValue: TEntry) {
		if (path.isMatch) {	// we can assume leafIndex is valid
			const oldKey = this.keyFromEntry(path.leafNode.entries[path.leafIndex]);
			if (this.compareKeys(oldKey, this.keyFromEntry(newValue)) !== 0) {	// if key changed, delete and re-insert
				if (this.insert(newValue)) {
					this.deleteAt(path);
					return true;
				}
				path.isMatch = false;
				return false;
			} else {
				path.leafNode.entries[path.leafIndex] = Object.freeze(newValue);
			}
			return true;
		}
		return false;
	}

	/** Inserts the entry if it doesn't exist, or updates it if it does.
	 * The entry is frozen to ensure immutability.
	 * @returns true if the value was inserted; false when updated */
	upsert(entry: TEntry): boolean {
		Object.freeze(entry);	// Ensure immutability
		const path = this.find(this.keyFromEntry(entry));
		if (path.isMatch) {
			path.leafNode.entries[path.leafIndex] = entry;
			return false;
		} else {
			this.insertAt(path, entry);
			return true;
		}
	}

	/** Inserts or updates depending on the existence of the given key, using callbacks to generate the new value.
	 * @returns true if the value was inserted; false when updated */
	insdate(key: TKey, getInserted: () => TEntry, getUpdated: (existing: TEntry) => TEntry): boolean {
		const path = this.find(key);
		if (path.isMatch) {
			this.updateAt(path, Object.freeze(getUpdated(path.leafNode.entries[path.leafIndex])));
			return false;
		} else {
			this.insertAt(path, Object.freeze(getInserted()));
			return true;
		}
	}

	/** Deletes the entry at the given path.
	 * The isMatch property of the path will be cleared.
	 * @returns true if the delete succeeded (the key was found); false otherwise.
	*/
	deleteAt(path: Path<TKey, TEntry>): boolean {
		if (path.isMatch) {
			path.leafNode.entries.splice(path.leafIndex, 1);
			if (path.branches.length > 0) {   // Only wory about underflows, balancing, etc. if not root
				if (path.leafIndex === 0) { // If we deleted index 0, update branches with new key
					const pathBranch = path.branches.at(-1)!;
					this.updatePartition(pathBranch.index, path, path.branches.length - 1, this.keyFromEntry(path.leafNode.entries[path.leafIndex]));
				}
				const newRoot = this.rebalanceLeaf(path, path.branches.length);
				if (newRoot) {
					this._root = newRoot;
				}
			}
			path.isMatch = false;
			return true;
		} else {
			return false;
		}
	}

	/** @returns the entry for the given path if on an entry; undefined otherwise. */
	entryAt(path: Path<TKey, TEntry>) {
		return path.isMatch ? path.leafNode.entries[path.leafIndex] : undefined;
	}

	/** Iterates forward starting from the path location (inclusive) to the end. */
	*ascending(path: Path<TKey, TEntry>): Generator<Path<TKey, TEntry>, void, void> {
		this.near(path);
		while (path.isMatch) {
			yield path;
			this.next(path);
		}
	}

	/** Iterates backward starting from the path location (inclusive) to the end. */
	*descending(path: Path<TKey, TEntry>): Generator<Path<TKey, TEntry>, void, void> {
		this.near(path);
		while (path.isMatch) {
			yield path;
			this.prior(path);
		}
	}

	/** Computed (not stored) count.  Computes the sum using leaf-node lengths.  O(n/af) where af is average fill. */
	getCount(): number {
		let result = 0;
		const path = this.first();
		while (path.isMatch) {
			result += path.leafNode.entries.length;
			path.leafIndex = path.leafNode.entries.length - 1;
			this.next(path);
		}
		return result;
	}

	/** If the path isn't a match, but there is a "nearest" entry, this will place the path on it. */
	near(path: Path<TKey, TEntry>) {
		if (!path.isMatch) {
			const success = path.branches.every(branch => branch.index >= 0 && branch.index < branch.node.nodes.length)
				&& path.leafIndex >= 0 && path.leafIndex < path.leafNode.entries.length;
			path.isMatch = success;
			return success;
		} else {
			return true;
		}
	}

	/** Attempts to advance the path one step forward.  isMatch will be true if the path hasn't hit the end. */
	next(path: Path<TKey, TEntry>) {
		if (path.leafIndex >= path.leafNode.entries.length - 1) {
			let popCount = 0;
			let opening = false;
			const last = path.branches.length - 1;
			while (popCount <= last && !opening) {
				const branch = path.branches[last - popCount];
				if (branch.index === branch.node.partitions.length)	// last node in branch
					++popCount;
				else
					opening = true;
			}

			if (!opening) {
				path.leafIndex = path.leafNode.entries.length - 1;
				path.isMatch = false;
			} else {
				path.branches.splice(-popCount, popCount);
				const branch = path.branches.at(-1)!;
				++branch.index;
				this.moveToFirst(branch.node.nodes[branch.index], path);
			}
		}
		else {
			++path.leafIndex;
			path.isMatch = true;
		}
	}

	/** Attempts to advance the path one step backward.  isMatch will be true if the path hasn't hit the end. */
	prior(path: Path<TKey, TEntry>) {
		if (path.leafIndex <= 0) {
			let popCount = 0;
			let opening = false;
			const last = path.branches.length - 1;
			while (popCount <= last && !opening) {
				const branch = path.branches[last - popCount];
				if (branch.index === 0)	// first node in branch
					++popCount;
				else
					opening = true;
			}

			if (!opening) {
				path.leafIndex = 0;
				path.isMatch = false;
			} else {
				path.branches.splice(-popCount, popCount);
				const branch = path.branches.at(-1)!;
				--branch.index;
				this.moveToLast(branch.node.nodes[branch.index], path);
			}
		}
		else {
			--path.leafIndex;
			path.isMatch = true;
		}
	}

	/**
	 * Invokes user-provided comperator to compare two keys.
	 * Inner-loop code, so this doesn't do backflips to iron out ES's idiosyncrasies (undefined quirks, infinity, nulls, etc.), but does ensure deterministic comparison.
	 * If you want to eak out more performance at the risk of corruption, you can override this method and omit the consistency check.
	 */
	protected compareKeys(a: TKey, b: TKey): number {
		const result = this.compare(a, b);
		if (result !== 0 && result === this.compare(b, a)) {
			throw new Error("Inconsistent comparison function for given values");
		}
		return result;
	}

	private getPath(node: ITreeNode, key: TKey): Path<TKey, TEntry> {
		if (node.isLeaf) {
			const leaf = node as LeafNode<TEntry>;
			const [isMatch, index] = this.indexOfEntry(leaf.entries, key);
			return new Path<TKey, TEntry>([], leaf, index, isMatch);
		} else {
			const branch = node as BranchNode<TKey>;
			const index = this.indexOfKey(branch.partitions, key);
			const path = this.getPath(branch.nodes[index], key);
			path.branches.unshift(new PathBranch(branch, index));
			return path;
		}
	}

	private indexOfEntry(entries: TEntry[], key: TKey): [isMatch: boolean, index: number] {
		let lo = 0;
		let hi = entries.length - 1;
		let split = 0;
		let result = -1;

		while (lo <= hi) {
			split = (lo + hi) >> 1;
			result = this.compareKeys(key, this.keyFromEntry(entries[split]));

			if (result === 0)
				return [true, split];
			else if (result < 0)
				hi = split - 1;
			else
				lo = split + 1;
		}

		return [false, lo];
	}

	private indexOfKey(keys: TKey[], key: TKey): number {
		let lo = 0;
		let hi = keys.length - 1;
		let split = 0;
		let result = -1;

		while (lo <= hi) {
			split = (lo + hi) >> 1;
			result = this.compareKeys(key, keys[split]);

			if (result === 0)
				return split + 1;	// +1 because taking right partition
			else if (result < 0)
				hi = split - 1;
			else
				lo = split + 1;
		}

		return lo;
	}

	private insertAt(path: Path<TKey, TEntry>, entry: TEntry) {
		let split = this.leafInsert(path.leafNode, path.leafIndex, entry);
		let branchIndex = path.branches.length - 1;
		while (split && branchIndex >= 0) {
			split = this.branchInsert(path, branchIndex, split);
			--branchIndex;
		}
		if (split) {
			const newBranch = new BranchNode<TKey>([split.key], [this._root, split.right]);
			this._root = newBranch;
		}
		path.isMatch = true;
	}

	/** Starting from the given node, recursively working down to the leaf, build onto the path based on the beginning-most entry. */
	private moveToFirst(node: ITreeNode, path: Path<TKey, TEntry>) {
		if (node.isLeaf) {
			const leaf = node as LeafNode<TEntry>;
			path.leafNode = leaf;
			path.leafIndex = 0;
			path.isMatch = leaf.entries.length > 0;
		} else {
			path.branches.push(new PathBranch(node as BranchNode<TKey>, 0));
			this.moveToFirst((node as BranchNode<TKey>).nodes[0], path);
		}
	}

	/** Starting from the given node, recursively working down to the leaf, build onto the path based on the end-most entry. */
	private moveToLast(node: ITreeNode, path: Path<TKey, TEntry>) {
		if (node.isLeaf) {
			const leaf = node as LeafNode<TEntry>;
			const count = leaf.entries.length;
			path.leafNode = leaf;
			path.isMatch = count > 0;
			path.leafIndex = count > 0 ? count - 1 : 0;
		} else {
			const branch = node as BranchNode<TKey>;
			const pathBranch = new PathBranch(branch, branch.partitions.length);
			path.branches.push(pathBranch);
			this.moveToLast(branch.nodes[pathBranch.index], path);
		}
	}

	/** Construct a path based on the first-most edge of the given. */
	private getFirst(node: ITreeNode): Path<TKey, TEntry> {
		if (node.isLeaf) {
			const leaf = node as LeafNode<TEntry>;
			return new Path<TKey, TEntry>([], leaf, 0, leaf.entries.length > 0)
		} else {
			const branch = node as BranchNode<TKey>;
			const path = this.getFirst(branch.nodes[0]);
			path.branches.unshift(new PathBranch(branch, 0));
			return path;
		}
	}

	/** Construct a path based on the last-most edge of the given node */
	private getLast(node: ITreeNode): Path<TKey, TEntry> {
		if (node.isLeaf) {
			const leaf = node as LeafNode<TEntry>;
			const count = leaf.entries.length;
			return new Path<TKey, TEntry>([], leaf, count > 0 ? count - 1 : 0, count > 0);
		} else {
			const branch = node as BranchNode<TKey>;
			const index = branch.partitions.length - 1;
			const path = this.getLast(branch.nodes[index]);
			path.branches.unshift(new PathBranch(branch, index));
			return path;
		}
	}

	private leafInsert(leaf: LeafNode<TEntry>, index: number, entry: TEntry): Split<TKey> | undefined {
		if (leaf.entries.length < NodeCapacity) {  // No split needed
			leaf.entries.splice(index, 0, entry);
			return undefined;
		}
		// Full. Split needed

		const midIndex = (leaf.entries.length + 1) >> 1;
		const moveEntries = leaf.entries.splice(midIndex);

		// New node
		const newLeaf = new LeafNode(moveEntries);

		// Insert new entry into appropriate node
		if (index <= leaf.entries.length) {
			leaf.entries.splice(index, 0, entry);
		} else {
			newLeaf.entries.splice(index - leaf.entries.length, 0, entry);
		}

		return new Split<TKey>(this.keyFromEntry(moveEntries[0]), newLeaf);
	}

	private branchInsert(path: Path<TKey, TEntry>, branchIndex: number, split: Split<TKey>): Split<TKey> | undefined {
		const pathBranch = path.branches[branchIndex];
		const { index, node } = pathBranch;
		if (node.nodes.length < NodeCapacity) {  // no split needed
			node.partitions.splice(index, 0, split.key);
			node.nodes.splice(index + 1, 0, split.right);
			return undefined;
		}
		// Full. Split needed

		const midIndex = (node.nodes.length + 1) >> 1;
		const movePartitions = node.partitions.splice(midIndex);
		node.partitions.pop();	// Remove the extra partition
		const moveNodes = node.nodes.splice(midIndex);

		// New node
		const newBranch = new BranchNode(movePartitions, moveNodes);

		// Insert into appropriate node
		if (index < node.nodes.length) {
			node.partitions.splice(index, 0, split.key);
			node.nodes.splice(index + 1, 0, split.right);
		} else {
			pathBranch.index -= node.nodes.length;
			newBranch.partitions.splice(pathBranch.index, 0, split.key);
			newBranch.nodes.splice(pathBranch.index + 1, 0, split.right);
		}

		return new Split<TKey>(this.firstKeyOfNode(newBranch), newBranch);
	}

	private firstKeyOfNode(node: ITreeNode): TKey {
		if (node.isLeaf) {
			return this.keyFromEntry((node as LeafNode<TEntry>).entries[0]!);
		} else {
			return this.firstKeyOfNode((node as BranchNode<TKey>).nodes[0]);
		}
	}

	private rebalanceLeaf(path: Path<TKey, TEntry>, depth: number): ITreeNode | undefined {
		if (depth === 0 || path.leafNode.entries.length >= (NodeCapacity >> 1)) {
			return undefined;
		}

		const leaf = path.leafNode;
		const parent = path.branches.at(depth - 1)!;
		const pIndex = parent.index;
		const pNode = parent.node;

		const rightSib = pIndex < pNode.nodes.length ? pNode.nodes[pIndex + 1] as LeafNode<TEntry> : undefined;
		if (rightSib && rightSib.entries.length > (NodeCapacity >> 1)) {   // Attempt to borrow from right sibling
			leaf.entries.push(rightSib.entries.shift()!);
			this.updatePartition(pIndex + 1, path, depth - 1, this.keyFromEntry(rightSib.entries[0]!));
			return undefined;
		}

		const leftSib = pIndex > 0 ? pNode.nodes[pIndex - 1] as LeafNode<TEntry> : undefined;
		if (leftSib && leftSib.entries.length > (NodeCapacity >> 1)) {   // Attempt to borrow from left sibling
			const entry = leftSib.entries.pop()!;
			leaf.entries.unshift(entry);
			this.updatePartition(pIndex, path, depth - 1, this.keyFromEntry(entry));
			path.leafIndex += 1;
			return undefined;
		}

		if (rightSib && rightSib.entries.length + leaf.entries.length <= NodeCapacity) {  // Attempt to merge right sibling into leaf (right sib deleted)
			leaf.entries.push(...rightSib.entries);
			pNode.partitions.splice(pIndex, 1);
			pNode.nodes.splice(pIndex + 1, 1);
			if (pIndex === 0) { // 0th node of parent, update parent key
				this.updatePartition(pIndex, path, depth - 1, this.keyFromEntry(leaf.entries[0]!));
			}
			return this.rebalanceBranch(path, depth - 1);
		}

		if (leftSib && leftSib.entries.length + leaf.entries.length <= NodeCapacity) {  // Attempt to merge into left sibling (leaf deleted)
			leftSib.entries.push(...leaf.entries);
			pNode.partitions.splice(pIndex - 1, 1);
			pNode.nodes.splice(pIndex, 1);
			path.leafNode = leftSib;
			path.leafIndex += leftSib.entries.length;
			return this.rebalanceBranch(path, depth - 1);
		}
		return undefined;
	}

	private rebalanceBranch(path: Path<TKey, TEntry>, depth: number): ITreeNode | undefined {
		const pathBranch = path.branches[depth];
		const branch = pathBranch.node;
		if (depth === 0 && branch.partitions.length === 0) {  // last node... collapse child into root
			return path.branches[depth + 1]?.node ?? path.leafNode;
		}

		if (depth === 0 || (branch.nodes.length >= NodeCapacity << 1)) {
			return undefined;
		}

		const parent = path.branches.at(depth - 1)!;
		const pIndex = parent.index;
		const pNode = parent.node;

		const rightSib = pIndex < pNode.nodes.length ? (pNode.nodes[pIndex + 1]) as BranchNode<TKey> : undefined;
		if (rightSib && rightSib.nodes.length > (NodeCapacity >> 1)) {   // Attempt to borrow from right sibling
			branch.partitions.push(pNode.partitions[pIndex]);
			const node = rightSib.nodes.shift()!;
			branch.nodes.push(node);
			const rightKey = rightSib.partitions.shift()!;	// Replace parent partition with old key from right sibling
			this.updatePartition(pIndex + 1, path, depth - 1, rightKey);
			return undefined;
		}

		const leftSib = pIndex > 0 ? (pNode.nodes[pIndex - 1] as BranchNode<TKey>) : undefined;
		if (leftSib && leftSib.nodes.length > (NodeCapacity >> 1)) {   // Attempt to borrow from left sibling
			branch.partitions.unshift(pNode.partitions[pIndex - 1]);
			const node = leftSib.nodes.pop()!;
			branch.nodes.unshift(node);
			const pKey = leftSib.partitions.pop()!;
			pathBranch.index += 1;
			this.updatePartition(pIndex, path, depth - 1, pKey);
			return undefined;
		}

		if (rightSib && rightSib.nodes.length + branch.nodes.length <= NodeCapacity) {   // Attempt to merge right sibling into self
			const pKey = pNode.partitions.splice(pIndex, 1)[0]
			branch.partitions.push(pKey);
			branch.partitions.push(...rightSib.partitions);
			branch.nodes.push(...rightSib.nodes);
			pNode.nodes.splice(pIndex + 1, 1);
			if (pIndex === 0 && pNode.partitions.length > 0) {	// if parent is left edge, new right sibling is now the first partition
				this.updatePartition(pIndex, path, depth - 1, pNode.partitions[0]);
			}
			return this.rebalanceBranch(path, depth - 1);
		}

		if (leftSib && leftSib.nodes.length + branch.nodes.length <= NodeCapacity) {   // Attempt to merge self into left sibling
			const pKey = pNode.partitions.splice(pIndex - 1, 1)[0];
			leftSib.partitions.push(pKey);
			leftSib.partitions.push(...branch.partitions);
			leftSib.nodes.push(...branch.nodes);
			pNode.partitions.splice(pIndex - 1, 1);
			pNode.nodes.splice(pIndex, 1);
			pathBranch.node = leftSib;
			pathBranch.index += leftSib.nodes.length;
			return this.rebalanceBranch(path, depth - 1);
		}
	}

	private updatePartition(nodeIndex: number, path: Path<TKey, TEntry>, depth: number, newKey: TKey) {
		const pathBranch = path.branches[depth];
		if (nodeIndex > 0) {  // Only affects this branch; just update the partition key
			pathBranch.node.partitions[nodeIndex - 1] = newKey;
		} else if (depth !== 0) {
			this.updatePartition(path.branches[depth - 1].index, path, depth - 1, newKey);
		}
	}
}

class Split<TKey> {
	constructor(
		public key: TKey,
		public right: ITreeNode,
	) { }
}
