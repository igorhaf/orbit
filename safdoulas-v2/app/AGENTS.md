# Orbit agent instructions

Use [`.agents/skills/orbit-development/SKILL.md`](.agents/skills/orbit-development/SKILL.md) for Orbit feature development and interface changes.

## Ciclo de vida das aplicações

Não reinicie, levante ou derrube as instâncias Orbit automaticamente. Só faça qualquer ação de ciclo de vida (parar, iniciar ou reiniciar develop ou produção) quando o usuário pedir explicitamente.

## Validações sem navegador

Não execute Selenium dentro do Orbit ou neste host de desenvolvimento. O usuário desautorizou essas execuções após um travamento da máquina. Não inicie Chrome/Chromium ou ChromeDriver para substituir essa validação automaticamente. Use lint, TypeScript, testes unitários e verificações da API em sequência. Os scripts de navegador permanecem como referência; uma nova execução exige autorização explícita do usuário em um ambiente adequado.

Follow the repository Git conventions in [`.agents/skills/orbit-git-conventions/SKILL.md`](.agents/skills/orbit-git-conventions/SKILL.md) whenever branch or commit work is requested. Do not create or rename a branch, stage files for a commit, or create a commit unless the user explicitly requests that Git action. A request to implement or fix code alone does not authorize it.

After every user-requested commit, follow [`.agents/skills/orbit-post-commit-validation/SKILL.md`](.agents/skills/orbit-post-commit-validation/SKILL.md) to rebuild, restart, and run unit tests, repeating after repairs until all available checks pass or a prerequisite blocks verification.

Before every user-requested commit, run `npm run build` from the repository root. Builds lint the API and web workspaces with zero warnings allowed and then compile them. If lint or compilation fails, fix the reported problems and rerun the failing check and the full build until everything passes. Never bypass the pre-commit hook or commit while a lint issue remains. `npm run lint:fix` may fix some issues, but review its edits and rerun `npm run build`.
