// MapViewer: mapa global interactivo de anomalías de temperatura (estilo mapas NASA GISTEMP).
//
//  - Dibuja en un <canvas> la malla anual de 4°x4° (public/data/map-data.json), suavizada con
//    interpolación bilineal en el espacio y lineal en el tiempo, de modo que al cambiar de año
//    el mapa se "derrite" de uno al siguiente en lugar de saltar.
//  - Colores: azul = más frío que 1951-1980, blanco = normal, naranja/rojo = más cálido.
//  - Slider propio (1926 – hoy). Desde fuera se sincroniza con setYear() (gráfico/animación).
//  - Puntos calientes en Hot Pink: los focos más cálidos del año; el clic en ellos se "imanta".
//  - Clic en una zona -> onSelect (main.ts reproduce el sonido y muestra el InfoPanel).
// Los valores son anomalías respecto a 1951-1980, como los mapas originales de NASA.
import type { MapData, MapSelection } from '../types';
import {
  cellAnomaly,
  cellCenter,
  describeRegion,
  fillSmallHoles,
  findHotspots,
  locateCell,
  yearIndexOf,
  type Hotspot,
} from '../utils/mapData';

export interface MapViewerOptions {
  /** El usuario hizo clic en una celda con dato. */
  onSelect: (selection: MapSelection) => void;
  /** El año mostrado (redondeado) cambió: el panel de información deja de corresponder. */
  onYearChange?: (year: number) => void;
}

const COLORS = { navy: '#0F183D', white: '#FFFFFF', hotPink: '#FF3D8B' } as const;

/** Rango de anomalías que cubre la escala de color (°C), como en los mapas anuales de NASA. */
const COLOR_RANGE = 4;
/** Resolución interna del mapa de calor (1° por píxel); se escala suavemente al canvas. */
const HEAT_W = 360;
const HEAT_H = 180;
const PULSE_MS = 1200;
const SMOOTH_SECONDS = 0.14;
const SNAP_RADIUS_PX = 22;
/** Intervalo mínimo entre dibujos del mapa mientras el año está en movimiento. */
const MOVING_FRAME_MS = 40;

/** Azul (frío) -> blanco (normal) -> naranja -> rojo (calor). Valores en °C. */
const COLOR_STOPS: [number, [number, number, number]][] = [
  [-4, [36, 72, 255]],
  [-2, [90, 150, 255]],
  [-0.5, [200, 226, 255]],
  [0, [255, 255, 255]],
  [0.5, [255, 226, 190]],
  [1, [255, 184, 110]],
  [2, [255, 110, 60]],
  [4, [196, 22, 46]],
];

const LUT_SIZE = 512;
/** Color (RGBA little-endian) de las rayas de las zonas sin dato. */
const NO_DATA_STRIPE = 0x30ffffff;

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const signed = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;

/** Tabla de colores empaquetados RGBA (little-endian) para pintar ImageData. */
const buildColorTable = (): Uint32Array => {
  const table = new Uint32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const value = -COLOR_RANGE + (i / (LUT_SIZE - 1)) * 2 * COLOR_RANGE;
    let lower = COLOR_STOPS[0]!;
    let upper = COLOR_STOPS[COLOR_STOPS.length - 1]!;
    for (let s = 0; s < COLOR_STOPS.length - 1; s++) {
      const a = COLOR_STOPS[s]!;
      const b = COLOR_STOPS[s + 1]!;
      if (value >= a[0] && value <= b[0]) {
        lower = a;
        upper = b;
        break;
      }
    }
    const span = upper[0] - lower[0];
    const t = span === 0 ? 0 : (value - lower[0]) / span;
    const [r, g, b] = lower[1].map((c, k) => Math.round(c + (upper[1][k]! - c) * t)) as [number, number, number];
    table[i] = (0xf2 << 24) | (b << 16) | (g << 8) | r;
  }
  return table;
};

