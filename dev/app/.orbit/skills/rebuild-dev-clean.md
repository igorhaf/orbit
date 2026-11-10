---
id: rebuild-dev-clean
name: Clean rebuild development
permissions: [filesystem.read, filesystem.write, process.execute]
---
Execute `node scripts/orbit-rebuild-dev.mjs --clean` from the project root.
Preserve the database contents. Remove compiled API and Web artifacts before
building, report each stage, and preserve a non-zero exit code on failure.
