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

## Exemplos de domínio

- `gastro-clinic` fornece exemplos de fila de espera somente para papéis com `plugin.gastro-clinic.read`.
- `gastro-finance` fornece exemplos financeiros administrativos somente para papéis com `plugin.gastro-finance.read`.
- `gastro-inventory` fornece exemplos sintéticos de saldo e lote somente para papéis com `plugin.gastro-inventory.read`.

Esses itens são estáticos e somente de leitura. Não consultam nem representam cadastros, movimentações, saldos ou dados financeiros reais; a simulação não altera permissões nem libera rotas do produto.
