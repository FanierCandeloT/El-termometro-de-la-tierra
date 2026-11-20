// StorySections: texto de las secciones explicativas (causas, impactos y fuentes).
// Son HTML estático (sin datos ni interacción): conectan el gráfico y el mapa con el "por qué" y el "y entonces qué".
// Reglas de contenido: lenguaje claro, párrafos breves, y solo afirmaciones que respaldan las fuentes citadas
// junto a cada sección. No se incluyen cifras que no puedan verificarse con esas fuentes.
// El estilo vive en styles/story.css.

type Source = { label: string; href: string };

const SOURCES = {
  nasaCauses: { label: 'NASA, Causas del cambio climático', href: 'https://science.nasa.gov/climate-change/causes/' },
  nasaEffects: { label: 'NASA, Efectos del cambio climático', href: 'https://science.nasa.gov/climate-change/effects/' },
  ipccWg1: { label: 'IPCC AR6, Grupo de trabajo I (base científica)', href: 'https://www.ipcc.ch/report/ar6/wg1/' },
  ipccWg3: { label: 'IPCC AR6, Grupo de trabajo III (mitigación)', href: 'https://www.ipcc.ch/report/ar6/wg3/' },
  ipccSyr: { label: 'IPCC AR6, Informe de síntesis', href: 'https://www.ipcc.ch/report/ar6/syr/' },
  ipccSrccl: { label: 'IPCC, Informe especial sobre cambio climático y tierra', href: 'https://www.ipcc.ch/srccl/' },
  gistemp: { label: 'NASA GISTEMP v4', href: 'https://data.giss.nasa.gov/gistemp/' },
} as const satisfies Record<string, Source>;

const link = ({ label, href }: Source): string =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a>`;

const sourceLine = (sources: Source[]): string =>
  `<p class="story__source"><span>Fuentes:</span> ${sources.map(link).join(' · ')}</p>`;

export const renderCauses = (): string => `
  <section class="story story--causes" aria-labelledby="causes-title">
    <header class="story__head">
      <p class="story__eyebrow">Las causas</p>
      <h2 class="story__title" id="causes-title">¿Por qué se calienta el planeta?</h2>
      <p class="story__lede">
        La curva que acabas de recorrer sube porque las <strong class="hl">actividades humanas</strong> han aumentado los <strong class="hl">gases de efecto
        invernadero</strong> en la atmósfera. Esos gases <strong class="hl">retienen más calor</strong> cerca de la superficie.
      </p>
    </header>

    <ol class="story__flow" aria-label="Cómo se llega del origen al calentamiento">
      <li><strong>Actividades humanas</strong><span>energía, transporte, industria, campos y alimentos</span></li>
      <li><strong>Más gases de efecto invernadero</strong><span>sobre todo dióxido de carbono y metano</span></li>
      <li><strong>Más calor retenido</strong><span>la atmósfera deja escapar menos calor</span></li>
      <li class="story__flow-last"><strong>Sube la temperatura global</strong><span>lo que muestra el gráfico</span></li>
    </ol>

    <ul class="story__cards">
      <li class="story-card">
        <h3>Combustibles fósiles</h3>
        <p>Quemar carbón, petróleo y gas para producir electricidad, mover vehículos y fabricar cosas es la <strong class="hl">principal fuente de CO₂</strong>.</p>
      </li>
      <li class="story-card">
        <h3>Uso del suelo</h3>
        <p>Talar bosques y transformar la tierra libera el carbono almacenado y reduce la capacidad de absorber más.</p>
      </li>
      <li class="story-card">
        <h3>Sistemas alimentarios</h3>
        <p>La agricultura, la ganadería y los alimentos que se desperdician emiten metano, óxido nitroso y CO₂.</p>
      </li>
    </ul>

    <p class="story__note">
      Los ciclos naturales también influyen en la temperatura de un año concreto, por eso la serie sube con
      altibajos. La tendencia de décadas es la que apunta a las actividades humanas.
    </p>
    ${sourceLine([SOURCES.nasaCauses, SOURCES.ipccWg1, SOURCES.ipccWg3, SOURCES.ipccSrccl])}
  </section>
`;

export const renderImpacts = (): string => `
  <section class="story story--impacts" aria-labelledby="impacts-title">
    <header class="story__head">
      <p class="story__eyebrow">Las consecuencias</p>
      <h2 class="story__title" id="impacts-title">¿Qué significa ese cambio?</h2>
      <p class="story__lede">
        Unas décimas de grado en el promedio global se traducen en <strong class="hl">cambios reales</strong>. Estos son algunos ejemplos.
      </p>
    </header>

    <ul class="story__cards story__cards--four">
      <li class="story-card">
        <h3>Olas de calor</h3>
        <p>Los episodios de calor extremo son más frecuentes e intensos en muchas regiones, con riesgos para la salud, el trabajo y los cultivos.</p>
      </li>
      <li class="story-card">
        <h3>Cambios en las lluvias</h3>
        <p>Algunas zonas reciben lluvias más fuertes e inundaciones; otras, sequías más largas o intensas.</p>
      </li>
      <li class="story-card">
        <h3>Pérdida de hielo</h3>
        <p>Los glaciares, las capas de hielo y el hielo marino del Ártico se reducen a medida que el planeta se calienta.</p>
      </li>
      <li class="story-card">
        <h3>Nivel del mar</h3>
        <p>El mar sube porque el agua se expande al calentarse y porque se derrite hielo de tierra firme. Afecta sobre todo a las costas.</p>
      </li>
    </ul>

    <aside class="story__callout" aria-label="Importante">
      <h3>Los efectos <span class="hl">no son iguales</span> en todas partes</h3>
      <p>
        Dependen de la región, de la geografía y de cuán preparada esté cada comunidad. Además, el mapa de anomalías
        que viste muestra solo la <strong class="hl">temperatura</strong>: por sí solo no representa lluvias, hielo, nivel del mar
        ni los daños concretos de cada lugar.
      </p>
    </aside>
    ${sourceLine([SOURCES.nasaEffects, SOURCES.ipccWg1, SOURCES.ipccSyr])}
  </section>
`;

export const renderNotes = (): string => `
  <footer class="story story--notes" aria-labelledby="notes-title">
    <h2 class="story__title story__title--small" id="notes-title">Fuentes y notas</h2>
    <p class="page__note">
      <strong>Datos de temperatura:</strong> ${link(SOURCES.gistemp)}. Los datos originales son
      <strong>anomalías respecto al promedio 1951-1980</strong>; aquí se reexpresan restando la media 1880-1900 de la
      misma serie. El año en curso es parcial. El mapa usa la malla regional de GISTEMP (promedios anuales en celdas
      de 4°) y muestra la anomalía original respecto a 1951-1980.
    </p>
    <p class="page__note">
      <strong>Explicaciones de las secciones "¿Por qué se calienta el planeta?" y "¿Qué significa ese cambio?":</strong>
      son resúmenes simplificados de las fuentes citadas en cada sección.
      Las cifras de "Qué puedes hacer" son aproximadas y varían según el año y el método de cálculo.
    </p>
    <ul class="story__links">
      <li>${link(SOURCES.nasaCauses)}</li>
      <li>${link(SOURCES.nasaEffects)}</li>
      <li>${link(SOURCES.ipccWg1)}</li>
      <li>${link(SOURCES.ipccWg3)}</li>
      <li>${link(SOURCES.ipccSyr)}</li>
      <li>${link(SOURCES.ipccSrccl)}</li>
    </ul>
  </footer>
`;
