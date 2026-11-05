@AGENTS.md

## Daily task list

When asked to "create today task list" (or "task list", "daily status"), answer in exactly
this shape — it is pasted into a status report for the client, so it must stand alone:

```
ClientName: Sunil
ProjectName: Reliance GreenTech

Task-1: <short title> — completed.
<one short plain-English paragraph: what a user or manager can now do>

Task-2: <short title> — in progress.
<what is done, and what is left>
```

- One `Task-N:` per piece of work; merge related commits into one task. Small unrelated
  fixes go together in a single "Fixes." task as bullets.
- Plain words only: no commit hashes, file names, branch names, emojis or jargon.
- Scope is today's work by the person asking — find it with `git fetch` then
  `git log --all --since=<today 00:00> --author="$(git config user.name)" --pretty="%h %an %s"`
  across every branch, plus uncommitted changes. Manual testing, releases or meetings the
  person mentions go in as their own tasks, without inventing details.
- Mark a task **completed** only if its commit is merged into `origin/main` or `origin/dev`
  (`git merge-base --is-ancestor <sha> origin/main`). Work that exists only on a feature branch,
  or is not yet committed, is **in progress** — say it still needs to be merged.
- If the person pastes the previous day's list, leave out anything already reported.
