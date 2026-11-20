// calculations: funciones puras de cálculo sobre los datos de temperatura.
//
// Recordatorio: los valores de NASA son anomalías respecto a 1951-1980. Aquí se
// reexpresan respecto a la media 1880-1900 de la MISMA serie, restando esa media.
import type {
  AnnualData,
  AnomalyTier,
  Baseline,
  ChartSelection,
  MonthlyData,
  SelectionInfo,
  SmoothedPoint,
  TemperatureData,
  Thresholds,
  YearRange,
} from '../types';
import { PARIS_THRESHOLDS, PREINDUSTRIAL_PERIOD } from '../types';

/** Fila mensual cruda: anomalía vs 1951-1980, antes de calcular la línea base. */
export interface RawMonthly {
  year: number;
  month: number;
  anomaly: number;
}

const mean = (values: number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

const inRange = (year: number, range: YearRange): boolean =>
  year >= range.startYear && year <= range.endYear;

/**
 * Promedio de la línea base (por defecto 1880-1900) usando todos los meses del período,
 * es decir, un promedio de ventana de 21 años y no de meses aislados.
 * El resultado sigue expresado respecto a 1951-1980 (negativo, ≈ -0.2 °C).
 */
export const computeBaseline = (
  raw: RawMonthly[],
  period: YearRange = PREINDUSTRIAL_PERIOD,
): Baseline => {
  const values = raw.filter((r) => inRange(r.year, period)).map((r) => r.anomaly);
  if (values.length === 0) {
    throw new Error(
      `No hay datos para la línea base ${period.startYear}-${period.endYear}.`,
    );
  }
  return { ...period, mean: mean(values), monthCount: values.length };
};

/** Convierte anomalías (vs 1951-1980) a valores relativos a la línea base. */
export const toRelative = (anomaly: number, baseline: Baseline): number =>
  anomaly - baseline.mean;

/** Añade el valor relativo a la línea base a cada dato mensual. */
export const buildMonthly = (raw: RawMonthly[], baseline: Baseline): MonthlyData[] =>
  raw.map((r) => ({ ...r, relative: toRelative(r.anomaly, baseline) }));

/** Agrupa los datos mensuales en anuales (promedio de los meses disponibles). */
export const buildAnnual = (monthly: MonthlyData[], baseline: Baseline): AnnualData[] => {
  const byYear = new Map<number, number[]>();
  for (const m of monthly) {
    const list = byYear.get(m.year) ?? [];
    list.push(m.anomaly);
    byYear.set(m.year, list);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, values]) => {
      const anomaly = mean(values);
      return {
        year,
        anomaly,
        relative: toRelative(anomaly, baseline),
        monthsAvailable: values.length,
        complete: values.length === 12,
      };
    });
};

/** Datos mensuales dentro de un rango de años (inclusivo). */
export const getMonthlyInRange = (monthly: MonthlyData[], range: YearRange): MonthlyData[] =>
  monthly.filter((m) => inRange(m.year, range));

/** Datos anuales dentro de un rango de años (inclusivo). */
export const getAnnualInRange = (annual: AnnualData[], range: YearRange): AnnualData[] =>
  annual.filter((a) => inRange(a.year, range));

/** Datos mensuales de un año concreto. */
export const getMonthlyForYear = (monthly: MonthlyData[], year: number): MonthlyData[] =>
  monthly.filter((m) => m.year === year);

/** Dato anual de un año concreto, si existe. */
export const getAnnualForYear = (annual: AnnualData[], year: number): AnnualData | undefined =>
  annual.find((a) => a.year === year);

/**
 * Promedio de una ventana de tiempo (rango de años) usando todos los meses.
 * Devuelve valor original (vs 1951-1980) y relativo (vs 1880-1900).
 */
export const averageOverWindow = (
  monthly: MonthlyData[],
  range: YearRange,
): { anomaly: number; relative: number; monthCount: number } | undefined => {
  const slice = getMonthlyInRange(monthly, range);
  if (slice.length === 0) return undefined;
  return {
    anomaly: mean(slice.map((m) => m.anomaly)),
    relative: mean(slice.map((m) => m.relative)),
    monthCount: slice.length,
  };
};

/**
 * Promedio móvil sobre años (por defecto 10 años), sobre el valor relativo a 1880-1900.
 * Cada punto promedia los `windowYears` años que terminan en ese año; solo se emiten
 * puntos con ventana completa, para no mostrar valores de pocos años.
 */
export const rollingAverage = (
  annual: AnnualData[],
  windowYears = 10,
): SmoothedPoint[] => {
  const points: SmoothedPoint[] = [];
  for (let i = windowYears - 1; i < annual.length; i++) {
    const window = annual.slice(i - windowYears + 1, i + 1);
    points.push({ year: annual[i].year, value: mean(window.map((a) => a.relative)) });
  }
  return points;
};

/** Años del promedio de ventana que acompaña a una selección anual. */
const SELECTION_WINDOW_YEARS = 10;

/** Clasifica un valor relativo a 1880-1900 en un nivel de intensidad. */
export const classifyAnomaly = (relative: number): AnomalyTier => {
  if (relative >= PARIS_THRESHOLDS[1].value) return 'extreme';
  if (relative >= PARIS_THRESHOLDS[0].value) return 'critical';
  if (relative >= 1.0) return 'hot';
  if (relative >= 0.5) return 'warm';
  return 'calm';
};

/** Distancia (valor - umbral) a cada umbral; positivo = el valor lo supera. */
export const distanceToThresholds = (
  relative: number,
  thresholds: Thresholds[] = PARIS_THRESHOLDS,
): { threshold: Thresholds; delta: number }[] =>
  thresholds.map((threshold) => ({ threshold, delta: relative - threshold.value }));

/** Posición (1 = el más cálido) de un valor dentro de una lista de valores. */
export const rankDescending = (values: number[], value: number): number =>
  values.filter((v) => v > value).length + 1;

/**
 * Reúne todo lo que el InfoPanel muestra sobre una selección: valor, promedio de
 * ventana, distancia a los umbrales de París y ranking en la serie.
 *  - Vista anual: ventana de 10 años que terminan en el año seleccionado.
 *  - Vista mensual: ventana del año calendario del mes seleccionado.
 */
export const buildSelectionInfo = (
  data: TemperatureData,
  selection: ChartSelection,
): SelectionInfo => {
  const isAnnual = selection.mode === 'annual';
  const range: YearRange = isAnnual
    ? {
        startYear: Math.max(data.firstYear, selection.year - SELECTION_WINDOW_YEARS + 1),
        endYear: selection.year,
      }
    : { startYear: selection.year, endYear: selection.year };

  const average = averageOverWindow(data.monthly, range);
  if (!average) throw new Error(`Sin datos para la ventana ${range.startYear}-${range.endYear}.`);

  const windowLabel = isAnnual
    ? `Promedio de ${range.endYear - range.startYear + 1} años (${range.startYear}–${range.endYear})`
    : `Promedio de ${selection.year} (${average.monthCount} meses)`;

  const pool = isAnnual ? data.annual.map((a) => a.relative) : data.monthly.map((m) => m.relative);

  return {
    selection,
    tier: classifyAnomaly(selection.relative),
    window: { range, label: windowLabel, ...average },
    thresholds: distanceToThresholds(selection.relative),
    rank: {
      position: rankDescending(pool, selection.relative),
      total: pool.length,
      unit: isAnnual ? 'años' : 'meses',
    },
  };
};
