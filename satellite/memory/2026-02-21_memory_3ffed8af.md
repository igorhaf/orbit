# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 3815 in / 1003 out | Cost: $0.0088

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

frontend/src/app/ai-models/page.tsx (typescript):
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

      

## Response

{
  "business_rules": [
    {
      "rule_text": "Usuário pode criar novos modelos IA preenchendo campos como nome, provedor, chave API (não preenchida automaticamente), tipo de uso e configurações avançadas.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "Usuário pode editar modelos existentes, incluindo alteração de nome, provedor, tipo de uso e configurações, mas a chave API não é preenchida automaticamente para segurança.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "Exclusão de modelo requer confirmação explícita por parte do usuário via diálogo de confirmação.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "Sistema verifica existência de modelo ativo do tipo 'GERAL' como fallback para garantir funcionalidade mínima.",
      "rule_type": "validation",
      "confidence": "medium"
    },
    {
      "rule_text": "Usuário pode configurar limites de taxa, timeout e concorrência para modelos IA, definindo parâmetros de uso do sistema.",
      "rule_type": "domain",
      "confidence": "high"
    },
    {
      "rule_text": "Números grandes são formatados automaticamente para exibição (ex: 1000 → 1K, 1000000 → 1M) para melhorar a legibilidade.",
      "rule_type": "calculation",
      "confidence": "high"
    },
    {
      "rule_text": "Sistema aceita formatos variados de resposta da API (array direto ou objeto com propriedade 'models') para compatibilidade.",
      "rule_type": "validation",
      "confidence": "medium"
    }
  ]
}
