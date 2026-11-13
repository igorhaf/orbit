# Implementação da aceleração Orbit

Data de referência: 10/11/2026. Branch ativa única: `main`.

O objetivo é tornar disponíveis em conjunto base reutilizável, configuração de produto, catálogo de plugins, contratos, geradores, stubs, migrações assistidas, análise de impacto, cache, verificação por marcos, delegação criteriosa, recuperação de contexto, métricas e entregas rastreáveis. A implementação preserva o padrão visual existente e o isolamento de bancos, dados e configuração.

As frentes foram divididas entre catálogo/impacto, geradores/stubs e conhecimento/métricas/entregas. O integrador mantém fontes compartilhadas, CLI, políticas persistentes, integração nos cartões e revisão final. Os arquivos de cada frente foram delimitados, sem edição concorrente.

Estado: ferramentas e políticas implementadas e integradas; verificações de código concluídas. A validação funcional de banco novo, navegador e integrações reais está delimitada em VALIDATION.md. Consulte README.md nesta pasta para a matriz de métodos e comandos. As evidências locais ficam em `.orbit/local/deliveries/acceleration-platform.json`; são privadas e não substituem os registros versionados de arquitetura.

O inventário de extração está em `shared-audit.json`. As diferenças legadas não são apagadas ou promovidas sem revisão; novos módulos comuns devem passar pelas fontes canônicas. O compartilhamento por projeções foi escolhido para preservar os imports e contextos de build existentes enquanto se reduz a edição repetida. Ele não declara equivalência funcional de todas as variantes legadas.
