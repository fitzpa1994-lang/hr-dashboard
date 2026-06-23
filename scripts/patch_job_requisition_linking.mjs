import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const n8nDir = path.join(root, 'n8n');

function findFile(prefix) {
  const entry = fs.readdirSync(n8nDir).find((name) => name.startsWith(prefix) && name.endsWith('.json'));
  if (!entry) {
    throw new Error(`Missing n8n export for ${prefix}`);
  }
  return path.join(n8nDir, entry);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function updateWorkflowNodes(workflow, updater) {
  for (const node of workflow.nodes || []) {
    updater(node);
  }
  if (workflow.activeVersion?.nodes) {
    for (const node of workflow.activeVersion.nodes) {
      updater(node);
    }
  }
}

const bootstrapQuery = `ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS job_requisition_id INTEGER REFERENCES job_requisitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_job_requisition
ON candidates(job_requisition_id);
`;

const extractJs = `const item = $input.item.json;
const subject = String(item.subject || '').trim();
const rawBody = item.body?.content || item.bodyPreview || '';
const body = String(rawBody)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#\\d+;/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();

const sender = typeof item.from === 'string'
  ? item.from
  : (item.from?.emailAddress?.address || item.sender?.emailAddress?.address || null);
const receivedAt = item.receivedDateTime || item.sentDateTime || item.createdDateTime || item.lastModifiedDateTime || new Date().toISOString();

const collectEmails = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      return entry.emailAddress?.address || entry.address || null;
    })
    .filter(Boolean)
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean);
};

const toEmails = collectEmails(item.to);
const ccEmails = collectEmails(item.cc);
const recipientEmails = [...new Set([...toEmails, ...ccEmails])];

const recipientRoutingRules = [
  { match: /viclee@sporton\\.com\\.tw$/, topDepartment: 'WBU', preferredRequisitionId: 25 },
  { match: /codychang@sporton\\.com\\.tw$/, topDepartment: 'ICC', preferredRequisitionId: 1 },
  { match: /yenchen@sporton\\.com\\.tw$/, topDepartment: 'ICC' },
];

const recipientHint = recipientRoutingRules.find((rule) => recipientEmails.some((email) => rule.match.test(email))) || null;

const SKIP = new Set([
  '通知', '安排', '確認', '面試', '邀請', '時間',
  '地點', '更改', '更新', '推薦', '取消', '履歷',
  '回覆', 're', 'fw', 'fwd'
]);

const normalizeCandidate = (value) => String(value || '')
  .replace(/^(?:RE|FW|FWD)\\s*:\\s*/i, '')
  .replace(/[()]/g, ' ')
  .replace(/(?:先生|女士|小姐|同學)$/g, '')
  .replace(/\\s+/g, '')
  .trim();

const isLikelyCandidate = (value) => {
  if (!value) return false;
  if (value.length < 2 || value.length > 16) return false;
  if (SKIP.has(value.toLowerCase()) || SKIP.has(value)) return false;
  if (/^(?:面試時間|履歷推薦|面試安排|面試通知|錄取通知|新進人員通知)$/i.test(value)) return false;
  return /[\\u4e00-\\u9fa5A-Za-z]/.test(value);
};

let candidateName = null;
const subjectPatterns = [
  /[\\u3010\\[][^\\u3011\\]]+[\\u3011\\]]\\s*[\\-\\uff0d\\u2014\\u2013:\\uff1a]\\s*([^\\n]+?)\\s*$/,
  /[\\u3010\\[][^\\u3011\\]]+[\\u3011\\]]\\s*([^\\n]+?)\\s*$/,
  /[\\-\\uff0d\\u2014\\u2013:\\uff1a]\\s*([^\\n]+?)\\s*$/,
  /([^\\n]+?)\\s*(?:先生|女士|小姐)\\s*$/
];
for (const pattern of subjectPatterns) {
  const match = subject.match(pattern);
  if (!match || !match[1]) continue;
  const normalized = normalizeCandidate(match[1]);
  if (isLikelyCandidate(normalized)) {
    candidateName = normalized;
    break;
  }
}

if (!candidateName) {
  const bodyNamePatterns = [
    /候選人[：: ]*([\\u4e00-\\u9fa5A-Za-z]{2,16})/,
    /姓名[：: ]*([\\u4e00-\\u9fa5A-Za-z]{2,16})/,
    /([\\u4e00-\\u9fa5]{2,4})\\s*(?:先生|女士|小姐)\\s*您好/
  ];
  for (const pattern of bodyNamePatterns) {
    const match = body.match(pattern);
    if (!match || !match[1]) continue;
    const normalized = normalizeCandidate(match[1]);
    if (isLikelyCandidate(normalized)) {
      candidateName = normalized;
      break;
    }
  }
}

const explicitDepartmentMatch = body.match(/部門[：: ]*([^\\s，。,；;]+)/);
const explicitDepartment = explicitDepartmentMatch ? explicitDepartmentMatch[1].trim() : null;

const positionFromSubjectMatch = subject.match(/[\\u3010\\[]([^\\u3011\\]]+)[\\u3011\\]]/);
const explicitPositionMatch = body.match(/(?:職缺|職稱|應徵職位)[：: ]*([^\\n]+)/);
const inferredPosition = explicitPositionMatch
  ? explicitPositionMatch[1].trim()
  : (positionFromSubjectMatch ? positionFromSubjectMatch[1].trim() : null);

const deriveDepartment = (position, department, text, hint) => {
  if (department) return department;
  const source = String(position || text || '');
  const patterns = [
    { re: /\\bICC\\b|ICC/, value: 'ICC' },
    { re: /WBU|SAR|RF\\s*PM|文件專員|文件組|RF測試工程師/, value: 'WBU' },
    { re: /新竹/, value: '新竹' },
    { re: /新華/, value: '新華' },
    { re: /安規|電池/, value: '安規' },
    { re: /董事長室|財務|行政|MIS|資訊部|軟體工程師/, value: '行政' }
  ];
  for (const entry of patterns) {
    if (entry.re.test(source)) return entry.value;
  }
  return hint?.topDepartment || null;
};

const inferredDepartment = deriveDepartment(inferredPosition, explicitDepartment, subject + ' ' + body, recipientHint);

const searchText = subject + ' ' + body.substring(0, 800);
const hasTentativeScheduling = /(可安排|皆可安排|可配合|可面試|可約|方便面試|請評估|再約|可於|起皆可)/.test(searchText);

let interviewDate = null;
if (!hasTentativeScheduling) {
  const currentYear = new Date(receivedAt || Date.now()).getFullYear();
  const datePatterns = [
    { re: /(\\d{4})年(\\d{1,2})月(\\d{1,2})日/, fn: (m) => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') },
    { re: /(\\d{4})[\\/.-](\\d{1,2})[\\/.-](\\d{1,2})/, fn: (m) => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') },
    { re: /(\\d{1,2})月(\\d{1,2})日/, fn: (m) => String(currentYear) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') }
  ];
  for (const entry of datePatterns) {
    const match = searchText.match(entry.re);
    if (match) {
      interviewDate = entry.fn(match);
      break;
    }
  }
}

let interviewTime = null;
if (!hasTentativeScheduling) {
  const timeMatch = searchText.match(/(?:上午|下午|AM|PM|am|pm)?\\s*(\\d{1,2})[:：](\\d{2})/);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const marker = timeMatch[0];
    if (/(下午|PM|pm)/.test(marker) && hour < 12) hour += 12;
    if (/(上午|AM|am)/.test(marker) && hour === 12) hour = 0;
    interviewTime = String(hour).padStart(2, '0') + ':' + timeMatch[2];
  }
}

return {
  email_msg_id: item.id,
  email_subject: subject,
  email_web_link: item.webLink || null,
  sender,
  received_at: receivedAt,
  recipient_emails: recipientEmails,
  recipient_top_department_hint: recipientHint?.topDepartment || null,
  preferred_requisition_id: recipientHint?.preferredRequisitionId || null,
  candidate_name: candidateName,
  interview_date: interviewDate,
  interview_time: interviewTime,
  inferred_department: inferredDepartment,
  inferred_applied_position: inferredPosition,
  has_tentative_scheduling: hasTentativeScheduling,
  body_text: body.substring(0, 2000),
};`;

const candidateQuery = `${bootstrapQuery}

WITH candidate_input AS (
  SELECT
    '{{ ($json.department || '').replace(/'/g, "''") }}'::TEXT AS raw_department,
    '{{ ($json.applied_position || '').replace(/'/g, "''") }}'::TEXT AS raw_position,
    NULLIF('{{ ($json.recipient_top_department_hint || '').replace(/'/g, "''") }}', '')::TEXT AS recipient_top_department_hint,
    NULLIF('{{ $json.preferred_requisition_id || '' }}', '')::INTEGER AS recipient_preferred_requisition_id
),
candidate_norm AS (
  SELECT
    raw_department,
    raw_position,
    recipient_top_department_hint,
    COALESCE(
      recipient_preferred_requisition_id,
      CASE
        WHEN lower(raw_position) LIKE '%icc%客服業務%' OR lower(raw_position) LIKE '%icc客服業務%' THEN 19
        WHEN lower(raw_position) LIKE '%icc%案件專員%' OR lower(raw_position) LIKE '%iccpm%' THEN 5
        WHEN lower(raw_position) LIKE '%icc%測試工程師%' THEN 1
        WHEN lower(raw_position) LIKE '%sar測試工程師%' OR lower(raw_position) LIKE '%rfsar%' THEN 23
        WHEN (
          lower(raw_position) LIKE '%rf測試工程師%'
          OR lower(raw_position) LIKE '%emc測試工程師%'
          OR lower(raw_position) LIKE '%新竹%rf%測試工程師%'
          OR lower(raw_position) LIKE '%新竹%emc%測試工程師%'
        ) AND raw_department LIKE '%新竹%' THEN 4
        WHEN lower(raw_position) LIKE '%rf測試工程師%' AND recipient_top_department_hint = 'WBU' THEN 25
        WHEN lower(raw_position) LIKE '%rf測試工程師%' AND raw_department LIKE '%新華%' THEN 12
        WHEN lower(raw_position) LIKE '%五部rfpm%' OR lower(raw_position) LIKE '%rfpm%' THEN 13
        WHEN lower(raw_position) = 'pm' AND recipient_top_department_hint = 'WBU' THEN 13
        WHEN lower(raw_position) LIKE '%助理業務/業務%' AND raw_department LIKE '%安規%' THEN 22
        WHEN lower(raw_position) LIKE '%業務助理(david)%' THEN 8
        WHEN lower(raw_position) LIKE '%文件專員%' THEN 2
        ELSE NULL
      END
    ) AS preferred_requisition_id,
    CASE
      WHEN raw_department IN ('', '未分類', '未知部門', '未知職位', '測試', '人力資源部') THEN NULL
      ELSE raw_department
    END AS strong_department,
    CASE
      WHEN raw_department IN ('ICC', 'WBU', '新華', '新竹', '安規', '行政') THEN raw_department
      WHEN raw_department LIKE '%ICC%' THEN 'ICC'
      WHEN raw_department LIKE '%WBU%' OR raw_department LIKE '%SAR%' OR raw_department LIKE '%RF%' THEN 'WBU'
      WHEN raw_department LIKE '%新華%' THEN '新華'
      WHEN raw_department LIKE '%新竹%' THEN '新竹'
      WHEN raw_department LIKE '%安規%' OR raw_department LIKE '%電池%' THEN '安規'
      WHEN raw_department LIKE '%董事長室%' OR raw_department LIKE '%財務%' OR raw_department LIKE '%資訊%' OR raw_department LIKE '%MIS%' OR raw_department LIKE '%品管%' OR raw_department LIKE '%行政%' THEN '行政'
      WHEN raw_position LIKE 'ICC%' THEN 'ICC'
      WHEN raw_position LIKE 'WBU%' OR raw_position LIKE 'SAR%' OR raw_position LIKE 'RF %' OR raw_position LIKE 'RF%' THEN 'WBU'
      WHEN raw_position LIKE '新華%' THEN '新華'
      WHEN raw_position LIKE '新竹%' THEN '新竹'
      WHEN raw_position LIKE '安規%' OR raw_position LIKE '%電池%' THEN '安規'
      WHEN raw_position LIKE '%董事長室%' OR raw_position LIKE '%財務%' OR raw_position LIKE '%資訊%' OR raw_position LIKE 'MIS%' OR raw_position LIKE '%品管%' OR raw_position LIKE '%行政%' THEN '行政'
      ELSE recipient_top_department_hint
    END AS top_department,
    lower(regexp_replace(raw_position, '\\s+', '', 'g')) AS pos_norm,
    lower(regexp_replace(regexp_replace(raw_position, '^(ICC|icc|WBU|新華|新竹|安規|行政)', '', 'g'), '\\s+', '', 'g')) AS pos_core
  FROM candidate_input
),
matched_requisition AS (
  SELECT
    j.id,
    j.department,
    j.position_title
  FROM job_requisitions j
  CROSS JOIN candidate_norm c
  WHERE (j.status <> 'cancelled' OR (c.preferred_requisition_id IS NOT NULL AND j.id = c.preferred_requisition_id))
    AND (
      (c.preferred_requisition_id IS NOT NULL AND j.id = c.preferred_requisition_id)
      OR lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_norm
      OR lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_core
      OR c.pos_norm = lower(regexp_replace(split_part(j.department, ' / ', 1) || j.position_title, '\\s+', '', 'g'))
      OR c.pos_core = lower(regexp_replace(split_part(j.department, ' / ', 1) || j.position_title, '\\s+', '', 'g'))
      OR (
        c.pos_core <> ''
        AND (
          lower(regexp_replace(j.position_title, '\\s+', '', 'g')) LIKE '%' || c.pos_core || '%'
          OR c.pos_core LIKE '%' || lower(regexp_replace(j.position_title, '\\s+', '', 'g')) || '%'
        )
      )
    )
  ORDER BY
    CASE
      WHEN c.preferred_requisition_id IS NOT NULL AND j.id = c.preferred_requisition_id THEN 0
      WHEN c.strong_department IS NOT NULL AND j.department = c.strong_department THEN 1
      WHEN c.strong_department IS NOT NULL AND j.department LIKE '%' || c.strong_department || '%' THEN 2
      WHEN c.top_department IS NOT NULL AND split_part(j.department, ' / ', 1) = c.top_department THEN 3
      ELSE 4
    END,
    CASE
      WHEN lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_norm THEN 0
      WHEN lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_core THEN 1
      ELSE 2
    END,
    j.id
  LIMIT 1
),
resolved AS (
  SELECT
    COALESCE((SELECT department FROM matched_requisition), (SELECT raw_department FROM candidate_norm)) AS department,
    COALESCE((SELECT position_title FROM matched_requisition), (SELECT raw_position FROM candidate_norm)) AS position_title,
    (SELECT id FROM matched_requisition) AS job_requisition_id
),
inserted AS (
  INSERT INTO candidates (name, applied_position, department, job_requisition_id, source, status, notes)
  SELECT
    '{{ ($json.candidate_name || '').replace(/'/g, "''") }}',
    resolved.position_title,
    resolved.department,
    resolved.job_requisition_id,
    'Outlook即時',
    '{{ $json.db_status || '' }}',
    NULLIF('{{ ($json.system_stage_note || '').replace(/'/g, "''") }}', '')
  FROM resolved
  WHERE NOT EXISTS (
    SELECT 1
    FROM candidates
    WHERE name = '{{ ($json.candidate_name || '').replace(/'/g, "''") }}'
  )
  RETURNING id
)
UPDATE candidates
SET
  applied_position = CASE
    WHEN candidates.job_requisition_id IS NULL AND (SELECT job_requisition_id FROM resolved) IS NOT NULL
      THEN (SELECT position_title FROM resolved)
    ELSE candidates.applied_position
  END,
  department = CASE
    WHEN candidates.job_requisition_id IS NULL AND (SELECT job_requisition_id FROM resolved) IS NOT NULL
      THEN (SELECT department FROM resolved)
    ELSE candidates.department
  END,
  job_requisition_id = COALESCE(candidates.job_requisition_id, (SELECT job_requisition_id FROM resolved)),
  status = '{{ $json.db_status || '' }}',
  notes = CASE
    WHEN '{{ ($json.system_stage_note || '').replace(/'/g, "''") }}' <> '' THEN
      TRIM(BOTH ' ' FROM CONCAT(
        NULLIF(TRIM(BOTH ' ' FROM REGEXP_REPLACE(COALESCE(notes, ''), '\\\\s*\\\\[SYS_STAGE:[^\\\\]]+\\\\]', '', 'g')), ''),
        CASE
          WHEN NULLIF(TRIM(BOTH ' ' FROM REGEXP_REPLACE(COALESCE(notes, ''), '\\\\s*\\\\[SYS_STAGE:[^\\\\]]+\\\\]', '', 'g')), '') IS NOT NULL
            THEN ' '
          ELSE ''
        END,
        '{{ ($json.system_stage_note || '').replace(/'/g, "''") }}'
      ))
    ELSE NULLIF(TRIM(BOTH ' ' FROM REGEXP_REPLACE(COALESCE(notes, ''), '\\\\s*\\\\[SYS_STAGE:[^\\\\]]+\\\\]', '', 'g')), '')
  END
WHERE name = '{{ ($json.candidate_name || '').replace(/'/g, "''") }}';

SELECT
  c.id AS candidate_id,
  c.job_requisition_id AS job_requisition_id,
  '{{ ($json.candidate_name || '').replace(/'/g, "''") }}' AS candidate_name,
  '{{ $json.interview_date || '' }}' AS interview_date,
  '{{ $json.interview_time || '' }}' AS interview_time,
  {{ $json.round || 1 }} AS round,
  '{{ ($json.location || '').replace(/'/g, "''") }}' AS location,
  '{{ ($json.hr_owner || '').replace(/'/g, "''") }}' AS hr_owner,
  '{{ $json.interview_status || 'scheduled' }}' AS status,
  '{{ $json.intent || '' }}' AS intent,
  '{{ ($json.email_subject || '').replace(/'/g, "''") }}' AS email_subject,
  '{{ $json.email_msg_id || '' }}' AS email_msg_id,
  '{{ $json.email_web_link || '' }}' AS email_web_link,
  '{{ $json.sender || '' }}' AS sender,
  '{{ $json.received_at || '' }}' AS received_at,
  COALESCE(j.position_title, c.applied_position) AS applied_position,
  COALESCE(j.department, c.department) AS department
FROM candidates c
LEFT JOIN job_requisitions j ON j.id = c.job_requisition_id
WHERE c.name = '{{ ($json.candidate_name || '').replace(/'/g, "''") }}'
ORDER BY c.created_at DESC
LIMIT 1;`;

const migrationQuery = `ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS job_requisition_id INTEGER REFERENCES job_requisitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_job_requisition
ON candidates(job_requisition_id);

WITH candidate_norm AS (
  SELECT
    c.id,
    c.department,
    c.applied_position,
    CASE
      WHEN lower(c.applied_position) LIKE '%icc%客服業務%' OR lower(c.applied_position) LIKE '%icc客服業務%' THEN 19
      WHEN lower(c.applied_position) LIKE '%icc%案件專員%' OR lower(c.applied_position) LIKE '%iccpm%' THEN 5
      WHEN lower(c.applied_position) LIKE '%icc%測試工程師%' THEN 1
      WHEN lower(c.applied_position) LIKE '%sar測試工程師%' OR lower(c.applied_position) LIKE '%rfsar%' THEN 23
      WHEN (
        lower(c.applied_position) LIKE '%rf測試工程師%'
        OR lower(c.applied_position) LIKE '%emc測試工程師%'
        OR lower(c.applied_position) LIKE '%新竹%rf%測試工程師%'
        OR lower(c.applied_position) LIKE '%新竹%emc%測試工程師%'
      ) AND c.department LIKE '%新竹%' THEN 4
      WHEN lower(c.applied_position) LIKE '%rf測試工程師%' AND c.department = 'WBU' THEN 25
      WHEN lower(c.applied_position) LIKE '%rf測試工程師%' AND c.department LIKE '%新華%' THEN 12
      WHEN lower(c.applied_position) LIKE '%五部rfpm%' OR lower(c.applied_position) LIKE '%rfpm%' THEN 13
      WHEN lower(c.applied_position) = 'pm' AND c.department = 'WBU' THEN 13
      WHEN lower(c.applied_position) LIKE '%助理業務/業務%' AND c.department LIKE '%安規%' THEN 22
      WHEN lower(c.applied_position) LIKE '%業務助理(david)%' THEN 8
      WHEN lower(c.applied_position) LIKE '%文件專員%' THEN 2
      ELSE NULL
    END AS preferred_requisition_id,
    CASE
      WHEN c.department IN ('', '未分類', '未知部門', '未知職位', '測試', '人力資源部') THEN NULL
      ELSE c.department
    END AS strong_department,
    CASE
      WHEN c.department IN ('ICC', 'WBU', '新華', '新竹', '安規', '行政') THEN c.department
      WHEN c.department LIKE '%ICC%' THEN 'ICC'
      WHEN c.department LIKE '%WBU%' OR c.department LIKE '%SAR%' OR c.department LIKE '%RF%' THEN 'WBU'
      WHEN c.department LIKE '%新華%' THEN '新華'
      WHEN c.department LIKE '%新竹%' THEN '新竹'
      WHEN c.department LIKE '%安規%' OR c.department LIKE '%電池%' THEN '安規'
      WHEN c.department LIKE '%董事長室%' OR c.department LIKE '%財務%' OR c.department LIKE '%資訊%' OR c.department LIKE '%MIS%' OR c.department LIKE '%品管%' OR c.department LIKE '%行政%' THEN '行政'
      WHEN c.applied_position LIKE 'ICC%' THEN 'ICC'
      WHEN c.applied_position LIKE 'WBU%' OR c.applied_position LIKE 'SAR%' OR c.applied_position LIKE 'RF %' OR c.applied_position LIKE 'RF%' THEN 'WBU'
      WHEN c.applied_position LIKE '新華%' THEN '新華'
      WHEN c.applied_position LIKE '新竹%' THEN '新竹'
      WHEN c.applied_position LIKE '安規%' OR c.applied_position LIKE '%電池%' THEN '安規'
      WHEN c.applied_position LIKE '%董事長室%' OR c.applied_position LIKE '%財務%' OR c.applied_position LIKE '%資訊%' OR c.applied_position LIKE 'MIS%' OR c.applied_position LIKE '%品管%' OR c.applied_position LIKE '%行政%' THEN '行政'
      ELSE NULL
    END AS top_department,
    lower(regexp_replace(c.applied_position, '\\s+', '', 'g')) AS pos_norm,
    lower(regexp_replace(regexp_replace(c.applied_position, '^(ICC|icc|WBU|新華|新竹|安規|行政)', '', 'g'), '\\s+', '', 'g')) AS pos_core
  FROM candidates c
),
matched AS (
  SELECT
    c.id AS candidate_id,
    j.id AS job_requisition_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.id
      ORDER BY
        CASE
          WHEN c.preferred_requisition_id IS NOT NULL AND j.id = c.preferred_requisition_id THEN 0
          WHEN c.strong_department IS NOT NULL AND j.department = c.strong_department THEN 0
          WHEN c.strong_department IS NOT NULL AND j.department LIKE '%' || c.strong_department || '%' THEN 1
          WHEN c.top_department IS NOT NULL AND split_part(j.department, ' / ', 1) = c.top_department THEN 2
          ELSE 3
        END,
        CASE
          WHEN lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_norm THEN 0
          WHEN lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_core THEN 1
          ELSE 2
        END,
        j.id
    ) AS rn
  FROM candidate_norm c
  JOIN job_requisitions j
    ON (
      (c.preferred_requisition_id IS NOT NULL AND j.id = c.preferred_requisition_id)
      OR lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_norm
      OR lower(regexp_replace(j.position_title, '\\s+', '', 'g')) = c.pos_core
      OR c.pos_norm = lower(regexp_replace(split_part(j.department, ' / ', 1) || j.position_title, '\\s+', '', 'g'))
      OR c.pos_core = lower(regexp_replace(split_part(j.department, ' / ', 1) || j.position_title, '\\s+', '', 'g'))
      OR (
        c.pos_core <> ''
        AND (
          lower(regexp_replace(j.position_title, '\\s+', '', 'g')) LIKE '%' || c.pos_core || '%'
          OR c.pos_core LIKE '%' || lower(regexp_replace(j.position_title, '\\s+', '', 'g')) || '%'
        )
      )
    )
   AND j.status <> 'cancelled'
)
UPDATE candidates c
SET job_requisition_id = m.job_requisition_id
FROM matched m
WHERE c.id = m.candidate_id
  AND m.rn = 1
  AND c.job_requisition_id IS NULL;

SELECT id, name, department, applied_position, job_requisition_id
FROM candidates
ORDER BY id DESC
LIMIT 20;`;

function patchWorkflow1(filePath) {
  const workflow = readJson(filePath);
  updateWorkflowNodes(workflow, (node) => {
    if (node.type === 'n8n-nodes-base.code' && node.name === 'Code：萃取基本資訊' && typeof node.parameters?.jsCode === 'string') {
      node.parameters.jsCode = extractJs;
    }
    if (typeof node.parameters?.query === 'string' && node.parameters.query.includes('INSERT INTO candidates')) {
      node.parameters.query = candidateQuery;
    }
  });
  writeJson(filePath, workflow);
}

function patchDashboardApi(filePath) {
  const workflow = readJson(filePath);
  updateWorkflowNodes(workflow, (node) => {
    const query = node.parameters?.query;
    if (typeof query !== 'string' || !query.includes(`'jobsData'`)) return;
    let updated = query;
    updated = updated.replace(
      "    c.id,\n    c.name,\n    c.applied_position,\n    c.department,\n    c.status,",
      "    c.id,\n    c.name,\n    c.applied_position,\n    c.department,\n    c.job_requisition_id,\n    c.status,"
    );
    updated = updated.replace(
      "        'name', c.name,\n        'pos', c.applied_position,\n        'dept', c.department,\n",
      "        'name', c.name,\n        'pos', c.applied_position,\n        'dept', c.department,\n        'jobRequisitionId', c.job_requisition_id,\n"
    );
    updated = updated.replace(
      "      GROUP BY c.id, c.name, c.applied_position, c.department, c.status, c.source, c.marker_hr, c.clean_note, c.has_invite_marker",
      "      GROUP BY c.id, c.name, c.applied_position, c.department, c.job_requisition_id, c.status, c.source, c.marker_hr, c.clean_note, c.has_invite_marker"
    );
    updated = updated.replace(
      "      WHERE c.department = j.department\n        AND c.applied_position = j.position_title",
      "      WHERE c.job_requisition_id = j.id\n         OR (\n           c.job_requisition_id IS NULL\n           AND c.department = j.department\n           AND c.applied_position = j.position_title\n         )"
    );
    if (!updated.includes('ADD COLUMN IF NOT EXISTS job_requisition_id')) {
      updated = `${bootstrapQuery}\n${updated}`;
    }
    node.parameters.query = updated;
  });
  writeJson(filePath, workflow);
}

function patchTempDbCheck(filePath) {
  const workflow = readJson(filePath);
  updateWorkflowNodes(workflow, (node) => {
    if (node.type === 'n8n-nodes-base.postgres' && node.parameters?.operation === 'executeQuery') {
      node.parameters.query = migrationQuery;
    }
  });
  writeJson(filePath, workflow);
}

patchWorkflow1(findFile('live_Workflow1_'));
patchDashboardApi(path.join(n8nDir, 'live_Dashboard_API.json'));
patchTempDbCheck(path.join(n8nDir, 'live_temp_db_check.json'));

console.log(JSON.stringify({
  patched: [
    'live_Workflow1_*',
    'live_Dashboard_API.json',
    'live_temp_db_check.json',
  ],
}, null, 2));
