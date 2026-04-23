import { type BenchmarkChart, type BenchmarkChartPoint, type BenchmarkChartSeries } from "../types.ts";

const FONT_FAMILY = "'IBM Plex Sans', 'Segoe UI', sans-serif";
const CHART_WIDTH = 1400;
const CHART_HEIGHT = 1080;
const X_AXIS_TICK_STEP = 200;
const LEGEND_COLUMNS = 3;
const LEGEND_COLUMN_WIDTH = 340;
const LEGEND_ROW_HEIGHT = 50;
const LEGEND_LINE_WIDTH = 32;
const CHART_MARGIN = {
  top: 120,
  right: 56,
  bottom: 240,
  left: 104,
};
const COLOR_BY_SERIES_KEY = {
  "binary-split:min": "#93c5fd",
  "binary-split:avg": "#3b82f6",
  "binary-split:max": "#1d4ed8",
  "leave-one-out:min": "#fca5a5",
  "leave-one-out:avg": "#ef4444",
  "leave-one-out:max": "#b91c1c",
} as const;
const STROKE_DASHARRAY_BY_METRIC = {
  min: "none",
  avg: "10 8",
  max: "none",
} as const;

interface ChartLineMetric {
  key: "max" | "avg" | "min";
  label: string;
  valueOf: (point: BenchmarkChartPoint) => number;
}

const CHART_LINE_METRICS: readonly ChartLineMetric[] = [
  {
    key: "min",
    label: "min",
    valueOf: (point) => point.minQuestions,
  },
  {
    key: "avg",
    label: "avg",
    valueOf: (point) => point.averageQuestionsValue,
  },
  {
    key: "max",
    label: "max",
    valueOf: (point) => point.maxQuestions,
  },
];

