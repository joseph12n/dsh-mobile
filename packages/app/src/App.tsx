import { PROTOCOL_NAME, PROTOCOL_VERSION } from '@dsh-mobile/protocol';

/**
 * Esqueleto de la PWA.
 *
 * A propósito no implementa el producto: el alcance real (sesiones,
 * transcripción, preguntas) se construye **después** de que la Fase 0 confirme
 * que el plugin ve lo que tiene que ver. Esto solo prueba la canalización de
 * build, el manifest y que el contrato compartido resuelve en el navegador.
 */
export function App() {
  return (
    <main className="shell">
      <header className="head">
        <h1>DSH Mobile</h1>
        <p className="muted">Control remoto de DeepSeek Harness</p>
      </header>

      <section className="card">
        <h2>Sin emparejar</h2>
        <p>
          Abre el QR en el escritorio y escanéalo para vincular este teléfono. El enlace lleva el
          endpoint y el código de un solo uso.
        </p>
        <button type="button" disabled>
          Escanear QR (próximamente)
        </button>
      </section>

      <footer className="foot">
        <span className="muted">
          {PROTOCOL_NAME} v{PROTOCOL_VERSION}
        </span>
      </footer>
    </main>
  );
}
