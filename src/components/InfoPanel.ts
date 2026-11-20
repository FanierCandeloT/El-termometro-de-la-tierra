// InfoPanel: panel que aparece al hacer clic en una zona del gráfico.
// Muestra el valor de la anomalía, el promedio de la ventana de tiempo, la distancia
// a los umbrales de París, el ranking y cómo suena ese valor. Un "termómetro"
// horizontal y un brillo Hot Pink (--heat) crecen con la intensidad.
// No genera sonido ni toca el gráfico: emite callbacks (replay, zoom, close).
import type { AnomalyTier, SelectionInfo, YearRange } from '../types';
import { SOUND_MAX_ANOMALY, SOUND_MIN_ANOMALY, describeSound, heatOf, mapAnomalyToSound } from '../utils/soundMapper';

export interface InfoPanelOptions {
  onReplay: (info: SelectionInfo) => void;
  /** Pide ver en vista mensual el rango dado (solo se ofrece desde la vista anual). */
  onZoom: (range: YearRange) => void;
}

const TIER_COPY: Record<AnomalyTier, { title: string; verse: string }> = {
  calm: { title: 'Aguas tranquilas', verse: 'Un murmullo: el planeta respira cerca de su equilibrio.' },
  warm: { title: 'Calor creciente', verse: 'El pulso se acelera apenas; el calor empieza a dejar huella.' },
  hot: { title: 'Fiebre en ascenso', verse: 'La tierra se agita: ya no es un susurro.' },
  critical: { title: 'Umbral superado', verse: 'La línea de París queda atrás. El aire vibra.' },
  extreme: { title: 'Territorio extremo', verse: 'Más allá de +2 °C el sonido se quiebra, como el suelo bajo el calor.' },
};

const signed = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;

const gaugePercent = (value: number): number => heatOf(value) * 100;

export class InfoPanel {
  private readonly container: HTMLElement;
  private readonly options: InfoPanelOptions;
  private current: SelectionInfo | null = null;

  constructor(container: HTMLElement, options: InfoPanelOptions) {
    this.container = container;
    this.options = options;
    this.container.classList.add('info-host');
    this.container.hidden = true;

    // Delegación de eventos: el contenido se vuelve a pintar en cada selección.
    this.container.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action || !this.current) return;
      if (action === 'close') this.hide();
      if (action === 'replay') this.options.onReplay(this.current);
      if (action === 'zoom') {
        const year = this.current.selection.year;
        this.options.onZoom({ startYear: year - 1, endYear: year + 1 });
      }
    });
  }

  show(info: SelectionInfo): void {
    this.current = info;
    this.container.hidden = false;
    this.container.innerHTML = this.render(info);
    // Reinicia la animación de entrada.
    this.container.classList.remove('info-host--in');
    void this.container.offsetWidth;
    this.container.classList.add('info-host--in');
  }

  hide(): void {
    this.current = null;
    this.container.hidden = true;
    this.container.innerHTML = '';
  }

  private render(info: SelectionInfo): string {
    const { selection, tier, window: win, thresholds, rank } = info;
    const copy = TIER_COPY[tier];
    const heat = heatOf(selection.relative);
    const sound = describeSound(mapAnomalyToSound(selection.relative));
    const gaugeTicks = thresholds
      .map((t) => `<span class="gauge__tick" style="left:${gaugePercent(t.threshold.value)}%"><i></i>${t.threshold.value.toFixed(1)}</span>`)
      .join('');
    const distances = thresholds
      .map(({ threshold, delta }) => {
        const text =
          delta >= 0
            ? `<strong class="is-over">supera en ${delta.toFixed(2)} °C</strong>`
            : `<strong>faltan ${Math.abs(delta) < 0.005 ? 'menos de 0,01' : Math.abs(delta).toFixed(2)} °C</strong>`;
        return `<div><dt>Umbral +${threshold.value.toFixed(1)} °C</dt><dd>${text}</dd></div>`;
      })
      .join('');

    return `
      <article class="info" data-tier="${tier}" style="--heat:${heat.toFixed(3)}">
        <div class="info__main">
        <header class="info__header">
          <span class="info__tier">${copy.title}</span>
          <button type="button" class="info__close" data-action="close" aria-label="Cerrar panel">×</button>
        </header>
        <h2 class="info__label">${selection.label}</h2>
        <p class="info__value">${signed(selection.relative)}<small> °C sobre 1880-1900${info.note ? ' (aprox.)' : ''}</small></p>
        <p class="info__verse">${copy.verse}</p>

        <div class="gauge" role="img" aria-label="Posición ${signed(selection.relative)} °C en una escala de ${SOUND_MIN_ANOMALY} a ${SOUND_MAX_ANOMALY} °C">
          <div class="gauge__track"><div class="gauge__marker" style="left:${gaugePercent(selection.relative)}%"></div></div>
          ${gaugeTicks}
        </div>
        </div>

        <div class="info__side">
        <dl class="info__stats">
          <div><dt>${win.label}</dt><dd><strong>${signed(win.relative)} °C</strong></dd></div>
          ${distances}
          <div><dt>Ranking</dt><dd><strong>n.º ${rank.position}</strong> de ${rank.total} ${rank.unit}${selection.region ? ' en esta zona' : ''}</dd></div>
        </dl>

        <p class="info__original">
          Dato original de NASA: <strong>${signed(selection.anomaly)} °C</strong> respecto al promedio 1951-1980
          (la app lo reexpresa respecto a 1880-1900).
        </p>
        ${info.note ? `<p class="info__note">${info.note}</p>` : ''}
        <p class="info__sound">Así suena: ${sound}</p>

        <div class="info__actions">
          <button type="button" class="btn btn--ghost" data-action="replay">🔊 Escuchar de nuevo</button>
          ${
            selection.mode === 'annual' && !selection.region
              ? '<button type="button" class="btn btn--ghost" data-action="zoom">Ver meses de este período</button>'
              : ''
          }
        </div>
        </div>
      </article>
    `;
  }
}
