# Merge train

`scripts/merge-train.js` lands many branches in batches of at most 10 and runs the whole CI sequence after each batch. When a batch goes red it finds the branch that broke it.

It **never pushes, never publishes, never touches main or master and never works in your checkout.** It builds a new branch `train/<stamp>` in a new git worktree (default `.claude/worktrees/train-<stamp>`) and leaves both there. Moving the result anywhere is your decision, by hand.

## Dry run (the default)

```
node scripts/merge-train.js --base origin/integration-2 --branches a,b,c
node scripts/merge-train.js --base origin/integration-2 --file branches.txt
```

Creates nothing. For each branch it reports whether it exists, how many commits it adds, whether every commit has a `Rank:` line (or a `release-ranks.txt` entry) and whether it merges cleanly into the base (`git merge-tree`, which writes no files). Exit 1 if a branch does not exist.

`branches.txt`: one branch per line or comma-separated; `#` starts a comment.

## Run

```
node scripts/merge-train.js --base origin/integration-2 --file branches.txt --run
```

Per batch:

1. Skip any branch with an unranked commit (the pre-merge Rank check; `--allow-unranked` turns it off). The report lists the commit hashes to rank.
2. `git merge --no-ff` each branch in order. A conflicting branch is aborted and skipped.
3. Run the CI sequence of `.github/workflows/verify.yml`, in order: `check:source`, `check:types`, `lint`, tests on **Node 22** (`npx -y node@22 vitest run --maxWorkers=4`), `smoke`, `smoke:restart`, `npm audit --omit=dev --audit-level=high`. `--with-pack` adds the package build; `--no-node22` runs the tests on the local Node. The first step is `scripts/heavy-gate.js`, so a running game or low memory stops the train (use `--force` semantics of the gate only knowingly: `VEX_HEAVY_FORCE=1`).
4. Green: next batch.
5. Red: bisect. The batch is rebuilt from its start with the first k branches, CI runs, and a binary search finds the first branch whose arrival turns CI red (at most 4 extra CI runs for 10 branches). That branch is left out, the rest are merged again and CI runs once more. If it is still red the train **halts** and says so: more than one branch is at fault, or the base was already red (run CI on the base first if in doubt).

A report is written to `%TEMP%\vex-merge-train-<stamp>.md` (or `--report`): per batch the result and branches merged, the branches left out and why, the skipped ones. Add the hashes it lists to `release-ranks.txt` (or fix the commit messages) and run again for the skipped branches.

## Options

| option | meaning |
| --- | --- |
| `--base <ref>` | where the train starts (required) |
| `--branches a,b` / `--file f` | what to merge, in this order |
| `--batch-size N` | 1 to 10 (default 10) |
| `--run` | do it (default is a dry run) |
| `--with-pack` | also run `npm run pack` per batch (slow, heavy) |
| `--no-node22` | run vitest on the local Node |
| `--allow-unranked` | do not skip branches with unranked commits |
| `--report <file>` / `--worktree <dir>` | where the report / worktree go |

## After the train

Look at the train branch (`git log --oneline origin/integration-2..train/<stamp>`), run `node scripts/release-check.js`, and decide yourself how it moves on. Close the Vex you use day to day before a `--with-pack` run (`dist\` is rebuilt), and do not run a train while a game is running.
