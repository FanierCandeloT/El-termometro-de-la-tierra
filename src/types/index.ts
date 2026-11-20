// Tipos compartidos de la aplicación.
//
// IMPORTANTE: los datos originales de NASA GISTEMP son ANOMALÍAS (en °C) respecto al
// promedio 1951-1980. NO son temperaturas absolutas ni están relativas a la era
// preindustrial. La app añade un valor `relative` (respecto a 1880-1900) derivado de
// esos datos; el valor original se conserva siempre en `anomaly`.

/** Período climatológico contra el que NASA calcula sus anomalías. */
export const NASA_REFERENCE_PERIOD = { startYear: 1951, endYear: 1980 } as const;

/** Período usado en esta app como aproximación de la línea base preindustrial. */
export const PREINDUSTRIAL_PERIOD = { startYear: 1880, endYear: 1900 } as const;

/** Rango de años inclusivo. */
export interface YearRange {
  startYear: number;
  endYear: number;
}

/** Dato mensual. */
export interface MonthlyData {
  year: number;
  /** Mes 1-12. */
  month: number;
  /** Anomalía original de NASA en °C respecto a 1951-1980. */
  anomaly: number;
  /** Anomalía en °C respecto a la línea base 1880-1900 (anomaly - baseline.mean). */
  relative: number;
}

/** Dato anual (promedio de los meses disponibles del año). */
export interface AnnualData {
  year: number;
  /** Anomalía original en °C respecto a 1951-1980 (promedio de los meses disponibles). */
  anomaly: number;
  /** Anomalía en °C respecto a 1880-1900. */
  relative: number;
  /** Cantidad de meses con dato (1-12). */
  monthsAvailable: number;
  /** true si el año tiene los 12 meses; false para el año en curso. */
  complete: boolean;
}

/** Línea base calculada a partir de la propia serie. */
export interface Baseline extends YearRange {
  /** Promedio de las anomalías (vs 1951-1980) en este período, en °C. */
  mean: number;
  /** Cantidad de meses usados en el promedio. */
  monthCount: number;
}

/** Colección completa de datos ya procesados. */
export interface TemperatureData {
  /** Descripción de la fuente. */
  source: string;
  /** Período de referencia de los valores originales (siempre 1951-1980). */
  originalReference: YearRange;
  /** Línea base 1880-1900 calculada. */
  baseline: Baseline;
  monthly: MonthlyData[];
  annual: AnnualData[];
  /** Primer y último año con datos. */
  firstYear: number;
  lastYear: number;
}

/** Umbral de calentamiento (p. ej. 1.5 °C del Acuerdo de París). */
export interface Thresholds {
  id: string;
  label: string;
  /** Valor en °C respecto a la línea base 1880-1900. */
  value: number;
}

/** Umbrales del Acuerdo de París, relativos a la línea base 1880-1900. */
export const PARIS_THRESHOLDS: Thresholds[] = [
  { id: 'paris-1.5', label: '+1,5 °C (Acuerdo de París)', value: 1.5 },
  { id: 'paris-2.0', label: '+2,0 °C (Acuerdo de París)', value: 2.0 },
];

/** Nivel de intensidad de una anomalía (de más calmo a más extremo). */
export type AnomalyTier = 'calm' | 'warm' | 'hot' | 'critical' | 'extreme';

/** Punto del gráfico seleccionado por el usuario con un clic. */
export interface ChartSelection {
  mode: ChartMode;
  year: number;
  /** Mes 1-12; solo en vista mensual. */
  month?: number;
  /** Valor relativo a 1880-1900 (°C). */
  relative: number;
  /** Anomalía original de NASA vs 1951-1980 (°C). */
  anomaly: number;
  /** Etiqueta legible: "2024", "mar 2024"... */
  label: string;
  /** Solo si la selección viene del mapa: la zona elegida. */
  region?: RegionInfo;
}

/** Información completa sobre la zona seleccionada, para el InfoPanel. */
export interface SelectionInfo {
  selection: ChartSelection;
  tier: AnomalyTier;
  /** Promedio de una ventana de tiempo alrededor de la selección (no un mes aislado). */
  window: {
    range: YearRange;
    label: string;
    relative: number;
    anomaly: number;
    monthCount: number;
  };
  /** Distancia a cada umbral: delta = valor - umbral (positivo = lo supera). */
  thresholds: { threshold: Thresholds; delta: number }[];
  /** Posición entre los más cálidos de la serie (1 = el más cálido). */
  rank: { position: number; total: number; unit: 'años' | 'meses' };
  /** Aviso metodológico que el panel muestra tal cual (p. ej. valores regionales aproximados). */
  note?: string;
}

/** Modo de visualización del gráfico. */
export type ChartMode = 'annual' | 'monthly';

/** Vista actual del gráfico: modo + rango de años mostrado. */
export interface ChartView {
  mode: ChartMode;
  range: YearRange;
}

/** Zona geográfica seleccionada en el mapa. */
export interface RegionInfo {
  lat: number;
  lon: number;
  /** Nombre legible: "Zona tropical (12° N, 45° E)". */
  name: string;
}

/**
 * Mapa global de anomalías anuales (GISTEMP, malla de 4°x4°).
 * Los valores son anomalías en °C respecto a 1951-1980, como los originales de NASA.
 */
export interface MapData {
  source: string;
  /** Período de referencia de los valores (1951-1980). */
  reference: string;
  /** Años disponibles (consecutivos, p. ej. 1926..2026). */
  years: number[];
  /** Meses con dato en el último año (12 = año completo). */
  lastYearMonths: number;
  rows: number;
  cols: number;
  /** Tamaño de celda en grados. */
  cellDeg: number;
  /** °C por unidad entera de `values`. */
  scale: number;
  /** Valor entero que indica "sin dato". */
  missing: number;
  /** Anillos de costa: arreglos planos [lon, lat, lon, lat, ...]. */
  land: number[][];
  /** Valores enteros [año][fila sur→norte][columna oeste→este], aplanados. */
  values: Int8Array;
}

/** Celda del mapa seleccionada con un clic. */
export interface MapSelection {
  /** Año del mapa en el momento del clic. */
  year: number;
  region: RegionInfo;
  /** Anomalía original de NASA en esa celda (°C vs 1951-1980). */
  anomaly: number;
  row: number;
  col: number;
}

/** Acción recomendada del carrusel "Qué puedes hacer". */
export interface ActionItem {
  title: string;
  text: string;
  /** Dato de impacto opcional (cifra aproximada + qué significa). */
  fact?: { value: string; label: string };
}

/** Punto de una serie suavizada. */
export interface SmoothedPoint {
  year: number;
  value: number;
}
