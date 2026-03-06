"""
Commits Contracts - Auto-generated from YAML contracts.
Source: backend/app/contracts/commits/ (1 files)
"""


# --- commits/commit_message.yaml ---

COMMITS_COMMIT_MESSAGE_SYSTEM = """## REGRA GERAL
- NUNCA use emojis ou simbolos especiais nas respostas"""

COMMITS_COMMIT_MESSAGE_USER = """Gere uma mensagem de commit profissional seguindo a especificação Conventional Commits.

INFORMAÇÕES DA TAREFA:
Título: {{ task_title }}
Descrição: {{ task_description | default('Sem descrição') }}
Status: {{ task_status }}

ALTERAÇÕES REALIZADAS:
{{ changes }}

TIPOS DE COMMIT CONVENCIONAL:
- feat: Nova funcionalidade
- fix: Correção de bug
- docs: Apenas documentação
- style: Estilo/formatação de código (sem mudança de lógica)
- refactor: Refatoração de código
- test: Adição de testes
- chore: Manutencao, dependencias
- perf: Melhoria de performance

FORMATO:
type(scope): subject

REGRAS:
1. Subject em minusculas
2. Sem ponto final
3. Máximo 72 caracteres
4. Seja específico e claro
5. Use ingles para o commit (padrão da industria)
6. Use modo imperativo (ex: "add" não "added")

EXEMPLOS:
- feat(auth): implement JWT authentication
- fix(api): resolve database connection timeout
- docs(readme): update installation guide
- refactor(user): simplify profile update logic
- perf(query): optimize database indexes

FORMATO DE RESPOSTA (JSON):
{
  "type": "feat",
  "scope": "auth",
  "subject": "implement JWT authentication",
  "description": "Breve explicacao do que foi feito"
}

Gere a mensagem de commit baseada na tarefa e alterações acima.
Retorne APENAS o JSON, sem markdown ou texto extra."""


CONTRACTS = {
    "commits/commit_message": {"system": COMMITS_COMMIT_MESSAGE_SYSTEM, "user": COMMITS_COMMIT_MESSAGE_USER, "usage_type": "commit_generation"},
}
