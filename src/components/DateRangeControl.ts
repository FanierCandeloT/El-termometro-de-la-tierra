// DateRangeControl: controles de UI para el rango visible y la animación temporal.
//  - Dos sliders (año inicial / final) + atajos (1926–hoy, 1980–hoy, 2000–hoy).
//  - Botón de reproducir (repite la animación "desenrollando" el tiempo).
//  - Botón para alternar vista anual <-> mensual.
//  - Barra de progreso con el año/mes actual de la animación.
// No conoce al gráfico: solo emite callbacks y recibe el estado con set*().
import type { ChartMode, ChartView, YearRange } from '../types';

export interface DateRangeControlOptions {
  minYear: number;
  maxYear: number;
  onRangeChange: (range: YearRange) => void;
  onPlay: () => void;
  onToggleMonthly: () => void;
  /** Activa/desactiva el sonido; recibe el nuevo estado. */
  onSoundToggle: (enabled: boolean) => void;
}

export class DateRangeControl {
  private readonly options: DateRangeControlOptions;
  private readonly startInput: HTMLInputElement;
  private readonly endInput: HTMLInputElement;
  private readonly startLabel: HTMLElement;
  private readonly endLabel: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly progressBar: HTMLElement;
  private readonly progressLabel: HTMLElement;

  constructor(container: HTMLElement, options: DateRangeControlOptions) {
    this.options = options;
    const { minYear, maxYear } = options;
    const presets = [minYear, 1980, 2000].filter((y, i, arr) => y >= minYear && arr.indexOf(y) === i);

    container.classList.add('range-control');
    container.innerHTML = `
      <div class="range-control__sliders">
        <label class="range-control__field">
          <span>Desde <strong data-role="start-label"></strong></span>
          <input type="range" data-role="start" min="${minYear}" max="${maxYear}" step="1" />
        </label>
        <label class="range-control__field">
          <span>Hasta <strong data-role="end-label"></strong></span>
          <input type="range" data-role="end" min="${minYear}" max="${maxYear}" step="1" />
        </label>
      </div>
      <div class="range-control__actions">
        <div class="range-control__presets" role="group" aria-label="Atajos de rango">
          ${presets
            .map((y) => `<button type="button" class="btn btn--ghost" data-start="${y}">${y}–${maxYear}</button>`)
            .join('')}
        </div>
        <button type="button" class="btn btn--action" data-role="play">▶ Reproducir</button>
        <button type="button" class="btn btn--ghost" data-role="mode">Ver meses</button>
        <button type="button" class="btn btn--ghost" data-role="sound" aria-pressed="true">🔊 Sonido: sí</button>
      </div>
      <div class="range-control__progress" aria-live="off">
        <div class="progress"><div class="progress__bar" data-role="bar"></div></div>
        <span class="range-control__current" data-role="current"></span>
      </div>
    `;

    const q = <T extends HTMLElement>(role: string): T =>
      container.querySelector<T>(`[data-role="${role}"]`)!;
    this.startInput = q('start');
    this.endInput = q('end');
    this.startLabel = q('start-label');
    this.endLabel = q('end-label');
    this.playButton = q('play');
    this.modeButton = q('mode');
    this.soundButton = q('sound');
    this.progressBar = q('bar');
    this.progressLabel = q('current');

    // 'input' solo actualiza las etiquetas; 'change' (al soltar) aplica el rango.
    this.startInput.addEventListener('input', () => this.syncLabels());
    this.endInput.addEventListener('input', () => this.syncLabels());
    this.startInput.addEventListener('change', () => this.commit('start'));
    this.endInput.addEventListener('change', () => this.commit('end'));

    container.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((button) =>
      button.addEventListener('click', () => {
        this.setSliders({ startYear: Number(button.dataset.start), endYear: maxYear });
        this.options.onRangeChange(this.readRange());
      }),
    );
    this.playButton.addEventListener('click', () => this.options.onPlay());
    this.modeButton.addEventListener('click', () => this.options.onToggleMonthly());
    this.soundButton.addEventListener('click', () => {
      const enabled = this.soundButton.getAttribute('aria-pressed') !== 'true';
      this.soundButton.setAttribute('aria-pressed', String(enabled));
      this.soundButton.textContent = enabled ? '🔊 Sonido: sí' : '🔇 Sonido: no';
      this.options.onSoundToggle(enabled);
    });
  }

  /** Refleja la vista actual del gráfico (no dispara callbacks). */
  setView(view: ChartView): void {
    this.setSliders(view.range);
    this.setMode(view.mode);
  }

  /** Progreso de la animación (0-1) y etiqueta del punto actual. */
  setProgress(progress: number, label: string): void {
    this.progressBar.style.width = `${Math.round(progress * 100)}%`;
    this.progressLabel.textContent = label;
  }

  /** Deshabilita "Reproducir" mientras la animación está en curso. */
  setPlaying(playing: boolean): void {
    this.playButton.disabled = playing;
    this.playButton.textContent = playing ? '… Reproduciendo' : '▶ Reproducir';
  }

  private setMode(mode: ChartMode): void {
    this.modeButton.textContent = mode === 'annual' ? 'Ver meses' : 'Volver a vista anual';
  }

  private setSliders(range: YearRange): void {
    this.startInput.value = String(range.startYear);
    this.endInput.value = String(range.endYear);
    this.syncLabels();
  }

  private readRange(): YearRange {
    return { startYear: Number(this.startInput.value), endYear: Number(this.endInput.value) };
  }

  private syncLabels(): void {
    this.startLabel.textContent = this.startInput.value;
    this.endLabel.textContent = this.endInput.value;
  }

  /** Mantiene inicio <= fin moviendo el otro slider si hace falta. */
  private commit(changed: 'start' | 'end'): void {
    const range = this.readRange();
    if (range.startYear > range.endYear) {
      if (changed === 'start') this.endInput.value = this.startInput.value;
      else this.startInput.value = this.endInput.value;
    }
    this.syncLabels();
    this.options.onRangeChange(this.readRange());
  }
}
