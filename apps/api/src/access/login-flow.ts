import { HttpException } from "@nestjs/common";
import type { LoginAccount } from "./login-attempts";

type MfaLogin = {
  completeChallenge(challengeId: unknown, code: unknown, purpose: "login"): Promise<LoginAccount | null>;
  requestLogin(userId: string): Promise<{ challenge_id: string; email_hint: string }>;
};

export async function completeLogin<T>(options: {
  email: string;
  challengeId: string | null;
  code: unknown;
  authenticate: () => Promise<LoginAccount | null>;
  mfa: MfaLogin;
  onAuthenticationSuccess?: () => Promise<void>;
  issueSession: (account: LoginAccount) => Promise<T>;
}): Promise<T | { mfa_required: true; challenge_id: string; email_hint: string; email: string }> {
  const account = options.challengeId
    ? await options.mfa.completeChallenge(options.challengeId, options.code, "login")
    : await options.authenticate();
  if (!account) throw new HttpException({ message: "E-mail ou senha incorretos." }, 401);
  if (account.email.toLowerCase() !== options.email || (options.challengeId && !account.mfa_enabled))
    throw new HttpException({ message: "Código inválido ou expirado." }, 401);
  await options.onAuthenticationSuccess?.();
  if (account.mfa_enabled && !options.challengeId) {
    const challenge = await options.mfa.requestLogin(account.id);
    return { mfa_required: true, ...challenge, email: account.email };
  }
  return options.issueSession(account);
}
