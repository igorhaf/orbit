/**
 * ChatModals - All dialog/modal components for Epic generation, notifications, and confirmations
 * Extracted from ChatInterface.tsx (PROMPT #232)
 */

'use client';

import { useRouter } from 'next/navigation';
import { Button, Dialog, DialogFooter } from '@/components/ui';
import { ErrorDialog } from '@/components/ui/ErrorDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// Epic result state type
export interface EpicResult {
  title?: string;
  error?: string;
}

// PROMPT #109 - Notification dialog state
export interface NotificationDialogState {
  open: boolean;
  title: string;
  message: string;
  details?: string;
  type: 'error' | 'warning' | 'info' | 'success';
}

// PROMPT #118 - Confirm dialog state
export interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  type: 'warning' | 'danger' | 'info';
  onConfirm: () => void;
  confirmLabel?: string;
  isLoading?: boolean;
}

interface ChatModalsProps {
  projectId?: string;
  // Epic Confirm Modal (PROMPT #87)
  showEpicConfirmModal: boolean;
  onCloseEpicConfirmModal: () => void;
  onExecuteEpicGeneration: () => void;
  // Epic Success Modal (PROMPT #87)
  showEpicSuccessModal: boolean;
  onCloseEpicSuccessModal: () => void;
  epicResult: EpicResult | null;
  // Epic Error Modal (PROMPT #87)
  showEpicErrorModal: boolean;
  onCloseEpicErrorModal: () => void;
  // Notification Dialog (PROMPT #112)
  notificationDialog: NotificationDialogState;
  onCloseNotificationDialog: () => void;
  // Confirm Dialog (PROMPT #118)
  confirmDialog: ConfirmDialogState;
  onCloseConfirmDialog: () => void;
}

/**
 * All modals/dialogs used by the ChatInterface.
 * PROMPT #87 - Epic Generation modals (Confirm, Success, Error)
 * PROMPT #112 - Notification Dialog (replaces crude browser alerts)
 * PROMPT #118 - Confirm Dialog (replaces crude browser confirm())
 */
export default function ChatModals({
  projectId,
  showEpicConfirmModal,
  onCloseEpicConfirmModal,
  onExecuteEpicGeneration,
  showEpicSuccessModal,
  onCloseEpicSuccessModal,
  epicResult,
  showEpicErrorModal,
  onCloseEpicErrorModal,
  notificationDialog,
  onCloseNotificationDialog,
  confirmDialog,
  onCloseConfirmDialog,
}: ChatModalsProps) {
  const router = useRouter();

  return (
    <>
      {/* PROMPT #87 - Epic Generation Confirmation Modal */}
      <Dialog
        open={showEpicConfirmModal}
        onClose={onCloseEpicConfirmModal}
        title="Gerar Epic"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">&#127919;</span>
            </div>
            <div>
              <p className="text-sm text-gray-700">
                Gerar um Epic a partir desta entrevista usando IA?
              </p>
              <p className="text-xs text-gray-500 mt-1">
                O Epic será criado automaticamente com base na sua conversa.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={onCloseEpicConfirmModal}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={onExecuteEpicGeneration}
          >
            Gerar Epic
          </Button>
        </DialogFooter>
      </Dialog>

      {/* PROMPT #87 - Epic Generation Success Modal */}
      <Dialog
        open={showEpicSuccessModal}
        onClose={onCloseEpicSuccessModal}
        title="Epic Criado"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">&#9989;</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {epicResult?.title}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Agora você pode decompor em Stories na página de Backlog.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={onCloseEpicSuccessModal}
          >
            Fechar
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onCloseEpicSuccessModal();
              if (projectId) {
                router.push(`/projects/${projectId}?tab=backlog`);
              }
            }}
          >
            Ir para Backlog
          </Button>
        </DialogFooter>
      </Dialog>

      {/* PROMPT #87 - Epic Generation Error Modal */}
      <Dialog
        open={showEpicErrorModal}
        onClose={onCloseEpicErrorModal}
        title="Erro"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">&#10060;</span>
            </div>
            <div>
              <p className="text-sm text-gray-700">
                {epicResult?.error || 'Ocorreu um erro ao gerar o Epic.'}
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            onClick={onCloseEpicErrorModal}
          >
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>

      {/* PROMPT #112 - Notification Dialog (replaces crude browser alerts) */}
      <ErrorDialog
        open={notificationDialog.open}
        onClose={onCloseNotificationDialog}
        title={notificationDialog.title}
        message={notificationDialog.message}
        details={notificationDialog.details}
        type={notificationDialog.type}
      />

      {/* PROMPT #118 - Confirm Dialog (replaces crude browser confirm()) */}
      <ConfirmDialog
        open={confirmDialog.open}
        onClose={onCloseConfirmDialog}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
        confirmLabel={confirmDialog.confirmLabel}
        isLoading={confirmDialog.isLoading}
      />
    </>
  );
}
