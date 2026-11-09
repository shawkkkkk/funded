-- Funded production schema. Not applied by the local server.
-- Amounts are integer base units or USD micros. No floats.

CREATE TABLE creators (
  id uuid PRIMARY KEY,
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9_]{1,15}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consents (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES creators(id),
  rail text NOT NULL CHECK (rail IN ('xmoney', 'cashapp', 'venmo')),
  handle text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (creator_id, version)
);

CREATE TABLE launches (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES creators(id),
  consent_id uuid NOT NULL REFERENCES consents(id),
  mint text NOT NULL UNIQUE,
  quote_mint text NOT NULL,
  fee_tier smallint NOT NULL CHECK (fee_tier IN (0, 1, 2)),
  fee_receiver text NOT NULL,
  creator_wallet text NOT NULL,
  launch_signature text,
  launch_slot bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fee_receiver <> creator_wallet)
);

CREATE TABLE receipts (
  origin_ref text PRIMARY KEY,
  launch_id uuid NOT NULL REFERENCES launches(id),
  signature text NOT NULL,
  asset text NOT NULL,
  units numeric(39, 0) NOT NULL CHECK (units > 0),
  credited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signature, origin_ref)
);

CREATE TABLE batches (
  id uuid PRIMARY KEY,
  launch_id uuid NOT NULL REFERENCES launches(id),
  consent_id uuid NOT NULL REFERENCES consents(id),
  status text NOT NULL,
  asset text NOT NULL,
  units numeric(39, 0) NOT NULL CHECK (units >= 0),
  paid_usd_micros numeric(39, 0) NOT NULL DEFAULT 0 CHECK (paid_usd_micros >= 0),
  peer_order_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batch_receipts (
  batch_id uuid NOT NULL REFERENCES batches(id),
  origin_ref text NOT NULL REFERENCES receipts(origin_ref),
  PRIMARY KEY (batch_id, origin_ref),
  UNIQUE (origin_ref)
);

CREATE TABLE events (
  id text PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  kind text NOT NULL,
  ref text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)
);

CREATE TABLE journal (
  event_id text NOT NULL REFERENCES events(id),
  asset text NOT NULL,
  account text NOT NULL,
  delta numeric(39, 0) NOT NULL CHECK (delta <> 0),
  PRIMARY KEY (event_id, asset, account)
);

CREATE TABLE peer_orders (
  deposit_id text PRIMARY KEY,
  batch_id uuid NOT NULL UNIQUE REFERENCES batches(id),
  environment text NOT NULL CHECK (environment IN ('preproduction', 'staging', 'production')),
  payee text NOT NULL,
  units numeric(39, 0) NOT NULL CHECK (units > 0),
  filled_units numeric(39, 0) NOT NULL DEFAULT 0 CHECK (filled_units >= 0),
  usd_micros numeric(39, 0) NOT NULL DEFAULT 0 CHECK (usd_micros >= 0),
  status text NOT NULL,
  sender_display text NOT NULL DEFAULT 'unresolved',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (filled_units <= units)
);

CREATE TABLE fills (
  payment_id text PRIMARY KEY,
  deposit_id text NOT NULL REFERENCES peer_orders(deposit_id),
  units numeric(39, 0) NOT NULL CHECK (units > 0),
  usd_micros numeric(39, 0) NOT NULL CHECK (usd_micros > 0),
  paid_currency text NOT NULL,
  paid_at timestamptz NOT NULL
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batches(id),
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  lease_owner text,
  lease_until timestamptz,
  fence bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE (batch_id, kind)
);

CREATE TABLE pauses (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  paused boolean NOT NULL,
  reason text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pauses (paused, reason) VALUES (true, 'default closed');
