@AGENTS.md

# Git workflow

`main` is protected by a GitHub ruleset: direct pushes are rejected, and a PR can only merge when all commits are signed and the required checks pass. Changes are batched on one branch until the user says they're done, then go in as a single PR.

### While making changes

1. **Check the current branch before changing anything** (`git branch --show-current`).
   - **On `main`:** run `git pull --ff-only`, then create a branch with a descriptive prefix: `feat/`, `fix/`, `docs/`, `ci/`, `chore/`, or `test/` for throwaway experiments.
   - **Already on another branch:** keep working on it. Don't create a new branch for each change; further changes belong on the same branch until the user says they're done.
2. **Never commit to or push `main`.**
3. **After making a change, ask the user whether they're done** or want more changes on this branch. Don't commit, push or open a PR until the user says yes.

### When the user says they're done

4. **Run the checks locally:** `npm run lint`, `npx next typegen && npx tsc --noEmit`, and `npm run build`.
5. **Commit. Commits must be signed.** Signing is configured globally (SSH key, `commit.gpgsign=true`), so never pass `--no-gpg-sign` or `-c commit.gpgsign=false`. Check with `git log --format='%G? %h %s' -1`, which should show `G`. If signing fails, stop and tell the user; don't work around it.
6. **Push the branch and open a PR with `gh pr create --base main`.** Include a summary and a test plan in the description. If the branch already has an open PR, push to it and update its description instead.
7. **Wait for the PR checks and read the results**, every time you push to a PR:
   - `gh pr checks <number> --watch` until the run finishes.
   - Then read the bot's results comment: `gh api repos/smifffystuff/node-chat-bot/issues/<number>/comments --jq '.[] | select(.user.login == "github-actions[bot]") | .body'`. For failed checks it includes error output and suggested fixes.
   - If anything failed, fix it, push again, and re-check. Don't report the work as done while checks are failing.
8. **Don't merge the PR yourself** unless the user asks. Report the PR link and the check results, and let the user review and merge.
9. **After the user merges:** `git switch main && git pull --ff-only`, then delete the branch locally (`git branch -d <branch>`) and on GitHub (`git push origin --delete <branch>`) if GitHub didn't already.

Test PRs and temporary commits used to try out CI must be clearly labelled, never merged, and cleaned up afterwards: close the PR and delete the branch. Force-pushing is fine on your own feature branches to drop temporary commits, but never on `main`.
