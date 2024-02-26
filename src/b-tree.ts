import { KeyRange, Path, PathBranch } from ".";
import { BranchNode, ITreeNode, LeafNode } from "./nodes";

/** Node capacity.  Not configurable - not worth the runtime memory, when almost nobody will touch this */
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

	/** @returns a path to the first entry (on = false if no entries) */
	first(): Path<TKey, TEntry> {
		return this.getFirst(this._root);
	}

	/** @returns a path to the last entry (on = false if no entries) */
	last(): Path<TKey, TEntry> {
		return this.getLast(this._root);
	}

	/** Attempts to find the given key
	 * If on is true on the resulting path, a match was found.  Use near() to try to move the path to the nearest match. */
	find(key: TKey): Path<TKey, TEntry> {
		return this.getPath(this._root, key);
	}

	/** Iterates based on the given range */
	*range(range: KeyRange<TKey>): Generator<Path<TKey, TEntry>, void, void> {
		if (range.first && range.last) { // Ensure not inverted or empty range
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
		if (!startPath.on) {	// If not directly on a key, move on to the nearest
			if (range.isAscending) {
				this.moveNext(startPath);
			} else {
				this.movePrior(startPath);
			}
		}
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
		if (!endPath.on) {	// If not directly on a key, move on to the nearest
			if (range.isAscending) {
				this.movePrior(endPath);
			} else {
				this.moveNext(endPath);
			}
		}
		for (let path of iter) {
			if (path.isEqual(endPath)) {
				if (!range.last || range.last.inclusive) {
					yield path;
				}
				break;
			}
			yield path;
		}
	}

	/**
	 * Adds a value to the tree.  Be sure to check the result, as the tree does not allow duplicate keys.
	 * Added entries are frozen to ensure immutability
	 * @returns path to the new (on = true) or conflicting (on = false) row. */
	insert(entry: TEntry): Path<TKey, TEntry> {
		Object.freeze(entry);	// Ensure immutability
		const path = this.find(this.keyFromEntry(entry));
		if (path.on) {
			path.on = false;
			return path;
		}
		this.insertAt(path, entry);
		path.on = true;
		return path;
	}

	/** Updates the entry at the given path to the given value.  Deletes and inserts if the key changes.
	 * @returns path to resulting entry and whether it was an update (as opposed to an insert).
	 * 	* on = true if update/insert succeeded.
	 * 		* wasUpdate = true if updated; false if inserted.
	 * 		* Returned path is on entry
	 * 	* on = false if update/insert failed.
	 * 		* wasUpdate = true, given path is not on an entry
	 * 		* else newEntry's new key already present; returned path is "near" existing entry */
	updateAt(path: Path<TKey, TEntry>, newEntry: TEntry): [path: Path<TKey, TEntry>, wasUpdate: boolean] {
		if (path.on) {
			const oldKey = this.keyFromEntry(path.leafNode.entries[path.leafIndex]);
			const newKey = this.keyFromEntry(newEntry);
			if (this.compareKeys(oldKey, newKey) !== 0) {	// if key changed, delete and re-insert
				let newPath = this.insert(newEntry)
				if (newPath.on) {	// insert succeeded
					this.deleteAt(path);
					newPath = this.find(newKey);	// Re-find the new path - delete might have completely changed the tree
				}
				return [newPath, false];
			} else {
				path.leafNode.entries[path.leafIndex] = Object.freeze(newEntry);
			}
		}
		return [path, true];
	}

	/** Inserts the entry if it doesn't exist, or updates it if it does.
	 * The entry is frozen to ensure immutability.
	 * @returns path to the new entry.  on = true if existing; on = false if new. */
	upsert(entry: TEntry): Path<TKey, TEntry> {
		Object.freeze(entry);	// Ensure immutability
		const path = this.find(this.keyFromEntry(entry));
		if (path.on) {
			path.leafNode.entries[path.leafIndex] = entry;
		} else {
			this.insertAt(path, entry);
		}
		return path;
	}

	/** Inserts or updates depending on the existence of the given key, using callbacks to generate the new value.
	 * @param newEntry the new entry to insert if the key doesn't exist.
	 * @param getUpdated a callback to generate an updated entry if the key does exist.  WARNING: don't mutate the tree in this callback.
	 * @returns path to new entry and whether an update or insert attempted.
	 * If getUpdated callback returns a row that is already present, the resulting path will not be on. */
	merge(newEntry: TEntry, getUpdated: (existing: TEntry) => TEntry): [path: Path<TKey, TEntry>, wasUpdate: boolean] {
		const newKey = this.keyFromEntry(newEntry);
		const path = this.find(newKey);
		if (path.on) {
			return this.updateAt(path, getUpdated(path.leafNode.entries[path.leafIndex]));
		} else {
			this.insertAt(path, newEntry);
			path.on = true;
			return [path, false];
		}
	}

	/** Deletes the entry at the given path.
	 * The on property of the path will be cleared.
	 * @returns true if the delete succeeded (the key was found); false otherwise.
	*/
	deleteAt(path: Path<TKey, TEntry>): boolean {
		if (path.on) {
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
			path.on = false;
			return true;
		} else {
			return false;
		}
	}

	/** @returns the entry for the given path if on an entry; undefined otherwise. */
	at(path: Path<TKey, TEntry>): TEntry | undefined {
		return path.on ? path.leafNode.entries[path.leafIndex] : undefined;
	}

	/** Iterates forward starting from the path location (inclusive) to the end. */
	*ascending(path: Path<TKey, TEntry>): Generator<Path<TKey, TEntry>, void, void> {
		const newPath = path.clone();
		while (newPath.on) {
			yield newPath;
			this.moveNext(newPath);
		}
	}

	/** Iterates backward starting from the path location (inclusive) to the end. */
	*descending(path: Path<TKey, TEntry>): Generator<Path<TKey, TEntry>, void, void> {
		const newPath = path.clone();
		while (newPath.on) {
			yield newPath;
			this.movePrior(newPath);
		}
	}

	/** Computed (not stored) count.  Computes the sum using leaf-node lengths.  O(n/af) where af is average fill.
	 * @param from if provided, the count will start from the given path (inclusive).  If ascending is false,
	 * 	the count will start from the end of the tree.
	 */
	getCount(from?: { path: Path<TKey, TEntry>, ascending: boolean }): number {
		let result = 0;
		const path = from ? from.path.clone() : this.first();
		if (from?.ascending ?? true) {
			while (path.on) {
				result += path.leafNode.entries.length - path.leafIndex;
				path.leafIndex = path.leafNode.entries.length - 1;
				this.moveNext(path);
			}
		} else {
			while (path.on) {
				result += path.leafIndex + 1;
				path.leafIndex = 0;
				this.movePrior(path);
			}
		}
		return result;
	}

	/** @returns a path one step forward.  on will be true if the path hasn't hit the end. */
	next(path: Path<TKey, TEntry>): Path<TKey, TEntry> {
		const newPath = path.clone();
		this.moveNext(newPath);
		return newPath;
	}

	/** Attempts to advance the given path one step forward. (mutates the path) */
	moveNext(path: Path<TKey, TEntry>) {
		if (!path.on) {	// Attempt to move off of crack
			path.on = path.branches.every(branch => branch.index >= 0 && branch.index < branch.node.nodes.length)
				&& path.leafIndex >= 0 && path.leafIndex < path.leafNode.entries.length;
			if (path.on) {
				return;
			}
		} else if (path.leafIndex >= path.leafNode.entries.length - 1) {
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
				path.leafIndex = path.leafNode.entries.length;	// after last row = end crack
				path.on = false;
			} else {
				path.branches.splice(-popCount, popCount);
				const branch = path.branches.at(-1)!;
				++branch.index;
				this.moveToFirst(branch.node.nodes[branch.index], path);
			}
		}
		else {
			++path.leafIndex;
			path.on = true;
		}
	}

	/** @returns a path one step backward.  on will be true if the path hasn't hit the end. */
	prior(path: Path<TKey, TEntry>): Path<TKey, TEntry> {
		const newPath = path.clone();
		this.movePrior(newPath);
		return newPath;
	}

	/** Attempts to advance the given path one step backwards. (mutates the path) */
	movePrior(path: Path<TKey, TEntry>) {
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
				path.on = false;
			} else {
				path.branches.splice(-popCount, popCount);
				const branch = path.branches.at(-1)!;
				--branch.index;
				this.moveToLast(branch.node.nodes[branch.index], path);
			}
		}
		else {
			--path.leafIndex;
			path.on = true;
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
			const [on, index] = this.indexOfEntry(leaf.entries, key);
			return new Path<TKey, TEntry>([], leaf, index, on);
		} else {
			const branch = node as BranchNode<TKey>;
			const index = this.indexOfKey(branch.partitions, key);
			const path = this.getPath(branch.nodes[index], key);
			path.branches.unshift(new PathBranch(branch, index));
			return path;
		}
	}

	private indexOfEntry(entries: TEntry[], key: TKey): [on: boolean, index: number] {
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
	}

	/** Starting from the given node, recursively working down to the leaf, build onto the path based on the beginning-most entry. */
	private moveToFirst(node: ITreeNode, path: Path<TKey, TEntry>) {
		if (node.isLeaf) {
			const leaf = node as LeafNode<TEntry>;
			path.leafNode = leaf;
			path.leafIndex = 0;
			path.on = leaf.entries.length > 0;
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
			path.on = count > 0;
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
