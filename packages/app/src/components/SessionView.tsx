import { useState } from 'react';
import type {
  HistoryEntry,
  ModelCatalog,
  ModelSelection,
  SessionSummary,
  TranscriptEvent,
} from '@dsh-mobile/protocol';
import { groupTurns, partTurn, type Turn } from '../lib/turns.js';
import { plural, useI18n } from '../i18n/index.js';

/**
 * Transcripción de una sesión.
 *
 * Las entradas llegan de dos fuentes: la página inicial (`session.history`) y el
 * flujo vivo (`session.event`). Se fusionan por `seq`, así que un evento repetido
 * —reconexión, solapamiento de página— no se pinta dos veces.
 */

/** Catalogue key for a session state. */
const STATE_KEY = {
  working: 'session.working',
  waiting: 'session.waiting',
  idle: 'session.idle',
  done: 'session.done',
  error: 'session.error',
} as const;

function timeOf(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function EventRow({ entry }: { entry: HistoryEntry }) {
  const { t } = useI18n();
  const event: TranscriptEvent = entry.event;

  if (event.kind === 'message') {
    return (
      <li className={`msg ${event.role}`}>
        <span className="msg-role">
          {event.role === 'user' ? t('session.you') : t('session.agent')}
        </span>
        <p>{event.text}</p>
      </li>
    );
  }

  if (event.kind === 'tool') {
    return (
      <li className={`tool ${event.status}`}>
        <span className="tool-name">{event.name}</span>
        {event.summary && <span className="tool-summary">{event.summary}</span>}
      </li>
    );
  }

  return (
    <li className="state-row">
      <span>{t(STATE_KEY[event.state as keyof typeof STATE_KEY] ?? 'session.idle')}</span>
      <span className="muted small">{timeOf(entry.at)}</span>
    </li>
  );
}

/**
 * Una racha de herramientas seguidas dentro de un turno.
 *
 * El estado y el `id` son **por racha**, no por turno: un turno puede tener varias
 * (herramientas, respuesta, más herramientas), y compartir el `id` producía ids
 * duplicados y un `aria-controls` que apuntaba al grupo equivocado. Además, con un
 * estado por turno, pulsar un botón desplegaba todas las rachas aunque dijera
 * "1 herramienta".
 */
function ToolRun({ entries }: { entries: HistoryEntry[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = `herramientas-${entries[0]?.seq ?? 0}`;

  return (
    <li className="tool-group">
      <button
        type="button"
        className="ghost tiny"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        // Solo apunta al grupo cuando existe: una referencia a un id que no está
        // renderizado es ARIA inválido.
        aria-controls={open ? id : undefined}
      >
        {plural(t, 'session.tools', entries.length)}
        {open ? ` · ${t('session.hideTools')}` : ''}
      </button>

      {open && (
        <ul className="transcript nested" id={id}>
          {entries.map((entry) => (
            <EventRow key={`${entry.seq}-tool`} entry={entry} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Un turno: lo que pidió el humano y lo que provocó.
 *
 * Las herramientas van **plegadas** porque son muchas y ruidosas; los mensajes y
 * los cambios de estado siempre se ven, dentro del turno y **en su orden real**.
 */
function TurnBlock({ turn, number }: { turn: Turn; number: number }) {
  const { t } = useI18n();
  const parts = partTurn(turn.entries);
  const label = turn.prompt
    ? `${t('session.turn', { number })}: ${turn.prompt}`
    : t('session.turn', { number });

  return (
    <section className="turn" aria-label={label}>
      <header className="turn-head">
        <span className="turn-number">{t('session.turn', { number })}</span>
        <span className="muted small">{timeOf(turn.at)}</span>
      </header>

      <ul className="transcript">
        {parts.map((part) =>
          part.kind === 'entry' ? (
            <EventRow key={part.entry.seq} entry={part.entry} />
          ) : (
            <ToolRun key={`herramientas-${part.entries[0]?.seq ?? 0}`} entries={part.entries} />
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * Modelo y nivel de razonamiento de la sesión.
 *
 * Es el mismo catálogo que ofrece el escritorio: el host lo describe con
 * `session.modelCatalog` y el cambio va por `session.selectModel`, así que la
 * lista no puede quedarse corta respecto a lo que el host admite de verdad.
 *
 * Se usa un `<select>` nativo porque en un teléfono ya trae el selector del
 * sistema, con búsqueda y accesibilidad resueltas.
 */
function ModelBar({
  model,
  catalog,
  onSelect,
}: {
  /** Puede faltar mientras la lista no conozca el modelo de la sesión. */
  model: ModelSelection | undefined;
  catalog: ModelCatalog;
  onSelect: (selection: ModelSelection) => void;
}) {
  const { t } = useI18n();

  const choices = catalog.groups.flatMap((group) =>
    group.models.map((option) => ({ provider: group.id, option })),
  );

  // Lo que la sesión usará si nadie ha elegido: el modelo del despliegue.
  const current = model ?? catalog.default;
  const index = choices.findIndex(
    (choice) => choice.provider === current?.provider && choice.option.id === current?.model,
  );
  const selected = choices[index];
  const efforts = selected?.option.reasoningEfforts ?? [];
  // El elegido de verdad, si lo hay. El `defaultReasoningEffort` es lo que el host
  // aplicaría sin elección: sirve para mostrarlo, no para arrastrarlo como si el
  // usuario lo hubiera elegido.
  const explicitEffort = model?.reasoningEffort;
  const effort = explicitEffort ?? selected?.option.defaultReasoningEffort ?? '';

  const choose = (next: number): void => {
    const choice = choices[next];
    if (!choice) return;

    // El nivel anterior puede no existir en el modelo nuevo: se conserva solo si lo
    // anuncia, y si no se usa el que ese modelo trae por defecto.
    const available = choice.option.reasoningEfforts ?? [];
    const keep =
      explicitEffort && available.some((item) => item.id === explicitEffort)
        ? explicitEffort
        : undefined;
    const effortId = keep ?? choice.option.defaultReasoningEffort;

    onSelect({
      provider: choice.provider,
      model: choice.option.id,
      ...(effortId ? { reasoningEffort: effortId } : {}),
    });
  };

  const chooseEffort = (next: string): void => {
    if (!selected) return;
    onSelect({
      provider: selected.provider,
      model: selected.option.id,
      ...(next ? { reasoningEffort: next } : {}),
    });
  };

  if (choices.length === 0) {
    return catalog.failures.length > 0 ? (
      <p className="muted small">{failuresText(catalog)}</p>
    ) : (
      <p className="muted small">{t('model.none')}</p>
    );
  }

  return (
    <>
      <div className="model-bar">
        <label className="model-field">
          <span className="muted small">{t('model.label')}</span>
          <select
            value={index >= 0 ? String(index) : ''}
            onChange={(event) => {
              // El hueco no es una opción: `Number('')` es 0 y elegiría el primero.
              if (event.target.value === '') return;
              choose(Number(event.target.value));
            }}
          >
            {index < 0 && (
              <option value="" disabled>
                {t('model.choose')}
              </option>
            )}
            {catalog.groups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.models.map((option) => {
                  const at = choices.findIndex(
                    (choice) => choice.provider === group.id && choice.option.id === option.id,
                  );
                  return (
                    <option key={option.id} value={String(at)}>
                      {option.name}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </label>

        {efforts.length > 0 && (
          <label className="model-field">
            <span className="muted small">{t('model.effort')}</span>
            <select value={effort} onChange={(event) => chooseEffort(event.target.value)}>
              <option value="">{t('model.effortDefault')}</option>
              {efforts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Un proveedor que no se pudo leer se dice: un catálogo corto sin motivo
          parece un fallo de la app. */}
      {catalog.failures.length > 0 && <p className="muted small">{failuresText(catalog)}</p>}
    </>
  );
}

/** Proveedores que el host no pudo leer, en una línea. */
function failuresText(catalog: ModelCatalog): string {
  return catalog.failures.map((failure) => `${failure.name}: ${failure.message}`).join(' · ');
}

export function SessionView({
  session,
  entries,
  hasMore,
  loading,
  model,
  catalog,
  error,
  onBack,
  onLoadMore,
  onCancel,
  onSend,
  onSelectModel,
}: {
  session: SessionSummary;
  entries: HistoryEntry[];
  hasMore: boolean;
  loading: boolean;
  /** Modelo con el que seguirá la sesión, si el host lo proyecta. */
  model?: ModelSelection;
  /** Catálogo de modelos, cuando el host anunció `model.select`. */
  catalog?: ModelCatalog;
  /** Error del último cambio de modelo. */
  error?: string;
  onBack: () => void;
  onLoadMore: () => void;
  onCancel: () => void;
  onSend: (text: string) => void;
  onSelectModel?: (selection: ModelSelection) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <section className="card session-view">
      <div className="row">
        <button type="button" className="ghost" onClick={onBack}>
          {t('session.back')}
        </button>
        {!session.archived && (
          <button type="button" className="ghost" onClick={onCancel}>
            {t('session.stop')}
          </button>
        )}
      </div>

      <h2 className="session-heading">{session.title}</h2>
      <p className="muted small">{t(STATE_KEY[session.state] ?? 'session.idle')}</p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {catalog && onSelectModel && (
        <ModelBar model={model} catalog={catalog} onSelect={onSelectModel} />
      )}

      {hasMore && (
        <button type="button" className="ghost load-more" onClick={onLoadMore} disabled={loading}>
          {loading ? t('session.loading') : t('session.loadMore')}
        </button>
      )}

      {entries.length === 0 ? (
        <p className="muted">{loading ? t('session.loading') : t('session.empty')}</p>
      ) : (
        <div className="transcript">
          {groupTurns(entries).map((turn, index) => (
            <TurnBlock key={turn.id} turn={turn} number={index + 1} />
          ))}
        </div>
      )}

      {/*
        Una sesión archivada se puede leer, pero no continuar: el host rechaza el turno.
        Escribir aquí acababa en una pantalla de error por algo que la app podía impedir.
      */}
      {session.archived ? (
        <p className="muted">{t('session.archivedNote')}</p>
      ) : (
        /* Composer fijo al final: se escribe sin perder de vista la conversación. */
        <div className="composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter envía; Shift+Enter hace salto de línea.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={t('session.placeholder')}
            rows={2}
            autoCapitalize="sentences"
          />
          <button type="button" onClick={send} disabled={!draft.trim()}>
            {t('session.send')}
          </button>
        </div>
      )}
    </section>
  );
}
