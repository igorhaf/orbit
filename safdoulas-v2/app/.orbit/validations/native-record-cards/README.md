# Cursos em quadros nativos com escopo fixo

## Verificações automatizadas sem navegador

- `npm run test -w apps/api`: permissões, dependências, contratos e suspensão do conector, incluindo ROOT.
- `npm run build`: lint e TypeScript de API/web.
- `scripts/safdoulas-native-work-verify.mjs`: três quadros, nove fases, oito modelos, reabertura idempotente, oito perfis e bloqueio de fases livres, criação genérica, movimentação e compartilhamento indevidos.
- `scripts/safdoulas-native-work-demo.mjs`: comentários, checklists e agenda dos três exemplos existentes; execução idempotente sobre os exemplos conhecidos.
- `scripts/safdoulas-validate.mjs`: migrações e jornada com os treze documentos originais em banco descartável; inclui novo quadro de curso, reabertura sem duplicação, modelos idempotentes e projeção automática da fase após transição formal.

As verificações da API precisam de DATABASE_URL e JWT_SECRET no ambiente. Não grave credenciais no repositório.

## Jornada visual a conferir em ambiente autorizado

1. Em Seus quadros, conferir um quadro para cada curso autorizado.
2. Usar Criar → Novo quadro de curso e selecionar curso e regras ativos.
3. No quadro, abrir Modelos na lateral; no celular, abrir Modelos de cartões no cabeçalho.
4. Usar um modelo e conferir sua descrição, checklist, fase e pai principal.
5. No cartão principal, conferir anexos, comentários, responsáveis e datas; abrir Registro e transições e Dossiê e registros relacionados.
6. Após uma transição formal autorizada, conferir a fase do cartão principal.
7. Abrir o compromisso no calendário e retornar ao acompanhamento do curso.
8. Conferir que um perfil cegado não vê o quadro com identidade original e que Coleções/criação livre continuam indisponíveis.
9. Conferir larguras de celular e desktop e os painéis aninhados com teclado.

Navegadores e Selenium não foram executados neste host, conforme restrição expressa do usuário.
