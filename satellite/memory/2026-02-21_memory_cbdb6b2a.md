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

Arquivo: frontend/src/app/ai-executions/page.tsx
Linguagem: typescript

```
/**
 * AI Executions Page
 * Displays AI execution logs with filtering and detailed view
 * PROMPT #54 - AI Execution Logging System
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { aiExecutionsApi } from '@/lib/api';
import { Activity, RefreshCw, TrendingUp, Database, Clock, AlertCircle } from 'lucide-react';
import { useNotification } from '@/hooks';

interface AIExecution {
  id: string;
  usage_type: string;
  provider: string;
  model_name: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  created_at: string;
}

interface AIExecutionDetail {
  id: string;
  ai_model_id: string | null;
  usage_type: string;
  provider: string;
  model_name: string;
  input_messages: any[];
  system_prompt: string | null;
  response_content: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  temperature: string | null;
  max_tokens: number | null;
  execution_metadata: any;
  error_message: string | null;
  execution_time_ms: number | null;
  created_at: string;
}

interface Stats {
  total_executions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  executions_by_provider: Record<string, number>;
  executions_by_usage_type: Record<string, number>;
  avg_execution_time_ms: number | null;
}

export default function AIExecutionsPage() {
  const { showError, NotificationComponent } = useNotification();
  const [executions, setExecutions] = useState<AIExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<AIExecutionDetail | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUsageType, setFilterUsageType] = useState<string>('');
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [filterHasError, setFilterHasError] = useState<string>('');

  const loadExecutions = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {};
      if (filterUsageType) params.usage_type = filterUsageType;
      if (filterProvider) params.provider = filterProvider;
      if (filterHasError === 'true') params.has_error = true;
      if (filterHasError === 'false') params.has_error = false;

      const [executionsData, statsData] = await Promise.all([
        aiExecutionsApi.list(params),
        aiExecutionsApi.stats()
      ]);

      setExecutions(executionsData);
      setStats(statsData);
    } catch (err: any) {
      console.error('Failed to load executions:', err);
      setError(err.message || 'Falha ao carregar execucoes');
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionDetail = async (id: string) => {
    try {
      const detail = await aiExecutionsApi.get(id);
      setSelectedExecution(detail);
    } catch (err: any) {
      console.error('Failed to load execution detail:', err);
      showError('Falha ao carregar detalhes da execução');
    }
  };

  useEffect(() => {
    loadExecutions();
  }, [filterUsageType, filterProvider, filterHasError]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatNumber = (num: number | null) => {
    if (num === null || num === undefined) return 'N/A';
    return num.toLocaleString();
  };

  const getUsageTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'prompt_generation': 'Geração de Prompts',
      'task_execution': 'Execução de Tarefas',
      'commit_generation': 'Geração de Commits',
      'interview': 'Entrevista',
      'general': 'Geral'
    };
    return labels[type] || type;
  };

  const getProviderColor = (provider: string) => {
    const colors: Record<string, string> = {
      'anthropic': 'bg-purple-100 text-purple-700',
      'openai': 'bg-green-100 text-green-700',
      'google': 'bg-blue-100 text-blue-700'
    };
    return colors[provider] || 'bg-gray-100 text-gray-700';
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 rounded-lg">
              <Activity className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Execucoes IA</h1>
              <p className="text-gray-600 mt-1">
                Monitore e análise logs de execução de modelos IA
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={loadExecutions}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total de Execucoes</p>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(stats.total_executions)}</p>
                  </div>
                  <Database className="w-8 h-8 text-indigo-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Tokens Totais</p>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(stats.total_tokens)}</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Tokens de Entrada</p>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(stats.total_input_tokens)}</p>
                  </div>
                  <Activity className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Tempo Medio Exec</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {stats.avg_execution_time_ms ? `${Math.round(stats.avg_execution_time_ms)}ms` : 'N/A'}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tipo de Uso
                </label>
                <select
                  value={filterUsageType}
                  onChange={(e) => setFilterUsageType(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="">Todos os Tipos</option>
                  <option value="prompt_generation">Geração de Prompts</option>
                  <option value="task_execution">Execução de Tarefas</option>
                  <option value="commit_generation">Geração de Commits</option>
                  <option value="interview">Entrevista</option>
                  <option value="general">Geral</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Provedor
                </label>
                <select
                  value={filterProvider}
                  onChange={(e) => setFilterProvider(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="">Todos os Provedores</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="google">Google (Gemini)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  value={filterHasError}
                  onChange={(e) => setFilterHasError(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="">Todos os Status</option>
                  <option value="false">Apenas Sucesso</option>
                  <option value="true">Apenas Erros</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-900 mb-1">Erro</h3>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Executions Table */}
        <Card>
          <CardHeader>
            <CardTitle>Histórico de Execucoes ({executions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-3" />
                <p className="text-gray-600">Carregando execucoes...</p>
              </div>
            ) : executions.length === 0 ? (
              <div className="text-center py-12">
                <Activity className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">Nenhuma execução encontrada</p>
                <p className="text-sm text-gray-500 mt-1">
                  Execucoes aparecerao aqui conforme os modelos IA forem usados
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Hora
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tipo de Uso
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Provedor
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Modelo
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tokens
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {executions.map((execution) => (
                      <tr
                        key={execution.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => loadExecutionDetail(execution.id)}
                      >
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(execution.created_at)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700">
                            {getUsageTypeLabel(execution.usage_type)}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getProviderColor(execution.provider)}`}>
                            {execution.provider}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">
                          {execution.model_name}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                          {execution.total_tokens ? (
                            <div>
                              <span className="font-medium">{formatNumber(execution.total_tokens)}</span>
                              <span className="text-xs text-gray-500 ml-1">
                                ({formatNumber(execution.input_tokens)} ent / {formatNumber(execution.output_tokens)} sai)
                              </span>
                            </div>
                          ) : (
   
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


