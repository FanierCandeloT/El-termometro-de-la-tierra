# Termómetro de la Tierra

Prototipo académico de una aplicación web interactiva que **muestra y hace escuchar** cuánto se ha calentado el planeta desde 1880. Cada punto del gráfico es un año; cada año tiene un sonido: lo templado suena grave y armonioso, y a medida que sube la temperatura el tono se vuelve más agudo, tenso y disonante.

Construida con **Vite + TypeScript** (modo estricto), **Chart.js** y la **Web Audio API**. No usa frameworks ni archivos de audio: el sonido se sintetiza en tiempo real.

## Qué se puede hacer

- **Ver la serie anual** de temperatura global (desde 1926; la vista inicial empieza en 1980) con una animación que "desenrolla" el tiempo.
- **Comparar con los umbrales del Acuerdo de París**: +1,5 °C y +2,0 °C respecto a la línea base 1880-1900.
- **Hacer clic** en cualquier punto: suena esa anomalía y se abre un panel con su valor, el promedio de una ventana de tiempo, la distancia a cada umbral, el ranking histórico y una descripción del sonido.
- **Arrastrar** sobre el gráfico (o usar "Ver meses") para ampliar una época a **vista mensual**.
- **Ajustar el rango** con los sliders y los atajos, y repetir la animación con "Reproducir" (mientras corre suena un zumbido continuo que sigue el valor).
- Activar o silenciar el sonido desde el botón "Sonido".
- **Explorar el mapa global** de anomalías por región (azul = más frío que 1951-1980, blanco = normal, naranja/rojo = más cálido):
  - sigue al gráfico: al mover los sliders o pulsar "Reproducir", el mapa se transforma suavemente hasta el año correspondiente;
  - tiene su propio slider (1926 – hoy);
  - los **puntos rosa** marcan los focos más cálidos del año;
  - un clic en cualquier zona suena y abre un panel con la anomalía, el promedio de 10 años en esa zona y la distancia a los umbrales de París.

## Recorrido de la página

1. **Introducción** (título, qué muestran los datos y la línea base 1880-1900).
2. **Exploración histórica**: controles, gráfico y sonido.
3. **Mapa global** de anomalías.
4. **¿Por qué se calienta el planeta?** (causas: combustibles fósiles, uso del suelo y sistemas alimentarios).
5. **¿Qué significa ese cambio?** (olas de calor, lluvias, hielo, nivel del mar; los efectos varían por región).
6. **Qué puedes hacer**: carrusel con acciones personales y colectivas.
7. **Fuentes y notas**: NASA GISTEMP, IPCC y NASA Clima, citadas también junto a cada sección. El texto vive en `StorySections.ts` y `ActionsCarousel.ts`.

## Fondo ligado al scroll

El fondo va **del calor al frío** con el scroll. Arriba es la parte caliente de la página: rojos, naranjas y amarillos, con brasas que flotan. Al bajar se enfría hasta azules oceánicos, celeste, cian y blanco, con motas de hielo. Tres cortinas de luz ondulan (suma de ondas que viajan, con rayos verticales suaves) y cambian de color con el scroll. La paleta del fondo está en `variables.css` y `BackgroundEffect.ts` (rojo `#D93A24`, naranja `#FF7A1A`, amarillo `#FFC83D`, Navy `#0F183D`, océano `#167D9A`, celeste `#63C7D5`, cian `#2FD0E6` y blanco); el rosa `#FF3D8B` se reserva para datos, anomalías y acciones importantes.

