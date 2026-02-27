# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um analista de negocios e especialista em dominio analisando um projeto de software.

Sua tarefa e produzir uma ANÁLISE DETALHADA DO DOMINIO DE NEGOCIO a partir das regras
de negocio extraidas do codebase.

Escreva em Português (Brasil).

Sua análise DEVE cobrir:
1. **Dominio de Negocio**: Qual dominio de negocio este sistema atende
2. **Entidades Principais**: Entidades chave do dominio e seus relacionamentos
3. **Regras de Negocio Estruturadas**: Agrupe regras por área de dominio, explique cada uma
4. **Fluxos de Negocio**: Workflows core de negocio identificados a partir das regras
5. **Invariantes**: Restricoes de negocio que devem sempre ser verdadeiras

Seja específico. Mapeie regras para entidades e workflows.
Saída como Markdown estruturado.

## User Prompt

Projeto: Orbit

Regras de Negocio Extraidas do Código:
- Validação de variáveis obrigatórias em contratos e prompts
- Regras de validação semântica e de formato para garantir conformidade
- Sistema de auditoria com registro de mudanças em contratos
- Gerenciamento de status de tarefas e jobs com entrega de resultados
- Categorização de modelos de IA por tipo de uso e provedor
- Regra 1: Proibição de exclusão de pastas satélite criadas, garantindo integridade do conhecimento
- Regra 2: Impedir geração de cards enquanto ocorre reindexação RAG
- Regra 3: Validação de unicidade de projetos para evitar duplicatas
- Regra 4: Proteção contra exclusão de projetos com configuração ativa
- Regra 5: Restrição de geração automática de contexto humano e semântico
- Regra 6: Enforce de hierarquia de cards (Epic > Story > Task > Subtask)
- Regra 7: Validação de regras de negócio em todos os níveis da hierarquia
- Regra 8: Proibição de sobreposição de dados editados por humanos com dados gerados por IA
- Regra 9: Limitação de 10 arquivos por lote para processamento RAG
- Regra 10: Validação de domínio para classificação de regras de negócio

Funcionalidades Principais:
- Gestão de contratos com validação de regras de negócio
- Sistema de processamento assíncrono de tarefas
- Interface para criação e edição de modelos de IA
- Monitoramento de métricas de modelos (custo, latência)
- Sistema de prompts com validação de variáveis

Gere uma análise detalhada do dominio de negocio deste projeto.
IDIOMA OBRIGATÓRIO: Todo o conteúdo DEVE ser em português brasileiro, mesmo que as regras estejam em ingles.

## Response


