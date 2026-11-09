-- Durable pipeline on top of the initial schema. Applied once by the migrator.

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  batch_id uuid REFERENCES batches(id),
  kind text NOT NULL CHECK (kind IN ('intake', 'swap_plan', 'bridge_check', 'peer_plan')),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'done', 'retry', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  due_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  fence bigint NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_due ON outbox (status, due_at, id);

CREATE TABLE observations (
  id text PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
