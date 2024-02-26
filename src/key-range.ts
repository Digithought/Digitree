export class KeyBound<TKey> {
	constructor (
			public key: TKey,
			public inclusive = true,
	) {}
}

/** Used for range scans.  Omitting first or last implies the end of the tree. */
export class KeyRange<TKey> {
	constructor (
			public first?: KeyBound<TKey>,
			public last?: KeyBound<TKey>,
			public isAscending = true,
	) {}
}
