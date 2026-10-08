import { publicApiUrl } from '../public-api-url';

const redirects = {
  calendar: ['GOOGLE_CALENDAR_REDIRECT_URI', '/calendar/google/oauth/callback'],
  drive: ['GOOGLE_DRIVE_REDIRECT_URI', '/google/drive/oauth/callback'],
  gmail: ['GOOGLE_GMAIL_REDIRECT_URI', '/mail/gmail/oauth/callback'],
} as const;

export function googleRedirectUri(service: keyof typeof redirects): string {
  const [key, path] = redirects[service];
  return process.env[key]?.trim() || `${publicApiUrl()}${path}`;
}
