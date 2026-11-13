import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.js';

export function ForgetDeviceButton({ onForget }: { onForget: () => void }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  const cancel = (): void => {
    returnFocus.current = true;
    setConfirming(false);
  };

  if (!confirming) {
    return (
      <button ref={triggerRef} type="button" className="ghost" onClick={() => setConfirming(true)}>
        {t('error.forget')}
      </button>
    );
  }

  return (
    <div
      className="confirm"
      role="alertdialog"
      aria-labelledby="forget-confirm-text"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <p id="forget-confirm-text">{t('forget.confirm')}</p>
      <div className="confirm-actions">
        <button ref={cancelRef} type="button" className="ghost" onClick={cancel}>
          {t('forget.cancel')}
        </button>
        <button type="button" className="danger" onClick={onForget}>
          {t('forget.action')}
        </button>
      </div>
    </div>
  );
}
