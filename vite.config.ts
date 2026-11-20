import { defineConfig } from 'vite';

// base './' hace que los assets usen rutas relativas, necesario para GitHub Pages
// (el sitio se sirve desde /<repositorio>/ y no desde la raíz del dominio).
export default defineConfig({
  base: './',
});
