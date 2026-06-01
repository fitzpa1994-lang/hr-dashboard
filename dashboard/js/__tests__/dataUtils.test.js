import { describe, test, expect } from '@jest/globals';
import {
  getTodayOnboard,
  getFutureOnboard,
  getTodayInterviews,
  getWeekResigns,
  getCalendarDots,
  normalizeJobRequisition,
  filterJobRequisitions,
  serializeJobRequisitionPayload,
  analyzeOnboardingRequisitionMatches,
} from '../dataUtils.js';

const TODAY = '2026-05-26';

describe('getTodayOnboard', () => {
  test('只回傳今天且非 cancelled 的報到', () => {
    const data = [
      { date: TODAY, status: 'pending', name: '張三' },
      { date: '2026-05-27', status: 'pending', name: '李四' },
      { date: TODAY, status: 'cancelled', name: '王五' },
      { date: TODAY, status: 'onboarded', name: '趙六' },
    ];
    const result = getTodayOnboard(data, TODAY);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['張三', '趙六']);
  });

  test('無資料時回傳空陣列', () => {
    expect(getTodayOnboard([], TODAY)).toEqual([]);
  });
});

describe('normalizeJobRequisition', () => {
  test('maps 999 open slots to 數名 and keeps open status', () => {
    const job = normalizeJobRequisition({
      pos: 'RF SAR 測試工程師',
      dept: '五部',
      headcount: 999,
      cands: 3,
      hired: 1,
      status: 'open',
      note: '數名',
    });

    expect(job.openSlots).toBe(999);
    expect(job.displayOpenSlots).toBe('數名');
    expect(job.displayStatus).toBe('open');
    expect(job.candidateCount).toBe(3);
    expect(job.hiredCount).toBe(1);
  });

  test('treats zero slots as closed', () => {
    const job = normalizeJobRequisition({
      pos: 'PM',
      dept: '新華',
      headcount: 0,
      status: 'cancelled',
    });

    expect(job.displayStatus).toBe('closed');
    expect(job.isClosed).toBe(true);
  });
});

describe('filterJobRequisitions', () => {
  test('filters by derived display status', () => {
    const jobs = [
      { pos: 'A', dept: 'D1', headcount: 2, status: 'open' },
      { pos: 'B', dept: 'D1', headcount: 0, status: 'cancelled' },
      { pos: 'C', dept: 'D1', headcount: 1, status: 'on_hold' },
      { pos: 'D', dept: 'D1', headcount: 0, status: 'filled' },
    ];

    expect(filterJobRequisitions(jobs, 'all')).toHaveLength(4);
    expect(filterJobRequisitions(jobs, 'open').map(j => j.pos)).toEqual(['A']);
    expect(filterJobRequisitions(jobs, 'closed').map(j => j.pos)).toEqual(['B']);
    expect(filterJobRequisitions(jobs, 'cancelled').map(j => j.pos)).toEqual(['B']);
    expect(filterJobRequisitions(jobs, 'on_hold').map(j => j.pos)).toEqual(['C']);
    expect(filterJobRequisitions(jobs, 'filled').map(j => j.pos)).toEqual(['D']);
  });
});

describe('serializeJobRequisitionPayload', () => {
  test('maps dashboard job data into write API payload', () => {
    const payload = serializeJobRequisitionPayload({
      id: 12,
      pos: 'MIS工程師',
      dept: '汐止/行政',
      headcount: 1,
      status: 'open',
      urgency: 4,
      note: 'HyperV+VMware',
      open: '2026-05-29',
      target: null,
    }, { includeId: true });

    expect(payload).toEqual({
      id: 12,
      department: '汐止/行政',
      positionTitle: 'MIS工程師',
      headcount: 1,
      status: 'open',
      urgency: 4,
      notes: 'HyperV+VMware',
      openDate: '2026-05-29',
      targetDate: null,
    });
  });
});

describe('getFutureOnboard', () => {
  test('回傳未來 pending 報到，按日期排序', () => {
    const data = [
      { date: '2026-06-10', status: 'pending', name: '乙' },
      { date: '2026-06-01', status: 'pending', name: '甲' },
      { date: TODAY, status: 'pending', name: '丙' },
      { date: '2026-06-05', status: 'cancelled', name: '丁' },
    ];
    const result = getFutureOnboard(data, TODAY);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('甲');
    expect(result[1].name).toBe('乙');
  });
});

describe('getTodayInterviews', () => {
  test('只回傳今天的面試事件', () => {
    const events = [
      { type: 'interview', date: TODAY, name: 'A' },
      { type: 'onboard', date: TODAY, name: 'B' },
      { type: 'interview', date: '2026-05-27', name: 'C' },
    ];
    const result = getTodayInterviews(events, TODAY);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('A');
  });
});

describe('getCalendarDots', () => {
  test('同一天多種事件各有對應顏色 key', () => {
    const events = [
      { type: 'interview', date: TODAY },
      { type: 'onboard', date: TODAY },
      { type: 'resign', date: '2026-05-27' },
    ];
    const dots = getCalendarDots(events);
    expect(dots[TODAY].has('interview')).toBe(true);
    expect(dots[TODAY].has('onboard')).toBe(true);
    expect(dots['2026-05-27'].has('resign')).toBe(true);
  });
});
