import { BranchNode, LeafNode } from ".";

export class PathBranch<TKey> {
	constructor (
			public node: BranchNode<TKey>,
			public index: number,
	) {}
}

export class Path<TKey, TEntry> {
	constructor(
			public branches: PathBranch<TKey>[],
			public leafNode: LeafNode<TEntry>,
			public leafIndex: number,
			public isMatch: boolean
	) { }

	isEqual(path: Path<TKey, TEntry>) {
			return this.leafNode === path.leafNode
					&& this.leafIndex === path.leafIndex
					&& this.isMatch === path.isMatch;
	}
}
