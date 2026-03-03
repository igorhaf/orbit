# PROMPT #248 — Wiki Rich Editor + AI Create Flow

## Objective

Upgrade the wiki panel to have a rich markdown editor (with toolbar, same as project description editor) and add AI generation capability during page creation — not just for existing pages.

## What Was Implemented

### 1. New Reusable MarkdownEditor Component

**Created:** `frontend/src/components/ui/MarkdownEditor.tsx`

Self-contained markdown editor with:
- **Toolbar** matching OverviewTab: Bold | Italic | Code | H1 | H2 | H3 | Bullet List | Numbered List | Quote | Code Block | Table | Link
- **Keyboard shortcuts**: Ctrl+B bold, Ctrl+I italic, Ctrl+Enter save, Esc cancel
- **Status bar** with formatting hints
- **Props**: `value`, `onChange`, `placeholder`, `minHeight`, `onSave`, `onCancel`, `showStatusBar`, `autoFocus`
- **Internal insertMarkdown()** — same logic as `page.tsx:695-724` but self-contained

Exported from `frontend/src/components/ui/index.ts`.

### 2. Create Dialog with AI Generation

- **Dialog enlarged** from `size="md"` to `size="2xl"` to accommodate the editor
- **Plain textarea replaced** with `<MarkdownEditor>` — full toolbar in create dialog
- **New "Criar e Gerar com IA" button** — creates page then triggers AI content generation:
  1. Creates page with placeholder content
  2. Closes dialog, selects the page
  3. Triggers `wikiApi.generateContent()` via job polling
  4. AI processing indicator shows progress
  5. Content auto-refreshes on completion
- **Duplicated dialog eliminated** — was rendered twice (empty state + main view), now a single shared `renderCreateDialog()`

### 3. Rich Editor in Edit Mode

- **Plain textarea replaced** with `<MarkdownEditor>` in edit mode
- Full toolbar with Bold/Italic/H1-H3/Lists/Quote/Code/Table/Link
- Keyboard shortcuts work: Ctrl+B, Ctrl+I, Ctrl+Enter save, Esc cancel
- Removed separate preview pane (toolbar + prose rendering in view mode are sufficient)

### 4. Double-Click to Edit

- View mode content area has `onDoubleClick={() => setEditing(true)}`
- Cursor changes to pointer on hover (`cursor-pointer`)
- Subtle hover effect (`hover:bg-gray-50`)
- Hint text "Clique duplo para editar" in page metadata

## Files Created

- `frontend/src/components/ui/MarkdownEditor.tsx` — New reusable component

## Files Modified

- `frontend/src/components/ui/index.ts` — Added MarkdownEditor export
- `frontend/src/components/wiki/WikiPanel.tsx` — Rich editor, AI create flow, dedup dialog, double-click

## Testing Results

- **TypeScript**: Zero errors in wiki/MarkdownEditor files
- **Selenium tests**: 11/11 passed (16.32s)
- **Frontend loads**: HTTP 200

## Status

**COMPLETED**