- `BackgroundEffect.ts` calcula el color a partir del progreso de scroll, con interpolación en OKLab entre fotogramas clave, y lo aplica con seis variables CSS; el resto es CSS con `transform` (manchas de luz que derivan) y un único `<canvas>` con pocas partículas.
- Las cortinas de luz se calculan por código en un búfer pequeño y se escala con suavizado: queda difusa **sin usar `filter: blur`**, que es muy caro (con él la página bajaba a ~5 fps en una prueba sin GPU; ahora ~40-60 fps). En móvil el búfer es aún menor y se actualiza a ~20 fps. Se pausa con la pestaña oculta.
- La legibilidad se mantiene: los colores del fondo son oscuros (texto blanco con contraste ≥ 4,5:1) y los paneles llevan fondo Navy casi opaco.
- Si el sistema pide **reducir el movimiento** (`prefers-reduced-motion`), las cortinas se quedan quietas y se desactivan las partículas y las animaciones del gráfico: el color solo sigue al scroll.

### Móvil

La página es responsive (probada desde 320 px hasta escritorio, sin desbordes horizontales y con objetivos táctiles de al menos 44 px): respeta las zonas seguras del notch (`viewport-fit=cover`), usa el alto de pantalla "pequeño" (`svh`) para el gráfico, desactiva los desenfoques de fondo de paneles y botones en pantallas táctiles y tiene ajustes para teléfonos muy estrechos y para modo horizontal.

## Sección "Qué puedes hacer"

Un carrusel minimalista (`ActionsCarousel.ts`) cierra la página con seis acciones: comer menos carne, elegir energía limpia, moverse distinto, reducir el desperdicio de comida, comprar menos ropa nueva y hablar del tema. Cada slide tiene un título corto, una frase y, cuando aplica, una cifra de impacto (aproximada: FAO, IPCC, IEA y UNEP).

- La slide activa va al frente y las vecinas se ven detrás con perspectiva (solo `transform` y `opacity`); en móvil se ve solo la activa.
- Navegación: flechas, indicadores, teclado (← → Inicio Fin) y deslizar con el dedo o el ratón. Es accesible (región tipo carrusel, anuncia la slide actual) y sin transiciones con "reducir movimiento".
- Para cambiar las acciones, edita `DEFAULT_ACTIONS` en el componente.

## Cómo se tratan los datos

Los datos originales de NASA GISTEMP **no son temperaturas absolutas**: son **anomalías respecto al promedio 1951-1980**. La app:

1. Descarga y parsea el CSV (`public/data/GLB.Ts+dSST.csv`), ignorando los meses sin dato (`***`).
2. Calcula la línea base preindustrial como el **promedio de todos los meses de 1880-1900** de la misma serie (≈ −0,22 °C respecto a 1951-1980).
3. Reexpresa cada valor restando esa base, de modo que los umbrales de París se leen directamente (+1,5 °C, +2,0 °C).
4. Conserva siempre el valor original de NASA, que se muestra junto al valor reexpresado.

Los promedios se calculan sobre ventanas de tiempo (10 años en la vista anual, el año calendario en la mensual), nunca sobre meses aislados. El año en curso es **parcial** y se indica como tal.

> La línea base 1880-1900 es una aproximación habitual de la era preindustrial, no una definición oficial única.

### Mapa regional

El mapa usa la **malla oficial de GISTEMP v4** (`gistemp1200_GHCNv4_ERSSTv5`, celdas de 2°). El script `scripts/build-map-data.py` la convierte en `public/data/map-data.json` (≈ 590 KB): promedios **anuales** de 1926 a hoy, agregados a celdas de **4°**, cuantizados a 0,1 °C y con el contorno de los continentes. Se dibuja directamente en un `<canvas>` (sin imágenes ni librerías de mapas), interpolando entre celdas y entre años para que las transiciones sean suaves.

- El mapa muestra la anomalía **original de NASA (respecto a 1951-1980)**, como los mapas oficiales.
- Los umbrales de París se definen para la **media global**. Para un clic regional, la app aproxima el valor respecto a 1880-1900 sumando la diferencia de la base global (≈ 0,22 °C), porque en muchas zonas no hay datos fiables en 1880-1900. El InfoPanel lo indica con el aviso "aprox.".
- Para regenerar los datos del mapa (por ejemplo, cuando NASA publique meses nuevos): `python scripts/build-map-data.py` (solo requiere Python 3; descarga los datos por sí mismo).

