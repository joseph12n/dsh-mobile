import { useEffect, useId, useRef, useState } from 'react';
import type { DeviceInfo } from '@deepseekharness-mobile/protocol';
import { useI18n } from '../i18n/index.js';
import { lastSeenLabel, sortDevices } from '../lib/devices.js';

export function PairedDevices({
  devices,
  currentId,
  onRevoke,
}: {
  devices: DeviceInfo[];
  currentId?: string;
  onRevoke: (deviceId: string) => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const textId = useId();

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const cancel = (): void => {
    const id = confirming;
    setConfirming(undefined);
    if (id) requestAnimationFrame(() => triggers.current.get(id)?.focus());
  };

  const sorted = sortDevices(devices, currentId);
  const target = sorted.find((device) => device.id === confirming);

  return (
    <div className="devices">
      <ul className="device-list">
        {sorted.map((device) => (
          <li key={device.id} className="device-row">
            <div className="device-ident">
              <span className="device-name">{device.name}</span>
              <span className="device-meta muted small">
                {device.id === currentId
                  ? t('devices.this')
                  : lastSeenLabel(device.lastSeenAt, Date.now(), t)}
              </span>
            </div>

            {device.id !== currentId && (
              <button
                type="button"
                className="ghost"
                ref={(node) => {
                  if (node) triggers.current.set(device.id, node);
                  else triggers.current.delete(device.id);
                }}
                onClick={() => setConfirming(device.id)}
              >
                {t('devices.revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {target && (
        <div
          className="confirm"
          role="alertdialog"
          aria-labelledby={textId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
        >
          <p id={textId}>{t('devices.confirm', { name: target.name })}</p>
          <div className="confirm-actions">
            <button ref={cancelRef} type="button" className="ghost" onClick={cancel}>
              {t('devices.cancel')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                onRevoke(target.id);
                setConfirming(undefined);
              }}
            >
              {t('devices.revokeConfirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
