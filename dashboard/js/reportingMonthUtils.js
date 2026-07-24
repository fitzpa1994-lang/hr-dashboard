(function exposeReportingMonthUtils(root) {
  function getReportingMonth(dateValue) {
    const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(dateValue || ''));
    if (!match) return '';
    const month = Number(match[2]);
    if (month < 1 || month > 12) return '';
    return `${match[1]}-${match[2]}`;
  }

  function shiftMonth(month, offset) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function buildReportingMonthWindow(currentDate, count = 6) {
    const currentMonth = getReportingMonth(currentDate);
    const size = Number.isInteger(count) && count > 0 ? count : 6;
    if (!currentMonth) return [];
    return Array.from(
      { length: size },
      (_, index) => shiftMonth(currentMonth, index - size + 1)
    );
  }

  function alignRowsToReportingWindow(rows, currentDate, count = 6) {
    const source = Array.isArray(rows) ? rows : [];
    const rowsByMonth = new Map(
      source
        .filter(row => /^\d{4}-\d{2}$/.test(String(row?.month || '')))
        .map(row => [String(row.month), row])
    );
    return buildReportingMonthWindow(currentDate, count).map(month => ({
      ...(rowsByMonth.get(month) || {}),
      month,
    }));
  }

  function filterRowsToReportingWindow(rows, currentDate, count = 6) {
    const allowedMonths = new Set(buildReportingMonthWindow(currentDate, count));
    return (Array.isArray(rows) ? rows : []).filter(row => (
      allowedMonths.has(String(row?.month || ''))
    ));
  }

  function finiteCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  function aggregateDepartmentFunnelTrend(rows, currentDate, count = 6) {
    const months = buildReportingMonthWindow(currentDate, count);
    const allowedMonths = new Set(months);
    const uniqueDepartmentMonths = new Map();

    for (const row of Array.isArray(rows) ? rows : []) {
      const month = String(row?.month || '');
      if (!allowedMonths.has(month)) continue;
      const department = String(row?.department || '未分類').trim() || '未分類';
      uniqueDepartmentMonths.set(`${month}\u0000${department}`, row);
    }

    const totalsByMonth = new Map(months.map(month => [
      month,
      { month, interview: 0, onboard: 0 },
    ]));
    for (const row of uniqueDepartmentMonths.values()) {
      const total = totalsByMonth.get(String(row.month));
      total.interview += finiteCount(row.interview);
      total.onboard += finiteCount(row.onboard);
    }

    return [...totalsByMonth.values()];
  }

  root.hrReportingMonthUtils = Object.freeze({
    aggregateDepartmentFunnelTrend,
    alignRowsToReportingWindow,
    buildReportingMonthWindow,
    filterRowsToReportingWindow,
    getReportingMonth,
  });
})(globalThis);
