/**
 * TaskForm Component
 * Form for creating new tasks
 */

'use client';

import { useState } from 'react';
import { tasksApi } from '@/lib/api';
import { TaskStatus } from '@/lib/types';
import { Button, Input, Textarea, Select } from '@/components/ui';

interface Props {
  projectId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'A Fazer' },
  { value: 'in_progress', label: 'Em Progresso' },
  { value: 'review', label: 'Revisao' },
  { value: 'done', label: 'Concluido' },
];

export function TaskForm({ projectId, onSuccess, onCancel }: Props) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    status: 'backlog' as TaskStatus,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      setError('Título e obrigatório');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await tasksApi.create({
        project_id: projectId,
        title: formData.title,
        description: formData.description || null,
        status: formData.status,
      });
      onSuccess();
    } catch (err: any) {
      console.error('Falha ao criar tarefa:', err);
      setError(err.response?.data?.detail || 'Falha ao criar tarefa');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Título */}
      <Input
        label="Título"
        placeholder="Título da tarefa"
        required
        value={formData.title}
        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
      />

      {/* Descrição */}
      <Textarea
        label="Descrição"
        placeholder="Descrição da tarefa (opcional)"
        value={formData.description}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        rows={4}
      />

      {/* Status */}
      <Select
        label="Status"
        options={STATUS_OPTIONS}
        value={formData.status}
        onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
      />

      {/* Erro */}
      {error && (
        <div className="text-sm text-red-500 bg-red-50 p-3 rounded">{error}</div>
      )}

      {/* Ações */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" isLoading={loading}>
          Criar Tarefa
        </Button>
      </div>
    </form>
  );
}
