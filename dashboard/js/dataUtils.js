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
