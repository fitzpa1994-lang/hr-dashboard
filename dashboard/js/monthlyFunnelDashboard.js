import {
  aggregateMonthlyFunnel,
  calculateMonthDelta,
  deltaTone,
  formatConversionRate,
  formatDeltaPeople,
  formatDeltaPercentage,
  formatMonthLabel,
  getFunnelRowKey,
  listFunnelFilters,
} from './monthlyFunnelUtils.js';

const METRICS = [
  { key: 'recommend', label: '推薦數量', shortLabel: '推薦', icon: 'send', color: '#2563EB' },
  { key: 'interview', label: '面試數量', shortLabel: '面試', icon: 'messages-square', color: '#7C3AED' },
  { key: 'onboard', label: '到職數量', shortLabel: '到職', icon: 'user-check', color: '#15803D' },
  { key: 'resign', label: '離職數量', shortLabel: '離職', icon: 'user-minus', color: '#B91C1C' },
];

const state = {
  granularity: 'department',
  selectedKey: 'all',
  range: 6,
};

const trendCharts = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getRows() {
  return state.granularity === 'job'
    ? (window._monthlyFunnelByJob || [])
    : (window._monthlyFunnelByDepartment || []);
}

function currentModel() {
  return aggregateMonthlyFunnel(getRows(), {
    granularity: state.granularity,
    selectedKey: state.selectedKey,
    range: state.range,
  });
}

function selectedLabel() {
  if (state.selectedKey === 'all') {
    return state.granularity === 'job' ? '全部職缺' : '全部部門';
  }
  const row = getRows().find(item => getFunnelRowKey(item, state.granularity) === state.selectedKey);
  if (!row) return '全部';
  return state.granularity === 'job'
    ? `${row.department || '未分類'} · ${row.position_title || '未命名職缺'}`
    : (row.department || '未分類');
}

