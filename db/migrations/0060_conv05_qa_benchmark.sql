-- CONV-05 benchmark results are isolated from player characters and memories.
-- The schema is intentionally not exposed to Supabase API roles.

CREATE SCHEMA IF NOT EXISTS qa_conv05;
REVOKE ALL ON SCHEMA qa_conv05 FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE qa_conv05.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_version text NOT NULL,
  generator_model text NOT NULL,
  evaluator_model text NOT NULL,
  budget_limit_usd numeric(8,4) NOT NULL CHECK (budget_limit_usd > 0),
  total_cost_usd numeric(8,6) NOT NULL DEFAULT 0 CHECK (total_cost_usd >= 0),
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'running', 'paused', 'complete', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (total_cost_usd <= budget_limit_usd)
);

CREATE TABLE qa_conv05.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES qa_conv05.runs(id) ON DELETE CASCADE,
  character_slot smallint NOT NULL CHECK (character_slot BETWEEN 1 AND 10),
  character_id text NOT NULL,
  qa_identity_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, character_slot),
  UNIQUE (run_id, character_id)
);

CREATE TABLE qa_conv05.results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES qa_conv05.runs(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES qa_conv05.subjects(id) ON DELETE CASCADE,
  question_no smallint NOT NULL CHECK (question_no BETWEEN 1 AND 20),
  question text NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_refs) = 'array'),
  generator_request_id text,
  generator_provider text,
  generator_http_status integer,
  generator_response text,
  generator_finish_reason text,
  generator_input_tokens integer CHECK (generator_input_tokens IS NULL OR generator_input_tokens >= 0),
  generator_output_tokens integer CHECK (generator_output_tokens IS NULL OR generator_output_tokens >= 0),
  generator_cost_usd numeric(12,8) CHECK (generator_cost_usd IS NULL OR generator_cost_usd >= 0),
  generator_latency_ms integer CHECK (generator_latency_ms IS NULL OR generator_latency_ms >= 0),
  evaluator_request_id text,
  evaluator_provider text,
  evaluator_http_status integer,
  evaluator_result jsonb CHECK (evaluator_result IS NULL OR jsonb_typeof(evaluator_result) = 'object'),
  evaluator_finish_reason text,
  evaluator_input_tokens integer CHECK (evaluator_input_tokens IS NULL OR evaluator_input_tokens >= 0),
  evaluator_output_tokens integer CHECK (evaluator_output_tokens IS NULL OR evaluator_output_tokens >= 0),
  evaluator_cost_usd numeric(12,8) CHECK (evaluator_cost_usd IS NULL OR evaluator_cost_usd >= 0),
  evaluator_latency_ms integer CHECK (evaluator_latency_ms IS NULL OR evaluator_latency_ms >= 0),
  error_class text,
  error_detail text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'complete', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (subject_id, question_no)
);

CREATE INDEX results_run_status_idx ON qa_conv05.results (run_id, status);

CREATE TABLE qa_conv05.sediment_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES qa_conv05.runs(id) ON DELETE CASCADE,
  candidate text NOT NULL,
  evidence_result_ids uuid[] NOT NULL DEFAULT '{}',
  recurrence_count integer NOT NULL CHECK (recurrence_count > 0),
  category text NOT NULL CHECK (category IN ('technical', 'canon_review_required')),
  status text NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON ALL TABLES IN SCHEMA qa_conv05 FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA qa_conv05
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
