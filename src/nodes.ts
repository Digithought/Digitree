export interface ITreeNode {
    isLeaf: boolean,
}

export class LeafNode<TEntry> implements ITreeNode {
    readonly isLeaf = true;
    constructor (
        public entries: TEntry[],    // These don't move so that they can be externally referenced -- only inserted and deleted (ordering happens through sequence)
    ) {}
}

export class BranchNode<TPartition> implements ITreeNode {
    readonly isLeaf = false;
    constructor (
        public partitions: TPartition[],
        public nodes: ITreeNode[],  // has capacity plus one, since partitions split nodes
    ) {}
}