function sparklineSvg(values, color, label) {
  const numericValues = values.filter(value => Number.isFinite(value));
  if (!numericValues.length) {
    return '<div class="funnel-sparkline-empty" aria-hidden="true">資料不足</div>';
  }
  const width = 116;
  const height = 38;
  const padding = 3;
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const range = Math.max(1, max - min);
  const denominator = Math.max(1, values.length - 1);
  const points = values.map((value, index) => {
    const normalized = Number.isFinite(value) ? value : min;
    const x = padding + (index / denominator) * (width - padding * 2);
    const y = height - padding - ((normalized - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastPoint = points.split(' ').at(-1)?.split(',') || [width - padding, height / 2];
  return `
    <svg class="funnel-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="2.75" fill="${color}" stroke="#fff" stroke-width="1.5"></circle>
    </svg>`;
}

function renderFilterOptions() {
  const select = document.getElementById('funnel-dimension-filter');
  const label = document.getElementById('funnel-dimension-label');
  if (!select || !label) return;

  const options = listFunnelFilters(getRows(), state.granularity);
  if (state.selectedKey !== 'all' && !options.some(option => option.value === state.selectedKey)) {
    state.selectedKey = 'all';
  }
  label.textContent = state.granularity === 'job' ? '職缺' : '部門';
  select.setAttribute('aria-label', state.granularity === 'job' ? '篩選職缺' : '篩選部門');
  select.innerHTML = [
    `<option value="all">${state.granularity === 'job' ? '全部職缺' : '全部部門'}</option>`,
    ...options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`),
  ].join('');
  select.value = state.selectedKey;
}

function renderControlState() {
  document.querySelectorAll('[data-funnel-granularity]').forEach(button => {
    const active = button.dataset.funnelGranularity === state.granularity;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-funnel-range]').forEach(button => {
    const active = Number(button.dataset.funnelRange) === state.range;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderHeading(model) {
  const period = document.getElementById('funnel-reporting-period');
  const note = document.getElementById('funnel-granularity-note');
  if (period) {
    period.textContent = model.latestMonth
      ? `${formatMonthLabel(model.latestMonth, true)} · ${selectedLabel()}`
      : '尚無可用月份';
  }
  if (note) {
    note.textContent = state.granularity === 'job'
      ? '職缺維度的正式資料只涵蓋推薦與面試；到職、離職不以名稱模糊比對推估。'
      : `顯示最近 ${state.range} 個月；本月以所選範圍內最新月份計算。`;
  }
}

function renderKpis(model) {
  const container = document.getElementById('funnel-kpi-grid');
  if (!container) return;
  if (!model.series.length) {
    container.innerHTML = '<div class="funnel-empty-state">目前篩選條件沒有月度資料</div>';
    return;
  }

  const current = model.series.at(-1);
  const previous = model.series.at(-2);
  container.innerHTML = METRICS.map(metric => {
    const currentValue = current?.[metric.key] ?? null;
    const previousValue = previous?.[metric.key] ?? null;
    const delta = calculateMonthDelta(currentValue, previousValue);
    const tone = deltaTone(metric.key, delta);
    const available = model.availability[metric.key];
    const sparkValues = model.series.slice(-6).map(row => row[metric.key]);
    const sparkLabel = `${metric.shortLabel}最近六個月：${sparkValues.map(value => value ?? '無資料').join('、')}`;
    return `
      <article class="funnel-kpi-card metric-${metric.key}" aria-label="${metric.label}">
        <div class="funnel-kpi-head">
          <span class="funnel-kpi-label"><i data-lucide="${metric.icon}" aria-hidden="true"></i>${metric.label}</span>
          <span class="funnel-kpi-month">${escapeHtml(formatMonthLabel(model.latestMonth))}</span>
        </div>
        <div class="funnel-kpi-main">
          <div>
            <div class="funnel-kpi-value">${available ? currentValue : '—'}${available ? '<span>人</span>' : ''}</div>
            <div class="funnel-kpi-delta tone-${tone}">
              <span>${available ? escapeHtml(formatDeltaPeople(delta)) : '無職缺層級資料'}</span>
              <strong>${available ? escapeHtml(formatDeltaPercentage(delta)) : '—'}</strong>
            </div>
          </div>
          ${sparklineSvg(available ? sparkValues : [], metric.color, sparkLabel)}
        </div>
      </article>`;
  }).join('');
}

function destroyTrendCharts() {
  for (const chart of trendCharts.values()) chart.destroy();
  trendCharts.clear();
}

function tooltipDeltaLabel(metric, context) {
  const index = context.dataIndex;
  const data = context.chart.$metricSeries || [];
  const delta = calculateMonthDelta(data[index], index > 0 ? data[index - 1] : null);
  if (delta.kind === 'unavailable') return '較上月：—';
  const people = formatDeltaPeople(delta);
  const percentage = formatDeltaPercentage(delta);
  return percentage === '—' ? `較上月：${people}` : `較上月：${people}（${percentage}）`;
}

function renderTrendCharts(model) {
  destroyTrendCharts();
  const empty = document.getElementById('funnel-trend-empty');
  const grid = document.getElementById('funnel-trend-grid');
  if (!model.series.length || typeof window.Chart !== 'function') {
    if (empty) empty.hidden = false;
    if (grid) grid.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (grid) grid.hidden = false;

  const labels = model.series.map(row => formatMonthLabel(row.month));
  const latestIndex = model.series.length - 1;
  const css = getComputedStyle(document.documentElement);
  const gridColor = css.getPropertyValue('--viz-grid').trim() || '#E7E5E1';
  const textColor = css.getPropertyValue('--muted').trim() || '#57534E';

  for (const metric of METRICS) {
    const canvas = document.getElementById(`funnel-trend-${metric.key}`);
    const summary = document.getElementById(`funnel-trend-summary-${metric.key}`);
    if (!canvas) continue;
    const values = model.series.map(row => row[metric.key]);
    const available = model.availability[metric.key];
    const summaryText = available
      ? model.series.map((row, index) => `${formatMonthLabel(row.month)} ${values[index]} 人`).join('；')
      : '此維度沒有可靠資料';
    canvas.setAttribute('aria-label', `${metric.label}月度長條圖。${summaryText}`);
    if (summary) summary.textContent = summaryText;

    if (!available) {
      canvas.hidden = true;
      canvas.parentElement?.classList.add('is-unavailable');
      continue;
    }
    canvas.hidden = false;
    canvas.parentElement?.classList.remove('is-unavailable');
    const baseColor = `${metric.color}A6`;
    const backgroundColors = values.map((_, index) => index === latestIndex ? metric.color : baseColor);
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: metric.shortLabel,
          data: values,
          backgroundColor: backgroundColors,
          hoverBackgroundColor: metric.color,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 34,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            backgroundColor: '#172033',
            titleColor: '#FFFFFF',
            bodyColor: '#F8FAFC',
            padding: 12,
            cornerRadius: 6,
            callbacks: {
              title: items => items[0]?.label || '',
              label: context => `${metric.shortLabel}：${context.parsed.y} 人`,
              afterLabel: context => tooltipDeltaLabel(metric.key, context),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: textColor, maxRotation: 0, autoSkip: true, font: { size: 10 } },
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: gridColor },
            ticks: { color: textColor, precision: 0, font: { size: 10 } },
          },
        },
      },
    });
    chart.$metricSeries = values;
    trendCharts.set(metric.key, chart);
  }
}

function renderFunnel(model) {
  const container = document.getElementById('funnel-conversion-content');
  if (!container) return;
  const current = model.series.at(-1);
  const available = current
    && model.availability.recommend
    && model.availability.interview
    && model.availability.onboard;
  if (!available) {
    container.innerHTML = '<div class="funnel-empty-state compact">目前篩選維度沒有完整的推薦、面試與到職資料</div>';
    return;
  }

  const stages = [
    { key: 'recommend', label: '推薦', value: current.recommend, icon: 'send' },
    { key: 'interview', label: '面試', value: current.interview, icon: 'messages-square' },
    { key: 'onboard', label: '到職', value: current.onboard, icon: 'user-check' },
  ];
  const rates = [
    { label: '面試率', value: formatConversionRate(current.interview, current.recommend) },
    { label: '面試到職率', value: formatConversionRate(current.onboard, current.interview) },
    { label: '推薦到職率', value: formatConversionRate(current.onboard, current.recommend) },
  ];

  container.innerHTML = `
    <div class="funnel-stage-flow" aria-label="本月招募漏斗">
      ${stages.map((stage, index) => `
        ${index ? '<i data-lucide="chevron-right" class="funnel-stage-arrow" aria-hidden="true"></i>' : ''}
        <div class="funnel-stage metric-${stage.key}">
          <span class="funnel-stage-icon"><i data-lucide="${stage.icon}" aria-hidden="true"></i></span>
          <span class="funnel-stage-label">${stage.label}</span>
          <strong>${stage.value}<small>人</small></strong>
        </div>`).join('')}
    </div>
    <dl class="funnel-rate-list">
      ${rates.map(rate => `
        <div>
          <dt>${rate.label}</dt>
          <dd>${rate.value}</dd>
        </div>`).join('')}
    </dl>`;
}

function renderDetailTable(model) {
  const body = document.getElementById('funnel-detail-body');
  const caption = document.getElementById('funnel-detail-caption');
  if (!body || !caption) return;
  caption.textContent = `${selectedLabel()}，最近 ${state.range} 個月`;
  if (!model.series.length) {
    body.innerHTML = '<tr><td colspan="9" class="funnel-detail-empty">目前沒有明細資料</td></tr>';
    return;
  }

  body.innerHTML = [...model.series].reverse().map((row, rowIndex, reversed) => {
    const originalIndex = model.series.length - 1 - rowIndex;
    const previous = originalIndex > 0 ? model.series[originalIndex - 1] : null;
    const metricCells = METRICS.map(metric => {
      const available = model.availability[metric.key];
      const value = row[metric.key];
      const delta = calculateMonthDelta(value, previous?.[metric.key] ?? null);
      const tone = deltaTone(metric.key, delta);
      const deltaText = available
        ? `${formatDeltaPeople(delta)}${formatDeltaPercentage(delta) !== '—' ? ` · ${formatDeltaPercentage(delta)}` : ''}`
        : '—';
      return `
        <td data-label="${metric.shortLabel}">${available ? value : '—'}</td>
        <td data-label="${metric.shortLabel}較上月" class="tone-${tone}">${escapeHtml(deltaText)}</td>`;
    }).join('');
    return `
      <tr class="${rowIndex === 0 ? 'is-latest' : ''}">
        <th scope="row" data-label="月份">${escapeHtml(formatMonthLabel(row.month, true))}</th>
        ${metricCells}
      </tr>`;
  }).join('');
}

function renderMonthlyFunnel() {
  const root = document.getElementById('monthly-funnel-dashboard');
  if (!root) return;
  renderFilterOptions();
  renderControlState();
  const model = currentModel();
  renderHeading(model);
  renderKpis(model);
  renderTrendCharts(model);
  renderFunnel(model);
  renderDetailTable(model);
  window.lucide?.createIcons();
}

function setFunnelGranularity(granularity) {
  if (!['department', 'job'].includes(granularity)) return;
  state.granularity = granularity;
  state.selectedKey = 'all';
  renderMonthlyFunnel();
}

function bindControls() {
  document.querySelectorAll('[data-funnel-granularity]').forEach(button => {
    button.addEventListener('click', () => setFunnelGranularity(button.dataset.funnelGranularity));
  });
  document.querySelectorAll('[data-funnel-range]').forEach(button => {
    button.addEventListener('click', () => {
      state.range = Number(button.dataset.funnelRange) === 12 ? 12 : 6;
      renderMonthlyFunnel();
    });
  });
  document.getElementById('funnel-dimension-filter')?.addEventListener('change', event => {
    state.selectedKey = event.target.value || 'all';
    renderMonthlyFunnel();
  });
}

window.renderMonthlyFunnel = renderMonthlyFunnel;
window.setFunnelGranularity = setFunnelGranularity;
window.addEventListener('hr-dashboard-data-loaded', renderMonthlyFunnel);

bindControls();
if ((window._monthlyFunnelByDepartment || []).length || (window._monthlyFunnelByJob || []).length) {
  renderMonthlyFunnel();
}
