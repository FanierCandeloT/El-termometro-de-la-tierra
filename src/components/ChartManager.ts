// ChartManager: gráfico principal (Chart.js) de la temperatura global.
//
//  - Vista anual (desde 1926) y vista mensual (zoom) con valores relativos a 1880-1900.
//  - Animación que "desenrolla" la serie en el tiempo (revela los puntos gradualmente).
//  - Zoom a vista mensual: arrastrar sobre el gráfico para elegir un rango.
//  - Clic: selecciona el punto más cercano, lo marca con un pulso visual y avisa con
//    onSelect (main.ts reproduce el sonido y muestra el InfoPanel).
//  - Umbrales del Acuerdo de París (+1,5 °C y +2,0 °C) en Hot Pink.
//  - Responsive: el canvas se ajusta al contenedor (maintainAspectRatio: false).
//
// Los datos originales de NASA son anomalías vs 1951-1980; aquí se grafica el valor
// `relative` (vs 1880-1900) y el tooltip muestra también la anomalía original.
import {
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type Plugin,
  type TooltipItem,
} from 'chart.js';
import type { ChartMode, ChartSelection, ChartView, TemperatureData, YearRange } from '../types';
import { PARIS_THRESHOLDS } from '../types';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

export const COLORS = {
  navy: '#0F183D',
  white: '#FFFFFF',
  hotPink: '#FF3D8B',
  grid: 'rgba(255, 255, 255, 0.12)',
} as const;

/** Primer año de la vista anual. */
export const ANNUAL_START_YEAR = 1926;

/** Subconjunto de las opciones de los ejes que esta clase modifica en caliente. */
interface AxisOptions {
  min?: number;
  max?: number;
  ticks: {
    stepSize?: number;
    callback: (value: number | string) => string;
  };
  title: { display: boolean };
}

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DRAG_THRESHOLD_PX = 6;
const PULSE_MS = 1300;

interface ChartPoint {
  x: number;
  y: number;
  year: number;
  /** Mes 1-12; solo en vista mensual. */
  month?: number;
  /** Anomalía original de NASA (vs 1951-1980). */
  anomaly: number;
  label: string;
}

