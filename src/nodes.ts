// Note: used to store isLeaf flag in each node thinking that instanceof might be slower; V8 benchmark showed instanceof to be 5x faster
export interface ITreeNode { }

export class LeafNode<TEntry> implements ITreeNode {
	constructor(
		public entries: TEntry[],    // These don't move so that they can be externally referenced -- only inserted and deleted (ordering happens through sequence)
	) { }
}

export class BranchNode<TPartition> implements ITreeNode {
	constructor(
		public partitions: TPartition[],
		public nodes: ITreeNode[],  // has capacity plus one, since partitions split nodes
	) { }
}
