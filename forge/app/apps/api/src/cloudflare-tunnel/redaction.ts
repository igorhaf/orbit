export function redact(value: string, token = '') {
  let safe = token ? value.split(token).join('[REDACTED]') : value;
  safe = safe.replace(/(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\r\n]+/gi, '$1[REDACTED]');
  safe = safe.replace(/\b((?:[A-Z_]*TOKEN|[A-Z_]*SECRET|[A-Z_]*PASSWORD|[A-Z_]*CREDENTIALS|[A-Z_]*API_KEY|[A-Z_]*PRIVATE_KEY|[A-Z_]*ACCESS_KEY|TunnelSecret|AccountTag|credentials-file|cred-file))(["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi, '$1$2[REDACTED]');
  safe = safe.replace(/(--(?:token|credentials|password|secret)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]');
  safe = safe.replace(/https?:\/\/[^\s"<>]+/gi, raw => {
    try {const url = new URL(raw); if (url.username || url.password) {url.username = 'REDACTED'; url.password = '';}
      for (const key of [...url.searchParams.keys()]) if (/token|secret|password|credential|key|auth|signature/i.test(key)) url.searchParams.set(key, 'REDACTED');
      if (url.hash) url.hash = '#REDACTED'; return url.toString();
    } catch {return '[REDACTED URL]';}
  });
  return safe.replace(/\beyJ[A-Za-z0-9_+/=-]{30,}/g, '[REDACTED]').split('').filter(char => {const code=char.charCodeAt(0);return code>=32 || [9,10,13].includes(code);}).join('');
}
