/**
 * Acceptance Criteria Tab Sub-Component
 * Extracted from ItemDetailPanel.tsx
 * Full CRUD for acceptance criteria
 * PROMPT #218 - Acceptance Criteria CRUD
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui';
import { BacklogItem } from '@/lib/types';

export interface AcceptanceTabProps {
  item: BacklogItem;
  newCriterion: string;
  setNewCriterion: (val: string) => void;
  isAddingCriterion: boolean;
  setIsAddingCriterion: (val: boolean) => void;
  editingCriterionIdx: number | null;
  setEditingCriterionIdx: (val: number | null) => void;
  editingCriterionText: string;
  setEditingCriterionText: (val: string) => void;
  handleAddCriterion: () => void;
  handleDeleteCriterion: (idx: number) => void;
  handleEditCriterion: (idx: number) => void;
  onUpdate?: () => void;
}

export default function AcceptanceTab({
  item,
  newCriterion,
  setNewCriterion,
  isAddingCriterion,
  setIsAddingCriterion,
  editingCriterionIdx,
  setEditingCriterionIdx,
  editingCriterionText,
  setEditingCriterionText,
  handleAddCriterion,
  handleDeleteCriterion,
  handleEditCriterion,
}: AcceptanceTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Critérios de Aceitação ({item.acceptance_criteria?.length || 0})
        </h3>
        <Button size="sm" variant="outline" onClick={() => setIsAddingCriterion(true)}>
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Adicionar Critério
        </Button>
      </div>

      {/* Add criterion input */}
      {isAddingCriterion && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newCriterion}
            onChange={(e) => setNewCriterion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddCriterion();
              if (e.key === 'Escape') { setIsAddingCriterion(false); setNewCriterion(''); }
            }}
            placeholder="Descreva o critério de aceitação..."
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoFocus
          />
          <Button size="sm" variant="primary" onClick={handleAddCriterion} disabled={!newCriterion.trim()}>
            Adicionar
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setIsAddingCriterion(false); setNewCriterion(''); }}>
            Cancelar
          </Button>
        </div>
      )}

      {!item.acceptance_criteria || item.acceptance_criteria.length === 0 ? (
        <p className="text-sm text-gray-500 italic">Nenhum critério de aceitação definido</p>
      ) : (
        <ul className="space-y-2">
          {item.acceptance_criteria.map((criterion, idx) => {
            // Normalize: criterion can be string or {text, completed} object
            const criterionText = typeof criterion === 'string' ? criterion : (criterion as any)?.text || JSON.stringify(criterion);
            return (
            <li key={idx} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 group">
              {editingCriterionIdx === idx ? (
                /* Editing mode */
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={editingCriterionText}
                    onChange={(e) => setEditingCriterionText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleEditCriterion(idx);
                      if (e.key === 'Escape') { setEditingCriterionIdx(null); setEditingCriterionText(''); }
                    }}
                    className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <button
                    onClick={() => handleEditCriterion(idx)}
                    className="p-1 text-green-600 hover:text-green-700"
                    title="Salvar"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => { setEditingCriterionIdx(null); setEditingCriterionText(''); }}
                    className="p-1 text-gray-400 hover:text-gray-600"
                    title="Cancelar"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                /* View mode */
                <>
                  <span className="mt-0.5 text-gray-400 text-xs font-mono">{idx + 1}.</span>
                  <span
                    className="flex-1 text-sm text-gray-900 cursor-pointer"
                    onDoubleClick={() => { setEditingCriterionIdx(idx); setEditingCriterionText(criterionText); }}
                    title="Clique duplo para editar"
                  >
                    {criterionText}
                  </span>
                  <button
                    onClick={() => { setEditingCriterionIdx(idx); setEditingCriterionText(criterionText); }}
                    className="p-1 text-gray-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Editar"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteCriterion(idx)}
                    className="p-1 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Excluir"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </>
              )}
            </li>
          );})}
        </ul>
      )}
    </div>
  );
}
