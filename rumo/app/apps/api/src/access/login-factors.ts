import { HttpException } from "@nestjs/common";
import type { LoginAccount } from "./login-attempts";

type LoginIdentity = Pick<LoginAccount, "id" | "email" | "mfa_enabled">;
type MfaLogin<Account extends LoginIdentity> = {
  completeChallenge(challengeId: unknown, code: unknown, purpose: "login"): Promise<Account | null>;
  requestLogin(userId: string): Promise<{ challenge_id: string; email_hint: string }>;
};

export type LoginResolution<Account extends LoginIdentity> =
  | { kind: "challenge"; email: string; challenge: { challenge_id: string; email_hint: string } }
  | { kind: "account"; account: Account };

/** Apply the same password/MFA gate before a runtime creates its own session. */
export async function resolveLoginFactors<PasswordAccount extends LoginIdentity, ChallengeAccount extends LoginIdentity>(
  email: string,
  challengeId: unknown,
  code: unknown,
  verifyPassword: () => Promise<PasswordAccount | null>,
  mfa: MfaLogin<ChallengeAccount>,
  onAuthenticationSuccess?: (account: PasswordAccount | ChallengeAccount) => Promise<void>,
): Promise<LoginResolution<PasswordAccount | ChallengeAccount>> {
  const challenge = typeof challengeId === "string" && challengeId.length > 0 ? challengeId : null;
  const account = challenge
    ? await mfa.completeChallenge(challenge, code, "login")
    : await verifyPassword();
  if (!account || account.email.toLowerCase() !== email.toLowerCase() || (challenge && !account.mfa_enabled))
    throw new HttpException(challenge ? "Código inválido ou expirado." : "E-mail ou senha incorretos.", 401);

  // Clear failed-attempt counters only after the active authentication factor
  // succeeds; for an MFA-enabled password login, retain Workspace's behavior
  // of clearing after password verification and before sending the challenge.
  await onAuthenticationSuccess?.(account);
  if (account.mfa_enabled && !challenge)
    return { kind: "challenge", email: account.email, challenge: await mfa.requestLogin(account.id) };
  return { kind: "account", account };
}
