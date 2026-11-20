// Punto de entrada de "Termómetro de la Tierra".
//
// Flujo completo:
//   1. dataLoader   -> descarga y parsea el CSV de NASA (anomalías vs 1951-1980)
//                      y calcula la línea base 1880-1900 (calculations).
//   2. ChartManager -> dibuja la serie anual (desde 1980) "desenrollando" el tiempo,
//                      con los umbrales de París.
//   3. Clic en el gráfico -> SoundEngine reproduce esa anomalía (soundMapper)
//                      e InfoPanel muestra sus datos (calculations).
//   4. DateRangeControl gobierna el rango visible, la animación y el sonido.
//   5. MapViewer muestra el mapa global del año; sigue al gráfico (animación y sliders) y
//      un clic en el mapa suena y abre su propio InfoPanel (mapData.ts).
import './style.css';
import { ANNUAL_START_YEAR, ChartManager } from './components/ChartManager';
import { ActionsCarousel } from './components/ActionsCarousel';
import { BackgroundEffect } from './components/BackgroundEffect';
import { DateRangeControl } from './components/DateRangeControl';
import { InfoPanel } from './components/InfoPanel';
import { MapViewer } from './components/MapViewer';
import { animateStory } from './components/StoryAnimator';
import { SoundEngine } from './components/SoundEngine';
import { renderCauses, renderImpacts, renderNotes } from './components/StorySections';
import type { ChartSelection, MapData, MapSelection, TemperatureData } from './types';
import { buildSelectionInfo } from './utils/calculations';
import { loadTemperatureData } from './utils/dataLoader';
import { buildMapSelectionInfo, loadMapData } from './utils/mapData';
import { mapAnomalyToSound } from './utils/soundMapper';

/** Año en que empieza la vista inicial (la serie completa llega desde 1926). */
const INITIAL_START_YEAR = 1980;
/** El botón "Ver meses" muestra como máximo los últimos N años del rango actual. */
const MONTHLY_MAX_YEARS = 10;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Falta el elemento #app en index.html.');
const root: HTMLElement = app;

