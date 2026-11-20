// BackgroundEffect: fondo de página que va del calor al frío con el scroll.
// Arriba: la parte caliente (rojo, naranja, amarillo). Al bajar: el frío (azul, cian, celeste, blanco).
//
// Cómo funciona:
//  - El progreso de scroll (0-1) se suaviza con un rAF y elige un color en una paleta de
//    fotogramas clave, interpolada en OKLab para transiciones limpias.
//  - Tres cortinas de luz se calculan por código: cada una es una banda ondulada (suma de
//    senos que viajan) con rayos verticales suaves. Se pintan en un búfer de baja resolución
//    y se escalan con suavizado: así quedan difusas SIN usar filtros de desenfoque
//    (que son muy caros, sobre todo en móviles).
//  - El mismo <canvas> dibuja encima partículas etéreas: brasas amarillas/naranjas arriba y
//    motas blancas/cian abajo, más estrellas.
//  - Con "reducir movimiento": las cortinas se quedan quietas y solo el color sigue al scroll.
//
// PALETA (debe coincidir con los tokens de styles/variables.css):
//   Calor: rojo #D93A24 · naranja #FF7A1A · amarillo #FFC83D
//   Frío:  Navy #0F183D · océano #167D9A · celeste #63C7D5 · cian #2FD0E6 · blanco #FFFFFF
// El rosa (#FF3D8B) NO se usa aquí: se reserva para datos, anomalías y acciones importantes.
// Los tonos del cielo son oscuros a propósito (texto blanco legible); los claros van como brillos
// de baja opacidad.

type Rgb = [number, number, number];
type Lab = [number, number, number];

interface Glow {
  color: string;
  alpha: number;
}

interface Keyframe {
  at: number;
  sky: [string, string, string];
  glows: [Glow, Glow, Glow];
}

// ---------- Color: interpolación en OKLab ----------

const hexToRgb = (hex: string): Rgb => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const fromLinear = (channel: number): number => {
  const c = channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, c)) * 255);
};

