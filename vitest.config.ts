import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    // Las pruebas no deben escribir en el log de evidencia del usuario.
    env: {
      DSH_MOBILE_LOG_FILE: '0',
    },
  },
});