## Estructura

```
public/data/GLB.Ts+dSST.csv   Serie global de NASA GISTEMP v4
public/data/map-data.json     Malla regional anual (generada con scripts/build-map-data.py)
scripts/build-map-data.py     Genera el JSON del mapa desde la malla oficial de NASA
src/main.ts                   Integración: datos -> gráfico -> sonido -> panel
src/components/
  ChartManager.ts             Gráfico Chart.js, animación temporal, zoom, selección
  DateRangeControl.ts         Sliders, atajos, reproducir, vista mensual, sonido
  SoundEngine.ts              Síntesis con Web Audio API
  InfoPanel.ts                Panel de información de la zona seleccionada
  MapViewer.ts                Mapa global interactivo de anomalías (canvas)
  BackgroundEffect.ts         Fondo fuego -> hielo ligado al scroll
src/utils/
  dataLoader.ts               Descarga y parseo del CSV
  calculations.ts             Línea base, conversión, ventanas, filtros, ranking
  soundMapper.ts              Anomalía -> parámetros de sonido (funciones puras)
  mapData.ts                  Carga del mapa, consultas de celdas, puntos calientes, info regional
src/types/index.ts            Tipos e interfaces compartidos
src/styles/                   variables.css (paleta y tokens), main.css y background.css
```

## Instalación y ejecución

Requiere [Node.js](https://nodejs.org/) 18 o superior.

```bash
npm install        # instala dependencias
npm run dev        # servidor de desarrollo (http://localhost:5173)
npm run build      # comprueba tipos (tsc estricto) y genera dist/
npm run preview    # sirve dist/ para probar el build
```

El navegador solo permite audio después de un gesto del usuario: el sonido comienza con el primer clic o toque.

## Despliegue en GitHub Pages

`vite.config.ts` usa `base: './'`, así que el build funciona desde cualquier subruta (`https://usuario.github.io/repositorio/`).

### Opción A: GitHub Actions (recomendada)

1. Sube el proyecto a un repositorio de GitHub.
2. En **Settings → Pages**, elige **Source: GitHub Actions**.
3. Crea `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Opción B: manual con `gh-pages`

```bash
npm install -D gh-pages
```

Añade en `package.json`, dentro de `scripts`: `"deploy": "npm run build && gh-pages -d dist"`. Luego ejecuta `npm run deploy` y, en **Settings → Pages**, selecciona la rama `gh-pages`.

## Créditos de los datos

- **NASA Goddard Institute for Space Studies (GISS)**, *GISS Surface Temperature Analysis (GISTEMP v4)*, serie "Land-Ocean: Global Means".
  - Datos: <https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv>
  - Malla regional del mapa: <https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz>
  - Proyecto: <https://data.giss.nasa.gov/gistemp/>
- Cita recomendada por NASA: GISTEMP Team, *GISS Surface Temperature Analysis (GISTEMP), version 4*. NASA Goddard Institute for Space Studies. Lenssen, N. et al. (2019), *Improvements in the GISTEMP uncertainty model*, J. Geophys. Res. Atmos., 124(12), 6307-6326.

Los datos de NASA son de acceso público. Este proyecto es académico y no está afiliado ni avalado por NASA.

## Recursos libres utilizados

El proyecto se apoya únicamente en recursos libres y gratuitos:

- **Chart.js** (licencia MIT) para el gráfico.
- **Vite** (MIT) y **TypeScript** (Apache-2.0) como herramientas de desarrollo.
- **Web Audio API**, estándar abierto del navegador: el sonido se genera por código, sin muestras ni archivos de audio de terceros.
- **Fraunces** e **Inter** (licencia SIL Open Font License) servidas desde Google Fonts; si no cargan se usan fuentes del sistema.
- Datos públicos de NASA GISTEMP.
- **Natural Earth** (dominio público), contornos de continentes a escala 1:110m: <https://www.naturalearthdata.com/>.
- Todo el código, los textos y el diseño visual del proyecto son originales.
