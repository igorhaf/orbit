---
name: orbit-development
description: Develop and maintain Orbit features, especially application interfaces and user workflows.
---

# Orbit Development

Use the current Orbit implementation and authenticated `/architecture` API contract as the source of truth for boards and orchestration. Reject unknown mutation fields; do not invent card fields or recreate obsolete UI. Cards use one checklist and live context links. Convert checklist items through the native endpoint so parent and inherited contexts stay attached. Load project skills even when the card has no selected skills. Boards linked to an architecture reference may only use custom fields defined by that reference.

For work in an existing site, preserve its approved layout and components. Keep execution reports, prompts, internal research and validation evidence out of public pages. Validate real rendering and interactions before concluding a demand; a successful worker exit alone does not prove acceptance.

The card interface uses IA do cartão, live Contextos links, and prompt-runs in the Execução tab. Do not render the removed Execução opcional, Contexto, Limites de alteração or Integrações panels, even when a card has an execution configuration. File scopes and mandatory verification remain backend configuration. Validate both a configured demand and the Orbit reference card in the browser; API structure alone cannot prove interface consistency.

For supervised projects, configure `require_write_scope: true` in `.orbit/orbit.yaml` and give each demand an explicit `context.write_scope` of relative files through the execution configuration API. The executor checks the working tree, restores changes outside that list, and fails the run. This completion check supports project supervision; it does not replace operating system isolation or permission controls. Revalidate the actual files and browser results before updating checklists or accepting a run.

Configure `post_execution_checks` as arrays of executable and arguments, such as `[npm, run, check]`, for mandatory project validations. Both execution paths await these checks before reporting success; failure or timeout fails the run. These checks require `process.execute`. Keep validation scripts outside the allowed write scope of implementation demands. Text generation runs in read only mode and does not authorize source edits.

Keep the Orbit system responsive across mobile, tablet, and desktop viewports whenever implementing or changing user-facing features.

- Design layouts to adapt to narrow screens; avoid fixed widths and horizontal page overflow.
- Preserve usable navigation, forms, dialogs, tables, and primary actions on touch-sized screens.
- Check the affected flow at a narrow mobile width and a desktop width, and address any responsive regressions introduced by the change.
- For shared navigation, board, dialog, or other cross-route layout changes, run `npm run test:selenium:mobile`; it covers phone and tablet widths, real touch events, and core routes. Set `ORBIT_SELENIUM_DB_HOST` when the DEV database hostname is only reachable inside Docker.
- Follow the repository's existing patterns and run relevant checks for the changed code.

Em projetos com escopo explícito e verificações obrigatórias, uma execução reprovada restaura também as alterações autorizadas da tentativa. Diretórios e caminhos por links simbólicos não são escopo de arquivos. As provas de navegador ficam privadas; testes não autorizam afrouxar os validadores.
