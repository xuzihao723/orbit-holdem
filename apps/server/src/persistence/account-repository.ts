import type { DatabaseSync } from 'node:sqlite';
import { withSqlTransaction } from './transaction.js';

export type Purpose = 'register' | 'reset';
interface Challenge {
  id: string;
  email: string;
  purpose: Purpose;
  flow_hash: string;
  code_mac: string;
  created_at: number;
  expires_at: number;
  attempts: number;
  proof_hash: string | null;
}
interface Account {
  session_id: string;
  email: string;
  password_hash: string;
}
export interface AccountLogin {
  session_id: string;
  expires_at: number;
}
export function accountRepository(db: DatabaseSync) {
  const byEmail = db.prepare('SELECT * FROM accounts WHERE email=? AND password_hash IS NOT NULL');
  const bySession = db.prepare('SELECT email FROM accounts WHERE session_id=?');
  const addLogin = db.prepare('INSERT INTO account_logins VALUES (?,?,?)');
  const findAccount = (email: string) => byEmail.get(email) as Account | undefined;
  const findProof = (hash: string, flow: string, purpose: Purpose, now: number) =>
    db
      .prepare(
        'SELECT * FROM email_challenges WHERE proof_hash=? AND flow_hash=? AND purpose=? AND expires_at>?',
      )
      .get(hash, flow, purpose, now) as Challenge | undefined;
  const consume = (id: string) => db.prepare('DELETE FROM email_challenges WHERE id=?').run(id);
  return {
    findAccount,
    startGoogleFlow(input: {
      state: string;
      browser: string;
      verifier: string;
      nonce: string;
      next: string;
      now: number;
      expires: number;
    }) {
      db.prepare('DELETE FROM google_auth_flows WHERE expires_at<=?').run(input.now);
      db.prepare('INSERT INTO google_auth_flows VALUES (?,?,?,?,?,?)').run(
        input.state,
        input.browser,
        input.verifier,
        input.nonce,
        input.next,
        input.expires,
      );
    },
    takeGoogleFlow(state: string, browser: string, now: number) {
      return db
        .prepare(
          'DELETE FROM google_auth_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING verifier,nonce,return_path',
        )
        .get(state, browser, now) as
        { verifier: string; nonce: string; return_path: string } | undefined;
    },
    signInGoogle(input: {
      subject: string;
      email: string;
      nickname: string;
      sessionId: string;
      disabledGuestHash: string;
      loginHash: string;
      previousLogin: string | null;
      expires: number;
      now: number;
    }) {
      return withSqlTransaction(db, () => {
        const existing = db
          .prepare('SELECT session_id FROM accounts WHERE google_sub=?')
          .get(input.subject);
        const sessionId = (existing?.session_id as string | undefined) ?? input.sessionId;
        if (existing) {
          db.prepare('UPDATE accounts SET email=? WHERE session_id=?').run(input.email, sessionId);
        } else {
          db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,1)').run(
            sessionId,
            input.disabledGuestHash,
            input.nickname,
            input.now,
            Number.MAX_SAFE_INTEGER,
          );
          db.prepare(
            'INSERT INTO accounts(session_id,email,created_at,google_sub) VALUES (?,?,?,?)',
          ).run(sessionId, input.email, input.now, input.subject);
        }
        db.prepare('DELETE FROM account_logins WHERE expires_at<=? OR token_hash=?').run(
          input.now,
          input.previousLogin,
        );
        addLogin.run(input.loginHash, sessionId, input.expires);
        return sessionId;
      });
    },
    validProof(hash: string, flow: string, purpose: Purpose, now: number) {
      return !!findProof(hash, flow, purpose, now);
    },
    emailForSession(sessionId: string) {
      return bySession.get(sessionId)?.email as string | undefined;
    },
    login(hash: string, now: number) {
      return db
        .prepare(
          'SELECT session_id,expires_at FROM account_logins WHERE token_hash=? AND expires_at>?',
        )
        .get(hash, now) as AccountLogin | undefined;
    },
    issueLogin(
      hash: string,
      sessionId: string,
      expires: number,
      passwordHash: string,
      now: number,
    ) {
      db.prepare('DELETE FROM account_logins WHERE expires_at<=?').run(now);
      return (
        db
          .prepare(
            'INSERT INTO account_logins SELECT ?,session_id,? FROM accounts WHERE session_id=? AND password_hash=?',
          )
          .run(hash, expires, sessionId, passwordHash).changes === 1
      );
    },
    revoke(hash: string) {
      db.prepare('DELETE FROM account_logins WHERE token_hash=?').run(hash);
    },
    allow(scope: string, now: number, interval: number, max: number) {
      const end = Math.floor(now / interval) * interval + interval;
      db.prepare('DELETE FROM auth_rate WHERE expires_at<=?').run(now);
      const row = db
        .prepare(
          `INSERT INTO auth_rate VALUES (?,?,1)
        ON CONFLICT(scope) DO UPDATE SET expires_at=excluded.expires_at,hits=auth_rate.hits+1
        WHERE auth_rate.hits<? RETURNING hits`,
        )
        .get(scope, end, max);
      return !!row;
    },
    challengeCooling(email: string, purpose: Purpose, now: number) {
      return !!db
        .prepare(
          'SELECT 1 FROM email_challenges WHERE email=? AND purpose=? AND created_at>? LIMIT 1',
        )
        .get(email, purpose, now - 60_000);
    },
    createChallenge(input: Omit<Challenge, 'attempts' | 'proof_hash'>) {
      withSqlTransaction(db, () => {
        db.prepare('DELETE FROM email_challenges WHERE expires_at<=?').run(input.created_at);
        db.prepare(
          'DELETE FROM email_challenges WHERE email=? AND purpose=? AND flow_hash=? AND proof_hash IS NULL',
        ).run(input.email, input.purpose, input.flow_hash);
        db.prepare(
          'INSERT INTO email_challenges(id,email,purpose,flow_hash,code_mac,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',
        ).run(
          input.id,
          input.email,
          input.purpose,
          input.flow_hash,
          input.code_mac,
          input.created_at,
          input.expires_at,
        );
      });
    },
    readChallenge(id: string, flow: string, now: number) {
      return db
        .prepare(
          'SELECT * FROM email_challenges WHERE id=? AND flow_hash=? AND expires_at>? AND attempts<5 AND proof_hash IS NULL',
        )
        .get(id, flow, now) as Challenge | undefined;
    },
    attempt(id: string, proof: string | null, expiresAt: number) {
      if (proof)
        db.prepare('UPDATE email_challenges SET proof_hash=?,expires_at=? WHERE id=?').run(
          proof,
          expiresAt,
          id,
        );
      else db.prepare('UPDATE email_challenges SET attempts=attempts+1 WHERE id=?').run(id);
    },
    register(input: {
      proof: string;
      flow: string;
      now: number;
      sessionId: string;
      disabledGuestHash: string;
      guestHash: string | null;
      nickname: string;
      passwordHash: string;
      loginHash: string;
      expires: number;
    }) {
      return withSqlTransaction(db, () => {
        const grant = findProof(input.proof, input.flow, 'register', input.now);
        if (!grant) return 'proof' as const;
        if (findAccount(grant.email)) return 'exists' as const;
        const guest = input.guestHash
          ? db
              .prepare(
                `SELECT s.session_id FROM sessions s LEFT JOIN accounts a USING(session_id)
              WHERE token_hash=? AND s.expires_at>? AND a.session_id IS NULL`,
              )
              .get(input.guestHash, input.now)
          : null;
        if (input.guestHash && !guest) return 'guest' as const;
        const sessionId = (guest?.session_id as string | undefined) ?? input.sessionId;
        if (guest) {
          const playing = db
            .prepare(
              `SELECT 1 FROM participants p JOIN rooms r USING(room_id)
            WHERE p.session_id=? AND p.left_at IS NULL AND r.status='playing'`,
            )
            .get(sessionId);
          if (playing) return 'playing' as const;
          db.prepare('UPDATE sessions SET token_hash=?,expires_at=? WHERE session_id=?').run(
            input.disabledGuestHash,
            Number.MAX_SAFE_INTEGER,
            sessionId,
          );
        } else {
          db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,1)').run(
            sessionId,
            input.disabledGuestHash,
            input.nickname,
            input.now,
            Number.MAX_SAFE_INTEGER,
          );
        }
        db.prepare(
          'INSERT INTO accounts(session_id,email,password_hash,created_at) VALUES (?,?,?,?)',
        ).run(sessionId, grant.email, input.passwordHash, input.now);
        addLogin.run(input.loginHash, sessionId, input.expires);
        consume(grant.id);
        return { sessionId };
      });
    },
    reset(proof: string, flow: string, now: number, passwordHash: string) {
      return withSqlTransaction(db, () => {
        const grant = findProof(proof, flow, 'reset', now);
        const account = grant && findAccount(grant.email);
        if (!grant || !account) return null;
        db.prepare('UPDATE accounts SET password_hash=? WHERE session_id=?').run(
          passwordHash,
          account.session_id,
        );
        db.prepare('DELETE FROM account_logins WHERE session_id=?').run(account.session_id);
        consume(grant.id);
        return account.session_id;
      });
    },
  };
}