const requireElement = <T extends HTMLElement>(selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Falta el elemento ${selector} en la página.`);
  return element;
};

const renderShell = (): void => {
  root.innerHTML = `
    <main class="page">
      <header class="hero">
        <p class="hero__eyebrow">NASA GISTEMP · 1880 – hoy</p>
        <h1 class="hero__title">Termómetro de la <em>Tierra</em></h1>
        <p class="hero__lede">
          Cada punto es un año; cada año tiene un sonido. Mide cuánto se ha calentado el planeta respecto a la
          línea base <strong>1880-1900</strong> y escucha cómo la calma se vuelve tensión.
        </p>
      </header>
      <section class="panel" id="controls"></section>
      <section class="panel chart-panel">
        <div class="chart-wrap"><canvas id="chart" role="img"
          aria-label="Gráfico de la temperatura global anual con los umbrales de +1,5 y +2,0 grados"></canvas></div>
        <ul class="hints">
          <li class="chip"><strong>Clic</strong> para escuchar y ver los datos</li>
          <li class="chip"><strong>Arrastrar</strong> para ampliar a meses</li>
          <li class="chip"><span class="chip__dot" aria-hidden="true"></span>Supera +1,5 °C</li>
        </ul>
      </section>
      <section id="info" aria-live="polite"></section>
      <section class="panel map-panel" id="map-section"><div id="map"></div></section>
      <section id="map-info" aria-live="polite"></section>
      ${renderCauses()}
      ${renderImpacts()}
      <section id="actions" aria-label="Qué puedes hacer"></section>
      ${renderNotes()}
    </main>
  `;
};

/** Monta el mapa: un clic suena y muestra la información de esa zona en su propio panel. */
const mountMap = (
  data: TemperatureData,
  mapData: MapData,
  mapPanel: InfoPanel,
  chartPanel: InfoPanel,
  playAnomaly: (relative: number) => void,
): MapViewer => {
  const onSelect = (selection: MapSelection): void => {
    const info = buildMapSelectionInfo(data, mapData, selection);
    playAnomaly(info.selection.relative);
    chartPanel.hide();
    mapPanel.show(info);
    requireElement('#map-info').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return new MapViewer(requireElement('#map'), mapData, {
    onSelect,
    onYearChange: () => mapPanel.hide(),
  });
};

/** Crea los componentes y los conecta entre sí. */
const mountApp = (data: TemperatureData, mapData: MapData | null): void => {
  const sound = new SoundEngine();

  // Los navegadores solo permiten audio tras un gesto del usuario.
  document.addEventListener('pointerdown', () => sound.unlock(), { once: true });

  const playAnomaly = (relative: number): void => {
    sound.unlock();
    sound.play(mapAnomalyToSound(relative));
  };

  // Los callbacks usan `chart`, `control` y `panel` solo cuando ya existen (se llaman después
  // del montaje), por eso pueden declararse en cualquier orden.
  const panel = new InfoPanel(requireElement('#info'), {
    onReplay: (info) => playAnomaly(info.selection.relative),
    onZoom: (range) => chart.zoomToMonthly(range),
  });
  const mapPanel = new InfoPanel(requireElement('#map-info'), {
    onReplay: (info) => playAnomaly(info.selection.relative),
    onZoom: () => undefined, // el panel del mapa no ofrece zoom mensual
  });

  const control = new DateRangeControl(requireElement('#controls'), {
    minYear: Math.max(ANNUAL_START_YEAR, data.firstYear),
    maxYear: data.lastYear,
    onRangeChange: (range) =>
      chart.getView().mode === 'annual' ? chart.showAnnual(range) : chart.zoomToMonthly(range),
    onPlay: () => {
      sound.unlock();
      chart.play();
    },
    onToggleMonthly: () => {
      const view = chart.getView();
      if (view.mode === 'monthly') {
        chart.backToAnnual();
        return;
      }
      chart.zoomToMonthly({
        startYear: Math.max(view.range.startYear, view.range.endYear - MONTHLY_MAX_YEARS + 1),
        endYear: view.range.endYear,
      });
    },
    onSoundToggle: (enabled) => {
      sound.setEnabled(enabled);
      if (enabled) sound.unlock();
    },
  });

  const onSelect = (selection: ChartSelection): void => {
    const info = buildSelectionInfo(data, selection);
    playAnomaly(info.selection.relative);
    mapPanel.hide();
    panel.show(info);
    requireElement('#info').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const map = mapData ? mountMap(data, mapData, mapPanel, panel, playAnomaly) : null;

  const chart = new ChartManager(requireElement<HTMLCanvasElement>('#chart'), data, {
    onViewChange: (view) => {
      control.setView(view);
      panel.hide();
      map?.setYear(view.range.endYear); // el mapa sigue al rango elegido
    },
    onProgress: (progress, label, value, year) => {
      control.setProgress(progress, label);
      if (progress < 1) sound.updateDrone(value);
      map?.setYear(year); // y, durante la animación, al año que se va revelando
    },
    onPlayingChange: (playing) => {
      control.setPlaying(playing);
      if (!playing) sound.stopDrone();
    },
    onSelect,
  });

  chart.showAnnual({ startYear: INITIAL_START_YEAR, endYear: data.lastYear });
};

const showError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  const target = root.querySelector('.chart-wrap');
  if (!target) return;
  target.innerHTML = '';
  const paragraph = document.createElement('p');
  paragraph.className = 'error';
  paragraph.textContent = `No se pudieron cargar los datos: ${message}`;
  target.append(paragraph);
};

const start = async (): Promise<void> => {
  new BackgroundEffect(); // fondo ligado al scroll: fuego arriba -> hielo abajo
  renderShell();
  animateStory(root);
  new ActionsCarousel(requireElement('#actions')); // no depende de los datos: siempre se muestra
  try {
    // El mapa es un extra: si no carga, el resto de la app sigue funcionando.
    const [data, mapData] = await Promise.all([
      loadTemperatureData(),
      loadMapData().catch((error: unknown) => {
        console.warn('Mapa no disponible:', error);
        return null;
      }),
    ]);
    if (!mapData) requireElement('#map-section').remove();
    mountApp(data, mapData);
  } catch (error) {
    showError(error);
  }
};

/** Efecto ripple en botones */
const addRippleEffect = (): void => {
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.btn');
    if (!button || button.hasAttribute('disabled')) return;
    
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
};

addRippleEffect();


void start();
