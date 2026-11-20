// dataLoader: carga y parsea GLB.Ts+dSST.csv de NASA GISTEMP v4.
// Fuente oficial: https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv
//
// Los valores del CSV son ANOMALÍAS en °C respecto al promedio 1951-1980 (no son
// temperaturas absolutas). "***" indica dato faltante (meses futuros).
import type { TemperatureData } from '../types';
import { NASA_REFERENCE_PERIOD } from '../types';
import type { RawMonthly } from './calculations';
import { buildAnnual, buildMonthly, computeBaseline } from './calculations';

export const DATA_FILE = 'GLB.Ts+dSST.csv';
export const NASA_URL = 'https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv';

const MONTH_COLUMNS = 12; // Jan..Dec: columnas 1-12 (la 0 es Year)

/** Parsea el texto CSV de NASA a filas mensuales crudas (anomalía vs 1951-1980). */
export const parseGistempCsv = (text: string): RawMonthly[] => {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => l.startsWith('Year,'));
  if (headerIndex === -1) {
    throw new Error('Formato inesperado: no se encontró la cabecera "Year,Jan,...".');
  }

  const rows: RawMonthly[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = line.trim().split(',');
    const year = Number(cells[0]);
    // Se omiten líneas vacías y cabeceras repetidas (NASA repite "Year,Jan,..." cada ~20 años).
    if (!Number.isInteger(year) || cells.length < MONTH_COLUMNS + 1) continue;

    for (let month = 1; month <= MONTH_COLUMNS; month++) {
      const cell = cells[month];
      if (cell === undefined || cell === '' || cell.includes('*')) continue;
      const anomaly = Number(cell);
      if (Number.isFinite(anomaly)) rows.push({ year, month, anomaly });
    }
  }

  if (rows.length === 0) throw new Error('El CSV no contiene datos mensuales válidos.');
  return rows;
};

/** Convierte el texto CSV en la estructura completa tipada. */
export const buildTemperatureData = (csvText: string): TemperatureData => {
  const raw = parseGistempCsv(csvText);
  const baseline = computeBaseline(raw);
  const monthly = buildMonthly(raw, baseline);
  const annual = buildAnnual(monthly, baseline);
  return {
    source: `NASA GISS Surface Temperature Analysis (GISTEMP v4), Land-Ocean Global Means. ${NASA_URL}`,
    originalReference: { ...NASA_REFERENCE_PERIOD },
    baseline,
    monthly,
    annual,
    firstYear: annual[0].year,
    lastYear: annual[annual.length - 1].year,
  };
};

/** Descarga el CSV local (public/data) y devuelve los datos procesados. */
export const loadTemperatureData = async (): Promise<TemperatureData> => {
  // El "+" va literal: en una ruta es válido, y codificarlo como %2B hace que el servidor
  // de Vite no encuentre el archivo y devuelva index.html en su lugar.
  const url = `${import.meta.env.BASE_URL}data/${DATA_FILE}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${DATA_FILE} (HTTP ${response.status}).`);
  }
  return buildTemperatureData(await response.text());
};
