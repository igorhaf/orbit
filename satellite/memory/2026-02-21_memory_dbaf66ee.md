# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 3290 in / 914 out | Cost: $0.0079

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

frontend/src/components/ui/FolderPicker.tsx (typescript):
/**
 * FolderPicker Component
 * PROMPT #111 - Browse and select folders from mounted /projects directory
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogFooter } from './Dialog';
import { Button } from './Button';
import { projectsApi } from '@/lib/api';

interface Folder {
  name: string;
  path: string;
  full_path: string;
  is_project: boolean;
}

interface BrowseResult {
  current_path: string;
  relative_path: string;
  parent_path: string | null;
  folders: Folder[];
  can_select: boolean;
  error?: string;
}

export interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  onSelectMultiple?: (paths: string[]) => void;
  multiSelect?: boolean;
  title?: string;
}

export const FolderPicker: React.FC<FolderPickerProps> = ({
  open,
  onClose,
  onSelect,
  onSelectMultiple,
  multiSelect = false,
  title = 'Selecionar Pasta do Projeto',
}) => {
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);

  const loadFolders = useCallback(async (path: string = '') => {
    setLoading(true);
    setError(null);
    try {
      const result = await projectsApi.browseFolders(path);
      const data = result.data || result;
      setBrowseResult(data);
      setFolders(data.folders || []);
      setCurrentPath(data.current_path || '/projects');
      if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
      setError('Falha ao carregar pastas. Verifique se a pasta de projetos esta montada.');
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadFolders('');
      setSelectedPath(null);
      setSelectedPaths(new Set());
    }
  }, [open, loadFolders]);

  // Timer ref to distinguish single-click (select) from double-click (navigate)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFolderNavigate = (folder: Folder) => {
    // Navigate into folder
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    loadFolders(folder.path);
    setSelectedPath(null);
    setSelectedPaths(new Set());
  };

  const handleFolderSelect = (folder: Folder, ctrlKey: boolean) => {
    if (multiSelect && ctrlKey) {
      // Ctrl+click: toggle in multi-selection
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(folder.full_path)) {
          next.delete(folder.full_path);
        } else {
          next.add(folder.full_path);
        }
        return next;
      });
    } else if (multiSelect) {
      // Normal click in multi mode: replace selection with just this one
      setSelectedPaths(new Set([folder.full_path]));
    } else {
      // Single-select mode
      setSelectedPath(folder.full_path);
    }
  };

  const handleItemClick = (folder: Folder, e: React.MouseEvent) => {
    const ctrlKey = e.ctrlKey || e.metaKey;
    if (clickTimerRef.current) {
      // Second click within 300ms = double-click → navigate
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      handleFolderNavigate(folder);
    } else {
      // First click → wait to see if double-click follows
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        handleFolderSelect(folder, ctrlKey);
      }, 300);
    }
  };

  const handleGoUp = () => {
    if (browseResult?.parent_path !== null && browseResult?.parent_path !== undefined) {
      loadFolders(browseResult.parent_path);
      setSelectedPath(null);
      setSelectedPaths(new Set());
    }
  };

  const handleSelectCurrent = () => {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  };

  const handleConfirm = () => {
    if (multiSelect && selectedPaths.size > 0) {
      if (onSelectMultiple) {
        onSelectMultiple(Array.from(selectedPaths));
      }
      onClose();
    } else if (selectedPath) {
      onSelect(selectedPath);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={multiSelect
        ? "Navegue e selecione pastas para bloquear (Ctrl+clique para selecionar multiplas)"
        : "Navegue e selecione uma pasta contendo o código do seu projeto"}
      size="lg"
    >
      {/* Breadcrumb / Current Path */}
      <div className="mb-4 p-3 bg-gray-100 rounded-lg">
        <div className="flex items-center gap-2 text-sm">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="font-mono text-gray-700 truncate">{currentPath}</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-2 mb-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleGoUp}
          disabled={browseResult?.parent_path === null || loading}
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Acima
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadFolders('')}
          disabled={loading}
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Raiz
        </Button>
        {browseResult?.can_select && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectCurrent}
            className="ml-auto"
          >
            Selecionar Esta Pasta
          </Button>
        )}
      </div>

      {/* Folder List */}
      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="p-4 text-center">
            <div className="text-red-500 mb-2">
              <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        ) : folders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p>Nenhuma subp

## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode navegar por pastas dentro da pasta raiz /projects e selecionar uma pasta para associar a um projeto.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema permite seleção de múltiplas pastas simultâneas usando o clique Ctrl+clique (em modo multi-select ativado).",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode retornar para a pasta pai usando o botão 'Acima' durante a navegação hierárquica.",
      "rule_type": "navigation",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema exibe uma mensagem de erro se a pasta de projetos não estiver montada ou não for acessível.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário só pode selecionar pastas que estão dentro da estrutura de diretórios montada em /projects.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "Ao criar um novo projeto, o usuário deve escolher a profundidade de varredura (rápida, normal ou profunda) para determinar o escopo de análise.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema cria o projeto instantaneamente após a seleção da pasta e redireciona o usuário para a página do projeto, com processamento em segundo plano.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário pode selecionar pastas para bloquear (multi-select) ou apenas uma pasta (single-select) dependendo da configuração do modo multi-select.",
      "rule_type": "constraint",
      "confidence": "high"
    }
  ]
}
