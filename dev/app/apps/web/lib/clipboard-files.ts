export function clipboardFiles(clipboard: DataTransfer): File[] {
  const files = Array.from(clipboard.files);
  const candidates = files.length ? files : Array.from(clipboard.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (!candidates.some(file => file.type.startsWith('image/'))) {
    const html = clipboard.getData('text/html');
    if (html && typeof DOMParser !== 'undefined') {
      const document = new DOMParser().parseFromString(html, 'text/html');
      for (const image of Array.from(document.images)) {
        const match = image.src.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
        if (!match) continue;
        try {
          const binary = atob(match[2].replace(/\s/g, ''));
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          const extension = match[1].split('/')[1]?.split('+')[0]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
          candidates.push(new File([bytes], `imagem-colada-${candidates.length + 1}.${extension}`, { type: match[1] }));
        } catch {
          // Ignore malformed data URLs and let normal text pasting continue.
        }
      }
    }
  }

  const seen = new Set<string>();
  return candidates.flatMap((file, index) => {
    const key = `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
    if (seen.has(key)) return [];
    seen.add(key);

    if (file.name.trim()) return [file];
    const extension = file.type.split('/')[1]?.split('+')[0]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
    return [new File([file], `arquivo-colado-${index + 1}.${extension}`, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
    })];
  });
}
