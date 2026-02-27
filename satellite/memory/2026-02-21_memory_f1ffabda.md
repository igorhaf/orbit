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

Arquivo: frontend/src/components/kanban/SimilarityBadge.tsx
Linguagem: typescript

```
/**
 * SimilarityBadge Component
 * PROMPT #95 - Blocking System UI
 *
 * Displays similarity score for blocked tasks (modification detection).
 * Shows percentage with color-coded badge (90%+ = red, high similarity).
 */

'use client';

import { Badge } from '@/components/ui';
import { IconAlert, IconChart, IconCheckCircle } from '@/components/icons'; // PROMPT #188

interface Props {
  score: number; // 0.0 to 1.0
  className?: string;
}

export function SimilarityBadge({ score, className = '' }: Props) {
  const percentage = Math.round(score * 100);

  // Color coding:
  // 90-100%: Red (very high similarity - modification detected)
  // 80-89%: Orange (high similarity)
  // 70-79%: Yellow (moderate similarity)
  // <70%: Green (low similarity - unlikely to be a modification)
  const getBadgeColor = () => {
    if (percentage >= 90) {
      return 'bg-red-100 text-red-800 border-red-300';
    } else if (percentage >= 80) {
      return 'bg-orange-100 text-orange-800 border-orange-300';
    } else if (percentage >= 70) {
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    } else {
      return 'bg-green-100 text-green-800 border-green-300';
    }
  };

  // Icon based on severity
  const getIcon = () => {
    if (percentage >= 90) {
      return <IconAlert className="w-4 h-4 inline" />;
    } else if (percentage >= 80) {
      return <IconAlert className="w-4 h-4 inline" />;
    } else if (percentage >= 70) {
      return <IconChart className="w-4 h-4 inline" />;
    } else {
      return <IconCheckCircle className="w-4 h-4 inline" />;
    }
  };

  return (
    <Badge
      className={`${getBadgeColor()} font-semibold text-xs px-2 py-1 ${className}`}
      title={`Pontuacao de similaridade: ${percentage}% - ${percentage >= 90 ? 'Modificacao detectada' : 'Tarefa similar encontrada'}`}
    >
      <span className="mr-1">{getIcon()}</span>
      {percentage}% Semelhante
    </Badge>
  );
}

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