export function renderBenchmarkChartSvg(chart: BenchmarkChart): string {
  const allPoints = chart.series.flatMap((series) => series.points);
  if (allPoints.length === 0) {
    throw new Error(`Cannot render chart "${chart.id}" without any points`);
  }

  const xValues = allPoints.map((point) => point.targetCount);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMax = getNiceUpperBound(
    Math.max(...allPoints.map((point) => Math.max(point.maxQuestions, point.averageQuestionsValue))),
  );
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const xRange = Math.max(xMax - xMin, 1);
  const yRange = Math.max(yMax, 1);
  const xTickValues = getFixedStepTicks(xMin, xMax, X_AXIS_TICK_STEP);
  const yTickValues = getLinearTicks(yMax, 6);
  const legendStartX = CHART_MARGIN.left + Math.max((plotWidth - LEGEND_COLUMNS * LEGEND_COLUMN_WIDTH) / 2, 0);
  const legendStartY = CHART_MARGIN.top + plotHeight + 126;

  const gridLines = yTickValues
    .map((tickValue) => {
      const y = scaleY(tickValue, yRange, plotHeight);
      return [
        `<line x1="${CHART_MARGIN.left}" y1="${y}" x2="${CHART_MARGIN.left + plotWidth}" y2="${y}" class="grid" />`,
        `<text x="${CHART_MARGIN.left - 12}" y="${y + 5}" text-anchor="end" class="axis-label">${escapeXml(
          String(tickValue),
        )}</text>`,
      ].join("");
    })
    .join("");

  const xTicks = xTickValues
    .map((tickValue) => {
      const x = scaleX(tickValue, xMin, xRange, plotWidth);
      return [
        `<line x1="${x}" y1="${CHART_MARGIN.top + plotHeight}" x2="${x}" y2="${CHART_MARGIN.top + plotHeight + 8}" class="axis" />`,
        `<text x="${x}" y="${CHART_MARGIN.top + plotHeight + 28}" text-anchor="middle" class="axis-label">${escapeXml(
          String(tickValue),
        )}</text>`,
      ].join("");
    })
    .join("");

  const linePaths = chart.series.flatMap((series) =>
    CHART_LINE_METRICS.map((metric) => renderSeriesPath(series, metric, xMin, xRange, yRange, plotWidth, plotHeight)),
  );

  const legendItems = chart.series.flatMap((series, seriesIndex) =>
    CHART_LINE_METRICS.map((metric, metricIndex) => {
      const legendIndex = seriesIndex * CHART_LINE_METRICS.length + metricIndex;
      const column = legendIndex % LEGEND_COLUMNS;
      const row = Math.floor(legendIndex / LEGEND_COLUMNS);
      const x = legendStartX + column * LEGEND_COLUMN_WIDTH;
      const y = legendStartY + row * LEGEND_ROW_HEIGHT;
      const color = COLOR_BY_SERIES_KEY[`${series.algorithm}:${metric.key}`];
      const dasharray = STROKE_DASHARRAY_BY_METRIC[metric.key];

      return [
        `<line x1="${x}" y1="${y}" x2="${x + LEGEND_LINE_WIDTH}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round"${dasharray === "none" ? "" : ` stroke-dasharray="${dasharray}"`} />`,
        `<text x="${x + LEGEND_LINE_WIDTH + 14}" y="${y + 6}" class="legend-text">${escapeXml(`${series.algorithm} ${metric.label}`)}</text>`,
      ].join("");
    }),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-labelledby="${chart.id}-title ${chart.id}-desc">
  <title id="${chart.id}-title">${escapeXml(chart.title)}</title>
  <desc id="${chart.id}-desc">${escapeXml(chart.description)}</desc>
  <style>
    text {
      fill: #0f172a;
      font-family: ${FONT_FAMILY};
    }
    .title {
      font-size: 46px;
      font-weight: 700;
    }
    .subtitle {
      fill: #475569;
      font-size: 28px;
    }
    .axis-title {
      fill: #334155;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .axis-label {
      fill: #475569;
      font-size: 22px;
    }
    .legend-text {
      fill: #1e293b;
      font-size: 24px;
      font-weight: 600;
    }
    .grid {
      stroke: #e2e8f0;
      stroke-width: 1;
    }
    .axis {
      stroke: #94a3b8;
      stroke-width: 1.5;
    }
    .plot-bg {
      fill: url(#plotGradient);
      stroke: #cbd5e1;
      stroke-width: 1.5;
    }
  </style>
  <defs>
    <linearGradient id="plotGradient" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#eef2ff" />
    </linearGradient>
  </defs>
  <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#ffffff" />
  <text x="${CHART_MARGIN.left}" y="54" class="title">${escapeXml(chart.title)}</text>
  <text x="${CHART_MARGIN.left}" y="94" class="subtitle">${escapeXml(chart.description)}</text>
  <rect x="${CHART_MARGIN.left}" y="${CHART_MARGIN.top}" width="${plotWidth}" height="${plotHeight}" class="plot-bg" />
  ${gridLines}
  <line x1="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top + plotHeight}" x2="${CHART_MARGIN.left + plotWidth}" y2="${CHART_MARGIN.top + plotHeight}" class="axis" />
  <line x1="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top}" x2="${CHART_MARGIN.left}" y2="${CHART_MARGIN.top + plotHeight}" class="axis" />
  ${xTicks}
  ${linePaths.join("")}
  <text x="${CHART_MARGIN.left + plotWidth / 2}" y="${CHART_MARGIN.top + plotHeight + 82}" text-anchor="middle" class="axis-title">${escapeXml(chart.xAxisLabel)}</text>
  ${legendItems.join("")}
  <text x="28" y="${CHART_MARGIN.top + plotHeight / 2}" transform="rotate(-90 28 ${CHART_MARGIN.top + plotHeight / 2})" text-anchor="middle" class="axis-title">${escapeXml(chart.yAxisLabel)}</text>
</svg>`;

  function scaleX(targetCount: number, min: number, range: number, width: number): number {
    return CHART_MARGIN.left + ((targetCount - min) / range) * width;
  }

  function scaleY(value: number, range: number, height: number): number {
    return CHART_MARGIN.top + height - (value / range) * height;
  }

  function renderSeriesPath(
    series: BenchmarkChartSeries,
    metric: ChartLineMetric,
    min: number,
    range: number,
    yAxisRange: number,
    width: number,
    height: number,
  ): string {
    const color = COLOR_BY_SERIES_KEY[`${series.algorithm}:${metric.key}`];
    const dasharray = STROKE_DASHARRAY_BY_METRIC[metric.key];
    const path = series.points
      .map((point, pointIndex) => {
        const x = scaleX(point.targetCount, min, range, width).toFixed(2);
        const y = scaleY(metric.valueOf(point), yAxisRange, height).toFixed(2);
        return `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${metric.key === "avg" ? 4 : 3}" stroke-linecap="round" stroke-linejoin="round"${dasharray === "none" ? "" : ` stroke-dasharray="${dasharray}"`} />`;
  }
}

function getFixedStepTicks(min: number, max: number, step: number): number[] {
  if (min === max) {
    return [min];
  }

  const tickValues = new Set<number>([min, max]);
  const firstAlignedTick = Math.ceil(min / step) * step;

  for (let value = firstAlignedTick; value <= max; value += step) {
    if (value !== min && value !== max && max - value < step * 0.2) {
      continue;
    }

    tickValues.add(value);
  }

  return [...tickValues].sort((left, right) => left - right);
}

function getLinearTicks(maxValue: number, desiredTickCount: number): number[] {
  if (maxValue <= 0) {
    return [0];
  }

  const step = getNiceStep(maxValue / Math.max(desiredTickCount - 1, 1));
  const tickValues: number[] = [];

  for (let value = 0; value <= maxValue + step / 2; value += step) {
    tickValues.push(value);
  }

  return tickValues;
}

function getNiceUpperBound(value: number): number {
  if (value <= 1) {
    return 1;
  }

  const step = getNiceStep(value / 5);
  return Math.ceil(value / step) * step;
}

function getNiceStep(value: number): number {
  if (value <= 1) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(value));
  const scale = 10 ** exponent;
  const fraction = value / scale;

  if (fraction <= 1) {
    return scale;
  }

  if (fraction <= 2) {
    return 2 * scale;
  }

  if (fraction <= 5) {
    return 5 * scale;
  }

  return 10 * scale;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
