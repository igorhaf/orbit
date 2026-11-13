# Decisões de arquitetura

## Distribuição de fontes por projeções

Os quatro runtimes usam builds isolados, imports locais e TypeScript com rootDir próprio. Foram adotados pacotes fonte com projeções determinísticas em cada aplicação. Existe um ponto de edição canônico, versão explícita e lock de conteúdo por consumidor. O build isolado continua autocontido e não depende da árvore externa do monorepo.

A promoção inicial usa igualdade exata de fontes genéricas. Arquivos distintos continuam como variantes dos runtimes até extração por contrato/adaptador; não são substituídos em massa. Alterações exclusivas de um produto devem continuar em plugins específicos ou filhos. A distribuição por fontes não afirma que todos os plugins tenham comportamento idêntico nem que todas as versões possíveis sejam compatíveis: o catálogo compara a composição concreta, e os contratos existentes são exercitados nas verificações.

## CLI local e conhecimento recuperável

As ferramentas de desenvolvimento usam Node.js e arquivos locais. O catálogo extrai metadados TypeScript sem importar a aplicação. A recuperação local usa BM25 e referências com hash; o RAG vetorial da aplicação continua separado e mantém suas permissões por workspace. Índices e evidências privadas não são publicados. Não há cobrança de embeddings ou serviço externo necessária para usar esse fluxo.

## Verificação proporcional à mudança

O grafo de imports, dependências de plugins e projeções escolhe verificações direcionadas. Mudança desconhecida usa cobertura conservadora. Cache só reaproveita comandos aprovados para as mesmas fontes e ambiente de execução identificado. Verificação obrigatória de cartão não pode ser removida por essa política.

Marcos executam cobertura mais ampla em sequência. Resultados de comandos e revisão funcional possuem estados distintos; fontes ou evidências alteradas invalidam a conclusão. Banco, integrações reais e renderização são validados no ambiente e com as autorizações apropriadas, sem iniciar serviços automaticamente.

## Agentes e estimativas

Múltiplos agentes só são recomendados com tarefas independentes, escopos explícitos e expectativa documentada de economia de tempo e tokens após coordenação. O planejador escolhe a menor quantidade útil; o integrador continua responsável pela demanda completa. Os números do planejador são estimativas fornecidas. Métricas de execução registram apenas cronômetros reais e não permitem concluir economia causal sem comparar escopo e fases equivalentes.
