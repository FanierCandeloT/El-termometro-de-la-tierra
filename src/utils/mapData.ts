// mapData: datos del mapa global de anomalías (public/data/map-data.json).
//
// El archivo lo genera scripts/build-map-data.py a partir de la malla oficial de NASA
// GISTEMP v4: anomalías ANUALES en °C respecto a 1951-1980, celdas de 4°x4°.
// Este módulo carga el archivo y ofrece consultas puras (valor de una celda, puntos
// calientes, zona geográfica) y la construcción de la información para el InfoPanel.
import type { MapData, MapSelection, RegionInfo, SelectionInfo, TemperatureData } from '../types';
import { classifyAnomaly, distanceToThresholds, rankDescending, toRelative } from './calculations';

export const MAP_DATA_FILE = 'map-data.json';

/** Años que abarca el promedio de ventana regional (igual que en la vista anual del gráfico). */
const REGION_WINDOW_YEARS = 10;

interface MapDataFile extends Omit<MapData, 'values'> {
  /** Valores int8 codificados en base64. */
  data: string;
}

const decodeBase64Int8 = (base64: string): Int8Array => {
  const binary = atob(base64);
  const bytes = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const loadMapData = async (): Promise<MapData> => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${MAP_DATA_FILE}`);
  if (!response.ok) throw new Error(`No se pudo cargar ${MAP_DATA_FILE} (HTTP ${response.status}).`);
  const { data, ...meta } = (await response.json()) as MapDataFile;
  const values = decodeBase64Int8(data);
  const expected = meta.years.length * meta.rows * meta.cols;
  if (values.length !== expected) {
    throw new Error(`${MAP_DATA_FILE} está corrupto: ${values.length} valores, se esperaban ${expected}.`);
  }
  return { ...meta, values };
};

/**
 * Copia de los valores donde los huecos pequeños (celdas sin dato rodeadas por al menos
 * `minNeighbors` de sus 8 vecinas) se rellenan con el promedio de sus vecinas. Solo sirve para
 * DIBUJAR el mapa sin "agujeros" sueltos; las consultas y el InfoPanel usan los datos originales.
 */
export const fillSmallHoles = (map: MapData, minNeighbors = 5): Int8Array => {
  const { rows, cols, missing, values } = map;
  const filled = values.slice();
  const cellsPerYear = rows * cols;
  for (let year = 0; year < map.years.length; year++) {
    const base = year * cellsPerYear;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (values[base + row * cols + col] !== missing) continue;
        let sum = 0;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const r = row + dr;
          if (r < 0 || r >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const raw = values[base + r * cols + ((col + dc + cols) % cols)];
            if (raw === undefined || raw === missing) continue;
            sum += raw;
            count++;
          }
        }
        if (count >= minNeighbors) filled[base + row * cols + col] = Math.round(sum / count);
      }
    }
  }
  return filled;
};

/** Posición en `values` de una celda de un año. */
export const cellOffset = (map: MapData, yearIndex: number, row: number, col: number): number =>
  (yearIndex * map.rows + row) * map.cols + col;

/** Anomalía (°C vs 1951-1980) de una celda, o null si no hay dato. */
export const cellAnomaly = (map: MapData, yearIndex: number, row: number, col: number): number | null => {
  const raw = map.values[cellOffset(map, yearIndex, row, col)];
  return raw === undefined || raw === map.missing ? null : raw * map.scale;
};

/** Índice de año (0-based) más cercano a un año decimal, acotado a los datos. */
export const yearIndexOf = (map: MapData, year: number): number =>
  Math.max(0, Math.min(map.years.length - 1, Math.round(year - (map.years[0] ?? 0))));

/** Fila y columna de la celda que contiene un punto (lat -90..90, lon -180..180). */
export const locateCell = (map: MapData, lat: number, lon: number): { row: number; col: number } => ({
  row: Math.max(0, Math.min(map.rows - 1, Math.floor((lat + 90) / map.cellDeg))),
  col: Math.max(0, Math.min(map.cols - 1, Math.floor((lon + 180) / map.cellDeg))),
});

/** Centro geográfico de una celda. */
export const cellCenter = (map: MapData, row: number, col: number): { lat: number; lon: number } => ({
  lat: -90 + (row + 0.5) * map.cellDeg,
  lon: -180 + (col + 0.5) * map.cellDeg,
});

const formatCoord = (value: number, positive: string, negative: string): string =>
  `${Math.abs(Math.round(value))}° ${value >= 0 ? positive : negative}`;

/** Describe una zona: banda climática + coordenadas. */
export const describeRegion = (lat: number, lon: number): RegionInfo => {
  const band =
    lat >= 66.5 ? 'Ártico'
    : lat >= 23.5 ? 'Zona templada norte'
    : lat > -23.5 ? 'Zona tropical'
    : lat > -66.5 ? 'Zona templada sur'
    : 'Antártida';
  return { lat, lon, name: `${band} (${formatCoord(lat, 'N', 'S')}, ${formatCoord(lon, 'E', 'O')})` };
};

export interface Hotspot {
  row: number;
  col: number;
  lat: number;
  lon: number;
  anomaly: number;
}

/**
 * Puntos calientes de un año: las celdas con mayor anomalía, separadas entre sí al menos
 * `minSeparationDeg` grados para no apilar marcas, y con un mínimo de `minAnomaly` °C.
 */
export const findHotspots = (
  map: MapData,
  yearIndex: number,
  count = 4,
  minAnomaly = 1,
  minSeparationDeg = 24,
): Hotspot[] => {
  const candidates: Hotspot[] = [];
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const anomaly = cellAnomaly(map, yearIndex, row, col);
      if (anomaly === null || anomaly < minAnomaly) continue;
      candidates.push({ row, col, anomaly, ...cellCenter(map, row, col) });
    }
  }
  candidates.sort((a, b) => b.anomaly - a.anomaly);

  const chosen: Hotspot[] = [];
  for (const candidate of candidates) {
    const farEnough = chosen.every((h) => {
      const dLon = Math.min(Math.abs(h.lon - candidate.lon), 360 - Math.abs(h.lon - candidate.lon));
      return Math.hypot(h.lat - candidate.lat, dLon) >= minSeparationDeg;
    });
    if (farEnough) chosen.push(candidate);
    if (chosen.length >= count) break;
  }
  return chosen;
};

/**
 * Información para el InfoPanel de una celda del mapa.
 *
 * Los umbrales de París se definen para la media GLOBAL respecto a 1880-1900. No existe
 * una base local fiable en 1880-1900 (en muchas zonas casi no hay datos), así que el valor
 * regional se aproxima sumando la diferencia de la base global (anomalía - baseline.mean).
 * El panel lo avisa con una nota y conserva el dato original de NASA.
 */
export const buildMapSelectionInfo = (
  temperature: TemperatureData,
  map: MapData,
  selection: MapSelection,
): SelectionInfo => {
  const firstYear = map.years[0] ?? selection.year;
  const relative = toRelative(selection.anomaly, temperature.baseline);

  // Promedio de ventana en esta celda (años con dato) y ranking entre todos sus años.
  const windowStart = Math.max(firstYear, selection.year - REGION_WINDOW_YEARS + 1);
  const windowValues: number[] = [];
  const allValues: number[] = [];
  map.years.forEach((year, index) => {
    const value = cellAnomaly(map, index, selection.row, selection.col);
    if (value === null) return;
    allValues.push(value);
    if (year >= windowStart && year <= selection.year) windowValues.push(value);
  });
  const windowAnomaly = windowValues.length
    ? windowValues.reduce((sum, v) => sum + v, 0) / windowValues.length
    : selection.anomaly;

  const partial = selection.year === map.years[map.years.length - 1] && map.lastYearMonths < 12;
  const yearLabel = partial ? `${selection.year} (parcial)` : `${selection.year}`;

  return {
    selection: {
      mode: 'annual',
      year: selection.year,
      relative,
      anomaly: selection.anomaly,
      label: `${yearLabel} · ${selection.region.name}`,
      region: selection.region,
    },
    tier: classifyAnomaly(relative),
    window: {
      range: { startYear: windowStart, endYear: selection.year },
      label: `Promedio en esta zona (${windowStart}–${selection.year}, ${windowValues.length} años con dato)`,
      relative: toRelative(windowAnomaly, temperature.baseline),
      anomaly: windowAnomaly,
      monthCount: windowValues.length,
    },
    thresholds: distanceToThresholds(relative),
    rank: {
      position: rankDescending(allValues, selection.anomaly),
      total: allValues.length,
      unit: 'años',
    },
    note:
      `Valor regional aproximado: a la anomalía de NASA en esta celda (respecto a 1951-1980) se le suma ` +
      `la diferencia de la base global 1880-1900 (${(-temperature.baseline.mean).toFixed(2)} °C). ` +
      `Los umbrales de París se definen para la media global, no para una zona.`,
  };
};
