/**
 * ModificationApprovalModal Component
 * PROMPT #95 - Blocking System UI
 *
 * Modal for approving/rejecting AI-suggested task modifications.
 * Shows diff view between original and proposed changes.
 */

'use client';

import { useState } from 'react';
import { Dialog, Button, Badge, Input } from '@/components/ui';
import { Task } from '@/lib/types';
import { SimilarityBadge } from './SimilarityBadge';

interface Props {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

export function ModificationApprovalModal({
  task,
  isOpen,
  onClose,
  onApprove,
  onReject,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectionInput, setShowRejectionInput] = useState(false);

  const modification = task.pending_modification;

  if (!modification) {
    return null;
  }

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove();
      onClose();
    } catch (error) {
      console.error('Falha ao aprovar modificação:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      await onReject(rejectionReason || undefined);
      onClose();
    } catch (error) {
      console.error('Falha ao rejeitar modificação:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to render diff (original vs proposed)
  const renderDiff = (label: string, original: string | undefined, proposed: string | undefined) => {
    const hasChange = original !== proposed;

    return (
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">{label}</h4>
        <div className="grid grid-cols-2 gap-4">
          {/* Original */}
          <div className="border rounded-lg p-3 bg-red-50 border-red-200">
            <div className="text-xs text-red-600 font-medium mb-1">Original</div>
            <div className={`text-sm ${hasChange ? 'line-through text-gray-500' : 'text-gray-900'}`}>
              {original || <span className="text-gray-400 italic">Vazio</span>}
            </div>
          </div>

          {/* Proposto */}
          <div className="border rounded-lg p-3 bg-green-50 border-green-200">
            <div className="text-xs text-green-600 font-medium mb-1">Proposto</div>
            <div className={`text-sm ${hasChange ? 'font-semibold text-green-800' : 'text-gray-900'}`}>
              {proposed || <span className="text-gray-400 italic">Vazio</span>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Revisar Modificação Proposta"
      size="xl"
    >
      <div className="space-y-6">
        {/* Header with similarity badge */}
        <div className="flex items-center justify-between pb-4 border-b">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Modificação Sugerida pela IA
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Revise as alterações e aprove ou rejeite a modificação
            </p>
          </div>
          <SimilarityBadge score={modification.similarity_score} className="text-base px-3 py-1.5" />
        </div>

        {/* Blocking reason */}
        {task.blocked_reason && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-yellow-600 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div>
                <p className="text-sm font-medium text-yellow-800">Motivo do Bloqueio:</p>
                <p className="text-sm text-yellow-700 mt-1">{task.blocked_reason}</p>
              </div>
            </div>
          </div>
        )}

        {/* Diff view */}
        <div className="space-y-4">
          {/* Título diff */}
          {renderDiff('Título', modification.original_title || task.title, modification.title)}

          {/* Descrição diff */}
          {renderDiff(
            'Descrição',
            modification.original_description || task.description || undefined,
            modification.description
          )}

          {/* Story points diff (if changed) */}
          {modification.story_points !== undefined && modification.story_points !== task.story_points && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Pontos de História</h4>
              <div className="flex items-center gap-4">
                <Badge className="bg-red-100 text-red-800 border-red-200">
                  Original: {task.story_points || 'Nenhum'}
                </Badge>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                <Badge className="bg-green-100 text-green-800 border-green-200">
                  Proposto: {modification.story_points}
                </Badge>
              </div>
            </div>
          )}

          {/* Acceptance criteria diff (if exists) */}
          {modification.acceptance_criteria && modification.acceptance_criteria.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Critérios de Aceitação</h4>
              <div className="grid grid-cols-2 gap-4">
                {/* Original */}
                <div className="border rounded-lg p-3 bg-red-50 border-red-200">
                  <div className="text-xs text-red-600 font-medium mb-2">Original</div>
                  {task.acceptance_criteria && task.acceptance_criteria.length > 0 ? (
                    <ul className="space-y-1">
                      {task.acceptance_criteria.map((criterion, idx) => (
                        <li key={idx} className="text-sm text-gray-700 line-through">
                          • {typeof criterion === 'string' ? criterion : (criterion as any)?.text || JSON.stringify(criterion)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm italic">Nenhum</span>
                  )}
                </div>

                {/* Proposto */}
                <div className="border rounded-lg p-3 bg-green-50 border-green-200">
                  <div className="text-xs text-green-600 font-medium mb-2">Proposto</div>
                  <ul className="space-y-1">
                    {modification.acceptance_criteria.map((criterion, idx) => (
                      <li key={idx} className="text-sm text-green-800 font-semibold">
                        • {typeof criterion === 'string' ? criterion : (criterion as any)?.text || JSON.stringify(criterion)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Suggested at timestamp */}
          <div className="text-xs text-gray-500">
            Sugerido em: {new Date(modification.suggested_at).toLocaleString()}
          </div>
        </div>

        {/* Rejection reason input (shown when user clicks Reject) */}
        {showRejectionInput && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Motivo da Rejeição (opcional)
            </label>
            <Input
              type="text"
              placeholder="Por que está rejeitando esta modificação?"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </Button>

          {!showRejectionInput ? (
            <>
              <Button
                variant="danger"
                onClick={() => setShowRejectionInput(true)}
                disabled={loading}
              >
                Rejeitar
              </Button>
              <Button
                variant="primary"
                onClick={handleApprove}
                disabled={loading}
              >
                {loading ? 'Aprovando...' : 'Aprovar Modificação'}
              </Button>
            </>
          ) : (
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={loading}
            >
              {loading ? 'Rejeitando...' : 'Confirmar Rejeição'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