const rgbToOklab = ([r8, g8, b8]: Rgb): Lab => {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const oklabToRgb = ([L, a, b]: Lab): Rgb => {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const mixLab = (a: Lab, b: Lab, t: number): Lab => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// ---------- Paleta y etapas del scroll ----------

const PALETTE = {
  red: '#D93A24',
  orange: '#FF7A1A',
  yellow: '#FFC83D',
  navy: '#0F183D',
  ocean: '#167D9A',
  sky: '#63C7D5',
  cyan: '#2FD0E6',
  white: '#FFFFFF',
} as const;

const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** Mezcla dos colores en OKLab (t = 0 -> a, t = 1 -> b). */
const blend = (a: string, b: string, t: number): string =>
  toHex(oklabToRgb(mixLab(rgbToOklab(hexToRgb(a)), rgbToOklab(hexToRgb(b)), t)));

/** Matiz oscuro de un color de la paleta (mezclado con negro): conserva el tono, baja la luz. */
const shade = (color: string, darkness: number): string => blend(color, '#000000', darkness);

/** Matices del cielo frío: Navy con una pizca de azul océano. */
const deep = (amount: number): string => blend(PALETTE.navy, PALETTE.ocean, amount);

/**
 * Etapas del scroll: fuego -> brasa -> bruma -> azul océano -> celeste -> hielo.
 * Los cielos son oscuros; los tonos vivos (amarillo, celeste, cian, blanco) van en las luces con
 * poca opacidad, para que el fondo no compita con los textos, gráficos y mapas.
 */
const KEYFRAMES: Keyframe[] = [
  { // fuego
    at: 0,
    sky: [shade(PALETTE.red, 0.74), shade(PALETTE.red, 0.42), shade(PALETTE.orange, 0.52)],
    glows: [
      { color: PALETTE.orange, alpha: 0.26 },
      { color: PALETTE.yellow, alpha: 0.12 },
      { color: PALETTE.red, alpha: 0.2 },
    ],
  },
  { // brasa
    at: 0.22,
    sky: [shade(PALETTE.red, 0.72), shade(PALETTE.orange, 0.55), shade(PALETTE.orange, 0.68)],
    glows: [
      { color: PALETTE.orange, alpha: 0.22 },
      { color: PALETTE.yellow, alpha: 0.12 },
      { color: PALETTE.red, alpha: 0.12 },
    ],
  },
  { // bruma: el calor se disipa
    at: 0.42,
    sky: [shade(PALETTE.ocean, 0.68), shade(PALETTE.ocean, 0.5), shade(PALETTE.orange, 0.72)],
    glows: [
      { color: PALETTE.yellow, alpha: 0.1 },
      { color: PALETTE.white, alpha: 0.08 },
      { color: PALETTE.sky, alpha: 0.12 },
    ],
  },
  { // azul océano
    at: 0.62,
    sky: [PALETTE.navy, deep(0.3), deep(0.12)],
    glows: [
      { color: PALETTE.ocean, alpha: 0.26 },
      { color: PALETTE.cyan, alpha: 0.14 },
      { color: PALETTE.white, alpha: 0.06 },
    ],
  },
  { // celeste
    at: 0.82,
    sky: [PALETTE.navy, deep(0.38), deep(0.2)],
    glows: [
      { color: PALETTE.sky, alpha: 0.18 },
      { color: PALETTE.cyan, alpha: 0.14 },
      { color: PALETTE.white, alpha: 0.08 },
    ],
  },
  { // hielo
    at: 1,
    sky: [PALETTE.navy, deep(0.24), PALETTE.navy],
    glows: [
      { color: PALETTE.white, alpha: 0.1 },
      { color: PALETTE.sky, alpha: 0.16 },
      { color: PALETTE.ocean, alpha: 0.2 },
    ],
  },
];

const PREPARED = KEYFRAMES.map((frame) => ({
  at: frame.at,
  sky: frame.sky.map((hex) => rgbToOklab(hexToRgb(hex))),
  glows: frame.glows.map((glow) => ({ lab: rgbToOklab(hexToRgb(glow.color)), alpha: glow.alpha })),
}));

const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface Palette {
  sky: string[];
  glows: string[];
  /** Colores de las luces (0-255) y su opacidad, para pintar la aurora en el canvas. */
  glowRgb: Rgb[];
  glowAlpha: number[];
}

const samplePalette = (progress: number): Palette => {
  const p = clamp01(progress);
  let index = 0;
  while (index < PREPARED.length - 2 && p > PREPARED[index + 1]!.at) index++;
  const from = PREPARED[index]!;
  const to = PREPARED[index + 1]!;
  const t = smoothstep(clamp01((p - from.at) / (to.at - from.at)));
  const css = (lab: Lab, alpha?: number): string => {
    const [r, g, b] = oklabToRgb(lab);
    return alpha === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha.toFixed(3)})`;
  };
  return {
    sky: from.sky.map((lab, i) => css(mixLab(lab, to.sky[i]!, t))),
    glows: from.glows.map((glow, i) => {
      const target = to.glows[i]!;
      return css(mixLab(glow.lab, target.lab, t), glow.alpha + (target.alpha - glow.alpha) * t);
    }),
    glowRgb: from.glows.map((glow, i) => oklabToRgb(mixLab(glow.lab, to.glows[i]!.lab, t))),
    glowAlpha: from.glows.map((glow, i) => glow.alpha + (to.glows[i]!.alpha - glow.alpha) * t),
  };
};

// ---------- Aurora (cortinas onduladas) ----------

interface Curtain {
  /** Altura media de la base brillante (fracción del alto) y alto de la cortina. */
  base: number;
  height: number;
  /** Tres ondas que viajan: amplitud (fracción del alto), frecuencia (ciclos por ancho), velocidad y fase. */
  waves: [number, number, number, number][];
  /** Rayos verticales: dos frecuencias altas (ciclos por ancho). */
  rays: [number, number];
  phase: number;
}

const CURTAINS: Curtain[] = [
  {
    base: 0.3, height: 0.3, phase: 0,
    waves: [[0.085, 1.1, 0.32, 0], [0.04, 2.3, -0.5, 1.7], [0.02, 4.4, 0.8, 3.1]],
    rays: [15, 7],
  },
  {
    base: 0.45, height: 0.34, phase: 2.1,
    waves: [[0.095, 0.9, -0.27, 2.2], [0.045, 1.9, 0.45, 0.4], [0.022, 3.8, -0.7, 5]],
    rays: [12, 5],
  },
  {
    base: 0.6, height: 0.27, phase: 4.3,
    waves: [[0.075, 1.5, 0.38, 4.1], [0.04, 2.9, -0.55, 2.6], [0.018, 5.3, 0.9, 0.9]],
    rays: [18, 9],
  },
];

/** Perfil vertical de una cortina: borde inferior nítido y desvanecimiento largo hacia arriba. */
const PROFILE_MIN = -0.5;
const PROFILE_MAX = 3;
const PROFILE_STEPS = 256;
const PROFILE_SCALE = (PROFILE_STEPS - 1) / (PROFILE_MAX - PROFILE_MIN);
const PROFILE = (() => {
  const table = new Float32Array(PROFILE_STEPS);
  for (let i = 0; i < PROFILE_STEPS; i++) {
    const u = PROFILE_MIN + i / PROFILE_SCALE; // u > 0: por encima de la base; u < 0: por debajo
    table[i] = u >= 0 ? Math.exp(-u * 1.7) * Math.min(1, 0.55 + u * 6) : Math.exp(u * 11) * 0.55;
  }
  return table;
})();

const TAU = Math.PI * 2;

/** Techos de opacidad: con ellos ningún punto del fondo supera el contraste mínimo con el texto blanco. */
const AURORA_CURTAIN_MAX = 0.6;
const AURORA_ALPHA_CAP = 0.55;

// ---------- Partículas ----------

interface Mote {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
  hue: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
}

const MOTE_YELLOW = hexToRgb(PALETTE.yellow);
const MOTE_ORANGE = hexToRgb(PALETTE.orange);
const MOTE_WHITE = hexToRgb(PALETTE.white);
const MOTE_CYAN = hexToRgb(PALETTE.cyan);

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

const random = (min: number, max: number): number => min + Math.random() * (max - min);

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class BackgroundEffect {
  private readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly resizeObserver: ResizeObserver;
  private readonly reduceMotion = prefersReducedMotion();

  private width = 0;
  private height = 0;
  private dpr = 1;
  private narrow = false;

  private scrollTarget = 0;
  private scrollShown = 0;
  private maxScroll = 1;
  private paletteApplied = -1;
  private rafId = 0;
  private lastTime = 0;
  private scrollQueued = false;

  private motes: Mote[] = [];
  private stars: Star[] = [];

  // Aurora: búfer pequeño que se escala al canvas (suavizado = difuminado gratis).
  private readonly auroraCanvas = document.createElement('canvas');
  private readonly auroraCtx = this.auroraCanvas.getContext('2d');
  private auroraImage: ImageData | null = null;
  private auroraW = 0;
  private auroraH = 0;
  private auroraLast = -1;
  private columns = new Float32Array(0);
  private palette: Palette = samplePalette(0);

  constructor(host: HTMLElement = document.body) {
    this.root.className = 'bg';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `
      <div class="bg__stars"></div>
    `;
    this.auroraCanvas.className = 'bg__aurora';
    this.root.prepend(this.auroraCanvas); // detrás de las estrellas y las partículas
    this.canvas.className = 'bg__canvas';
    this.root.append(this.canvas);
    const shade = document.createElement('div');
    shade.className = 'bg__shade';
    this.root.append(shade);
    host.prepend(this.root);

    this.ctx = this.canvas.getContext('2d');
    this.measure();
    this.populate();
    this.readScroll();
    this.scrollShown = this.scrollTarget;
    this.applyPalette(true);
    if (this.reduceMotion) this.draw(0, 0); // aurora estática

    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.measureScroll());
    this.resizeObserver.observe(document.body);

    if (!this.reduceMotion) this.start();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver.disconnect();
    this.root.remove();
  }

  private measure(): void {
    this.narrow = window.innerWidth < 700;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.narrow ? 1.25 : 1.5);
    this.width = Math.round(window.innerWidth * this.dpr);
    this.height = Math.round(window.innerHeight * this.dpr);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    // Búfer de la aurora: más pequeño en móviles (menos píxeles que calcular).
    this.auroraW = this.narrow ? 160 : 288;
    this.auroraH = Math.max(40, Math.round((this.auroraW * this.height) / Math.max(1, this.width)));
    this.auroraCanvas.width = this.auroraW;
    this.auroraCanvas.height = this.auroraH;
    this.auroraImage = this.auroraCtx ? this.auroraCtx.createImageData(this.auroraW, this.auroraH) : null;
    this.columns = new Float32Array(CURTAINS.length * this.auroraW * 3);
    this.auroraLast = -1;
    this.measureScroll();
  }

  private measureScroll(): void {
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    this.readScroll();
    if (this.reduceMotion) this.applyPalette();
  }

  private populate(): void {
    const k = this.narrow ? 0.5 : 1;
    const count = (n: number): number => Math.max(1, Math.round(n * k));
    
    // Motas de luz que flotan lentamente (efecto etéreo)
    this.motes = Array.from({ length: count(40) }, () => ({
      x: Math.random(),
      y: Math.random(),
      radius: random(0.5, 2),
      speed: random(0.005, 0.015),
      phase: random(0, 6.28),
      hue: random(0, 1), // reparte los tonos de cada zona (amarillo/naranja, blanco/cian)
    }));
    
    // Estrellas que titilan
    this.stars = Array.from({ length: count(12) }, () => ({
      x: Math.random(),
      y: Math.random() * 0.7, // más concentradas arriba
      size: random(1, 2.5),
      speed: random(0.3, 1.2),
      phase: random(0, 6.28),
    }));
  }

  private readScroll(): void {
    this.scrollTarget = clamp01(window.scrollY / this.maxScroll);
  }

  private readonly onScroll = (): void => {
    if (this.scrollQueued) return;
    this.scrollQueued = true;
    requestAnimationFrame(() => {
      this.scrollQueued = false;
      this.readScroll();
      if (this.reduceMotion) {
        this.scrollShown = this.scrollTarget;
        this.applyPalette();
        this.draw(0, 0);
      }
    });
  };

  private readonly onResize = (): void => {
    const widthChanged = Math.round(window.innerWidth * this.dpr) !== this.width;
    if (!widthChanged && Math.abs(Math.round(window.innerHeight * this.dpr) - this.height) < 150) {
      this.measureScroll();
      return;
    }
    this.measure();
    this.populate();
    if (this.reduceMotion) this.draw(0, 0);
  };

  private applyPalette(force = false): void {
    if (!force && Math.abs(this.scrollShown - this.paletteApplied) < 0.0005) return;
    this.paletteApplied = this.scrollShown;
    const palette = samplePalette(this.scrollShown);
    this.palette = palette;
    const { sky, glows } = palette;
    const style = this.root.style;
    style.setProperty('--bg-c1', sky[0]!);
    style.setProperty('--bg-c2', sky[1]!);
    style.setProperty('--bg-c3', sky[2]!);
    style.setProperty('--glow-a', glows[0]!);
    style.setProperty('--glow-b', glows[1]!);
    style.setProperty('--glow-c', glows[2]!);
  }

  private start(): void {
    if (this.rafId || document.hidden) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    } else if (!this.reduceMotion) {
      this.start();
    }
  };

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const elapsed = now - this.lastTime;
    if (this.narrow && elapsed < 32) return;
    const dt = Math.min(0.05, elapsed / 1000);
    this.lastTime = now;

    this.scrollShown += (this.scrollTarget - this.scrollShown) * (1 - Math.exp(-dt / 0.18));
    this.applyPalette();
    this.draw(now / 1000, dt);
  };

  private draw(time: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    
    const warm = clamp01(1 - this.scrollShown / 0.55);
    const cold = clamp01((this.scrollShown - 0.35) / 0.45);
    
    this.drawAurora(time);
    this.drawMotes(ctx, warm, cold, time, dt);
    this.drawStars(ctx, time);
  }

  /**
   * Aurora: tres cortinas onduladas. Se recalcula a ~30 fps (~20 en móvil) en un búfer pequeño que
   * es su propio <canvas>: el navegador lo escala con la GPU (CSS), sin copiarlo cada fotograma con JS.
   */
  private drawAurora(time: number): void {
    const image = this.auroraImage;
    const auroraCtx = this.auroraCtx;
    if (!image || !auroraCtx) return;

    const interval = this.narrow ? 0.05 : 0.033;
    if (this.auroraLast < 0 || time - this.auroraLast >= interval || this.reduceMotion) {
      this.auroraLast = time;
      this.renderAurora(image, time);
      auroraCtx.putImageData(image, 0, 0);
    }
  }

  private renderAurora(image: ImageData, time: number): void {
    const W = this.auroraW;
    const H = this.auroraH;
    const data = image.data;
    const cols = this.columns;
    const { glowRgb, glowAlpha } = this.palette;
    const energy = 1 + (1 - this.scrollShown) * 0.6; // arriba (calor) la aurora baila más rápido
    const t = time * energy;
    const drift = -this.scrollShown * 0.1; // al bajar, las cortinas suben un poco (paralaje)

    // Por columna y cortina: línea base (y), 1/alto efectivo y brillo de los rayos.
    for (let c = 0; c < CURTAINS.length; c++) {
      const curtain = CURTAINS[c]!;
      const offset = c * W * 3;
      for (let x = 0; x < W; x++) {
        const nx = (x / (W - 1)) * TAU;
        let wave = 0;
        for (const [amp, freq, speed, phase] of curtain.waves) wave += amp * Math.sin(nx * freq + t * speed + phase);
        const rays =
          0.5 +
          0.5 *
            Math.sin(nx * curtain.rays[0] + t * 0.9 + curtain.phase) *
            Math.sin(nx * curtain.rays[1] - t * 0.6 + curtain.phase * 2);
        cols[offset + x * 3] = (curtain.base + drift + wave) * H;
        cols[offset + x * 3 + 1] = 1 / (curtain.height * H * (0.7 + 0.6 * rays));
        cols[offset + x * 3 + 2] = 0.55 + 0.45 * rays;
      }
    }

    // Colores de cada cortina: base brillante -> punta, con las tres luces de la paleta.
    const lows = [glowRgb[0]!, glowRgb[1]!, glowRgb[2]!];
    const highs = [glowRgb[1]!, glowRgb[2]!, glowRgb[0]!];
    const alphas = [0, 1, 2].map((i) => Math.min(AURORA_CURTAIN_MAX, (glowAlpha[i] ?? 0.2) * 2.4));

    let o = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++, o += 4) {
        let sum = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let c = 0; c < CURTAINS.length; c++) {
          const k = c * W * 3 + x * 3;
          const u = (cols[k]! - y) * cols[k + 1]!;
          if (u < PROFILE_MIN || u > PROFILE_MAX) continue;
          const intensity = PROFILE[((u - PROFILE_MIN) * PROFILE_SCALE) | 0]! * cols[k + 2]! * alphas[c]!;
          if (intensity < 0.004) continue;
          const mix = u <= 0 ? 0 : u >= 1.5 ? 1 : u / 1.5;
          const low = lows[c]!;
          const high = highs[c]!;
          sum += intensity;
          r += intensity * (low[0] + (high[0] - low[0]) * mix);
          g += intensity * (low[1] + (high[1] - low[1]) * mix);
          b += intensity * (low[2] + (high[2] - low[2]) * mix);
        }
        if (sum < 0.004) {
          data[o + 3] = 0;
          continue;
        }
        const inv = 1 / sum;
        data[o] = r * inv;
        data[o + 1] = g * inv;
        data[o + 2] = b * inv;
        data[o + 3] = Math.min(AURORA_ALPHA_CAP, sum) * 255;
      }
    }
  }

  /** Motas de luz que flotan lentamente: brasas arriba, hielo abajo. */
  private drawMotes(ctx: CanvasRenderingContext2D, warm: number, cold: number, time: number, dt: number): void {
    const { width, height, dpr } = this;
    
    for (const mote of this.motes) {
      // Movimiento orgánico: suben y oscilan suavemente
      mote.y -= mote.speed * dt;
      if (mote.y < -0.05) {
        mote.y = 1.05;
        mote.x = Math.random();
      }
      
      const x = (mote.x + Math.sin(time * 0.3 + mote.phase) * 0.02) * width;
      const y = mote.y * height;
      
      // Color de la mota: brasas (amarillo -> naranja) arriba; motas de hielo (blanco -> cian) abajo.
      const coldShare = warm + cold === 0 ? 0 : cold / (warm + cold);
      const ember = mixRgb(MOTE_YELLOW, MOTE_ORANGE, mote.hue);
      const ice = mixRgb(MOTE_WHITE, MOTE_CYAN, mote.hue);
      const [r, g, b] = mixRgb(ember, ice, coldShare);

      const flicker = 0.4 + 0.6 * Math.sin(time * 1.5 + mote.phase * 2);
      const alpha = (warm + cold) * flicker * 0.3;
      const radius = mote.radius * dpr;
      
      // Glow suave
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = `rgb(${r} ${g} ${b})`;
      ctx.beginPath();
      ctx.arc(x, y, radius * 4, 0, Math.PI * 2);
      ctx.fill();
      
      // Núcleo brillante
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Estrellas que titilan en el cielo. */
  private drawStars(ctx: CanvasRenderingContext2D, time: number): void {
    const { width, height, dpr } = this;
    
    ctx.fillStyle = '#ffffff';
    for (const star of this.stars) {
      const twinkle = Math.pow(Math.max(0, Math.sin(time * star.speed + star.phase)), 4);
      if (twinkle < 0.05) continue;
      
      const x = star.x * width;
      const y = star.y * height;
      const size = star.size * dpr * (0.5 + 0.5 * twinkle);
      
      ctx.globalAlpha = twinkle * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      
      // Destello en cruz para las más brillantes
      if (star.size > 2) {
        ctx.globalAlpha = twinkle * 0.4;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.5 * dpr;
        const arm = size * 3;
        ctx.beginPath();
        ctx.moveTo(x - arm, y);
        ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm);
        ctx.lineTo(x, y + arm);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}