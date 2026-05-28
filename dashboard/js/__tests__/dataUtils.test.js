import { describe, test, expect } from '@jest/globals';
import {
  getTodayOnboard,
  getFutureOnboard,
  getTodayInterviews,
  getWeekResigns,
  getCalendarDots,
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
