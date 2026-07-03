WITH unknown_rows AS (
  UPDATE resignations
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE name = '未知姓名'
    AND department = '未分類'
    AND position = '未知職位'
    AND last_day = DATE '2026-07-03'
    AND status <> 'cancelled'
  RETURNING id
),
duplicate_ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY name, department, position, last_day
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM resignations
  WHERE name = '楊芝萱'
    AND department = '新華RF工程組'
    AND position = '工程師'
    AND last_day = DATE '2026-07-03'
    AND status <> 'cancelled'
),
duplicate_rows AS (
  UPDATE resignations r
  SET status = 'cancelled',
      updated_at = NOW()
  FROM duplicate_ranked d
  WHERE r.id = d.id
    AND d.row_num > 1
  RETURNING r.id
)
SELECT
  (SELECT COUNT(*) FROM unknown_rows) AS cancelled_unknown_rows,
  (SELECT COUNT(*) FROM duplicate_rows) AS cancelled_duplicate_rows;
