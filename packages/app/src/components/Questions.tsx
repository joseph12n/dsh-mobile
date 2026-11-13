import { useState } from 'react';
import { useI18n } from '../i18n/index.js';
import type { QuestionAnswerItem, QuestionBatch } from '@dsh-mobile/protocol';

export function QuestionsCard({
  questions,
  titleFor,
  onSubmit,
}: {
  questions: QuestionBatch[];
  titleFor?: (sessionId: string) => string;
  onSubmit: (callId: string, sessionId: string, answers: QuestionAnswerItem[]) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  if (questions.length === 0) return null;

  const toggle = (key: string, label: string, multiSelect: boolean): void => {
    setSelected((previous) => {
      const current = previous[key] ?? [];
      if (!multiSelect) return { ...previous, [key]: current.includes(label) ? [] : [label] };
      return {
        ...previous,
        [key]: current.includes(label)
          ? current.filter((item) => item !== label)
          : [...current, label],
      };
    });
  };

  const submit = (batch: QuestionBatch): void => {
    const answers: QuestionAnswerItem[] = batch.items.map((item) => {
      const key = `${batch.callId}:${item.id}`;
      const chosen = selected[key] ?? [];
      const text = (custom[key] ?? '').trim();

      if (chosen.length === 0 && !text) return { id: item.id, selected: [] };
      return { id: item.id, selected: chosen, ...(text ? { custom: text } : {}) };
    });

    onSubmit(batch.callId, batch.sessionId, answers);
  };

  return (
    <section className="card questions">
      <h2>{t('questions.title')}</h2>

      {questions.map((batch) => (
        <div key={batch.callId} className="question-batch">
          <p className="muted small">{titleFor?.(batch.sessionId) ?? batch.sessionId}</p>

          {batch.items.map((item) => {
            const key = `${batch.callId}:${item.id}`;
            const chosen = selected[key] ?? [];

            return (
              <div key={item.id} className="question-item">
                {item.header && <span className="question-header">{item.header}</span>}
                <p className="question-text">{item.text}</p>
                {item.detail && <pre className="question-detail">{item.detail}</pre>}

                <div className="options">
                  {item.options.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className={`option ${chosen.includes(option.label) ? 'chosen' : ''}`}
                      onClick={() => toggle(key, option.label, item.multiSelect)}
                      title={option.description ?? undefined}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {item.allowCustom && (
                  <input
                    className="custom"
                    value={custom[key] ?? ''}
                    onChange={(event) =>
                      setCustom((previous) => ({ ...previous, [key]: event.target.value }))
                    }
                    placeholder={t('questions.other')}
                    autoCapitalize="sentences"
                  />
                )}
              </div>
            );
          })}

          <button type="button" onClick={() => submit(batch)}>
            {t('questions.submit')}
          </button>
        </div>
      ))}
    </section>
  );
}
