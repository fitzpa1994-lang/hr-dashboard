SELECT json_build_object(
  'onboardings',
  (
    SELECT json_agg(row_to_json(t) ORDER BY t.expected_date, t.name)
    FROM (
      SELECT
        id,
        name,
        department,
        position,
        expected_date,
        status,
        email_subject,
        email_msg_id,
        created_at,
        updated_at
      FROM onboardings
      WHERE expected_date >= DATE '2026-06-01'
      ORDER BY expected_date, name
    ) AS t
  ),
  'resignations',
  (
    SELECT json_agg(row_to_json(t) ORDER BY t.last_day, t.name)
    FROM (
      SELECT
        id,
        name,
        department,
        position,
        resign_date,
        last_day,
        status,
        email_subject,
        email_msg_id,
        created_at,
        updated_at
      FROM resignations
      WHERE last_day >= DATE '2026-05-01'
      ORDER BY last_day, name
    ) AS t
  )
) AS payload;
