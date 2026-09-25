# MyTrello agent instructions

Follow the repository Git conventions in [`.agents/skills/mytrello-git-conventions/SKILL.md`](.agents/skills/mytrello-git-conventions/SKILL.md) whenever branch or commit work is requested. Do not create or rename a branch, stage files for a commit, or create a commit unless the user explicitly requests that Git action. A request to implement or fix code alone does not authorize it.

After every user-requested commit, follow [`.agents/skills/mytrello-post-commit-validation/SKILL.md`](.agents/skills/mytrello-post-commit-validation/SKILL.md) to rebuild, restart, and run unit tests, repeating after repairs until all available checks pass or a prerequisite blocks verification.

Before every user-requested commit, run `npm run build` from the repository root. Builds lint the API and web workspaces with zero warnings allowed and then compile them. If lint or compilation fails, fix the reported problems and rerun the failing check and the full build until everything passes. Never bypass the pre-commit hook or commit while a lint issue remains. `npm run lint:fix` may fix some issues, but review its edits and rerun `npm run build`.
