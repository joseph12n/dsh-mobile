import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.js';
import {
  currentPushSubscription,
  isIos,
  isStandalone,
  pushSupport,
  type PushSupport,
} from '../lib/push.js';

type Outcome = { ok: boolean; message?: string };

export function NotificationsSection({
  onEnable,
  onDisable,
}: {
  onEnable: () => Promise<Outcome>;
  onDisable: () => Promise<Outcome>;
}) {
  const { t } = useI18n();
  const [support, setSupport] = useState<PushSupport>('ready');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSupport(pushSupport());
    void currentPushSubscription()
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => undefined);
  }, []);

  const change = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);

    const result = enabled ? await onDisable() : await onEnable();
    setBusy(false);

    if (!result.ok) {
      setError(result.message ?? t('notifications.error'));
      return;
    }

    setEnabled(!enabled);
    setSupport(pushSupport());
  };

  if (support === 'unsupported') {
    return <p className="muted small">{t('notifications.unsupported')}</p>;
  }
  if (support === 'insecure') {
    return <p className="muted small">{t('notifications.insecure')}</p>;
  }
  if (support === 'denied') {
    return <p className="muted small">{t('notifications.denied')}</p>;
  }

  return (
    <div className="notifications">
      <div className="notification-row">
        <div className="notification-text">
          <span className="notification-title">{t('notifications.title')}</span>
          <span className="muted small">
            {enabled ? t('notifications.enabled') : t('notifications.disabled')}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('notifications.title')}
          className={`switch${enabled ? ' on' : ''}`}
          onClick={() => void change()}
          disabled={busy}
        >
          <span className="switch-thumb" />
        </button>
      </div>

      <p className="muted small">{t('notifications.hint')}</p>
      {isIos() && !isStandalone() && <p className="muted small">{t('notifications.ios')}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
