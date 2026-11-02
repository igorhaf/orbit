import { HttpException } from "@nestjs/common";
import type { LoginAccount } from "./login-attempts";

type MfaLogin = {
  completeChallenge(challengeId: unknown, code: unknown, purpose: "login"): Promise<LoginAccount | null>;
  requestLogin(userId: string): Promise<{ challenge_id: string; email_hint: string }>;
};

type LoginResolution =
  | { kind: "challenge"; email: string; challenge: { challenge_id: string; email_hint: string } }
  | { kind: "account"; account: LoginAccount };

/** Enforce the same MFA gate for password and external identity authentication. */
export async function resolveLoginFactors(
  email: string,
  challengeId: unknown,
  code: unknown,
  verifyPassword: () => Promise<LoginAccount | null>,
  mfa: MfaLogin,
  onPasswordVerified?: (account: LoginAccount) => Promise<void>,
): Promise<LoginResolution> {
  const challenge = typeof challengeId === "string" && challengeId.length > 0 ? challengeId : null;
  const account = challenge
    ? await mfa.completeChallenge(challenge, code, "login")
    : await verifyPassword();
  if (!challenge && account) await onPasswordVerified?.(account);
  if (!account || account.email.toLowerCase() !== email.toLowerCase() || (challenge && !account.mfa_enabled))
    throw new HttpException(challenge ? "Código inválido ou expirado." : "E-mail ou senha incorretos.", 401);
  if (account.mfa_enabled && !challenge)
    return { kind: "challenge", email: account.email, challenge: await mfa.requestLogin(account.id) };
  return { kind: "account", account };
}
