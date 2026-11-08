CREATE TABLE accounts (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE account_logins (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES accounts(session_id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX account_logins_session ON account_logins(session_id);

CREATE TABLE email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'reset')),
  flow_hash TEXT NOT NULL,
  code_mac TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  proof_hash TEXT UNIQUE
);
CREATE INDEX email_challenges_destination ON email_challenges(email,purpose,created_at);

CREATE TABLE auth_rate (
  scope TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