const legendGradient = (): string => {
  const stops = COLOR_STOPS.map(([value, [r, g, b]]) => {
    const percent = ((value + COLOR_RANGE) / (2 * COLOR_RANGE)) * 100;
    return `rgb(${r} ${g} ${b}) ${percent.toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
};

export class MapViewer {
  private readonly map: MapData;
  private readonly options: MapViewerOptions;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly heatCanvas: HTMLCanvasElement;
  private readonly heatContext: CanvasRenderingContext2D;
  private readonly heatImage: ImageData;
  private readonly heatPixels: Uint32Array;
  private readonly colorTable = buildColorTable();
  /** Valores para dibujar (sin huecos sueltos); las consultas usan map.values originales. */
  private readonly displayValues: Int8Array;
  private readonly landPath = new Path2D();
  private readonly resizeObserver: ResizeObserver;

  // Interpolación precalculada: 4 celdas vecinas y sus pesos por píxel del mapa de calor.
  private readonly cornerCells = new Int32Array(HEAT_W * HEAT_H * 4);
  private readonly cornerWeights = new Float32Array(HEAT_W * HEAT_H * 4);

  private readonly slider: HTMLInputElement;
  private readonly yearLabel: HTMLElement;
  private readonly sliderLabel: HTMLElement;
  private readonly partialLabel: HTMLElement;
  private readonly readout: HTMLElement;

  private shownYear: number;
  private targetYear: number;
  private lastReportedIndex = -1;
  private rafId = 0;
  private lastTime = 0;
  private lastDrawTime = 0;

  private hotspotsIndex = -1;
  private hotspots: Hotspot[] = [];
  private selected: { lat: number; lon: number; anomaly: number } | null = null;
  private pulseStart = 0;

  constructor(container: HTMLElement, map: MapData, options: MapViewerOptions) {
    this.map = map;
    this.options = options;

    const firstYear = map.years[0]!;
    const lastYear = map.years[map.years.length - 1]!;
    this.targetYear = lastYear;
    this.shownYear = lastYear;

    container.classList.add('map');
    container.innerHTML = `
      <header class="map__head">
        <div>
          <p class="map__eyebrow">Anomalías por región</p>
          <h2 class="map__title">Mapa global de temperatura</h2>
        </div>
        <p class="map__year" aria-live="polite"><span data-role="year"></span><small data-role="partial" hidden>parcial</small></p>
      </header>
      <div class="map__stage">
        <canvas class="map__canvas" role="img"
          aria-label="Mapa mundial de anomalías de temperatura: azul más frío, blanco normal, rojo más cálido"></canvas>
      </div>
      <p class="map__readout" data-role="readout"></p>
      <div class="map__legend">
        <div class="map__bar" style="background:${legendGradient()}"></div>
        <div class="map__ticks" aria-hidden="true"><span>−4</span><span>−2</span><span>0</span><span>+2</span><span>+4 °C</span></div>
        <p class="map__legend-note">Anomalía respecto a 1951-1980, el período de referencia de los datos originales de NASA. Las zonas rayadas no tienen datos.</p>
      </div>
      <label class="map__control">
        <span>Año del mapa <strong data-role="slider-year"></strong></span>
        <input type="range" data-role="slider" min="${firstYear}" max="${lastYear}" step="1" value="${lastYear}" />
      </label>
    `;

    const q = <T extends HTMLElement>(role: string): T => {
      const element = container.querySelector<T>(`[data-role="${role}"]`);
      if (!element) throw new Error(`MapViewer: falta ${role}`);
      return element;
    };
    const canvas = container.querySelector<HTMLCanvasElement>('.map__canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('MapViewer: no se pudo crear el canvas.');
    this.canvas = canvas;
    this.ctx = context;
    this.slider = q('slider');
    this.yearLabel = q('year');
    this.sliderLabel = q('slider-year');
    this.partialLabel = q('partial');
    this.readout = q('readout');

    this.heatCanvas = document.createElement('canvas');
    this.heatCanvas.width = HEAT_W;
    this.heatCanvas.height = HEAT_H;
    const heatContext = this.heatCanvas.getContext('2d');
    if (!heatContext) throw new Error('MapViewer: no se pudo crear el lienzo del mapa de calor.');
    this.heatContext = heatContext;
    this.heatImage = heatContext.createImageData(HEAT_W, HEAT_H);
    this.heatPixels = new Uint32Array(this.heatImage.data.buffer);

    this.displayValues = fillSmallHoles(map);
    this.buildLandPath();
    this.buildInterpolationTables();
    this.setDefaultReadout();
    this.updateLabels();

    this.slider.addEventListener('input', this.onSlider);
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.setDefaultReadout);
    this.canvas.style.touchAction = 'pan-y';

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
  }

  // ---------- API pública ----------

  /** Año mostrado (redondeado). */
  getYear(): number {
    return this.map.years[this.currentIndex()]!;
  }

  /** Lleva el mapa a un año (admite decimales: interpola entre años). */
  setYear(year: number, smooth = true): void {
    const first = this.map.years[0]!;
    const last = this.map.years[this.map.years.length - 1]!;
    this.targetYear = Math.max(first, Math.min(last, year));
    if (!smooth || prefersReducedMotion()) this.shownYear = this.targetYear;
    this.syncYearUi();
    this.requestFrame();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.slider.removeEventListener('input', this.onSlider);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.setDefaultReadout);
  }

  // ---------- Preparación ----------

  private buildLandPath(): void {
    // Coordenadas en grados "de mapa": x = lon + 180, y = 90 - lat (se escalan al dibujar).
    for (const ring of this.map.land) {
      for (let i = 0; i + 1 < ring.length; i += 2) {
        const x = ring[i]! + 180;
        const y = 90 - ring[i + 1]!;
        if (i === 0) this.landPath.moveTo(x, y);
        else this.landPath.lineTo(x, y);
      }
      this.landPath.closePath();
    }
  }

  /** Para cada píxel del mapa de calor: las 4 celdas más cercanas y sus pesos bilineales. */
  private buildInterpolationTables(): void {
    const { rows, cols, cellDeg } = this.map;
    for (let y = 0; y < HEAT_H; y++) {
      const lat = 90 - ((y + 0.5) * 180) / HEAT_H;
      const rf = Math.max(0, Math.min(rows - 1, (lat + 90) / cellDeg - 0.5));
      const r0 = Math.floor(rf);
      const r1 = Math.min(rows - 1, r0 + 1);
      const fr = rf - r0;
      for (let x = 0; x < HEAT_W; x++) {
        const lon = -180 + ((x + 0.5) * 360) / HEAT_W;
        const cf = (lon + 180) / cellDeg - 0.5;
        const c0 = ((Math.floor(cf) % cols) + cols) % cols; // la longitud es cíclica
        const c1 = (c0 + 1) % cols;
        const fc = cf - Math.floor(cf);
        const i = (y * HEAT_W + x) * 4;
        this.cornerCells[i] = r0 * cols + c0;
        this.cornerCells[i + 1] = r0 * cols + c1;
        this.cornerCells[i + 2] = r1 * cols + c0;
        this.cornerCells[i + 3] = r1 * cols + c1;
        this.cornerWeights[i] = (1 - fr) * (1 - fc);
        this.cornerWeights[i + 1] = (1 - fr) * fc;
        this.cornerWeights[i + 2] = fr * (1 - fc);
        this.cornerWeights[i + 3] = fr * fc;
      }
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.draw();
  }

  // ---------- Año y animación ----------

  private currentIndex(): number {
    return yearIndexOf(this.map, this.shownYear);
  }

  private syncYearUi(): void {
    const index = yearIndexOf(this.map, this.targetYear);
    if (index !== this.lastReportedIndex) {
      const first = this.lastReportedIndex === -1;
      this.lastReportedIndex = index;
      this.selected = null; // la marca y el panel correspondían a otro año
      if (!first) this.options.onYearChange?.(this.map.years[index]!);
    }
    this.slider.value = String(this.map.years[index]);
    this.updateLabels();
  }

  private updateLabels(): void {
    const year = this.map.years[yearIndexOf(this.map, this.targetYear)]!;
    const last = this.map.years[this.map.years.length - 1]!;
    this.yearLabel.textContent = String(year);
    this.sliderLabel.textContent = String(year);
    this.partialLabel.hidden = !(year === last && this.map.lastYearMonths < 12);
    const first = this.map.years[0]!;
    const percent = last === first ? 100 : ((year - first) / (last - first)) * 100;
    this.slider.style.setProperty('--fill', `${percent}%`);
  }

  private requestFrame(): void {
    if (this.rafId) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const difference = this.targetYear - this.shownYear;
    if (Math.abs(difference) < 0.003) this.shownYear = this.targetYear;
    else this.shownYear += difference * (1 - Math.exp(-dt / SMOOTH_SECONDS));

    const pulsing = performance.now() - this.pulseStart < PULSE_MS;
    const moving = this.shownYear !== this.targetYear;
    // Mientras el año se mueve (p. ej. durante "Reproducir") se redibuja a ~25 fps: el mapa es
    // pesado y así deja tiempo al gráfico. En reposo siempre se dibuja el último estado.
    if (!moving || now - this.lastDrawTime >= MOVING_FRAME_MS) {
      this.draw();
      this.lastDrawTime = now;
    }
    this.rafId = moving || pulsing ? requestAnimationFrame(this.frame) : 0;
  };

  // ---------- Dibujo ----------

  private draw(): void {
    const { ctx, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;
    const scale = width / 360; // píxeles por grado (el mapa es 2:1, así que es igual en vertical)

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.navy;
    ctx.fillRect(0, 0, width, height);

    this.drawGraticule(width, height);

    ctx.save();
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'; // tierra: visible aunque no haya datos
    ctx.fill(this.landPath, 'evenodd');
    ctx.restore();

    this.renderHeat();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.heatCanvas, 0, 0, width, height);

    ctx.save();
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#000000'; // contorno negro para separar claramente los continentes
    ctx.lineWidth = (1.1 * (window.devicePixelRatio || 1)) / scale;
    ctx.lineJoin = 'round';
    ctx.stroke(this.landPath);
    ctx.restore();

    this.drawHotspots(scale);
    this.drawSelection(scale);
  }

  private drawGraticule(width: number, height: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = Math.max(1, width / 900);
    ctx.beginPath();
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = ((lon + 180) / 360) * width;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) / 180) * height;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Mezcla los mapas de los dos años vecinos según el año decimal mostrado. */
  private renderHeat(): void {
    const { map, cornerCells, cornerWeights, heatPixels, colorTable } = this;
    const cellsPerYear = map.rows * map.cols;
    const last = map.years.length - 1;
    const position = Math.max(0, Math.min(last, this.shownYear - map.years[0]!));
    const yearA = Math.floor(position);
    const yearB = Math.min(last, yearA + 1);
    const mix = position - yearA;
    const valuesA = this.displayValues.subarray(yearA * cellsPerYear, (yearA + 1) * cellsPerYear);
    const valuesB = this.displayValues.subarray(yearB * cellsPerYear, (yearB + 1) * cellsPerYear);
    const { missing, scale } = map;
    const colorScale = (LUT_SIZE - 1) / (2 * COLOR_RANGE);

    const sample = (values: Int8Array, i: number): number => {
      let weightSum = 0;
      let valueSum = 0;
      for (let k = 0; k < 4; k++) {
        const raw = values[cornerCells[i + k]!]!;
        if (raw === missing) continue;
        const weight = cornerWeights[i + k]!;
        weightSum += weight;
        valueSum += weight * raw;
      }
      // Si casi todas las celdas vecinas faltan, el píxel queda sin dato (borde nítido).
      return weightSum < 0.5 ? NaN : (valueSum / weightSum) * scale;
    };

    for (let p = 0; p < HEAT_W * HEAT_H; p++) {
      const i = p * 4;
      const a = sample(valuesA, i);
      const b = yearB === yearA ? a : sample(valuesB, i);
      let value: number;
      if (Number.isNaN(a)) value = b;
      else if (Number.isNaN(b)) value = a;
      else value = a + (b - a) * mix;
      if (Number.isNaN(value)) {
        // Sin dato: rayado tenue (se nota que es una ausencia de datos, no un fallo de dibujo).
        heatPixels[p] = (p % HEAT_W) + Math.floor(p / HEAT_W) & 4 ? 0 : NO_DATA_STRIPE;
        continue;
      }
      const clamped = Math.max(-COLOR_RANGE, Math.min(COLOR_RANGE, value));
      heatPixels[p] = colorTable[Math.round((clamped + COLOR_RANGE) * colorScale)]!;
    }
    this.heatContext.putImageData(this.heatImage, 0, 0);
  }

  private currentHotspots(): Hotspot[] {
    const index = this.currentIndex();
    if (index !== this.hotspotsIndex) {
      this.hotspotsIndex = index;
      this.hotspots = findHotspots(this.map, index);
    }
    return this.hotspots;
  }

  /** Focos más cálidos del año: puntos Hot Pink con halo. */
  private drawHotspots(scale: number): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    for (const spot of this.currentHotspots()) {
      const x = (spot.lon + 180) * scale;
      const y = (90 - spot.lat) * scale;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 16 * dpr);
      glow.addColorStop(0, 'rgba(255, 61, 139, 0.55)');
      glow.addColorStop(1, 'rgba(255, 61, 139, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 16 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.hotPink;
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = COLORS.navy;
      ctx.stroke();
    }
  }

  /** Anillo en la zona elegida y ondas que se expanden (más ondas cuanto más cálida). */
  private drawSelection(scale: number): void {
    const selected = this.selected;
    if (!selected) return;
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const x = (selected.lon + 180) * scale;
    const y = (90 - selected.lat) * scale;
    const hot = selected.anomaly >= 1;
    const color = hot ? COLORS.hotPink : COLORS.white;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2);
    ctx.stroke();

    const elapsed = performance.now() - this.pulseStart;
    if (elapsed < PULSE_MS) {
      const rings = selected.anomaly >= 2 ? 4 : hot ? 3 : 2;
      for (let i = 0; i < rings; i++) {
        const t = (elapsed - i * 150) / (PULSE_MS - 450);
        if (t <= 0 || t >= 1) continue;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.lineWidth = (1.5 + (1 - t) * 2) * dpr;
        ctx.beginPath();
        ctx.arc(x, y, (9 + t * (hot ? 60 : 40)) * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- Interacción ----------

  private readonly onSlider = (): void => {
    this.setYear(Number(this.slider.value));
  };

  /** Posición de un evento del puntero en grados (lat/lon). */
  private locate(event: MouseEvent): { lat: number; lon: number; rect: DOMRect } {
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    return { lat: 90 - (py / rect.height) * 180, lon: (px / rect.width) * 360 - 180, rect };
  }

  private readonly onClick = (event: MouseEvent): void => {
    const located = this.locate(event);
    const { rect } = located;
    let { lat, lon } = located;

    // Imán hacia los puntos calientes cercanos: son el objetivo principal del clic.
    for (const spot of this.currentHotspots()) {
      const dx = ((spot.lon - lon) / 360) * rect.width;
      const dy = ((spot.lat - lat) / 180) * rect.height;
      if (Math.hypot(dx, dy) <= SNAP_RADIUS_PX) {
        lat = spot.lat;
        lon = spot.lon;
        break;
      }
    }

    const index = this.currentIndex();
    const { row, col } = locateCell(this.map, lat, lon);
    const anomaly = cellAnomaly(this.map, index, row, col);
    if (anomaly === null) {
      this.readout.textContent = 'Sin datos en esta zona para este año: prueba con una época más reciente.';
      return;
    }

    this.selected = { lat, lon, anomaly };
    this.pulseStart = performance.now();
    this.requestFrame();

    const center = cellCenter(this.map, row, col);
    this.options.onSelect({
      year: this.map.years[index]!,
      region: describeRegion(center.lat, center.lon),
      anomaly,
      row,
      col,
    });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    const { lat, lon } = this.locate(event);
    const { row, col } = locateCell(this.map, lat, lon);
    const anomaly = cellAnomaly(this.map, this.currentIndex(), row, col);
    const place = describeRegion(lat, lon).name;
    this.readout.textContent =
      anomaly === null
        ? `${place} · sin datos`
        : `${place} · ${signed(anomaly)} °C respecto a 1951-1980`;
  };

  private readonly setDefaultReadout = (): void => {
    this.readout.textContent =
      'Haz clic (o toca) una zona para escucharla. Los puntos rosa son los focos más cálidos del año.';
  };
}
