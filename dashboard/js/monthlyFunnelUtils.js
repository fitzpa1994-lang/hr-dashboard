const METRIC_FIELDS = ['recommend', 'interview', 'onboard', 'resign'];

function finiteCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

export function calculateMonthDelta(currentValue, previousValue) {
  const current = finiteCount(currentValue);
  const previous = finiteCount(previousValue);

  if (current === null || previous === null) {
    return { kind: 'unavailable', current, previous, difference: null, percentage: null };
  }

  const difference = current - previous;
  if (previous === 0) {
    if (current === 0) {
      return { kind: 'flat', current, previous, difference: 0, percentage: 0 };
    }
    return { kind: 'new', current, previous, difference, percentage: null };
  }

  const percentage = Math.round((difference / previous) * 100);
  if (difference === 0) {
    return { kind: 'flat', current, previous, difference: 0, percentage: 0 };
  }

  return {
    kind: difference > 0 ? 'increase' : 'decrease',
    current,
    previous,
    difference,
    percentage,
  };
}

export function formatDeltaPeople(delta) {
  if (!delta || delta.kind === 'unavailable') return '無上月資料';
  if (delta.kind === 'flat') return '持平';
  if (delta.kind === 'new') return `新增 ${delta.current} 人`;
  if (delta.kind === 'increase') return `增加 ${delta.difference} 人`;
  return `減少 ${Math.abs(delta.difference)} 人`;
}

export function formatDeltaPercentage(delta) {
  if (!delta || delta.kind === 'unavailable' || delta.kind === 'new') return '—';
  if (delta.kind === 'flat') return '0%';
  return `${delta.percentage > 0 ? '+' : ''}${delta.percentage}%`;
}

export function deltaTone(metric, delta) {
  if (!delta || ['unavailable', 'flat'].includes(delta.kind)) return 'neutral';
  const increased = ['new', 'increase'].includes(delta.kind);
  if (metric === 'resign') return increased ? 'negative' : 'positive';
  return increased ? 'positive' : 'negative';
}

export function formatConversionRate(numeratorValue, denominatorValue) {
  const numerator = finiteCount(numeratorValue);
  const denominator = finiteCount(denominatorValue);
  if (numerator === null || denominator === null || denominator === 0) return '—';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function getFunnelRowKey(row, granularity) {
  if (granularity === 'job') {
    const id = finiteCount(row?.job_requisition_id);
    if (id !== null) return `job:${id}`;
    const department = encodeURIComponent(String(row?.department || ''));
    const position = encodeURIComponent(String(row?.position_title || ''));
    return `job:${department}::${position}`;
  }
  return `department:${String(row?.department || '未分類')}`;
}

export function getFunnelRowLabel(row, granularity) {
  if (granularity === 'job') {
    const department = String(row?.department || '未分類');
    const position = String(row?.position_title || '未命名職缺');
    return `${department} · ${position}`;
  }
  return String(row?.department || '未分類');
}

export function listFunnelFilters(rows, granularity) {
  const options = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = getFunnelRowKey(row, granularity);
    if (!options.has(key)) options.set(key, getFunnelRowLabel(row, granularity));
  }
  return [...options.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
}

function shiftMonth(month, offset) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildMonthWindow(latestMonth, count) {
  const size = count === 12 ? 12 : 6;
  if (!/^\d{4}-\d{2}$/.test(String(latestMonth || ''))) return [];
  return Array.from({ length: size }, (_, index) => shiftMonth(latestMonth, index - size + 1));
}

export function getMonthKey(dateValue) {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(dateValue || ''));
  if (!match) return '';
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return `${match[1]}-${match[2]}`;
}

export function aggregateMonthlyFunnel(rows, {
  granularity = 'department',
  selectedKey = 'all',
  range = 6,
  currentMonth = '',
} = {}) {
  const source = (Array.isArray(rows) ? rows : []).filter(row => (
    selectedKey === 'all' || getFunnelRowKey(row, granularity) === selectedKey
  ));
  const sourceMonths = source
    .map(row => String(row?.month || ''))
    .filter(month => /^\d{4}-\d{2}$/.test(month))
    .sort();
  const reportingMonth = getMonthKey(currentMonth) || sourceMonths.at(-1) || '';
  const months = buildMonthWindow(reportingMonth, range);

  const availability = Object.fromEntries(
    METRIC_FIELDS.map(field => [
      field,
      source.some(row => finiteCount(row?.[field]) !== null),
    ])
  );

  const monthMap = new Map(months.map(month => [
    month,
    { month, recommend: 0, interview: 0, onboard: 0, resign: 0 },
  ]));

  for (const row of source) {
    const target = monthMap.get(String(row?.month || ''));
    if (!target) continue;
    for (const field of METRIC_FIELDS) {
      const value = finiteCount(row?.[field]);
      if (value !== null) target[field] += value;
    }
  }

  const series = [...monthMap.values()].map(row => {
    const result = { month: row.month };
    for (const field of METRIC_FIELDS) {
      result[field] = availability[field] ? row[field] : null;
    }
    return result;
  });

  return {
    reportingMonth,
    // Compatibility alias for callers using the original aggregate model.
    latestMonth: reportingMonth,
    series,
    availability,
  };
}

export function formatMonthLabel(month, includeYear = false) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return String(month || '—');
  return includeYear ? `${match[1]} 年 ${Number(match[2])} 月` : `${Number(match[2])} 月`;
}
