-- Privacy-preserving X Money receipt admission.
-- Raw provider payment ids and receipt URLs must never be stored here.

CREATE TABLE xmoney_receipt_bindings (
  binding_id text PRIMARY KEY CHECK (binding_id ~ '^xmoney_binding_[0-9a-f]{64}$'),
  batch_id uuid NOT NULL UNIQUE REFERENCES batches(id),
  plan_reference text NOT NULL,
  deposit_id text NOT NULL UNIQUE,
  payee_hash text NOT NULL CHECK (payee_hash ~ '^0x[0-9a-f]{64}$'),
  expected_base_usdc_units numeric(39, 0) NOT NULL CHECK (expected_base_usdc_units > 0),
  paid_usd_cents numeric(39, 0) NOT NULL CHECK (paid_usd_cents > 0),
  released_base_usdc_units numeric(39, 0) NOT NULL CHECK (released_base_usdc_units > 0),
  receipt_count integer NOT NULL CHECK (receipt_count > 0),
  result_fingerprint text NOT NULL CHECK (result_fingerprint ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE xmoney_receipt_references (
  receipt_reference text PRIMARY KEY CHECK (receipt_reference ~ '^xmoney_receipt_[0-9a-f]{64}$'),
  binding_id text NOT NULL REFERENCES xmoney_receipt_bindings(binding_id),
  payment_index integer NOT NULL CHECK (payment_index >= 0),
  UNIQUE (binding_id, payment_index)
);
