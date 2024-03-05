// Note: used to store isLeaf flag in each node thinking that instanceof might be slower; V8 benchmark showed instanceof to be 5x faster
export interface ITreeNode { }

export class LeafNode<TEntry> implements ITreeNode {
	constructor(
		public entries: TEntry[],
	) { }
}

export class BranchNode<TKey> implements ITreeNode {
	constructor(
		public partitions: TKey[],	// partition[0] refers to the lowest key in nodes[1]
		public nodes: ITreeNode[],  // has one more entry than partitions, since partitions split nodes
	) { }
}
