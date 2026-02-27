# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um ANALISTA DE NEGÓCIOS experiente analisando código-fonte para extrair regras de negócio FUNCIONAIS.

Sua perspectiva é de NEGÓCIO, não de tecnologia. Imagine que você está escrevendo um documento
para o GERENTE DE PRODUTO ou DONO DO NEGÓCIO que não entende código.

EXTRAIA regras que respondam:
- O que o USUÁRIO pode ou não pode fazer?
- Quais são as PERMISSÕES e RESTRIÇÕES de acesso?
- Como funcionam os FLUXOS e PROCESSOS do sistema?
- Quais CÁLCULOS de negócio existem (preços, comissões, notas)?
- Quais LIMITES e QUOTAS o sistema impõe?
- Quais VALIDAÇÕES afetam a experiência do usuário?
- Como as ENTIDADES do negócio se relacionam?

IGNORE COMPLETAMENTE (não são regras de negócio):
- Tipos de campos (booleano, string, integer)
- Configurações de framework (drivers, sessões, guards, middleware)
- Detalhes de banco (foreign keys, NOT NULL, migrations)
- CSS, layout, estilização
- Logs, cache, filas, timeouts
- Imports, dependências, bibliotecas
- Configurações de ambiente (.env, configs)
- Código boilerplate ou padrões técnicos

FORMATO das regras (escreva como linguagem de negócio):
✅ BOM: "O aluno só pode avaliar um curso após completar pelo menos 50% das aulas"
✅ BOM: "O instrutor recebe 70% do valor de cada inscrição em seu curso"
✅ BOM: "Cupons de desconto expiram após a data limite definida pelo instrutor"
❌ RUIM: "O campo 'rating' deve ser um integer entre 1 e 5"
❌ RUIM: "A tabela enrollments tem foreign key para courses"
❌ RUIM: "O guard 'web' usa driver de sessão"

Responda APENAS em JSON válido, sem markdown, sem explicações adicionais.

## User Prompt

Arquivo: backend/app/orchestrators/nextjs_postgres.py
Linguagem: python

```
from .base import StackOrchestrator
from typing import Dict, List, Any
import re

class NextPostgresOrchestrator(StackOrchestrator):
    """
    Orquestrador especializado em Next.js + PostgreSQL

    Conhece:
    - Next.js 14 App Router
    - Server Components
    - Server Actions
    - Prisma ORM
    - TypeScript strict mode
    """

    def __init__(self):
        super().__init__()
        self.stack_name = "Next.js + PostgreSQL"
        self.stack_description = "Next.js 14 App Router with PostgreSQL using Prisma"

    def get_stack_context(self) -> str:
        return """
STACK: Next.js 14 (App Router) with PostgreSQL + Prisma

ARCHITECTURE:
- App Router (app/ directory)
- Server Components by default
- Server Actions for mutations
- API Routes for external access
- Prisma as ORM
- TypeScript strict mode

FILE STRUCTURE:
app/
  api/
    [resource]/
      route.ts
  [resource]/
    page.tsx
lib/
  prisma.ts
  actions.ts
prisma/
  schema.prisma

NAMING CONVENTIONS:
- Components: PascalCase (UserList)
- Files: kebab-case or PascalCase
- Functions: camelCase (getUsers)
- Types: PascalCase (User)
- Database: snake_case in Prisma

TECHNICAL PATTERNS:
- Server Components for data fetching
- Client Components only when needed
- Server Actions for mutations
- Zod for validation
"""

    def get_patterns(self) -> Dict[str, str]:
        return {
            "api_route": """import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const {entityName}Schema = z.object({{
  name: z.string().min(1),
  description: z.string().min(1),
}});

export async function GET() {{
  const items = await prisma.{entityName}.findMany();
  return NextResponse.json(items);
}}

export async function POST(req: NextRequest) {{
  try {{
    const body = await req.json();
    const validated = {entityName}Schema.parse(body);

    const item = await prisma.{entityName}.create({{
      data: validated,
    }});

    return NextResponse.json(item, {{ status: 201 }});
  }} catch (error) {{
    return NextResponse.json(
      {{ error: 'Validation failed' }},
      {{ status: 400 }}
    );
  }}
}}
""",

            "server_component": """import { prisma } from '@/lib/prisma';

export default async function {EntityName}Page() {{
  const items = await prisma.{entityName}.findMany();

  return (
    <div>
      <h1>{EntityName}s</h1>
      <ul>
        {{items.map(item => (
          <li key={{item.id}}>{{item.name}}</li>
        ))}}
      </ul>
    </div>
  );
}}
"""
        }

    def get_conventions(self) -> Dict[str, Any]:
        return {
            "components": "PascalCase",
            "files": "kebab-case or PascalCase",
            "functions": "camelCase",
            "types": "PascalCase",
            "database": "snake_case"
        }

    def validate_output(self, code: str, task: Dict) -> List[str]:
        """Validações Next.js + TypeScript"""
        issues = []

        # Check TypeScript types
        if '.tsx' in task.get('file_spec', {}).get('path', ''):
            if ': any' in code:
                issues.append("⚠️ Found 'any' type - use proper types")

        # Check Server Actions
        if "actions" in task.get('file_spec', {}).get('path', ''):
            if "'use server'" not in code:
                issues.append("❌ Missing 'use server' directive")

        return issues

```

Extraia as regras de negócio FUNCIONAIS deste arquivo.
Escreva cada regra como se explicasse para um GERENTE DE PRODUTO.
Responda em JSON com este formato exato:

{
  "business_rules": [
    {
      "rule_text": "Descrição funcional da regra em linguagem de negócio",
      "rule_type": "domain|validation|constraint|workflow|permission|calculation",
      "confidence": "high|medium|low",
      "source_context": "trecho relevante do código (max 100 chars)"
    }
  ],
  "entities_found": ["Entidade1", "Entidade2"],
  "file_purpose": "Breve descrição do propósito do arquivo (1 frase)",
  "file_layer": "schema|routes|logic|presentation|config"
}

Se não houver regras de negócio FUNCIONAIS, retorne: {"business_rules": [], "entities_found": [], "file_purpose": "..."}
Arquivos de configuração, estilização e infraestrutura geralmente NÃO contêm regras de negócio.

## Response


