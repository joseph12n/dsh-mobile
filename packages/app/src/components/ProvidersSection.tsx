import { useEffect, useRef, useState } from 'react';
import type { ProviderTestResult, ProviderView } from '@dsh-mobile/protocol';
import { useI18n } from '../i18n/index.js';
import type { MessageKey } from '../i18n/locales.js';

type Outcome = { ok: boolean; message?: string };
type TestOutcome = ProviderTestResult | undefined;

const TEST_KEY: Record<ProviderTestResult['code'], MessageKey> = {
  ok: 'providers.testOk',
  rejected: 'providers.testRejected',
  unreachable: 'providers.testUnreachable',
  unsupported: 'providers.testUnsupported',
  invalid: 'providers.testInvalid',
};

function statusKey(provider: ProviderView): MessageKey {
  if (provider.action === 'none') return 'providers.connected';
  if (provider.action === 'desktop') return 'providers.desktop';
  if (provider.action === 'add-provider') return 'providers.addProvider';
  if (provider.credential === 'missing') return 'providers.missing';
  return 'providers.unknown';
}

export function ProvidersSection({
  providers,
  canConnect,
  loading,
  error,
  onTest,
  onConnect,
  onDisconnect,
}: {
  providers: ProviderView[];
  canConnect: boolean;
  loading: boolean;
  error?: string;
  onTest: (provider: string, apiKey: string) => Promise<TestOutcome>;
  onConnect: (provider: string, apiKey: string) => Promise<Outcome>;
  onDisconnect: (provider: string) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestOutcome>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (editing) keyRef.current?.focus();
  }, [confirming, editing]);

  const openForm = (provider: string): void => {
    setEditing(provider);
    setConfirming(undefined);
    setKey('');
    setTest(undefined);
    setActionError(undefined);
  };

  const closeForm = (): void => {
    setEditing(undefined);
    setKey('');
    setTesting(false);
    setSaving(false);
    setTest(undefined);
    setActionError(undefined);
  };

  const runTest = async (): Promise<void> => {
    if (!editing || !key.trim() || testing) return;
    setTesting(true);
    setActionError(undefined);
    const result = await onTest(editing, key.trim());
    setTesting(false);
    if (!result) {
      setActionError(t('providers.testUnreachable'));
      return;
    }
    setTest(result);
  };

  const save = async (): Promise<void> => {
    if (!editing || !key.trim() || saving) return;
    setSaving(true);
    setActionError(undefined);
    const result = await onConnect(editing, key.trim());
    setSaving(false);
    if (!result.ok) {
      setActionError(result.message ?? t('providers.connectFailed'));
      return;
    }
    closeForm();
  };

  const disconnect = async (provider: string): Promise<void> => {
    setConfirming(undefined);
    setActionError(undefined);
    const result = await onDisconnect(provider);
    if (!result.ok) setActionError(result.message ?? t('providers.disconnectFailed'));
  };

  if (loading) return <p className="muted small">{t('providers.loading')}</p>;
  if (error) return <p className="error">{error}</p>;

  const target = providers.find((provider) => provider.id === confirming);

  return (
    <div className="providers">
      <ul className="provider-list">
        {providers.map((provider) => (
          <li key={provider.id} className="provider-row">
            <div className="provider-ident">
              <span className="provider-name">{provider.name}</span>
              <span className="provider-status muted small">{t(statusKey(provider))}</span>
            </div>

            {canConnect && provider.action !== 'desktop' && provider.action !== 'none' && (
              <button type="button" className="ghost" onClick={() => openForm(provider.id)}>
                {provider.action === 'add-provider'
                  ? t('providers.connect')
                  : t('providers.addKey')}
              </button>
            )}

            {canConnect && provider.action === 'none' && (
              <button type="button" className="ghost" onClick={() => setConfirming(provider.id)}>
                {t('providers.disconnect')}
              </button>
            )}

            {editing === provider.id && (
              <div className="provider-form">
                <label className="provider-field">
                  <span className="muted small">{t('providers.key')}</span>
                  <input
                    ref={keyRef}
                    type="password"
                    value={key}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="sk-…"
                    onChange={(event) => setKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeForm();
                      }
                    }}
                  />
                </label>
                <p className="muted small">{t('providers.keyHint')}</p>

                {test && (
                  <p className={`provider-test ${test.ok ? 'ok' : 'bad'}`} role="status">
                    {t(TEST_KEY[test.code])}
                    {test.detail && <span className="provider-detail"> {test.detail}</span>}
                  </p>
                )}

                <div className="provider-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void runTest()}
                    disabled={!key.trim() || testing || saving}
                  >
                    {testing ? t('providers.testing') : t('providers.test')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={!key.trim() || testing || saving}
                  >
                    {saving ? t('providers.saving') : t('providers.save')}
                  </button>
                  <button type="button" className="ghost" onClick={closeForm} disabled={saving}>
                    {t('providers.cancel')}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {actionError && (
        <p className="error provider-error" role="alert">
          {actionError}
        </p>
      )}

      {target && (
        <div
          className="confirm"
          role="alertdialog"
          aria-labelledby="provider-disconnect-text"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setConfirming(undefined);
            }
          }}
        >
          <p id="provider-disconnect-text">
            {t('providers.disconnectConfirm', { name: target.name })}
          </p>
          <div className="confirm-actions">
            <button
              ref={cancelRef}
              type="button"
              className="ghost"
              onClick={() => setConfirming(undefined)}
            >
              {t('providers.cancel')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (confirming) void disconnect(confirming);
              }}
            >
              {t('providers.disconnect')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
