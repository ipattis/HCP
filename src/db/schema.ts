import type Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coordination_requests (
    request_id    TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    intent        TEXT NOT NULL,
    urgency       TEXT NOT NULL,
    state         TEXT NOT NULL DEFAULT 'SUBMITTED',
    context_package TEXT NOT NULL,  -- JSON
    response_schema TEXT,           -- JSON
    timeout_policy  TEXT NOT NULL,  -- JSON
    routing_hints   TEXT NOT NULL,  -- JSON
    trace_id        TEXT,
    idempotency_key TEXT UNIQUE,
    responder_id    TEXT NOT NULL,
    response_data   TEXT,           -- JSON
    responded_by    TEXT,
    responded_at    TEXT,
    submitted_at    TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    timeout_at      TEXT NOT NULL,
    delivered_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cr_state ON coordination_requests(state);
  CREATE INDEX IF NOT EXISTS idx_cr_agent_id ON coordination_requests(agent_id);
  CREATE INDEX IF NOT EXISTS idx_cr_responder_id ON coordination_requests(responder_id);
  CREATE INDEX IF NOT EXISTS idx_cr_timeout_at ON coordination_requests(timeout_at);

  CREATE TABLE IF NOT EXISTS audit_events (
    event_id    TEXT PRIMARY KEY,
    request_id  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    actor       TEXT NOT NULL,
    actor_type  TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',  -- JSON
    created_at  TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES coordination_requests(request_id)
  );

  CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_events(request_id);

  CREATE TABLE IF NOT EXISTS api_keys (
    key_id      TEXT PRIMARY KEY,
    key_hash    TEXT NOT NULL UNIQUE,
    agent_id    TEXT NOT NULL,
    label       TEXT NOT NULL,
    scopes      TEXT NOT NULL DEFAULT '[]',  -- JSON
    created_at  TEXT NOT NULL,
    revoked_at  TEXT
  );
`;

export function ensureSchema(db: Database.Database): void {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get() as { name: string } | undefined;

  if (!row) {
    db.exec(CREATE_TABLES);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION
    );
    return;
  }

  const versionRow = db
    .prepare("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | undefined;

  if (!versionRow || versionRow.version < SCHEMA_VERSION) {
    // Future migrations go here
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }
}
