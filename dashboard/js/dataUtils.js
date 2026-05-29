export function getTodayOnboard(onboardData, today) {
  return onboardData.filter(o => o.date === today && o.status !== 'cancelled');
}

export function getFutureOnboard(onboardData, today) {
  return onboardData
    .filter(o => o.date > today && o.status === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getTodayInterviews(schedEvents, today) {
  return schedEvents.filter(e => e.type === 'interview' && e.date === today);
}

export function getWeekResigns(schedEvents, weekStart, weekEnd) {
  return schedEvents.filter(
    e => e.type === 'resign' && e.date >= weekStart && e.date <= weekEnd
  );
}

export function getCalendarDots(schedEvents) {
  const dots = {};
  for (const e of schedEvents) {
    if (!dots[e.date]) dots[e.date] = new Set();
    dots[e.date].add(e.type);
  }
  return dots;
}

export function normalizeJobRequisition(job) {
  const rawSlots = Number(job?.headcount ?? 0);
  const openSlots = Number.isFinite(rawSlots) ? Math.max(0, rawSlots) : 0;
  const candidateCount = Number(job?.cands ?? 0) || 0;
  const hiredCount = Number(job?.hired ?? 0) || 0;
  const status = String(job?.status || '');

  let displayStatus = 'closed';
  if (status === 'on_hold') {
    displayStatus = 'on_hold';
  } else if (status === 'filled') {
    displayStatus = 'filled';
  } else if (status === 'open' && openSlots > 0) {
    displayStatus = 'open';
  }

  return {
    ...job,
    openSlots,
    candidateCount,
    hiredCount,
    displayStatus,
    displayOpenSlots: openSlots >= 999 ? '數名' : String(openSlots),
    isClosed: displayStatus === 'closed',
    noteText: String(job?.note || '').trim(),
  };
}

export function filterJobRequisitions(jobs, filter = 'all') {
  const normalized = jobs.map(normalizeJobRequisition);
  if (filter === 'all') return normalized;
  if (filter === 'cancelled') {
    return normalized.filter(job => job.displayStatus === 'closed');
  }
  return normalized.filter(job => job.displayStatus === filter || String(job.status || '') === filter);
}

export function serializeJobRequisitionPayload(job, { includeId = false } = {}) {
  const normalized = normalizeJobRequisition(job);
  return {
    ...(includeId ? { id: Number(job?.id) } : {}),
    department: String(job?.dept ?? job?.department ?? '').trim(),
    positionTitle: String(job?.pos ?? job?.positionTitle ?? job?.position_title ?? '').trim(),
    headcount: normalized.openSlots,
    status: normalized.displayStatus === 'closed' ? 'cancelled' : String(job?.status || normalized.displayStatus),
    urgency: Number(job?.urgency ?? 3) || 3,
    notes: String(job?.note ?? job?.notes ?? '').trim(),
    openDate: job?.open ?? job?.openDate ?? job?.open_date ?? null,
    targetDate: job?.target ?? job?.targetDate ?? job?.target_date ?? null,
  };
}
