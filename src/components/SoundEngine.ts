// SoundEngine: sintetiza el sonido en tiempo real con la Web Audio API (sin archivos de audio).
// Decide poco: los parámetros vienen de utils/soundMapper.
//  - play(params): acorde corto (voces + filtro + vibrato + ruido) para una anomalía.
//  - updateDrone(relative)/stopDrone(): zumbido continuo que sigue la animación temporal.
// Los navegadores exigen un gesto del usuario para iniciar el audio: llama a unlock()
// desde un evento (clic, toque).
import { mapAnomalyToDrone, type DroneParams, type SoundParams } from '../utils/soundMapper';

const SILENCE = 0.0001;

interface Drone {
  oscillators: OscillatorNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: Drone | null = null;
  private enabled = true;

  /** Crea/reanuda el AudioContext. Debe llamarse dentro de un gesto del usuario. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopDrone();
  }

  /** Reproduce el sonido de una anomalía. Devuelve false si no pudo sonar. */
  play(params: SoundParams): boolean {
    if (!this.enabled) return false;
    const ctx = this.ensureContext();
    const master = this.master!;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const end = now + params.duration;

    // Envolvente general: ataque (suave o agresivo) y caída exponencial.
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(SILENCE, now);
    envelope.gain.linearRampToValueAtTime(params.volume, now + params.attack);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, end);
    envelope.connect(master);

    // Filtro que "se abre" como un golpe de calor y se cierra despacio.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = params.filterQ;
    filter.frequency.setValueAtTime(params.filterCutoff * 0.25, now);
    filter.frequency.exponentialRampToValueAtTime(params.filterCutoff, now + params.attack + 0.08);
    filter.frequency.exponentialRampToValueAtTime(params.filterCutoff * 0.35, end);
    filter.connect(envelope);

    // Vibrato compartido por todas las voces.
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = params.vibratoRate;
    lfoDepth.gain.value = params.vibratoDepthCents;
    lfo.connect(lfoDepth);
    lfo.start(now);
    lfo.stop(end + 0.05);

    const sources: AudioScheduledSourceNode[] = [lfo];

    for (const partial of params.partials) {
      const osc = ctx.createOscillator();
      const voiceGain = ctx.createGain();
      osc.type = partial.waveform;
      osc.frequency.value = params.frequency * partial.ratio;
      osc.detune.value = partial.detuneCents;
      voiceGain.gain.value = partial.gain / params.partials.length;
      lfoDepth.connect(osc.detune);
      osc.connect(voiceGain).connect(filter);
      osc.start(now);
      osc.stop(end + 0.05);
      sources.push(osc);
    }

    if (params.noiseGain > 0) sources.push(this.crackle(params, now, end, envelope));

    // Libera los nodos cuando termina la última fuente.
    sources[sources.length - 1].onended = () => {
      envelope.disconnect();
      filter.disconnect();
      lfoDepth.disconnect();
    };
    return true;
  }

  /** Zumbido continuo cuyo tono/brillo siguen el valor actual durante la animación. */
  updateDrone(relative: number): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    if (!Number.isFinite(relative)) return; // setTargetAtTime lanza error con NaN/Infinity
    const params = mapAnomalyToDrone(relative);
    const drone = this.drone ?? this.startDrone(params);
    this.applyDrone(drone, params);
  }

  stopDrone(): void {
    const drone = this.drone;
    if (!drone || !this.context) return;
    this.drone = null;
    const now = this.context.currentTime;
    drone.gain.gain.cancelScheduledValues(now);
    drone.gain.gain.setTargetAtTime(SILENCE, now, 0.2);
    drone.oscillators.forEach((osc) => osc.stop(now + 1.2));
    drone.oscillators[0].onended = () => {
      drone.gain.disconnect();
      drone.filter.disconnect();
    };
  }

  destroy(): void {
    this.stopDrone();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  // ---------- Internos ----------

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    const ctx = new AudioContext();
    // Compresor para que las capas de disonancia no saturen.
    const compressor = ctx.createDynamicsCompressor();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(compressor).connect(ctx.destination);
    this.context = ctx;
    this.master = master;
    return ctx;
  }

  /** Ráfaga de ruido filtrado: el "crepitar" del calor extremo. */
  private crackle(
    params: SoundParams,
    now: number,
    end: number,
    destination: AudioNode,
  ): AudioBufferSourceNode {
    const ctx = this.context!;
    const length = Math.ceil(ctx.sampleRate * params.duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Ruido blanco "a chispazos": pocos impulsos fuertes entre silencios.
      samples[i] = Math.random() < 0.08 ? Math.random() * 2 - 1 : 0;
    }
    const source = ctx.createBufferSource();
    const band = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    band.type = 'bandpass';
    band.frequency.value = Math.min(6000, params.filterCutoff);
    band.Q.value = 0.8;
    gain.gain.value = params.noiseGain * 3;
    source.connect(band).connect(gain).connect(destination);
    source.start(now);
    source.stop(end + 0.05);
    return source;
  }

  private startDrone(params: DroneParams): Drone {
    const ctx = this.context!;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = params.filterCutoff;
    gain.gain.setValueAtTime(SILENCE, ctx.currentTime);
    filter.connect(gain).connect(this.master!);

    const types: OscillatorType[] = ['sine', 'triangle'];
    const oscillators = types.map((type) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = params.frequency;
      osc.connect(filter);
      osc.start();
      return osc;
    });
    this.drone = { oscillators, filter, gain };
    return this.drone;
  }

  private applyDrone(drone: Drone, params: DroneParams): void {
    const now = this.context!.currentTime;
    const glide = 0.15; // suaviza los cambios entre frames
    drone.oscillators[0].frequency.setTargetAtTime(params.frequency, now, glide);
    drone.oscillators[1].frequency.setTargetAtTime(params.frequency, now, glide);
    drone.oscillators[1].detune.setTargetAtTime(params.detuneCents, now, glide);
    drone.filter.frequency.setTargetAtTime(params.filterCutoff, now, glide);
    drone.gain.gain.setTargetAtTime(params.volume, now, 0.3);
  }
}
