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

Arquivo: frontend/src/components/rag/RagStatsCard.tsx
Linguagem: typescript

```
/**
 * RAG Statistics Cards Component
 *
 * PROMPT #90 - RAG Monitoring & Code Indexing Frontend
 *
 * Displays key RAG metrics in a grid of stat cards:
 * - Hit Rate: Percentage of RAG-enabled calls that found relevant results
 * - Avg Similarity: Average relevance score of top matches
 * - Avg Latency: Average retrieval time in milliseconds
 * - Avg Results: Average number of documents retrieved per query
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui';
import { TrendingUp, Clock, Database, Target } from 'lucide-react';
import { RagStats } from '@/lib/types';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subtitle?: string;
  color?: string;
}

export function StatCard({ title, value, icon, subtitle, color = 'blue' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className={`text-3xl font-bold text-${color}-600 mt-2`}>
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
            )}
          </div>
          <div className={`p-3 bg-${color}-100 rounded-lg`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface RagStatsCardProps {
  stats: RagStats;
}

export function RagStatsCard({ stats }: RagStatsCardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        title="Taxa de Acerto"
        value={`${stats.hit_rate.toFixed(1)}%`}
        icon={<Target className="w-6 h-6 text-green-600" />}
        subtitle={`${stats.total_rag_hits} / ${stats.total_rag_enabled} hits`}
        color="green"
      />

      <StatCard
        title="Similaridade Media"
        value={stats.avg_top_similarity.toFixed(3)}
        icon={<TrendingUp className="w-6 h-6 text-blue-600" />}
        subtitle="Relevancia do melhor resultado"
        color="blue"
      />

      <StatCard
        title="Latencia Media"
        value={`${stats.avg_retrieval_time_ms.toFixed(0)}ms`}
        icon={<Clock className="w-6 h-6 text-purple-600" />}
        subtitle="Velocidade de recuperação"
        color="purple"
      />

      <StatCard
        title="Media de Resultados"
        value={stats.avg_results_count.toFixed(1)}
        icon={<Database className="w-6 h-6 text-indigo-600" />}
        subtitle="Documentos recuperados"
        color="indigo"
      />
    </div>
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


