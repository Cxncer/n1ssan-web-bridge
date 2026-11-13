// The release version is read from the repository VERSION file at build time
// (see vite.config.ts) so every surface shows the same string as the release
// archive and manifest. Falls back to "dev" outside a Vite build.
export const APP_VERSION: string =
  typeof __N1SSAN_VERSION__ === 'string' && __N1SSAN_VERSION__ ? __N1SSAN_VERSION__ : 'dev'
