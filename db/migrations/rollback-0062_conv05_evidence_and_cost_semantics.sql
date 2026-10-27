DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM qa_conv05.results
     WHERE expected_source_refs <> '[]'::jsonb
        OR retrieved_source_refs <> '[]'::jsonb
        OR cited_source_refs <> '[]'::jsonb
        OR validated_evidence <> '[]'::jsonb
        OR generator_billed_cost_usd IS NOT NULL
        OR generator_estimated_cost_usd IS NOT NULL
        OR generator_reserved_cost_usd IS NOT NULL
        OR generator_unreconciled_cost_usd IS NOT NULL
        OR evaluator_billed_cost_usd IS NOT NULL
        OR evaluator_estimated_cost_usd IS NOT NULL
        OR evaluator_reserved_cost_usd IS NOT NULL
        OR evaluator_unreconciled_cost_usd IS NOT NULL
        OR cost_reconciliation_status <> 'UNRECONCILED'
  ) OR EXISTS (
    SELECT 1 FROM qa_conv05.runs
     WHERE billed_cost_usd IS NOT NULL
        OR estimated_cost_usd IS NOT NULL
        OR reserved_budget_usd IS NOT NULL
        OR unreconciled_cost_usd IS NOT NULL
        OR cost_reconciliation_status <> 'UNRECONCILED'
  ) THEN
    RAISE EXCEPTION 'rollback blocked: CONV-05 evidence/cost columns contain new values';
  END IF;
END;
$$;

ALTER TABLE qa_conv05.results
  DROP COLUMN cost_reconciliation_status,
  DROP COLUMN evaluator_unreconciled_cost_usd,
  DROP COLUMN evaluator_reserved_cost_usd,
  DROP COLUMN evaluator_estimated_cost_usd,
  DROP COLUMN evaluator_billed_cost_usd,
  DROP COLUMN generator_unreconciled_cost_usd,
  DROP COLUMN generator_reserved_cost_usd,
  DROP COLUMN generator_estimated_cost_usd,
  DROP COLUMN generator_billed_cost_usd,
  DROP COLUMN validated_evidence,
  DROP COLUMN cited_source_refs,
  DROP COLUMN retrieved_source_refs,
  DROP COLUMN expected_source_refs;

ALTER TABLE qa_conv05.runs
  DROP COLUMN cost_reconciliation_status,
  DROP COLUMN unreconciled_cost_usd,
  DROP COLUMN reserved_budget_usd,
  DROP COLUMN estimated_cost_usd,
  DROP COLUMN billed_cost_usd;
