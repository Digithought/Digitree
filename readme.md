# Digitree

Lightweight and performant B+Tree.  [On GitHub](https://github.com/Digithought/Digitree)

### Overview

Welcome to Digitree, a fast in-memory B+Tree[^1], written in Typescript using generics.  A B+Tree is an efficient balanced tree structure, which provides the basis for most database engines, but also happens to be one of the efficient structures for storing sorted information in-memory.  Worst case space efficiency is N*2, which matches that of "size doubling" list building methods.  Unlike the latter, however, random insertion and deletion are far more efficient, which is important when maintaining total ordering.

This implementation takes two type arguments: `TKey` and `TEntry`.  The key must be obtainable from the entry, and a constructor callback extracts the key from an entry.  If TEntry and TKey are the same, the tree essentially acts like an ordered set.  To use the tree like a sorted dictionary, simply use an entry type like this: `{ key: 5, value: "five" }` with a callback like this: `e => e.key`.  Inserted entries are frozen to ensure that they don't mutate, and corrupt the tree.

Features:
* **Set or dictionary** behavior
* **Existing attribute** can be used as a key (without additional storage)
* **Custom sorting**
  * For performance, doesn't try to untangle idiosyncrasies of Ecmascript comparisons, but...
  * Implementation does ensure consistency of sorting function
* **Light weight** - very little memory used, only important primitives
* **CRUD**: `insert`, `updateAt`, `deleteAt`, `find`, `first`, `last`
* **Upsert and Merge** for efficient hybrid mutation
* **Enumerations** using `ascending` and `descending` from optional starting point
* **Ranges** using `range`, ascending or descending, with optional inclusive/exclusive end-points
* **Path** navigation through `next` and `prior` or `moveNext` and `movePrior`
* **Find nearest**, using `next` on an unsuccessful path
* **Count** using `getCount`, computed by summing leaf entries

WARNING: this library freezes added entries to reduce the chance that keys are externally mutated, but this is not done transitively, so it is possible that an object's key can be mutated after adding, resulting in tree corruption.  Don't attempt to change a key value after it has been inserted.  Use updateAt, upsert, insdate, or deleteAt/insert to change the key value.

[^1]: technically this is a hybrid B-Tree/B+Tree.  Data are stored in the leaves, but no leaf-level linked list is implemented, since that's largely for optimizing for minimal contention.

### Usage

#### Installing

Via npm:
```
  npm install digitree
```

Via pnpm:
```
  npm add digitree
```

#### As an ordered set

```ts
  import { BTree } from 'digitree';
  ...
  const tree = new BTree<number, number>();
  tree.insert(3); tree.insert(1); tree.insert(2);
  for (let path of tree.ascending(tree.first())) {
    console.log(tree.at(path));
  }
  const path = tree.find(1.5);  // result in "crack" between values
  console.log(path.on); // false (not on entry)
  console.log(tree.at(tree.next(path))); // 2
```

#### As an ordered dictionary

```ts
  import { BTree } from 'digitree';
  ...
  interface Widget { id: number, shape: "square" | "circle" };
  const tree = new BTree<number, Widget>(e => e.id);
  tree.insert({ id: 3, shape: "square" });
  tree.insert({ id: 1, shape: "circle" });
  tree.insert({ id: 2, shape: "square" });
  for (let path of tree.ascending(tree.first())) {
    console.log(tree.at(path));
  }
  console.log(tree.get(2));  // Equivalent to find then at
```

#### See [Reference Documentation](https://digithought.github.io/Digitree/)

#### Paths

Many methods take and return Path objects.  All paths not returned from a mutation operation itself are invalid after mutation and any attempt to use them will throw an exception.  None of the public methods will mutate a given path, except for `moveNext` and `movePrior`.

```ts
  tree.updateAt(tree.last().prior(), 7);  // this is fine
  
  const path1 = tree.last();
  const ninePath = tree.updateAt(tree.find(5), 9);
  tree.updateAt(ninePath, 8);  // Fine, ninePath came from mutation
  //tree.updateAt(path1, 7);  // DON'T USE path1 - invalid after mutation
```

### Background

At one point, a colleague and I set about finding the fastest possible data structure for in-memory storage of datasets, small and large.  We experimented in C++ with various highly optimized data structures.  We inserted, deleted, and read from millions of data rows in various benchmarks.  We figured that structures like AVL trees or red-black trees would be the fastest due to simple design, but in the end, a B+Tree implementation, not dissimilar in design to this one (though much faster in C++) was the clear winner.  For some tests, they were about the same, but the other structures had terrible worst cases, whereas the B+Tree was reliably and consistently fast for a variety of workloads.  In studying this further, we realized that just as disk operations like to be performed in blocks, the same is true for memory and processor caches.

#### History

The B-Tree, and more specifically the B+Tree, is a type of self-balancing tree data structure that maintains sorted data in a way that allows for efficient insertion, deletion, and sequential access operations. The B+Tree is an extension of the B-Tree, designed to optimize the read and write operations of databases and file systems by reducing the amount of disk accesses required to find, insert, or delete entries.  Those same optimizations also apply to memory.

The B-Tree was first introduced by Rudolf Bayer and Edward M. McCreight in 1972 as a generalization of the binary search tree, in contexts where blocks of data could only be efficiently accessed in fixed-size chunks, such as disks or tapes (or memory blocks). The key innovation was its ability to maintain balance through tree operations that ensure all leaf nodes are at the same depth, significantly improving the efficiency of tree traversal and manipulation.

The B+Tree variant further modifies the B-Tree structure by storing all data in the leaf nodes and using the internal nodes purely for indexing. Traditionally, the leaf nodes are also linked across the bottom of the tree.  This implementation doesn't add that extra complexity, rather it maintains an open path structure for rapid traversal.  In a highly concurrent database context, the linked list avoids depending on high-traffic routing nodes, which is not an issue for this structure.

#### Performance

The best-case and worst-case time complexities for search, insertion, and deletion operations in a B+Tree are all O(log n), where n is the number of elements in the tree. This efficiency is maintained regardless of the tree's size, making B+Trees particularly well-suited for systems that manage large amounts of data.  For small datasets, this implementation has barely more overhead than an array, and should perform comparably to an ordered array.

### Contributing

Bug fixes, architectural enhancements, and speed improvement suggestions are welcome.  Added "helper" features might be better as an add-on library since the goal of this is to remain minimalistic.

#### Help wanted

* Benchmark suite
* Better insulation of path's internals
* More tests
* AssemblyScript portability?

#### Bug Fixes

The best way to contribute a bug fix is to submit a Pull Request with the fix, as well as a unit test that only passes with the fix.  Second best is to submit just a unit test that is broken.  If either of those are too tall an order, submit an issue.

#### Performance Improvements

Try to be sure that the enhancement isn't only associated with a particular usage pattern.  Performance of a B+Tree is a very tricky matter, and it's easy to improve one pattern while regressing another.

#### Environment

* If using VSCode use the editorconfig plugin to honor the conventions in `.editorconfig`
* Build: `pnpm build` or `npm run build`
* Test: `pnpm test` or `npm test`
