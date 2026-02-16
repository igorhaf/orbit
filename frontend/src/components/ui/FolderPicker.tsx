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
            <p>Nenhuma subpasta encontrada</p>
            <p className="text-xs mt-1">Você pode selecionar esta pasta como a raiz do seu projeto</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {folders.map((folder) => (
              <li
                key={folder.path}
                className={`flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                  (multiSelect ? selectedPaths.has(folder.full_path) : selectedPath === folder.full_path)
                    ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
                onClick={(e) => handleItemClick(folder, e)}
              >
                {/* Folder Icon */}
                <div className={`flex-shrink-0 ${folder.is_project ? 'text-blue-500' : 'text-yellow-500'}`}>
                  {folder.is_project ? (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                  )}
                </div>

                {/* Folder Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">{folder.name}</span>
                    {folder.is_project && (
                      <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                        Projeto
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate font-mono">{folder.full_path}</p>
                </div>

                {/* Navigate Arrow */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFolderNavigate(folder);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                  title="Abrir pasta"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Selected Path Preview */}
      {multiSelect && selectedPaths.size > 0 ? (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-green-800 mb-1">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{selectedPaths.size} {selectedPaths.size === 1 ? 'pasta selecionada' : 'pastas selecionadas'}</span>
          </div>
          <div className="ml-6 space-y-0.5">
            {Array.from(selectedPaths).map(p => (
              <div key={p} className="font-mono text-xs text-green-700 truncate">{p}</div>
            ))}
          </div>
        </div>
      ) : !multiSelect && selectedPath ? (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-green-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Selecionado:</span>
            <span className="font-mono font-medium truncate">{selectedPath}</span>
          </div>
        </div>
      ) : null}

      {/* Help Text */}
      <p className="mt-3 text-xs text-gray-500">
        {multiSelect
          ? 'Clique para selecionar, Ctrl+clique para selecionar multiplas, clique duplo para navegar'
          : 'Clique uma vez para selecionar, clique duplo para navegar para dentro da pasta'}
      </p>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          disabled={multiSelect ? selectedPaths.size === 0 : !selectedPath}
        >
          {multiSelect && selectedPaths.size > 1
            ? `Selecionar ${selectedPaths.size} Pastas`
            : 'Selecionar Pasta'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
