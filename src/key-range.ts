export class KeyBound<TKey> {
	constructor (
			public key: TKey,
			public inclusive = true,
	) {}
}

export class KeyRange<TKey> {
	constructor (
			public first?: KeyBound<TKey>,
			public last?: KeyBound<TKey>,
			public isAscending = true,
	) {}
}
