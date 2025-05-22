import { BranchNode, LeafNode } from "./nodes.js";

export class PathBranch<TKey> {
	constructor (
			public node: BranchNode<TKey>,
			public index: number,
	) {}

	clone() {
			return new PathBranch(this.node, this.index);
	}
}

/** Represents a cursor in a BTree.  Invalid once mutation has occurred (unless it is the results of a mutation method).
 * Do not change the properties of this object directly.  Use the methods of the BTree class to manipulate it.
 * @member on - true if the cursor is on an entry, false if it is between entries.
 */
export class Path<TKey, TEntry> {
	constructor(
			public branches: PathBranch<TKey>[],
			public leafNode: LeafNode<TEntry>,
			public leafIndex: number,
			public on: boolean,
			public version: number,
	) { }

	isEqual(path: Path<TKey, TEntry>) {
			return this.leafNode === path.leafNode
					&& this.leafIndex === path.leafIndex
					&& this.on === path.on
					&& this.version === path.version;
	}

	clone() {
			return new Path(this.branches.map(b => b.clone()), this.leafNode, this.leafIndex, this.on, this.version);
	}
}
