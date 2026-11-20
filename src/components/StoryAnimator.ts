// StoryAnimator: animaciones de entrada de las secciones explicativas (causas, impactos, notas).
// Al entrar en pantalla, cada elemento aparece en cascada y los resaltados (.hl) se subrayan.
// Mejora progresiva: sin JS, sin IntersectionObserver o con "reducir movimiento" todo se ve de inmediato.
// El estilo vive en styles/story.css.
const REVEAL_SELECTOR =
  '.story__head, .story__flow li, .story-card, .story__callout, .story__note, .story__source, .story__links';

export const animateStory = (root: HTMLElement): void => {
  const sections = [...root.querySelectorAll<HTMLElement>('.story')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    sections.forEach((section) => section.classList.add('is-visible'));
    return;
  }

  document.documentElement.classList.add('story-anim');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
  );

  for (const section of sections) {
    section.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((item, i) => {
      item.dataset.reveal = '';
      item.style.setProperty('--i', String(i));
    });
    observer.observe(section);
  }
};
