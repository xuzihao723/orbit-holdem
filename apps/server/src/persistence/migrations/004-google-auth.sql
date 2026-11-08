ALTER TABLE account_logins RENAME TO old_account_logins;
ALTER TABLE accounts RENAME TO old_accounts;

CREATE TABLE accounts (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id),
  email TEXT NOT NULL,
  password_hash TEXT,
  created_at INTEGER NOT NULL,
  google_sub TEXT UNIQUE,
  CHECK ((password_hash IS NOT NULL) != (google_sub IS NOT NULL))
);
CREATE UNIQUE INDEX accounts_password_email ON accounts(email) WHERE password_hash IS NOT NULL;
INSERT INTO accounts(session_id,email,password_hash,created_at)
  SELECT session_id,email,password_hash,created_at FROM old_accounts;

CREATE TABLE account_logins (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES accounts(session_id),
  expires_at INTEGER NOT NULL
);
INSERT INTO account_logins SELECT token_hash,session_id,expires_at FROM old_account_logins;
DROP TABLE old_account_logins;
DROP TABLE old_accounts;
CREATE INDEX account_logins_session ON account_logins(session_id);

CREATE TABLE google_auth_flows (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
