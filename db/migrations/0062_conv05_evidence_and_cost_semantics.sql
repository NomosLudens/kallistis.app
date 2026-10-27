-- Add unambiguous per-turn source and cost fields to the private CONV-05 QA schema.
-- Existing source_refs, generator_cost_usd, evaluator_cost_usd, and runs.total_cost_usd
-- retain their historical meaning; ambiguous legacy values are deliberately not backfilled.

ALTER TABLE qa_conv05.results
  ADD COLUMN IF NOT EXISTS expected_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(expected_source_refs) = 'array'),
  ADD COLUMN IF NOT EXISTS retrieved_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(retrieved_source_refs) = 'array'),
  ADD COLUMN IF NOT EXISTS cited_source_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(cited_source_refs) = 'array'),
  ADD COLUMN IF NOT EXISTS validated_evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(validated_evidence) = 'array'),
  ADD COLUMN IF NOT EXISTS generator_billed_cost_usd numeric(12,8)
    CHECK (generator_billed_cost_usd IS NULL OR generator_billed_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS generator_estimated_cost_usd numeric(12,8)
    CHECK (generator_estimated_cost_usd IS NULL OR generator_estimated_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS generator_reserved_cost_usd numeric(12,8)
    CHECK (generator_reserved_cost_usd IS NULL OR generator_reserved_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS generator_unreconciled_cost_usd numeric(12,8)
    CHECK (generator_unreconciled_cost_usd IS NULL OR generator_unreconciled_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS evaluator_billed_cost_usd numeric(12,8)
    CHECK (evaluator_billed_cost_usd IS NULL OR evaluator_billed_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS evaluator_estimated_cost_usd numeric(12,8)
    CHECK (evaluator_estimated_cost_usd IS NULL OR evaluator_estimated_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS evaluator_reserved_cost_usd numeric(12,8)
    CHECK (evaluator_reserved_cost_usd IS NULL OR evaluator_reserved_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS evaluator_unreconciled_cost_usd numeric(12,8)
    CHECK (evaluator_unreconciled_cost_usd IS NULL OR evaluator_unreconciled_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS cost_reconciliation_status text NOT NULL DEFAULT 'UNRECONCILED'
    CHECK (cost_reconciliation_status IN ('UNRECONCILED', 'PARTIAL', 'RECONCILED'));

ALTER TABLE qa_conv05.runs
  ADD COLUMN IF NOT EXISTS billed_cost_usd numeric(12,8)
    CHECK (billed_cost_usd IS NULL OR billed_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12,8)
    CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS reserved_budget_usd numeric(12,8)
    CHECK (reserved_budget_usd IS NULL OR reserved_budget_usd >= 0),
  ADD COLUMN IF NOT EXISTS unreconciled_cost_usd numeric(12,8)
    CHECK (unreconciled_cost_usd IS NULL OR unreconciled_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS cost_reconciliation_status text NOT NULL DEFAULT 'UNRECONCILED'
    CHECK (cost_reconciliation_status IN ('UNRECONCILED', 'PARTIAL', 'RECONCILED'));

COMMENT ON COLUMN qa_conv05.results.source_refs IS
  'Legacy source-reference field. Its old cumulative meaning is retained; use expected/retrieved/cited/validated fields for new rows.';
COMMENT ON COLUMN qa_conv05.results.generator_cost_usd IS
  'Legacy recorded cost value. Its historical meaning is retained; use billed/estimated/reserved/unreconciled fields for new rows.';
COMMENT ON COLUMN qa_conv05.runs.total_cost_usd IS
  'Legacy run cost/budget-control field. Not a verified provider invoice total; use explicit reconciliation fields for new accounting.';
