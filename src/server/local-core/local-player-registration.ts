import { randomUUID } from "node:crypto";
import { createPlayerInviteOAuthState, claimPlayerInvite } from "./player-google-invites";
import { credentialLookupDigest, hashCredential, normalizeCredential } from "./credentials";
import { createSession, hashSessionToken } from "./sessions";
import type { SqlExecutor } from "./postgres";

export type LocalPlayerRegistrationInput = {
  displayName: string;
  pronouns: string;
  credential: string;
};

export async function registerLocalPlayer(
  sql: SqlExecutor,
  lookupKey: string,
  input: LocalPlayerRegistrationInput,
): Promise<{ userId: string; playerLabel: string; sessionToken: string }> {
  if (!sql.transaction) throw new Error("registration_transaction_required");
  const displayName = input.displayName.trim();
  const pronouns = input.pronouns.trim();
  if (!displayName || displayName.length > 60 || !pronouns || pronouns.length > 80) {
    throw new Error("registration_identity_invalid");
  }
  const credential = normalizeCredential(input.credential);
  if (credential.length < 7) throw new Error("registration_credential_too_short");
  const credentialHash = await hashCredential(credential);
  const lookupDigest = credentialLookupDigest(credential, lookupKey);

  return sql.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(
      "SELECT id::text AS id FROM public.credentials WHERE credential_lookup_digest = $1 LIMIT 1",
      [lookupDigest],
    );
    if (existing[0]) throw new Error("registration_credential_in_use");

    const users = await tx.query<{ id: string }>(
      "INSERT INTO public.users (status) VALUES ('active') RETURNING id::text AS id",
    );
    const userId = users[0]?.id;
    if (!userId) throw new Error("registration_user_not_created");
    await tx.query(
      `INSERT INTO public.credentials (user_id, credential_lookup_digest, credential_hash)
       VALUES ($1, $2, $3)`,
      [userId, lookupDigest, credentialHash],
    );

    const state = await createPlayerInviteOAuthState(tx, null, { display_name: displayName, pronouns });
    const claim = await claimPlayerInvite(tx, state, userId);
    const { token, session } = createSession({ id: randomUUID(), userId });
    await tx.query(
      `INSERT INTO public.sessions
         (id, user_id, token_digest, created_at, expires_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
      [session.id, userId, hashSessionToken(token), session.createdAt, session.expiresAt, session.lastSeenAt],
    );
    return { userId, playerLabel: claim.player_label, sessionToken: token };
  });
}
