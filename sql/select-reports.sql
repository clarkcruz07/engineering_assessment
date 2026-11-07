-- One snapshot per brand/marketplace/week, available at the evaluation time ($1).
-- Reports are snapshots, never increments: exactly one row per scope is returned.
-- Precedence: complete over partial, then greatest coverage (period_end), then the
-- publisher's generation time. The internal import revision is only a final tie-break:
-- a later import can carry an older (superseded) publisher report.
WITH ranked AS (
  SELECT r.*, ROW_NUMBER() OVER (
    PARTITION BY brand_id, marketplace, period_start
    ORDER BY CASE WHEN status = 'complete' THEN 0 ELSE 1 END,
             period_end DESC, generated_at DESC, revision DESC
  ) AS priority
  FROM raw.subscription_reports r
  WHERE extracted_at <= $1::timestamptz
)
SELECT * FROM ranked WHERE priority = 1
