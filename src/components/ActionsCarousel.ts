// ActionsCarousel: sección final "Qué puedes hacer". Carrusel minimalista de acciones.
//
//  - Cada slide: título corto, una frase y (opcional) un dato de impacto.
//  - Profundidad: la slide activa va al frente; las vecinas se ven detrás, más pequeñas y girando
//    levemente (CSS 3D con transform/opacity: suave y barato). En móvil solo se ve la activa.
//  - Navegación discreta: flechas, indicadores, teclado (←, →, Inicio, Fin) y deslizar con el dedo.
//  - Accesible: región con rol de carrusel, anuncia la slide actual y oculta las no activas.
//  - Con "reducir movimiento" no hay transiciones.
// El estilo vive en styles/carousel.css; las cifras son aproximadas y se citan en el pie.
import type { ActionItem } from '../types';

export const DEFAULT_ACTIONS: ActionItem[] = [
  {
    title: 'Come menos carne',
    text: 'Especialmente de res. Una de las acciones individuales con más impacto.',
    fact: { value: '≈ 14,5 %', label: 'de las emisiones globales de origen humano vienen de la ganadería (FAO, 2013)' },
  },
  {
    title: 'Elige energía limpia',
    text: 'Cambia a un proveedor de electricidad renovable si puedes.',
    fact: { value: '≈ 34 %', label: 'de las emisiones globales de 2019 vienen del suministro de energía (IPCC)' },
  },
  {
    title: 'Muévete distinto',
    text: 'Camina, usa bici o transporte público cuando sea posible.',
    fact: { value: '≈ 15 %', label: 'de las emisiones globales de 2019 vienen del transporte (IPCC)' },
  },
  {
    title: 'Reduce el desperdicio de comida',
    text: 'Aprovecha lo que ya tienes. Menos basura = menos emisiones.',
    fact: { value: '8–10 %', label: 'de las emisiones globales vienen de alimentos perdidos o desperdiciados (IPCC)' },
  },
  {
    title: 'Compra menos ropa nueva',
    text: 'La moda rápida tiene un costo climático alto.',
  },
  {
    title: 'Habla de esto',
    text: 'Compartir información también genera cambio.',
  },
  {
    title: 'Actúa en comunidad',
    text: 'Vota, apoya políticas climáticas y súmate a iniciativas de tu barrio, escuela o trabajo. Los cambios grandes son colectivos.',
  },
];

const SWIPE_THRESHOLD_PX = 40;

const pad = (n: number): string => String(n).padStart(2, '0');

export class ActionsCarousel {
  private readonly root: HTMLElement;
  private readonly actions: ActionItem[];
  private readonly slides: HTMLElement[];
  private readonly dots: HTMLButtonElement[];
  private readonly status: HTMLElement;
  private readonly stage: HTMLElement;
  private active = 0;
  private swipeStartX: number | null = null;

  constructor(container: HTMLElement, actions: ActionItem[] = DEFAULT_ACTIONS) {
    if (actions.length === 0) throw new Error('ActionsCarousel: se necesita al menos una acción.');
    this.root = container;
    this.actions = actions;

    container.classList.add('actions');
    container.innerHTML = `
      <header class="actions__head">
        <p class="actions__eyebrow">Y ahora, ¿qué?</p>
        <h2 class="actions__title">Qué puedes hacer</h2>
        <p class="actions__lede">Las decisiones personales ayudan, pero el cambio grande depende también de gobiernos, empresas y comunidades. Hay acciones en ambos niveles.</p>
      </header>
      <div class="actions__carousel" role="region" aria-roledescription="carrusel" aria-label="Acciones recomendadas" tabindex="0">
        <div class="actions__stage" data-role="stage">
          ${actions.map((action, i) => this.renderSlide(action, i)).join('')}
        </div>
        <div class="actions__nav">
          <button type="button" class="actions__arrow" data-role="prev" aria-label="Acción anterior">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="actions__dots" role="group" aria-label="Elegir acción">
            ${actions
              .map((a, i) => `<button type="button" class="actions__dot" data-dot="${i}" aria-label="${i + 1}: ${a.title}"></button>`)
              .join('')}
          </div>
          <button type="button" class="actions__arrow" data-role="next" aria-label="Acción siguiente">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <p class="actions__status" data-role="status" aria-live="polite"></p>
      </div>
      <p class="actions__source">Cifras aproximadas; varían según el año y el método de cálculo. Fuentes:
        <a href="https://www.fao.org/4/i3437e/i3437e.pdf" target="_blank" rel="noopener noreferrer">FAO, Tackling climate change through livestock<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a> ·
        <a href="https://www.ipcc.ch/report/ar6/wg3/" target="_blank" rel="noopener noreferrer">IPCC AR6 GT III<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a> ·
        <a href="https://www.ipcc.ch/srccl/" target="_blank" rel="noopener noreferrer">IPCC SRCCL<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a>.</p>
    `;

    const query = <T extends HTMLElement>(selector: string): T => {
      const element = container.querySelector<T>(selector);
      if (!element) throw new Error(`ActionsCarousel: falta ${selector}`);
      return element;
    };
    this.stage = query('[data-role="stage"]');
    this.status = query('[data-role="status"]');
    this.slides = [...container.querySelectorAll<HTMLElement>('.actions__slide')];
    this.dots = [...container.querySelectorAll<HTMLButtonElement>('.actions__dot')];

    query('[data-role="prev"]').addEventListener('click', () => this.go(this.active - 1));
    query('[data-role="next"]').addEventListener('click', () => this.go(this.active + 1));
    this.dots.forEach((dot, i) => dot.addEventListener('click', () => this.go(i)));

    const carousel = query('.actions__carousel');
    carousel.addEventListener('keydown', this.onKeydown);
    this.stage.addEventListener('pointerdown', this.onPointerDown);
    this.stage.addEventListener('pointerup', this.onPointerUp);
    this.stage.addEventListener('pointercancel', this.onPointerCancel);
    // Un clic en una slide vecina la trae al frente.
    this.slides.forEach((slide, i) => slide.addEventListener('click', () => i !== this.active && this.go(i)));

    this.render(false);
  }

