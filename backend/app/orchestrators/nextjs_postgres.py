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
