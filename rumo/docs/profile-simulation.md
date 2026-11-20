# Simulação ROOT de perfis

Todo papel global registrado em `access_roles` recebe persona e contexto demonstrativo; não mantenha uma lista fixa de papéis. Inclua papéis genéricos e papéis definidos pelos plugins do produto.

## Regras

- Preserve o token/sessão e o ator ROOT para auditoria; aplique as permissões do papel selecionado à persona demonstrativa.
- Mantenha exemplos sintéticos no banco/workspace deste produto e nunca reutilize cadastros reais ou dados de outro ambiente.
- Cada perfil deve ver tarefas, registros e fluxos coerentes com suas permissões; plugins de domínio contribuem fixtures compatíveis sem duplicar o core.
- Faça rotas sem fixtures isoladas falharem fechadas. Mantenha a simulação somente leitura até que qualquer escrita esteja limitada às próprias fixtures.
- Não dispare integrações, notificações, envios ou efeitos externos. Personas de demonstração não autenticam nem aparecem como usuários reais.

## Critério de revisão

Percorra todos os papéis do catálogo, confirme que cada um recebe contexto e que fluxos indisponíveis seguem as permissões efetivas. Registre fixtures e limitações específicas do produto aqui. Atualize os contratos de plugins e o `orbitArchitecturePrompt` quando uma regra persistente mudar.

## Exemplos do Rumo

O plugin Orbit `project-boards` acrescenta exemplos sintéticos de planejamento de projeto, quadro de entregas e tarefa bloqueada quando o papel tem `boards.read`. São projeções estáticas da simulação: não são registros de quadro, não criam dados e não habilitam rotas. Perfis sem essa permissão continuam recebendo o contexto genérico do Core, sem os exemplos de quadros.
