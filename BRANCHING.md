# Branch workflow

**`main`** is the stable site. Do not commit experiments directly on `main`.

## Reference

- **Current default / v3:** `main` since PR #2 (`arty-whole-body`, commit `64de42a`) — dual magnetic fluids:
  M and S melt together as the cursor approaches (whole-body attraction).
- **v2:** commit `838faa7` — capped max-merge, readable MS snake, no cursor blot.
  - Tags: `v2-max-merge` / `reference/max-merge-snake`
  - Branch pin: `reference/v2-max-merge`
- **v1:** commit `05a8cd0` (solid MS, centered, outward stretch).
  - Tags: `reference/solid-ms-fluid` / `v1-solid-ms`
- Previous wild-thread main kept as: `archive/wild-thread-ms`

## How to work

1. Start from up-to-date `main`:
   `git checkout main && git pull`
2. Create a feature branch:
   `git checkout -b short-topic-name`
3. Commit and push the branch; open a PR into `main` when ready.
4. Merge only after review / when the result should become the live default.

## Active experiment branch

- `smooth-morph` — history of the MS morph experiments; further morph tweaks can continue here or on a new branch from `main`.
