# Produto Orbit: rumo

Este diretório pertence ao monorepo Orbit. A branch ativa é unicamente main; não inicialize um repositório dentro deste produto nem crie branches por ambiente. Siga também as instruções da raiz do monorepo.

Edite capacidades comuns nas fontes canônicas em packages e sincronize as projeções pelo comando shared. Regras exclusivas deste produto pertencem a plugins próprios ou filhos com dependências explícitas. Preserve compatibilidade entre plugins e o isolamento de banco, dados, portas e configuração.

A simulação ROOT precisa oferecer contexto demonstrativo para cada papel global do catálogo, inclusive papéis novos e papéis de plugins. Use fixtures de domínio próprias, mantenha sessão e auditoria do ROOT, não consulte dados reais e faça rotas sem fixtures falharem fechadas; até a escrita segura existir, a simulação é somente leitura. Consulte docs/profile-simulation.md e inclua essa cobertura na revisão do produto.

Não inicie, pare ou reinicie serviços automaticamente; operações de ciclo de vida e deploy dependem de pedido explícito. Use o perfil e app/.orbit/runtime.json deste produto para selecionar endpoints de validação.
