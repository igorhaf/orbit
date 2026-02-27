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

Arquivo: frontend/src/app/ai-models/page.tsx
Linguagem: typescript

```
/**
 * AI Models Management Page
 * View and manage AI model configurations
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Dialog,
  DialogFooter,
} from '@/components/ui';
import { aiModelsApi } from '@/lib/api';
import { useNotification } from '@/hooks';
import { AIModel, AIModelCreate, AIModelUpdate, AIModelUsageType } from '@/lib/types';

export default function AIModelsPage() {
  const { showError, NotificationComponent } = useNotification();
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [createFormData, setCreateFormData] = useState<AIModelCreate>({
    name: '',
    provider: 'anthropic',
    api_key: '',
    usage_type: AIModelUsageType.GENERAL,
    is_active: true,
    config: {
      model: '',
      max_tokens: 4096,
      temperature: 0.7,
    },
  });

  const [editFormData, setEditFormData] = useState<AIModelUpdate>({});

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const response = await aiModelsApi.list();
      // Handle both direct array and object with models property
      const data = Array.isArray(response) ? response : (response.models || response.data || []);
      setModels(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching AI models:', error);
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleModel = async (id: string) => {
    try {
      await aiModelsApi.toggle(id);
      fetchModels();
    } catch (error) {
      console.error('Error toggling model:', error);
    }
  };

  const handleCreateModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await aiModelsApi.create(createFormData);
      setShowCreateDialog(false);
      setCreateFormData({
        name: '',
        provider: 'anthropic',
        api_key: '',
        usage_type: AIModelUsageType.GENERAL,
        is_active: true,
        config: {
          model: '',
          max_tokens: 4096,
          temperature: 0.7,
        },
      });
      fetchModels();
    } catch (error) {
      console.error('Error creating model:', error);
      showError('Erro ao criar modelo. Verifique o console para detalhes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEdit = (model: AIModel) => {
    setSelectedModel(model);
    setEditFormData({
      name: model.name,
      provider: model.provider,
      api_key: '',  // PROMPT #234: Don't pre-fill masked key; leave blank to keep current
      usage_type: model.usage_type,
      is_active: model.is_active,
      config: model.config,
      // PROMPT #152 - Rate limiting fields
      rate_limit_requests: model.rate_limit_requests,
      rate_limit_window_seconds: model.rate_limit_window_seconds,
      // PROMPT #207 - Timeout field
      timeout_seconds: model.timeout_seconds,
      // PROMPT #228 - Concurrency field
      max_concurrent_requests: model.max_concurrent_requests,
    });
    setShowEditDialog(true);
  };

  const handleUpdateModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModel) return;

    setIsSubmitting(true);

    try {
      await aiModelsApi.update(selectedModel.id, editFormData);
      setShowEditDialog(false);
      setSelectedModel(null);
      setEditFormData({});
      fetchModels();
    } catch (error) {
      console.error('Error updating model:', error);
      showError('Erro ao atualizar modelo. Verifique o console para detalhes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenDelete = (model: AIModel) => {
    setSelectedModel(model);
    setShowDeleteDialog(true);
  };

  const handleDeleteModel = async () => {
    if (!selectedModel) return;

    setIsSubmitting(true);

    try {
      await aiModelsApi.delete(selectedModel.id);
      setShowDeleteDialog(false);
      setSelectedModel(null);
      fetchModels();
    } catch (error) {
      console.error('Error deleting model:', error);
      showError('Erro ao excluir modelo. Verifique o console para detalhes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if there's an active General model (fallback)
  const hasActiveGeneralModel = models.some(
    (model) => model.usage_type === AIModelUsageType.GENERAL && model.is_active
  );

  const getProviderIcon = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'anthropic':
        return (
          <svg className="w-6 h-6 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
          </svg>
        );
      case 'openai':
        return (
          <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
          </svg>
        );
      case 'google':
        return (
          <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        );
      case 'ollama':
        return (
          <svg className="w-6 h-6 text-orange-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
          </svg>
        );
      case 'cohere':
        return (
          <svg className="w-6 h-6 text-rose-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-6 h-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
          </svg>
        );
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Modelos IA</h1>
            <p className="mt-1 text-sm text-gray-500">
              Gerencie configurações de modelos IA e monitore uso
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => setShowCreateDialog(true)}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            }
          >
            Adicionar Modelo
          </Button>
        </div>

        {/* Warning: No General Model (Fallback) */}
        {!loading && !hasActiveGeneralModel && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-yellow-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  Nenhum Modelo General Configurado
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>
                    Você não tem um modelo ativo com <strong>Usage Type: General</strong>.
                    Este tipo serve como fallback quando nenhum modelo específico esta configurado para uma tarefa.
                    Sem ele, o sistema pode falhar se um modelo necessário não estiver disponível.
                  </p>
                  <p className="mt-2">
                    <strong>Recomendação:</strong> Crie ou ative um modelo General para garantir confiabilidade do sistema.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Models List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : models.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhum modelo IA</h3>
              <p className="mt-1 text-sm text-gray-500">
                Comece adicionando uma configuração de modelo IA.
              </p>
              <div className="mt-6">
                <Button
                  variant="primary"
                  onClick={() => setShowCreateDialog(true)}
                >
                  Adicionar Modelo
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {models.map((model) => (
              <Card key={model.id} variant="bordered">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {getProviderIcon(model.provider)}
                      <div>
                        <CardTitle className="text-lg">{model.name}</CardTitle>
                        <p className="text-xs text-gray-500 mt-1">
                          {model.provider.charAt(0).toUpperCase() + model.provider.slice(1)}
                        </p>
                      </div>
                    </div>
                    <div>
                      {model.is_active ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 font-medium">
                          Ativo
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800 font-medium">
                          Inativo
                        </span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {/* Model ID */}
                    {model.config?.model && (
                      <div className="text-xs text-gray-500">
                        <span className="font-medium">ID do Modelo:</span>{' '}
                        <span className="font-mono">{model.config.model}</span>
                      </div>
                    )}

                    {/* Usage Type */}
                    <div className="flex flex-wrap gap-1">
                      <span className={`px-2 py-1 text-xs rounded font-medium ${
                        model.usage_type === 'interview' ? 'bg-blue-50 text-blue-700' :
                        model.usage_type === 'prompt_generation' ? 'bg-purple-50 text-purple-700' :
                        model.usage_type === 'task_execution' ? 'bg-orange-50 text-orange-700' :
                        model.usage_type === 'commit_generation' ? 'bg-green-50 text-green-700' :
                        model.usage_type === 'pattern_discovery' ? 'bg-cyan-50 text-cyan-700' :
                        model.usage_type === 'memory' ? 'bg-pink-50 text-pink-700' :
                        'bg-gray-50 text-gray-700'
                      }`}>
                        {model.usage_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </div>

                    {/* Configuration */}
                    <div className="pt-3 border-t border-gray-200">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {model.config?.max_tokens && (
                          <div>
                            <div className="text-gray-500 text-xs">Max Tokens</div>
                            <div className="font-semibold text-gray-900">
                              {formatNumber(model.config.max_tokens)}
                            </div>
                          </div>
                        )}
                        {model.config?.temperature !== undefined && (
                          <div>
                            <div className="text-gray-500 text-xs">Temperature</div>
                            <div className="font-semibold text-gray-900">
                              {model.config.temperature.toFixed(1)}
                            </div>
                          </div>
                        )}
                        {/* PROMPT #152 - Rate Limit Display */}
                        {model.rate_limit_requests && model.rate_limit_window_seconds && (
                         
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