export interface ChartManagerOptions {
  /** Se llama cada vez que cambia el modo o el rango visible. */
  onViewChange?: (view: ChartView) => void;
  /** Progreso (0-1), etiqueta del punto actual (p. ej. "1998"), su valor (°C) y el año (decimal) que sincroniza el mapa. */
  onProgress?: (progress: number, label: string, value: number, year: number) => void;
  /** El usuario hizo clic en una zona del gráfico: punto más cercano. */
  onSelect?: (selection: ChartSelection) => void;
  /** Se llama al empezar/terminar la animación. */
  onPlayingChange?: (playing: boolean) => void;
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class ChartManager {
  private readonly chart: Chart<'line', ChartPoint[]>;
  private readonly canvas: HTMLCanvasElement;
  private readonly data: TemperatureData;
  private readonly options: ChartManagerOptions;

  private view: ChartView;
  private lastAnnualRange: YearRange;
  private fullPoints: ChartPoint[] = [];
  private rafId = 0;
  /** true mientras se "desenrolla" el tiempo. */
  private playing = false;
  /** Se incrementa al parar/empezar: un fotograma "viejo" que llegue tarde se descarta. */
  private animationToken = 0;
  private watchdogId = 0;

  private selectedPoint: ChartPoint | null = null;
  private pulseStart = 0;
  private pulseRafId = 0;

  private dragStartPx: number | null = null;
  private selection: { x0: number; x1: number } | null = null;

  constructor(canvas: HTMLCanvasElement, data: TemperatureData, options: ChartManagerOptions = {}) {
    this.canvas = canvas;
    this.data = data;
    this.options = options;
    const start = Math.max(ANNUAL_START_YEAR, data.firstYear);
    this.lastAnnualRange = { startYear: start, endYear: data.lastYear };
    this.view = { mode: 'annual', range: this.lastAnnualRange };

    Chart.defaults.color = COLORS.white;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;

    this.chart = new Chart<'line', ChartPoint[]>(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Temperatura global (vs 1880-1900)',
            data: [],
            borderColor: COLORS.white,
            borderWidth: 2,
            tension: 0.2,
            clip: false,
            pointRadius: (ctx) => this.pointRadius(ctx.raw as ChartPoint | undefined),
            pointHoverRadius: 6,
            pointBackgroundColor: (ctx) => this.pointColor(ctx.raw as ChartPoint | undefined),
            pointBorderColor: (ctx) => this.pointColor(ctx.raw as ChartPoint | undefined),
          },
          ...PARIS_THRESHOLDS.map((t, i) => ({
            label: t.label,
            data: [] as ChartPoint[],
            borderColor: COLORS.hotPink,
            borderWidth: 2,
            borderDash: i === 0 ? [] : [8, 5],
            pointRadius: 0,
            pointHoverRadius: 0,
            clip: false as const,
          })),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // En pantallas estrechas se oculta el título del eje Y para dar espacio al gráfico.
        onResize: (chart, size) => {
          const y = chart.options.scales?.['y'] as unknown as AxisOptions;
          const show = size.width > 560;
          if (y.title.display !== show) {
            y.title.display = show;
            chart.update('none');
          }
        },
        animation: false, // la animación temporal se controla manualmente
        parsing: false,
        layout: { padding: { left: 4, right: 12, top: 8, bottom: 4 } },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: {
            type: 'linear',
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.white, maxRotation: 0 },
          },
          y: {
            type: 'linear',
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.white, callback: (v) => `${Number(v).toFixed(1)}` },
            title: {
              display: true,
              text: 'Anomalía (°C) respecto a la línea base 1880-1900',
              color: COLORS.white,
              font: { size: 12, weight: 500 },
            },
          },
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: COLORS.white, boxWidth: 28, boxHeight: 2, padding: 16 },
          },
          tooltip: {
            backgroundColor: COLORS.navy,
            borderColor: COLORS.hotPink,
            borderWidth: 1,
            titleColor: COLORS.white,
            bodyColor: COLORS.white,
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => (items[0]?.raw as ChartPoint).label,
              label: (item: TooltipItem<'line'>) => {
                const p = item.raw as ChartPoint;
                return [
                  `${p.y >= 0 ? '+' : ''}${p.y.toFixed(2)} °C sobre 1880-1900`,
                  `NASA original: ${p.anomaly >= 0 ? '+' : ''}${p.anomaly.toFixed(2)} °C vs 1951-1980`,
                ];
              },
            },
          },
        },
      },
      plugins: [this.selectionPlugin()],
    });

    this.bindPointerEvents();
  }

  // ---------- API pública ----------

  getView(): ChartView {
    return this.view;
  }

  /** Muestra la serie anual en el rango dado (por defecto desde 1926). */
  showAnnual(range: YearRange, animate = true): void {
    const clamped = this.clampRange(range, Math.max(ANNUAL_START_YEAR, this.data.firstYear), 2);
    this.lastAnnualRange = clamped;
    this.applyView('annual', clamped, animate);
  }

  /** Zoom a la vista mensual del rango de años dado. */
  zoomToMonthly(range: YearRange, animate = true): void {
    const clamped = this.clampRange(range, this.data.firstYear, 1);
    this.applyView('monthly', clamped, animate);
  }

  /** Vuelve a la vista anual que había antes del zoom. */
  backToAnnual(animate = true): void {
    this.applyView('annual', this.lastAnnualRange, animate);
  }

  /** Repite la animación temporal de la vista actual. */
  play(): void {
    this.reveal();
  }

  destroy(): void {
    this.stopAnimation();
    cancelAnimationFrame(this.pulseRafId);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.chart.destroy();
  }

  // ---------- Construcción de la vista ----------

  /** Ajusta el rango a los datos y garantiza un mínimo de `minSpanYears` años de ancho. */
  private clampRange(range: YearRange, minYear: number, minSpanYears: number): YearRange {
    const maxYear = this.data.lastYear;
    let start = Math.max(minYear, Math.min(range.startYear, range.endYear));
    let end = Math.min(maxYear, Math.max(range.startYear, range.endYear));
    if (end - start + 1 < minSpanYears) {
      end = Math.min(maxYear, start + minSpanYears - 1);
      start = Math.max(minYear, end - minSpanYears + 1);
    }
    return { startYear: start, endYear: end };
  }

  private buildPoints(mode: ChartMode, range: YearRange): ChartPoint[] {
    if (mode === 'annual') {
      return this.data.annual
        .filter((a) => a.year >= range.startYear && a.year <= range.endYear)
        .map((a) => ({
          x: a.year,
          year: a.year,
          y: a.relative,
          anomaly: a.anomaly,
          label: a.complete ? `${a.year}` : `${a.year} (parcial: ${a.monthsAvailable} meses)`,
        }));
    }
    return this.data.monthly
      .filter((m) => m.year >= range.startYear && m.year <= range.endYear)
      .map((m) => ({
        x: m.year + (m.month - 1) / 12,
        year: m.year,
        month: m.month,
        y: m.relative,
        anomaly: m.anomaly,
        label: `${MONTH_ABBR[m.month - 1]} ${m.year}`,
      }));
  }

  private applyView(mode: ChartMode, range: YearRange, animate: boolean): void {
    this.stopAnimation();
    this.clearSelection();
    this.clearSelectedPoint();
    this.view = { mode, range };
    this.fullPoints = this.buildPoints(mode, range);
    if (this.fullPoints.length === 0) return;

    const xMin = mode === 'annual' ? range.startYear : this.fullPoints[0].x;
    const xMax = mode === 'annual' ? range.endYear : this.fullPoints[this.fullPoints.length - 1].x;
    this.configureScales(mode, xMin, xMax);

    PARIS_THRESHOLDS.forEach((t, i) => {
      const dataset = this.chart.data.datasets[i + 1];
      dataset.data = [
        { x: xMin, y: t.value, year: 0, anomaly: 0, label: t.label },
        { x: xMax, y: t.value, year: 0, anomaly: 0, label: t.label },
      ];
    });

    this.canvas.style.cursor = 'crosshair';
    this.options.onViewChange?.(this.view);

    if (animate && !prefersReducedMotion()) {
      this.reveal();
    } else {
      this.setVisible(1);
    }
  }

  private configureScales(mode: ChartMode, xMin: number, xMax: number): void {
    const scales = this.chart.options.scales;
    const x = scales?.['x'] as unknown as AxisOptions;
    const y = scales?.['y'] as unknown as AxisOptions;
    const spanYears = xMax - xMin;

    x.min = xMin;
    x.max = xMax;
    if (mode === 'annual') {
      x.ticks.stepSize = undefined;
      x.ticks.callback = (v: number | string) => (Number.isInteger(Number(v)) ? String(v) : '');
    } else {
      x.ticks.stepSize = spanYears <= 2 ? 1 / 12 : spanYears <= 6 ? 3 / 12 : 1;
      x.ticks.callback = (v: number | string) => {
        const value = Number(v);
        const year = Math.floor(value + 1e-6);
        const month = Math.round((value - year) * 12);
        return month === 0 ? String(year) : MONTH_ABBR[month % 12];
      };
    }

    // Eje Y fijo para la vista (no salta durante la animación) e incluye siempre los umbrales.
    const values = this.fullPoints.map((p) => p.y);
    const maxThreshold = Math.max(...PARIS_THRESHOLDS.map((t) => t.value));
    y.min = Math.floor((Math.min(0, ...values) - 0.1) * 5) / 5;
    y.max = Math.ceil((Math.max(maxThreshold, ...values) + 0.2) * 5) / 5;
  }

  // ---------- Animación temporal ----------

  private setVisible(progress: number): void {
    const full = this.fullPoints;
    let visible: ChartPoint[];
    if (progress >= 1 || full.length < 2) {
      visible = full;
    } else {
      const position = progress * (full.length - 1);
      const k = Math.floor(position);
      const frac = position - k;
      visible = full.slice(0, k + 1);
      if (frac > 0) {
        const a = full[k];
        const b = full[k + 1];
        visible.push({
          x: a.x + (b.x - a.x) * frac,
          y: a.y + (b.y - a.y) * frac,
          year: b.year,
          month: b.month,
          anomaly: a.anomaly + (b.anomaly - a.anomaly) * frac,
          label: b.label,
        });
      }
    }
    this.chart.data.datasets[0].data = visible;
    this.chart.update('none');

    const current = visible[visible.length - 1];
    try {
      this.notifyProgress(progress, current);
    } catch (error) {
      console.error('Error en onProgress:', error);
    }
  }

  private notifyProgress(progress: number, current: ChartPoint | undefined): void {
    this.options.onProgress?.(
      progress,
      current ? current.label : '',
      current ? current.y : 0,
      // Año decimal en vista anual (suaviza el avance); en vista mensual, el año del mes actual.
      current ? (this.view.mode === 'annual' ? current.x : current.year) : this.view.range.startYear,
    );
  }

  private reveal(): void {
    this.stopAnimation();
    if (this.fullPoints.length < 2 || prefersReducedMotion()) {
      this.setVisible(1);
      return;
    }
    const duration = Math.min(5000, 1500 + this.fullPoints.length * 25);
    const startTime = performance.now();
    const token = ++this.animationToken;
    this.playing = true;
    this.options.onPlayingChange?.(true);

    // Termina SIEMPRE: deja la línea completa, el botón libre y el sonido de fondo apagado.
    const finish = (): void => {
      if (token !== this.animationToken) return; // ya la sustituyó otra animación
      cancelAnimationFrame(this.rafId);
      clearTimeout(this.watchdogId);
      this.rafId = 0;
      this.playing = false;
      this.animationToken++;
      this.setVisible(1);
      this.options.onPlayingChange?.(false);
    };

    const frame = (now: number): void => {
      if (token !== this.animationToken) return; // animación cancelada o reemplazada
      // El siguiente fotograma se agenda ANTES de dibujar: si algo falla al pintar, la animación sigue.
      const t = Math.max(0, Math.min(1, (now - startTime) / duration));
      if (t < 1) this.rafId = requestAnimationFrame(frame);
      try {
        this.setVisible(easeInOutCubic(t));
      } catch (error) {
        console.error('Error al dibujar la animación:', error);
      }
      if (t >= 1) finish();
    };

    // Red de seguridad: si el navegador frena los fotogramas (pestaña oculta, equipo saturado),
    // la animación igualmente termina poco después de lo previsto en vez de quedarse a medias.
    this.watchdogId = window.setTimeout(finish, duration + 1500);
    this.setVisible(0);
    this.rafId = requestAnimationFrame(frame);
  }

  private stopAnimation(): void {
    if (!this.playing) return;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.watchdogId);
    this.rafId = 0;
    this.playing = false;
    this.animationToken++;
    this.options.onPlayingChange?.(false);
  }

  // ---------- Estilo de puntos ----------

  /** Puntos que superan +1,5 °C: alta importancia (Hot Pink). */
  private isCritical(p: ChartPoint | undefined): boolean {
    return p !== undefined && p.y >= PARIS_THRESHOLDS[0].value;
  }

  private pointColor(p: ChartPoint | undefined): string {
    return this.isCritical(p) ? COLORS.hotPink : COLORS.white;
  }

  private pointRadius(p: ChartPoint | undefined): number {
    const base = this.view.mode === 'annual' ? 3 : 2;
    return this.isCritical(p) ? base + 2 : base;
  }

  // ---------- Selección de rango y clic (zoom a vista mensual) ----------

  private selectionPlugin(): Plugin<'line'> {
    return {
      id: 'rangeSelection',
      afterDatasetsDraw: (chart) => {
        this.drawSelectedMarker(chart);
        if (!this.selection) return;
        const { ctx, chartArea } = chart;
        const left = Math.min(this.selection.x0, this.selection.x1);
        const width = Math.abs(this.selection.x1 - this.selection.x0);
        ctx.save();
        ctx.fillStyle = 'rgba(255, 61, 139, 0.18)';
        ctx.strokeStyle = COLORS.hotPink;
        ctx.lineWidth = 1;
        ctx.fillRect(left, chartArea.top, width, chartArea.bottom - chartArea.top);
        ctx.strokeRect(left, chartArea.top, width, chartArea.bottom - chartArea.top);
        ctx.restore();
      },
    };
  }

  private bindPointerEvents(): void {
    this.canvas.style.touchAction = 'pan-y'; // el arrastre horizontal selecciona, el vertical hace scroll
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
  }

  private clampToArea(px: number): number {
    const { left, right } = this.chart.chartArea;
    return Math.max(left, Math.min(right, px));
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.playing) return; // sin interacción mientras se "desenrolla" el tiempo
    this.dragStartPx = this.clampToArea(e.offsetX);
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.dragStartPx === null || this.view.mode !== 'annual') return; // arrastrar = zoom, solo en vista anual
    const current = this.clampToArea(e.offsetX);
    if (Math.abs(current - this.dragStartPx) < DRAG_THRESHOLD_PX) return;
    this.selection = { x0: this.dragStartPx, x1: current };
    this.chart.draw();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.dragStartPx === null) return;
    const startPx = this.dragStartPx;
    const endPx = this.clampToArea(e.offsetX);
    this.dragStartPx = null;
    this.clearSelection();

    const xScale = this.chart.scales.x;
    if (this.view.mode === 'annual' && Math.abs(endPx - startPx) >= DRAG_THRESHOLD_PX) {
      const a = Math.round(xScale.getValueForPixel(startPx) ?? 0);
      const b = Math.round(xScale.getValueForPixel(endPx) ?? 0);
      this.zoomToMonthly({ startYear: Math.min(a, b), endYear: Math.max(a, b) });
    } else {
      this.selectNearest(endPx);
    }
  };

  private readonly onPointerCancel = (): void => {
    this.dragStartPx = null;
    this.clearSelection();
  };

  // ---------- Selección de un punto (clic) ----------

  /** Selecciona el punto visible más cercano en horizontal al píxel dado. */
  private selectNearest(px: number): void {
    const points = this.chart.data.datasets[0].data;
    if (points.length === 0) return;
    const xScale = this.chart.scales.x;
    let nearest = points[0];
    let best = Infinity;
    for (const p of points) {
      const distance = Math.abs(xScale.getPixelForValue(p.x) - px);
      if (distance < best) {
        best = distance;
        nearest = p;
      }
    }
    this.selectedPoint = nearest;
    this.startPulse();
    this.options.onSelect?.({
      mode: this.view.mode,
      year: nearest.year,
      month: nearest.month,
      relative: nearest.y,
      anomaly: nearest.anomaly,
      label: nearest.label,
    });
  }

  private clearSelectedPoint(): void {
    cancelAnimationFrame(this.pulseRafId);
    this.pulseRafId = 0;
    this.selectedPoint = null;
  }

  /** Anillos que se expanden desde el punto (más anillos cuanto más alta la anomalía). */
  private startPulse(): void {
    cancelAnimationFrame(this.pulseRafId);
    this.pulseStart = performance.now();
    if (prefersReducedMotion()) {
      this.chart.draw();
      return;
    }
    const frame = (now: number): void => {
      this.chart.draw();
      this.pulseRafId = now - this.pulseStart < PULSE_MS ? requestAnimationFrame(frame) : 0;
    };
    this.pulseRafId = requestAnimationFrame(frame);
  }

  private drawSelectedMarker(chart: Chart): void {
    const point = this.selectedPoint;
    if (!point) return;
    const { ctx } = chart;
    const px = chart.scales.x.getPixelForValue(point.x);
    const py = chart.scales.y.getPixelForValue(point.y);
    const critical = this.isCritical(point);
    const color = critical ? COLORS.hotPink : COLORS.white;

    ctx.save();
    // Anillo fijo alrededor del punto elegido.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Pulsos expansivos.
    const elapsed = performance.now() - this.pulseStart;
    if (elapsed < PULSE_MS) {
      const rings = point.y >= PARIS_THRESHOLDS[1].value ? 4 : critical ? 3 : point.y >= 1 ? 2 : 1;
      for (let i = 0; i < rings; i++) {
        const t = (elapsed - i * 160) / (PULSE_MS - 400);
        if (t <= 0 || t >= 1) continue;
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.lineWidth = 2 + (1 - t) * 2;
        ctx.beginPath();
        ctx.arc(px, py, 9 + t * (critical ? 70 : 46), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.chart.draw();
  }
}
