'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import Image from 'next/image';
import { Paperclip } from 'lucide-react';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type ReactNodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TiptapImage from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { getToken } from '@/lib/api';

function EditableImage({ node }: ReactNodeViewProps) {
  const src = String(node.attrs.src || '');
  const [preview, setPreview] = useState(src.startsWith('/api/card-attachments/') ? '' : src);
  useEffect(() => {
    if (!src.startsWith('/api/card-attachments/')) return;
    let active = true;
    let objectUrl = '';
    void fetch(src, { headers: { Authorization: `Bearer ${getToken() || ''}` } })
      .then(async response => {
        if (!response.ok) throw new Error('Imagem indisponível.');
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setPreview(objectUrl);
      })
      .catch(() => { if (active) setPreview(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  const displayed = src.startsWith('/api/card-attachments/') ? preview : src;
  return <NodeViewWrapper className="my-2">
    {displayed ? <Image unoptimized src={displayed} alt={String(node.attrs.alt || 'Imagem')} width={640} height={320} className="h-auto max-h-80 max-w-full rounded object-contain" /> : <span className="text-xs text-[#626f86]">Carregando imagem…</span>}
  </NodeViewWrapper>;
}

const DescriptionImage = TiptapImage.extend({ addNodeView() { return ReactNodeViewRenderer(EditableImage); } });

export function CardDescriptionEditor({ value, onChange, onFiles, onUploadChange, maxLength = 1_000_000 }: {
  value: string;
  onChange: (value: string) => void;
  onFiles: (files: File[]) => Promise<{ url: string; name: string; mime_type: string }[]>;
  onUploadChange: (uploading: boolean) => void;
  maxLength?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Markdown.configure({ markedOptions: { gfm: true } }), DescriptionImage, TableKit, TaskList, TaskItem],
    content: value,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'rich-text min-h-36 px-3 py-2 text-sm outline-none' } },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      if (markdown.length <= maxLength) onChange(markdown);
    },
  });

  async function addFiles(files: File[]) {
    if (!editor || !files.length || uploading) return;
    if (files.length > 10) { setError('Envie no máximo 10 anexos por vez.'); return; }
    const position = editor.state.selection.from;
    setUploading(true);
    onUploadChange(true);
    setError('');
    try {
      const attachments = await onFiles(files);
      const content = attachments.map(attachment => /^image\/(?:avif|gif|jpe?g|png|webp)$/.test(attachment.mime_type)
        ? { type: 'image', attrs: { src: attachment.url, alt: attachment.name } }
        : { type: 'paragraph', content: [{ type: 'text', text: attachment.name, marks: [{ type: 'link', attrs: { href: attachment.url } }] }] });
      editor.chain().focus().insertContentAt(position, content).run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível anexar os arquivos.');
    } finally {
      setUploading(false);
      onUploadChange(false);
    }
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    await addFiles(Array.from(event.target.files || []));
    event.target.value = '';
  }

  const tool = (label: string, title: string, action: () => void, active = false) =>
    <button type="button" aria-label={title} title={title} onMouseDown={event => event.preventDefault()} onClick={action} className={`rounded px-2 py-1 text-xs font-semibold hover:bg-[#dfe1e6] ${active ? 'bg-[#dfe1e6]' : ''}`}>{label}</button>;

  return <div className="overflow-hidden rounded border border-[#8590a2] bg-white">
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[#dfe1e6] bg-[#f1f2f4] p-1">
      {tool('H', 'Cabeçalho', () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), editor?.isActive('heading', { level: 2 }))}
      {tool('B', 'Negrito', () => editor?.chain().focus().toggleBold().run(), editor?.isActive('bold'))}
      {tool('I', 'Itálico', () => editor?.chain().focus().toggleItalic().run(), editor?.isActive('italic'))}
      {tool('S', 'Tachado', () => editor?.chain().focus().toggleStrike().run(), editor?.isActive('strike'))}
      {tool('</>', 'Código', () => editor?.chain().focus().toggleCode().run(), editor?.isActive('code'))}
      {tool('•', 'Lista', () => editor?.chain().focus().toggleBulletList().run(), editor?.isActive('bulletList'))}
      {tool('1.', 'Lista numerada', () => editor?.chain().focus().toggleOrderedList().run(), editor?.isActive('orderedList'))}
      {tool('❝', 'Citação', () => editor?.chain().focus().toggleBlockquote().run(), editor?.isActive('blockquote'))}
      {tool('🔗', 'Link', () => { const href = window.prompt('Endereço do link'); if (href) editor?.chain().focus().setLink({ href }).run(); })}
      <label className="cursor-pointer rounded px-2 py-1 text-xs font-semibold hover:bg-[#dfe1e6]" title="Anexar arquivos">
        <Paperclip size={14} className="inline" />
        <input type="file" multiple className="sr-only" onChange={event => void handleFiles(event)} />
      </label>
    </div>
    <div aria-label="Descrição do cartão" onPaste={event => {
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); void addFiles(files); }
    }} onDragOver={event => { if (event.dataTransfer.files.length) event.preventDefault(); }} onDrop={event => {
      const files = Array.from(event.dataTransfer.files);
      if (files.length) { event.preventDefault(); void addFiles(files); }
    }}><EditorContent editor={editor} /></div>
    {uploading && <p className="px-3 pb-2 text-xs text-[#626f86]">Enviando anexos…</p>}
    {error && <p role="alert" className="px-3 pb-2 text-xs text-[#ae2a19]">{error}</p>}
    <div className="border-t border-[#dfe1e6] px-3 py-1 text-right text-[11px] text-[#626f86]">{value.length}/{maxLength}</div>
  </div>;
}
