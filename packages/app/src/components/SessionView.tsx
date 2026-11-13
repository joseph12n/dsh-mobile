import { useEffect, useRef, useState } from 'react';
import type {
  HistoryEntry,
  ModelCatalog,
  ModelSelection,
  SessionSummary,
  TranscriptEvent,
} from '@dsh-mobile/protocol';
import { groupTurns, partTurn, type Turn } from '../lib/turns.js';
import { plural, useI18n } from '../i18n/index.js';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  SendIcon,
  StopIcon,
} from './icons.js';

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

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

function ToolRun({ entries }: { entries: HistoryEntry[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = `herramientas-${entries[0]?.seq ?? 0}`;

  return (
    <li className="tool-group">
      <button
        type="button"
        className="tool-toggle"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
      >
        <ChevronRightIcon />
        {plural(t, 'session.tools', entries.length)}
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

function keepsState(entry: HistoryEntry): boolean {
  return (
    entry.event.kind !== 'state' || entry.event.state === 'done' || entry.event.state === 'error'
  );
}

function TurnBlock({ turn, number }: { turn: Turn; number: number }) {
  const { t } = useI18n();
  const parts = partTurn(turn.entries.filter(keepsState));
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

function ModelBar({
  model,
  catalog,
  onSelect,
}: {
  model: ModelSelection | undefined;
  catalog: ModelCatalog;
  onSelect: (selection: ModelSelection) => void;
}) {
  const { t } = useI18n();

  const choices = catalog.groups.flatMap((group) =>
    group.models.map((option) => ({ provider: group.id, option })),
  );

  const current = model ?? catalog.default;
  const index = choices.findIndex(
    (choice) => choice.provider === current?.provider && choice.option.id === current?.model,
  );
  const selected = choices[index];
  const efforts = selected?.option.reasoningEfforts ?? [];
  const explicitEffort = model?.reasoningEffort;
  const effort = explicitEffort ?? selected?.option.defaultReasoningEffort ?? '';

  const choose = (next: number): void => {
    const choice = choices[next];
    if (!choice) return;

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

      {catalog.failures.length > 0 && <p className="muted small">{failuresText(catalog)}</p>}
    </>
  );
}

function failuresText(catalog: ModelCatalog): string {
  return catalog.failures.map((failure) => `${failure.name}: ${failure.message}`).join(' · ');
}

function ModelSection({
  model,
  catalog,
  status,
  onSelect,
  onReload,
  onToggle,
}: {
  model?: ModelSelection;
  catalog?: ModelCatalog;
  status: CatalogStatus;
  onSelect: (selection: ModelSelection) => void;
  onReload?: () => void;
  onToggle?: () => void;
}) {
  const { t } = useI18n();

  if (catalog && catalog.groups.length > 0) {
    return (
      <details className="session-model" onToggle={() => onToggle?.()}>
        <summary>
          <span className="muted small">{t('model.label')}</span>
          <span className="session-model-name">{modelLabel(model, catalog)}</span>
          <ChevronDownIcon />
        </summary>
        <ModelBar model={model} catalog={catalog} onSelect={onSelect} />
      </details>
    );
  }

  if (status === 'loading') {
    return (
      <div className="session-model session-model-status" role="status" aria-busy="true">
        <span className="muted small">{t('model.label')}</span>
        <span className="skeleton-line" aria-hidden="true" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="session-model session-model-status" role="status">
        <span className="muted small">{t('model.unavailable')}</span>
        {onReload && (
          <button
            type="button"
            className="ghost icon-button"
            aria-label={t('model.retry')}
            onClick={onReload}
          >
            <RefreshIcon />
          </button>
        )}
      </div>
    );
  }

  if (catalog) {
    return (
      <div className="session-model session-model-status" role="status">
        <span className="muted small">{t('model.none')}</span>
      </div>
    );
  }

  return null;
}

export function SessionView({
  session,
  entries,
  hasMore,
  loading,
  model,
  catalog,
  catalogStatus,
  error,
  sendError,
  onBack,
  onLoadMore,
  onCancel,
  onSend,
  onSelectModel,
  onReloadModels,
}: {
  session: SessionSummary;
  entries: HistoryEntry[];
  hasMore: boolean;
  loading: boolean;
  model?: ModelSelection;
  catalog?: ModelCatalog;
  catalogStatus?: CatalogStatus;
  error?: string;
  sendError?: string;
  onBack: () => void;
  onLoadMore: () => void;
  onCancel: () => void;
  onSend: (text: string) => Promise<boolean>;
  onSelectModel?: (selection: ModelSelection) => void;
  onReloadModels?: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [session.id]);

  useEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 134)}px`;
  }, [draft]);

  useEffect(() => {
    atBottom.current = true;
    const area = scrollRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [session.id]);

  useEffect(() => {
    const area = scrollRef.current;
    if (area && atBottom.current) area.scrollTop = area.scrollHeight;
  }, [entries]);

  const trackScroll = (): void => {
    const area = scrollRef.current;
    if (!area) return;
    atBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
  };

  const keepBottom = (): void => {
    requestAnimationFrame(() => {
      const area = scrollRef.current;
      if (area && atBottom.current) area.scrollTop = area.scrollHeight;
    });
  };

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || sending) return;
    atBottom.current = true;
    setSending(true);
    const accepted = await onSend(text);
    setSending(false);
    if (accepted) setDraft('');
  };

  return (
    <section className="card session-view">
      <header className="session-top">
        <button
          type="button"
          className="ghost icon-button"
          onClick={onBack}
          aria-label={t('session.back')}
        >
          <ChevronLeftIcon />
        </button>

        <div className="session-ident">
          <h2 className="session-heading" tabIndex={-1} ref={headingRef}>
            {session.title}
          </h2>
          <span className="session-state">
            <span className={`dot ${session.state}`} aria-hidden="true" />
            {t(STATE_KEY[session.state] ?? 'session.idle')}
            {session.archived && ` · ${t('action.archived')}`}
          </span>
        </div>

        {!session.archived && (
          <button
            type="button"
            className="ghost icon-button"
            onClick={onCancel}
            aria-label={t('session.stop')}
          >
            <StopIcon />
          </button>
        )}
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {onSelectModel && (
        <ModelSection
          {...(model ? { model } : {})}
          {...(catalog ? { catalog } : {})}
          status={catalogStatus ?? 'idle'}
          onSelect={onSelectModel}
          onToggle={keepBottom}
          {...(onReloadModels ? { onReload: onReloadModels } : {})}
        />
      )}

      <div className="session-scroll" ref={scrollRef} onScroll={trackScroll}>
        {hasMore && (
          <button type="button" className="ghost load-more" onClick={onLoadMore} disabled={loading}>
            {loading ? t('session.loading') : t('session.loadMore')}
          </button>
        )}

        {entries.length === 0 ? (
          <p className="muted">{loading ? t('session.loading') : t('session.empty')}</p>
        ) : (
          <div
            className="transcript"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={t('session.transcript')}
          >
            {groupTurns(entries).map((turn, index) => (
              <TurnBlock key={turn.id} turn={turn} number={index + 1} />
            ))}
          </div>
        )}
      </div>

      {session.archived ? (
        <p className="muted">{t('session.archivedNote')}</p>
      ) : (
        <>
          {sendError && (
            <p className="error composer-error" role="alert">
              {sendError}
            </p>
          )}
          <div className="composer">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={t('session.placeholder')}
              aria-label={t('session.placeholder')}
              rows={1}
              autoCapitalize="sentences"
              enterKeyHint="send"
            />
            <button
              type="button"
              className="send-button"
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              aria-label={t('session.send')}
            >
              <SendIcon />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function modelLabel(model: ModelSelection | undefined, catalog: ModelCatalog): string {
  const selection = model ?? catalog.default;
  if (!selection) return '';

  const group = catalog.groups.find((item) => item.id === selection.provider);
  const option = group?.models.find((item) => item.id === selection.model);
  const name = option?.name ?? selection.model;
  const effortId = selection.reasoningEffort ?? option?.defaultReasoningEffort;
  const effort = option?.reasoningEfforts?.find((item) => item.id === effortId);

  return effort ? `${name} · ${effort.name}` : name;
}
