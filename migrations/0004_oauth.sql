CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_secret_hash TEXT,
  redirect_uris TEXT NOT NULL CHECK (json_valid(redirect_uris) AND json_type(redirect_uris) = 'array'),
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE TABLE oauth_authorization_requests (
  request_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  state TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT,
  expires_at INTEGER NOT NULL,
  consumed_by TEXT
);

CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  scope TEXT NOT NULL,
  audience TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_by TEXT
);

CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  parent_hash TEXT REFERENCES oauth_refresh_tokens(token_hash),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_by TEXT,
  revoked_at INTEGER
);

CREATE TABLE oauth_access_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE oauth_rate_limits (
  key_hash TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key_hash, window)
);

CREATE INDEX oauth_requests_expiry_idx ON oauth_authorization_requests(expires_at);
CREATE INDEX oauth_grants_user_idx ON oauth_grants(user_id, created_at);
CREATE INDEX oauth_grants_client_idx ON oauth_grants(client_id);
CREATE INDEX oauth_grants_expiry_idx ON oauth_grants(expires_at);
CREATE INDEX oauth_codes_grant_idx ON oauth_authorization_codes(grant_id);
CREATE INDEX oauth_codes_expiry_idx ON oauth_authorization_codes(expires_at);
CREATE INDEX oauth_refresh_grant_idx ON oauth_refresh_tokens(grant_id);
CREATE INDEX oauth_refresh_family_idx ON oauth_refresh_tokens(family_id);
CREATE INDEX oauth_access_grant_idx ON oauth_access_tokens(grant_id);
CREATE INDEX oauth_access_family_idx ON oauth_access_tokens(family_id);
CREATE INDEX oauth_access_expiry_idx ON oauth_access_tokens(expires_at);
CREATE INDEX oauth_rate_window_idx ON oauth_rate_limits(window);
