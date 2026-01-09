/**
 * PromptEditor Component
 * Editor for viewing and editing prompt content with metadata
 */

'use client';

import React, { useState } from 'react';
import { Prompt } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Label } from '@/components/ui/Label';
import { Save, X, Tag, Clock, FileText, GitBranch } from 'lucide-react';

interface PromptEditorProps {
  prompt: Prompt;
  onSave?: (updates: Partial<Prompt>) => void | Promise<void>;
  onCancel?: () => void;
  readOnly?: boolean;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  prompt,
  onSave,
  onCancel,
  readOnly = false,
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState(prompt.content);
  const [type, setType] = useState(prompt.type || '');
  const [isReusable, setIsReusable] = useState(prompt.is_reusable);
  const [componentInput, setComponentInput] = useState('');
  const [components, setComponents] = useState<string[]>(prompt.components || []);

  const handleSave = async () => {
    if (!onSave) return;

    setSaving(true);
    try {
      await onSave({
        content,
        type: type || undefined,
        is_reusable: isReusable,
        components,
      });
      setEditing(false);
    } catch (error) {
      console.error('Failed to save prompt:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to original values
    setContent(prompt.content);
    setType(prompt.type || '');
    setIsReusable(prompt.is_reusable);
    setComponents(prompt.components || []);
    setComponentInput('');
    setEditing(false);
    onCancel?.();
  };

  const addComponent = () => {
    if (componentInput.trim() && !components.includes(componentInput.trim())) {
      setComponents([...components, componentInput.trim()]);
      setComponentInput('');
    }
  };

  const removeComponent = (component: string) => {
    setComponents(components.filter(c => c !== component));
  };

  const handleComponentKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addComponent();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {prompt.type || 'Prompt'}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="default">v{prompt.version}</Badge>
              {prompt.is_reusable && (
                <Badge variant="success">
                  <Tag className="w-3 h-3 mr-1" />
                  Reusable
                </Badge>
              )}
              {prompt.parent_id && (
                <Badge variant="info">
                  <GitBranch className="w-3 h-3 mr-1" />
                  Versioned
                </Badge>
              )}
            </div>
          </div>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            ) : (
              <Button onClick={() => setEditing(true)}>Edit</Button>
            )}
          </div>
        )}
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Created:</span>
              <span className="ml-2 font-medium">
                {new Date(prompt.created_at).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Updated:</span>
              <span className="ml-2 font-medium">
                {new Date(prompt.updated_at).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Project ID:</span>
              <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">
                {prompt.project_id}
              </code>
            </div>
            {prompt.created_from_interview_id && (
              <div>
                <span className="text-gray-600">From Interview:</span>
                <code className="ml-2 text-xs bg-blue-100 px-2 py-1 rounded text-blue-800">
                  {prompt.created_from_interview_id}
                </code>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Type and Reusable Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="prompt-type">Type</Label>
            <Input
              id="prompt-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g., Feature, Bug Fix, Refactoring"
              disabled={!editing}
              className="mt-1"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-reusable"
              checked={isReusable}
              onChange={(e) => setIsReusable(e.target.checked)}
              disabled={!editing}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <Label htmlFor="is-reusable" className="cursor-pointer">
              Mark as reusable (can be used across multiple projects)
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Components */}
      <Card>
        <CardHeader>
          <CardTitle>Components</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing && (
            <div className="flex gap-2">
              <Input
                value={componentInput}
                onChange={(e) => setComponentInput(e.target.value)}
                onKeyPress={handleComponentKeyPress}
                placeholder="Add component (press Enter)"
              />
              <Button onClick={addComponent} variant="outline">
                Add
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {components.length === 0 ? (
              <p className="text-sm text-gray-500">No components defined</p>
            ) : (
              components.map((component, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 text-sm rounded-full"
                >
                  {component}
                  {editing && (
                    <button
                      onClick={() => removeComponent(component)}
                      className="ml-1 hover:text-purple-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content Editor */}
      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-96 p-4 font-mono text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Enter prompt content..."
            />
          ) : (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800">
                {content}
              </pre>
            </div>
          )}
          <div className="mt-2 text-xs text-gray-500">
            {content.length} characters
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
