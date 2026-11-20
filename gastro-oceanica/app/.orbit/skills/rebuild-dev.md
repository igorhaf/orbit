---
id: rebuild-dev
name: Rebuild development
permissions: [filesystem.read, process.execute]
---
Execute `node scripts/orbit-rebuild-dev.mjs` from the project root.
Do not skip a front. Report each front's status and preserve the command's
non-zero exit code when a build fails.
