'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Download, Paperclip } from 'lucide-react';
import { CardAttachment, getToken } from '@/lib/api';
import { Modal } from '@/components/ui';

function AttachmentImage({ attachment }: { attachment: CardAttachment }) {
  const [url, setUrl] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    void fetch(`/api/card-attachments/${attachment.id}/content`, {
      headers: { Authorization: `Bearer ${getToken() || ''}` },
    }).then(async response => {
      if (!response.ok) throw new Error('Imagem indisponível.');
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.id]);
  return <>
    {url ? <button type="button" onClick={() => setIsOpen(true)} aria-label={`Ampliar imagem ${attachment.name}`} className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c66e4]">
      <Image unoptimized src={url} alt={attachment.name} width={40} height={40} className="h-10 w-10 rounded object-cover" />
    </button> : <span className="grid h-10 w-10 place-items-center rounded bg-[#e9eaed]"><Paperclip size={16} /></span>}
    {isOpen && <Modal onClose={() => setIsOpen(false)} wide>
      <div className="flex min-h-32 items-center justify-center p-4 pt-12 sm:p-6 sm:pt-12">
        <Image unoptimized src={url} alt={attachment.name} width={1600} height={1200} className="h-auto max-h-[75dvh] w-auto max-w-full object-contain" />
      </div>
    </Modal>}
  </>;
}

export function CardAttachments({ attachments }: { attachments: CardAttachment[] }) {
  if (!attachments.length) return null;
  return <section aria-label="Anexos do cartão" className="mt-3 rounded border border-[#dfe1e6] bg-white p-3">
    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Paperclip size={15} /> Anexos ({attachments.length})</h3>
    <ul className="flex flex-wrap gap-2">
      {attachments.map(attachment => <li key={attachment.id} className="flex max-w-full items-center gap-2 rounded border border-[#dfe1e6] px-2 py-1.5 text-xs">
        {attachment.mime_type?.startsWith('image/') ? <AttachmentImage attachment={attachment} /> : <span className="grid h-10 w-10 place-items-center rounded bg-[#e9eaed]"><Paperclip size={16} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block max-w-52 truncate font-medium" title={attachment.name}>{attachment.name}</span>
          {attachment.size_bytes !== null && <span className="text-[#626f86]">{attachment.size_bytes < 1_000_000 ? `${Math.max(1, Math.round(attachment.size_bytes / 1000))} KB` : `${(attachment.size_bytes / 1_000_000).toFixed(1)} MB`}</span>}
        </span>
        <button type="button" title={`Baixar ${attachment.name}`} aria-label={`Baixar ${attachment.name}`} onClick={async () => {
          const response = await fetch(`/api/card-attachments/${attachment.id}/content`, { headers: { Authorization: `Bearer ${getToken() || ''}` } });
          if (!response.ok) return;
          const url = URL.createObjectURL(await response.blob());
          const link = document.createElement('a');
          link.href = url;
          link.download = attachment.name;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }} className="rounded p-1.5 hover:bg-[#f1f2f4]"><Download size={15} /></button>
      </li>)}
    </ul>
  </section>;
}
