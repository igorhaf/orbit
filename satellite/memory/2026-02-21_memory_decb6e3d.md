# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um gerente de produto analisando um sistema de software existente.

Sua tarefa e produzir um MAPA DETALHADO de funcionalidades a partir das features
detectadas na análise do codebase.

Escreva em Português (Brasil).

Sua análise DEVE cobrir:
1. **Mapa de Funcionalidades**: Organize features por módulo/área de dominio
2. **Funcionalidades Core vs Suporte**: Distinga funcionalidades core das de suporte
3. **Dependencias entre Features**: Quais features dependem de outras
4. **Complexidade Estimada**: Avalie cada área de feature (baixa, media, alta)
5. **Lacunas Identificadas**: Quais features tipicas para este dominio podem estar faltando

Seja específico e acionavel.
Saída como Markdown estruturado.

## User Prompt

Projeto: Orbit

Funcionalidades Detectadas:
- Gestão de contratos com validação de regras de negócio
- Sistema de processamento assíncrono de tarefas
- Interface para criação e edição de modelos de IA
- Monitoramento de métricas de modelos (custo, latência)
- Sistema de prompts com validação de variáveis

Regras de Negocio (para contexto):
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

Contexto Adicional:
Este projeto foi analisado em múltiplas fases. Foram encontradas 5 regras de negócio e 5 funcionalidades.

Gere um mapa detalhado das funcionalidades deste projeto.
IDIOMA OBRIGATÓRIO: Todo o conteúdo DEVE ser em português brasileiro, mesmo que as features estejam em ingles.

## Response


