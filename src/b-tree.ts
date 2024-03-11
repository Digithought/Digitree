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
	private _version = 0;

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
	 * @returns Path to the key or the "crack" before it.  If `on` is true on the resulting path, the key was found.
	 * 	If `on` is false, next() and prior() can attempt to move to the nearest match. */
	find(key: TKey): Path<TKey, TEntry> {
		return this.getPath(this._root, key);
	}

	/** Retrieves the entry for the given key.
	 * Use find instead for a path to the key, the nearest match, or as a basis for navigation.
	 * @returns the entry for the given key if found; undefined otherwise. */
	get(key: TKey): TEntry | undefined {
		return this.at(this.find(key));
	}

	/** @returns the entry for the given path if on an entry; undefined otherwise. */
	at(path: Path<TKey, TEntry>): TEntry | undefined {
		this.validatePath(path);
		return path.on ? path.leafNode.entries[path.leafIndex] : undefined;
	}

	/** Iterates based on the given range
	 * WARNING: mutation during iteration will result in an exception
	*/
	*range(range: KeyRange<TKey>): IterableIterator<Path<TKey, TEntry>> {
		const startPath = range.first
			? this.findFirst(range)
			: (range.isAscending ? this.first() : this.last());
		const endPath = range.last
			? this.findLast(range)
			: (range.isAscending ? this.last() : this.first());
		const endKey = this.keyFromEntry(endPath.leafNode.entries[endPath.leafIndex]);
		const iterable = range.isAscending
			? this.internalAscending(startPath)
			: this.internalDescending(startPath);
		const ascendingFactor = range.isAscending ? 1 : -1;
		for (let path of iterable) {
			if (!path.on || !endPath.on || this.compareKeys(
				this.keyFromEntry(path.leafNode.entries[path.leafIndex]),
				endKey
			) * ascendingFactor > 0) {
				break;
			}
			yield path;
		}
	}

	/** @returns true if the given path remains valid; false if the tree has been mutated, invalidating the path. */
	isValid(path: Path<TKey, TEntry>) {
		return path.version === this._version;
	}

	/**
	 * Adds a value to the tree.  Be sure to check the result, as the tree does not allow duplicate keys.
	 * Added entries are frozen to ensure immutability
	 * @returns path to the new (on = true) or conflicting (on = false) row. */
	insert(entry: TEntry): Path<TKey, TEntry> {
		Object.freeze(entry);	// Ensure immutability
		const path = this.internalInsert(entry);
		if (path.on) {
			path.version = ++this._version;
		}
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
		this.validatePath(path);
		if (path.on) {
			Object.freeze(newEntry);
		}
		const result = this.internalUpdate(path, newEntry);
		if (result[0].on) {
			result[0].version = ++this._version;
		}
		return result;
	}

	/** Inserts the entry if it doesn't exist, or updates it if it does.
	 * The entry is frozen to ensure immutability.
	 * @returns path to the new entry.  on = true if existing; on = false if new. */
	upsert(entry: TEntry): Path<TKey, TEntry> {
		const path = this.find(this.keyFromEntry(entry));
		Object.freeze(entry);
		if (path.on) {
			path.leafNode.entries[path.leafIndex] = entry;
		} else {
			this.internalInsertAt(path, entry);
		}
		path.version = ++this._version;
		return path;
	}

	/** Inserts or updates depending on the existence of the given key, using callbacks to generate the new value.
	 * @param newEntry the new entry to insert if the key doesn't exist.
	 * @param getUpdated a callback to generate an updated entry if the key does exist.  WARNING: mutation in this callback will cause merge to error.
	 * @returns path to new entry and whether an update or insert attempted.
	 * If getUpdated callback returns a row that is already present, the resulting path will not be on. */
	merge(newEntry: TEntry, getUpdated: (existing: TEntry) => TEntry): [path: Path<TKey, TEntry>, wasUpdate: boolean] {
		const newKey = this.keyFromEntry(newEntry);
		const path = this.find(newKey);
		if (path.on) {
			const result = this.updateAt(path, getUpdated(path.leafNode.entries[path.leafIndex]));	// Don't use internalUpdate - need to freeze and check for mutation
			if (result[0].on) {
				result[0].version = ++this._version;
			}
			return result;
		} else {
			this.internalInsertAt(path, Object.freeze(newEntry));
			path.on = true;
			path.version = ++this._version;
			return [path, false];
		}
	}

	/** Deletes the entry at the given path.
	 * The on property of the path will be cleared.
	 * @returns true if the delete succeeded (the key was found); false otherwise.
	*/
	deleteAt(path: Path<TKey, TEntry>): boolean {
		this.validatePath(path);
		const result = this.internalDelete(path);
		if (result) {
			++this._version;
		}
		return result;
	}

	/** Iterates forward starting from the path location (inclusive) to the end.
	 * WARNING: mutation during iteration will result in an exception.
	*/
	ascending(path: Path<TKey, TEntry>): IterableIterator<Path<TKey, TEntry>> {
		this.validatePath(path);
		return this.internalAscending(path.clone());
	}

	/** Iterates backward starting from the path location (inclusive) to the end.
	 * WARNING: mutation during iteration will result in an exception
	*/
	descending(path: Path<TKey, TEntry>): IterableIterator<Path<TKey, TEntry>> {
		this.validatePath(path);
		return this.internalDescending(path.clone());
	}

	/** Computed (not stored) count.  Computes the sum using leaf-node lengths.  O(n/af) where af is average fill.
	 * @param from if provided, the count will start from the given path (inclusive).  If ascending is false,
	 * 	the count will start from the end of the tree.  Ascending is true by default.
	 */
	getCount(from?: { path: Path<TKey, TEntry>, ascending?: boolean }): number {
		let result = 0;
		const path = from ? from.path.clone() : this.first();
		if (from?.ascending ?? true) {
			while (path.on) {
				result += path.leafNode.entries.length - path.leafIndex;
				path.leafIndex = path.leafNode.entries.length - 1;
				this.internalNext(path);
			}
		} else {
			while (path.on) {
				result += path.leafIndex + 1;
				path.leafIndex = 0;
				this.internalPrior(path);
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
		this.validatePath(path);
		this.internalNext(path);
	}

	/** @returns a path one step backward.  on will be true if the path hasn't hit the end. */
	prior(path: Path<TKey, TEntry>): Path<TKey, TEntry> {
		const newPath = path.clone();
		this.movePrior(newPath);
		return newPath;
	}

	/** Attempts to advance the given path one step backwards. (mutates the path) */
	movePrior(path: Path<TKey, TEntry>) {
		this.validatePath(path);
		this.internalPrior(path);
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

	private *internalAscending(path: Path<TKey, TEntry>): IterableIterator<Path<TKey, TEntry>> {
		this.validatePath(path);
		while (path.on) {
			yield path;
			this.moveNext(path);	// Not internal - re-check after yield
		}
	}

	private *internalDescending(path: Path<TKey, TEntry>): IterableIterator<Path<TKey, TEntry>> {
		this.validatePath(path);
		while (path.on) {
			yield path;
			this.movePrior(path);	// Not internal - re-check after yield
		}
	}

	private findFirst(range: KeyRange<TKey>) {	// Assumes range.first is defined
		const startPath = this.find(range.first!.key)
		if (!startPath.on || (range.first && !range.first.inclusive)) {
			if (range.isAscending) {
				this.internalNext(startPath);
			} else {
				this.internalPrior(startPath);
			}
		}
		return startPath;
	}

	private findLast(range: KeyRange<TKey>) {	// Assumes range.last is defined
		const endPath = this.find(range.last!.key)
		if (!endPath.on || (range.last && !range.last.inclusive)) {
			if (range.isAscending) {
				this.internalPrior(endPath);
			} else {
				this.internalNext(endPath);
			}
		}
		return endPath;
	}


	private getPath(node: ITreeNode, key: TKey): Path<TKey, TEntry> {
		if (node instanceof LeafNode) {
			const leaf = node as LeafNode<TEntry>;
			const [on, index] = this.indexOfEntry(leaf.entries, key);
			return new Path<TKey, TEntry>([], leaf, index, on, this._version);
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
			split = (lo + hi) >>> 1;
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
			split = (lo + hi) >>> 1;
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

	private internalNext(path: Path<TKey, TEntry>) {
		if (!path.on) {	// Attempt to move off of crack
			path.on = path.branches.every(branch => branch.index >= 0 && branch.index < branch.node.nodes.length)
				&& path.leafIndex >= 0 && path.leafIndex < path.leafNode.entries.length;
			if (path.on) {
				return;
			}
		} else if (path.leafIndex >= path.leafNode.entries.length - 1) {
			let popCount = 0;
			let found = false;
			const last = path.branches.length - 1;
			while (popCount <= last && !found) {
				const branch = path.branches[last - popCount];
				if (branch.index === branch.node.partitions.length)	// last node in branch
					++popCount;
				else
					found = true;
			}

			if (!found) {
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

	private internalPrior(path: Path<TKey, TEntry>) {
		this.validatePath(path);
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

	private internalUpdate(path: Path<TKey, TEntry>, newEntry: TEntry): [path: Path<TKey, TEntry>, wasUpdate: boolean] {
		if (path.on) {
			const oldKey = this.keyFromEntry(path.leafNode.entries[path.leafIndex]);
			const newKey = this.keyFromEntry(newEntry);
			if (this.compareKeys(oldKey, newKey) !== 0) {	// if key changed, delete and re-insert
				let newPath = this.internalInsert(newEntry)
				if (newPath.on) {	// insert succeeded
					this.internalDelete(this.find(oldKey));	// Re-find - insert invalidated path
					newPath = this.find(newKey);	// Re-find- delete invalidated path
				}
				return [newPath, false];
			} else {
				path.leafNode.entries[path.leafIndex] = newEntry;
			}
		}
		return [path, true];
	}

	private internalDelete(path: Path<TKey, TEntry>): boolean {
		if (path.on) {
			path.leafNode.entries.splice(path.leafIndex, 1);
			if (path.branches.length > 0) {   // Only worry about underflows, balancing, etc. if not root
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

	private internalInsert(entry: TEntry): Path<TKey, TEntry> {
		const path = this.find(this.keyFromEntry(entry));
		if (path.on) {
			path.on = false;
			return path;
		}
		this.internalInsertAt(path, entry);
		path.on = true;
		return path;
	}

	private internalInsertAt(path: Path<TKey, TEntry>, entry: TEntry) {
		let split = this.leafInsert(path, entry);
		let branchIndex = path.branches.length - 1;
		while (split && branchIndex >= 0) {
			split = this.branchInsert(path, branchIndex, split);
			--branchIndex;
		}
		if (split) {
			const newBranch = new BranchNode<TKey>([split.key], [this._root, split.right]);
			this._root = newBranch;
			path.branches.unshift(new PathBranch(newBranch, split.indexDelta));
		}
	}

	/** Starting from the given node, recursively working down to the leaf, build onto the path based on the beginning-most entry. */
	private moveToFirst(node: ITreeNode, path: Path<TKey, TEntry>) {
		if (node instanceof LeafNode) {
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
		if (node instanceof LeafNode) {
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
		if (node instanceof LeafNode) {
			const leaf = node as LeafNode<TEntry>;
			return new Path<TKey, TEntry>([], leaf, 0, leaf.entries.length > 0, this._version)
		} else {
			const branch = node as BranchNode<TKey>;
			const path = this.getFirst(branch.nodes[0]);
			path.branches.unshift(new PathBranch(branch, 0));
			return path;
		}
	}

	/** Construct a path based on the last-most edge of the given node */
	private getLast(node: ITreeNode): Path<TKey, TEntry> {
		if (node instanceof LeafNode) {
			const leaf = node as LeafNode<TEntry>;
			const count = leaf.entries.length;
			return new Path<TKey, TEntry>([], leaf, count > 0 ? count - 1 : 0, count > 0, this._version);
		} else {
			const branch = node as BranchNode<TKey>;
			const index = branch.nodes.length - 1;
			const path = this.getLast(branch.nodes[index]);
			path.branches.unshift(new PathBranch(branch, index));
			return path;
		}
	}

	private leafInsert(path: Path<TKey, TEntry>, entry: TEntry): Split<TKey> | undefined {
		const { leafNode: leaf, leafIndex: index } = path;
		if (leaf.entries.length < NodeCapacity) {  // No split needed
			leaf.entries.splice(index, 0, entry);
			return undefined;
		}
		// Full. Split needed

		const midIndex = (leaf.entries.length + 1) >>> 1;
		const moveEntries = leaf.entries.splice(midIndex);

		// New node
		const newLeaf = new LeafNode(moveEntries);

		// Insert new entry into appropriate node
		if (index < midIndex) {
			leaf.entries.splice(index, 0, entry);
		} else {
			path.leafNode = newLeaf;
			path.leafIndex -= leaf.entries.length;
			newLeaf.entries.splice(path.leafIndex, 0, entry);
		}

		return new Split<TKey>(this.keyFromEntry(moveEntries[0]), newLeaf, index < midIndex ? 0 : 1);
	}

	private branchInsert(path: Path<TKey, TEntry>, branchIndex: number, split: Split<TKey>): Split<TKey> | undefined {
		const pathBranch = path.branches[branchIndex];
		const { index, node } = pathBranch;
		pathBranch.index += split.indexDelta;
		node.partitions.splice(index, 0, split.key);
		node.nodes.splice(index + 1, 0, split.right);
		if (node.nodes.length <= NodeCapacity) {  // no split needed
			return undefined;
		}
		// Full. Split needed

		const midIndex = node.nodes.length >>> 1;
		const movePartitions = node.partitions.splice(midIndex);
		const newPartition = node.partitions.pop()!;	// Extra partition promoted to parent
		const moveNodes = node.nodes.splice(midIndex);

		// New node
		const newBranch = new BranchNode(movePartitions, moveNodes);

		if (pathBranch.index >= midIndex) { // If new entry in new node, slide the index
			pathBranch.index -= midIndex;
		}

		return new Split<TKey>(newPartition, newBranch, pathBranch.index < midIndex ? 0 : 1);
	}

	private rebalanceLeaf(path: Path<TKey, TEntry>, depth: number): ITreeNode | undefined {
		if (depth === 0 || path.leafNode.entries.length >= (NodeCapacity >>> 1)) {
			return undefined;
		}

		const leaf = path.leafNode;
		const parent = path.branches.at(depth - 1)!;
		const pIndex = parent.index;
		const pNode = parent.node;

		const rightSib = pIndex < pNode.nodes.length ? pNode.nodes[pIndex + 1] as LeafNode<TEntry> : undefined;
		if (rightSib && rightSib.entries.length > (NodeCapacity >>> 1)) {   // Attempt to borrow from right sibling
			const entry = rightSib.entries.shift()!;
			leaf.entries.push(entry);
			this.updatePartition(pIndex + 1, path, depth - 1, this.keyFromEntry(rightSib.entries[0]!));
			return undefined;
		}

		const leftSib = pIndex > 0 ? pNode.nodes[pIndex - 1] as LeafNode<TEntry> : undefined;
		if (leftSib && leftSib.entries.length > (NodeCapacity >>> 1)) {   // Attempt to borrow from left sibling
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
		if (rightSib && rightSib.nodes.length > (NodeCapacity >>> 1)) {   // Attempt to borrow from right sibling
			branch.partitions.push(pNode.partitions[pIndex]);
			const node = rightSib.nodes.shift()!;
			branch.nodes.push(node);
			const rightKey = rightSib.partitions.shift()!;	// Replace parent partition with old key from right sibling
			this.updatePartition(pIndex + 1, path, depth - 1, rightKey);
			return undefined;
		}

		const leftSib = pIndex > 0 ? (pNode.nodes[pIndex - 1] as BranchNode<TKey>) : undefined;
		if (leftSib && leftSib.nodes.length > (NodeCapacity >>> 1)) {   // Attempt to borrow from left sibling
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

	private validatePath(path: Path<TKey, TEntry>) {
		if (!this.isValid(path)) {
			throw new Error("Path is invalid due to mutation of the tree");
		}
	}
}

class Split<TKey> {
	constructor(
		public key: TKey,
		public right: ITreeNode,
		public indexDelta: number,
	) { }
}

