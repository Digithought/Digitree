import { expect } from 'chai';
import { BTree } from '../src/index.js';

describe('BTree Path Validation', () => {
	let tree: BTree<number, number>; // Example using number for both TKey and TEntry for simplicity

	beforeEach(() => {
		tree = new BTree<number, number>();
		// Populate the tree with initial data if necessary
	});

	// Helper function to populate the tree
	function populateTree(entries: number[]) {
		entries.forEach(entry => tree.insert(entry));
	}

	it('path remains valid after non-mutating operations', () => {
		populateTree([1, 2, 3]);
		const path = tree.find(2);
		const isValidBefore = tree.isValid(path);
		// Perform non-mutating operation
		tree.at(path);
		const isValidAfter = tree.isValid(path);
		expect(isValidBefore).to.be.true;
		expect(isValidAfter).to.be.true;
	});

	it('path is invalidated after insert', () => {
		populateTree([1, 2, 3]);
		const path = tree.find(2);
		tree.insert(4); // Mutating operation
		const isValid = tree.isValid(path);
		expect(isValid).to.be.false;
	});

	it('path is invalidated after delete', () => {
		populateTree([1, 2, 3]);
		const path = tree.find(2);
		tree.deleteAt(path); // Mutating operation
		const isValid = tree.isValid(path);
		expect(isValid).to.be.false;
	});

	it('path is invalidated after update', () => {
		populateTree([1, 2, 3]);
		const path = tree.find(2);
		tree.updateAt(path, 5); // Mutating operation
		const isValid = tree.isValid(path);
		expect(isValid).to.be.false;
	});

	it('path is invalidated during iteration after mutation', () => {
		populateTree([1, 2, 3, 4, 5]);
		const range = { first: { key: 1, inclusive: true }, last: { key: 5, inclusive: true }, isAscending: true };
		const iterator = tree.range(range);
		const firstPath = iterator.next().value;
		tree.insert(6); // Mutating operation during iteration
		const isValid = tree.isValid(firstPath!);
		expect(isValid).to.be.false;
		expect(() => iterator.next()).to.throw();
	});

	it('merge operation does not proceed when getUpdated mutates the tree', () => {
		populateTree([1, 2, 3]);

		// Attempt to perform a mutation within getUpdated
		const attemptMutationInGetUpdated = () => {
			tree.merge(
				3,	// Already present
				(existing) => {
					// Mutating operation within getUpdated
					tree.insert(5);
					return 4;
				}
			);
		};

		// Expect an exception to be thrown, preventing the merge
		expect(attemptMutationInGetUpdated).to.throw();
	});

});
