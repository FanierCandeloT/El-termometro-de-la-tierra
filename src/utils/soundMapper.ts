// soundMapper: traduce una anomalía (°C sobre 1880-1900) a parámetros de sonido.
// Funciones puras, sin Web Audio: SoundEngine solo ejecuta lo que se decide aquí.
//
// Idea artística: lo templado suena como un acorde consonante, suave y grave
// (seno, quintas, ataque lento). A medida que sube la anomalía el tono se hace más
// agudo e intenso y aparece la DISONANCIA: segundas menores, tritono, desafinación
// (batidos), onda de sierra, filtro resonante, vibrato nervioso y, por encima de
// +1,5 °C, un chisporroteo de ruido, como calor que cruje.
import type { AnomalyTier } from '../types';
import { classifyAnomaly } from './calculations';

export type Waveform = 'sine' | 'triangle' | 'sawtooth' | 'square';

/** Un armónico/voz del acorde. */
export interface SoundPartial {
  /** Múltiplo de la frecuencia fundamental. */
  ratio: number;
  /** Ganancia relativa (0-1) dentro del acorde. */
  gain: number;
  waveform: Waveform;
  /** Desafinación en cents (genera batidos que suenan "inquietos"). */
  detuneCents: number;
}

export interface SoundParams {
  /** Frecuencia fundamental en Hz. */
  frequency: number;
  /** Volumen máximo (0-1). */
  volume: number;
  /** Duración total en segundos. */
  duration: number;
  /** Tiempo de subida en segundos (lento = suave, rápido = agresivo). */
  attack: number;
  partials: SoundPartial[];
  /** Frecuencia de corte del filtro paso-bajo (Hz). */
  filterCutoff: number;
  /** Resonancia del filtro. */
  filterQ: number;
  vibratoRate: number;
  vibratoDepthCents: number;
  /** Volumen relativo del ruido "crepitante" (0 = ninguno). */
  noiseGain: number;
  /** 0 = armonioso, 1 = máxima tensión/disonancia. */
  tension: number;
  tier: AnomalyTier;
}

/** Parámetros del zumbido continuo que acompaña la animación temporal. */
export interface DroneParams {
  frequency: number;
  filterCutoff: number;
  volume: number;
  /** Desafinación entre las dos voces del zumbido (cents). */
  detuneCents: number;
}

/** Rango de valores relativos que se mapea al rango completo del sonido. */
export const SOUND_MIN_ANOMALY = -0.5;
export const SOUND_MAX_ANOMALY = 2.5;

// Escala pentatónica menor: sonora y "musical" aun con valores bajos.
const PENTATONIC_SEMITONES = [0, 3, 5, 7, 10];
const BASE_FREQUENCY = 110; // A2
const SCALE_STEPS = 14; // ≈ 3 octavas

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Calor normalizado 0-1 a partir de la anomalía. */
export const heatOf = (relative: number): number =>
  clamp01((relative - SOUND_MIN_ANOMALY) / (SOUND_MAX_ANOMALY - SOUND_MIN_ANOMALY));

/** Cuantiza el calor a una nota de la escala pentatónica. */
const quantizedFrequency = (heat: number): number => {
  const step = Math.round(heat * SCALE_STEPS);
  const octave = Math.floor(step / PENTATONIC_SEMITONES.length);
  const semitones = octave * 12 + PENTATONIC_SEMITONES[step % PENTATONIC_SEMITONES.length];
  return BASE_FREQUENCY * Math.pow(2, semitones / 12);
};

const waveformFor = (tension: number): Waveform =>
  tension < 0.2 ? 'sine' : tension < 0.6 ? 'triangle' : 'sawtooth';

/** Sonido de una anomalía: más alta => más agudo, más fuerte, más disonante. */
export const mapAnomalyToSound = (relative: number): SoundParams => {
  const heat = heatOf(relative);
  // La tensión arranca hacia +1 °C y llega al máximo cerca de +2,2 °C.
  const tension = smoothstep(1.0, 2.2, relative);
  const waveform = waveformFor(tension);

  const partials: SoundPartial[] = [
    { ratio: 1, gain: 1, waveform, detuneCents: 0 },
    { ratio: 1.5, gain: 0.45 * (1 - 0.5 * tension), waveform: 'sine', detuneCents: 0 },
    { ratio: 2, gain: 0.3, waveform: 'triangle', detuneCents: 0 },
  ];
  if (tension > 0.05) {
    const spread = tension * 28;
    partials.push(
      { ratio: 16 / 15, gain: 0.4 * tension, waveform, detuneCents: spread }, // segunda menor
      { ratio: Math.SQRT2, gain: 0.35 * tension, waveform, detuneCents: -spread }, // tritono
    );
  }

  return {
    frequency: quantizedFrequency(heat),
    volume: lerp(0.1, 0.34, heat),
    duration: lerp(1.8, 3.2, heat),
    attack: lerp(0.4, 0.02, heat),
    partials,
    filterCutoff: 500 + 6500 * Math.pow(heat, 1.5),
    filterQ: 0.7 + 6 * tension,
    vibratoRate: lerp(3, 9, heat),
    vibratoDepthCents: 3 + 40 * tension,
    noiseGain: clamp01((relative - 1.5) / 1.5) * 0.3,
    tension,
    tier: classifyAnomaly(relative),
  };
};

/** Zumbido continuo (frecuencia continua, sin cuantizar) para la animación del tiempo. */
export const mapAnomalyToDrone = (relative: number): DroneParams => {
  const heat = heatOf(relative);
  const tension = smoothstep(1.0, 2.2, relative);
  return {
    frequency: 55 * Math.pow(2, heat * 2),
    filterCutoff: 300 + 2500 * heat,
    volume: 0.05 + 0.07 * heat,
    detuneCents: tension * 30,
  };
};

const WAVEFORM_NAMES: Record<Waveform, string> = {
  sine: 'onda suave',
  triangle: 'onda triangular',
  sawtooth: 'onda de sierra',
  square: 'onda cuadrada',
};

/** Texto breve que explica cómo suena la anomalía (para el InfoPanel). */
export const describeSound = (params: SoundParams): string => {
  const hz = Math.round(params.frequency);
  const wave = WAVEFORM_NAMES[params.partials[0].waveform];
  const tension = Math.round(params.tension * 100);
  return `${hz} Hz · ${wave} · tensión ${tension} %`;
};
