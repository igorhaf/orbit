const driveIdPattern = /^[A-Za-z0-9_-]{10,200}$/;

/** Builds preview URLs only for individual Google Drive/Docs files on exact trusted hosts. */
export function googleDrivePreviewUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;

  if (url.hostname === "drive.google.com") {
    let fileId: string | null = null;
    if (url.pathname === "/open" || url.pathname === "/uc") fileId = url.searchParams.get("id");
    else fileId = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/(?:view|edit))?\/?$/)?.[1] || null;
    return fileId && driveIdPattern.test(fileId) ? `https://drive.google.com/file/d/${fileId}/preview` : null;
  }

  if (url.hostname === "docs.google.com") {
    const match = url.pathname.match(/^\/(document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,200})(?:\/(?:edit|preview))?\/?$/);
    if (!match || !driveIdPattern.test(match[2])) return null;
    return `https://docs.google.com/${match[1]}/d/${match[2]}/preview`;
  }

  return null;
}

/** Enables confirmed captions on a trusted privacy-enhanced YouTube embed. */
export function youtubeCaptionEmbedUrl(value: string, captionsConfirmed: boolean, language?: string | null): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "www.youtube-nocookie.com" || url.username || url.password
    || !/^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) return null;
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.delete("cc_load_policy");
  url.searchParams.delete("cc_lang_pref");
  if (captionsConfirmed) {
    url.searchParams.set("cc_load_policy", "1");
    if (typeof language === "string" && language.trim()) {
      try { url.searchParams.set("cc_lang_pref", Intl.getCanonicalLocales(language.trim())[0]); } catch { /* Let YouTube choose the viewer's preferred caption language. */ }
    }
  }
  return url.toString();
}

export type VimeoTextTrack = { language?: unknown; kind?: unknown; label?: unknown };

/** Selects a confirmed Vimeo captions track, preferring the configured locale. */
export function findVimeoCaptionsTrack<T extends VimeoTextTrack>(tracks: T[], language?: string | null): T | null {
  const captions = tracks.filter((track) => track.kind === "captions" && typeof track.language === "string" && track.language.trim());
  if (!captions.length) return null;
  if (!language?.trim()) return captions[0];
  let requested: string;
  try { requested = Intl.getCanonicalLocales(language.trim())[0].toLowerCase(); } catch { return null; }
  return captions.find((track) => {
    try { return Intl.getCanonicalLocales(String(track.language).trim())[0].toLowerCase() === requested; } catch { return false; }
  }) || null;
}
