# Digitree

Lightweight, fast in-memory B+Tree in TypeScript. Generic over `TKey`/`TEntry`; behaves as an ordered set (key = entry) or sorted dictionary (key extracted from entry). See [readme.md](readme.md) for usage.

## Layout

- `src/b-tree.ts` — `BTree<TKey, TEntry>` class; all public API and balancing logic. `NodeCapacity = 64` (fixed, not configurable).
- `src/nodes.ts` — `LeafNode` (holds entries) and `BranchNode` (partitions + child nodes). Data lives only in leaves; no leaf linked-list.
- `src/path.ts` — `Path` cursor (`branches`, `leafNode`, `leafIndex`, `on`, `version`) and `PathBranch`.
- `src/key-range.ts` — `KeyRange` for `range()`.
- `src/index.ts` — barrel export.
- `test/*.test.ts` — mocha + chai.

## Build & test

- Build: `yarn build` (or `npm run build`) — cleans then `tsc -p tsconfig.build.json`.
- Test: `yarn test` (or `npm test`) — mocha over `test/**/*.test.ts` via ts-node ESM loader.
- Docs: `yarn doc` (typedoc).
- Package manager is yarn 4; ESM (`"type": "module"`) — use `.js` extensions in imports.

## Core concepts (don't break these)

- **Paths are versioned cursors.** Any mutation bumps `_version` and invalidates all outstanding paths except the one a mutation method returns. Public methods validate the path version and throw on stale paths. Only `moveNext`/`movePrior` mutate a path in place; everything else returns a new one.
- **`on`** = cursor is on an entry vs. in a "crack" between/beyond entries. `find` returns the entry or the crack before it; `next`/`prior` move to the nearest match from a crack.
- **Entries are frozen on insert** to deter key mutation — but freezing is shallow and non-transitive. Never mutate a key after insert; use `updateAt`/`upsert`/`merge`/`deleteAt`.
- **Sort consistency over correctness.** The default compare uses `<`/`>`; a custom `compare` must be consistent, but the tree does not police Ecmascript comparison quirks.
- Public API: `insert`, `updateAt`, `deleteAt`, `upsert`, `merge`, `find`, `get`, `at`, `first`, `last`, `next`/`prior`, `moveNext`/`movePrior`, `ascending`/`descending`, `range`, `getCount`, `isValid`. All complexity O(log n); `getCount` is computed, not stored.

## Conventions

- Follow `.editorconfig`: **tabs** (size 2), UTF-8, single quotes in `.ts`, final newline. (Markdown uses spaces.)
- Stay minimalistic — helper/convenience features belong in an add-on library, not core.
- Performance is workload-sensitive: an "improvement" for one access pattern often regresses another. Benchmark broadly before claiming a speedup; add a failing-without-the-fix test for bug fixes.

## Tickets (tess)

This project uses [tess](tess/) for AI-driven ticket management.
Read and follow the ticket workflow rules in tess/agent-rules/tickets.md.
Tickets are in the [tickets/](tickets/) directory.