  /** Va a una slide (circular). */
  go(index: number): void {
    const count = this.actions.length;
    this.active = ((index % count) + count) % count;
    this.render(true);
  }

  destroy(): void {
    this.stage.removeEventListener('pointerdown', this.onPointerDown);
    this.stage.removeEventListener('pointerup', this.onPointerUp);
    this.stage.removeEventListener('pointercancel', this.onPointerCancel);
    this.root.innerHTML = '';
    this.root.classList.remove('actions');
  }

  // ---------- Dibujo ----------

  private renderSlide(action: ActionItem, index: number): string {
    const fact = action.fact
      ? `<p class="actions__fact"><strong>${action.fact.value}</strong><span>${action.fact.label}</span></p>`
      : '';
    return `
      <article class="actions__slide" role="group" aria-roledescription="slide"
        aria-label="${index + 1} de ${this.actions.length}">
        <span class="actions__index" aria-hidden="true">${pad(index + 1)}</span>
        <h3 class="actions__slide-title">${action.title}</h3>
        <p class="actions__text">${action.text}</p>
        ${fact}
      </article>
    `;
  }

  /** Reparte las posiciones: la activa al frente y sus vecinas (circulares) a los lados. */
  private render(announce: boolean): void {
    const count = this.actions.length;
    this.slides.forEach((slide, i) => {
      // Distancia circular más corta a la activa, en el rango [-count/2, count/2).
      const offset = ((i - this.active + count + Math.floor(count / 2)) % count) - Math.floor(count / 2);
      const state = offset === 0 ? 'active' : offset === -1 ? 'prev' : offset === 1 ? 'next' : 'hidden';
      slide.dataset.state = state;
      slide.style.setProperty('--o', String(Math.max(-2, Math.min(2, offset))));
      slide.style.setProperty('--abs', String(Math.min(2, Math.abs(offset))));
      // Solo la activa es contenido accesible: las demás son decoración de profundidad.
      slide.setAttribute('aria-hidden', String(state !== 'active'));
    });
    this.dots.forEach((dot, i) => {
      const current = i === this.active;
      dot.classList.toggle('is-active', current);
      if (current) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    if (announce) this.status.textContent = `${this.active + 1} de ${count}: ${this.actions[this.active]!.title}`;
  }

  // ---------- Interacción ----------

  private readonly onKeydown = (event: KeyboardEvent): void => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => this.go(this.active - 1),
      ArrowRight: () => this.go(this.active + 1),
      Home: () => this.go(0),
      End: () => this.go(this.actions.length - 1),
    };
    const handler = keys[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.swipeStartX = event.clientX;
    // Con captura, el pointerup llega aunque el dedo/ratón termine fuera del escenario.
    try {
      this.stage.setPointerCapture(event.pointerId);
    } catch {
      // Sin captura el gesto sigue funcionando mientras termine dentro del escenario.
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.swipeStartX === null) return;
    const dx = event.clientX - this.swipeStartX;
    this.swipeStartX = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    this.go(this.active + (dx < 0 ? 1 : -1));
  };

  private readonly onPointerCancel = (): void => {
    this.swipeStartX = null;
  };
}
