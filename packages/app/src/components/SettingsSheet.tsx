import { useId } from 'react';
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type DeviceInfo,
  type ProviderTestResult,
  type ProviderView,
  type Workspace,
} from '@deepseekharness-mobile/protocol';
import { displayTitle } from '../lib/folders.js';
import {
  FOLDER_ORDERS,
  toggleHidden,
  type FolderOrder,
  type FolderPreferences,
} from '../lib/preferences.js';
import { useContrast, CONTRASTS, type Contrast } from '../lib/contrast.js';
import { useI18n } from '../i18n/index.js';
import { LOCALES, LOCALE_LABELS, type Locale, type MessageKey } from '../i18n/locales.js';
import { ForgetDeviceButton } from './ForgetDeviceButton.js';
import { ChevronDownIcon } from './icons.js';
import { NotificationsSection } from './NotificationsSection.js';
import { PairedDevices } from './PairedDevices.js';
import { ProvidersSection } from './ProvidersSection.js';
import { Sheet } from './Sheet.js';

const ORDER_KEY: Record<FolderOrder, MessageKey> = {
  host: 'settings.order.host',
  name: 'settings.order.name',
  recent: 'settings.order.recent',
};

export function SettingsSheet({
  open,
  onClose,
  connected,
  workspaces,
  preferences,
  onPreferencesChange,
  hostName,
  endpoint,
  devices,
  currentDeviceId,
  canManageDevices,
  onRevokeDevice,
  deviceError,
  providers,
  providersLoading,
  providersError,
  canListProviders,
  canConnectProviders,
  onTestProvider,
  onConnectProvider,
  onDisconnectProvider,
  canPushNotifications,
  onEnablePush,
  onDisablePush,
  onForget,
}: {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  workspaces: Workspace[];
  preferences: FolderPreferences;
  onPreferencesChange: (next: FolderPreferences) => void;
  hostName: string;
  endpoint: string;
  devices: DeviceInfo[];
  currentDeviceId?: string;
  canManageDevices: boolean;
  onRevokeDevice: (deviceId: string) => void;
  deviceError?: string;
  providers: ProviderView[];
  providersLoading: boolean;
  providersError?: string;
  canListProviders: boolean;
  canConnectProviders: boolean;
  onTestProvider: (provider: string, apiKey: string) => Promise<ProviderTestResult | undefined>;
  onConnectProvider: (
    provider: string,
    apiKey: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onDisconnectProvider: (provider: string) => Promise<{ ok: boolean; message?: string }>;
  canPushNotifications: boolean;
  onEnablePush: () => Promise<{ ok: boolean; message?: string }>;
  onDisablePush: () => Promise<{ ok: boolean; message?: string }>;
  onForget: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const { contrast, setContrast } = useContrast();
  const id = useId();

  return (
    <Sheet
      open={open}
      title={t('settings.title')}
      closeLabel={t('settings.close')}
      onClose={onClose}
    >
      <section className="sheet-section" aria-labelledby={`${id}-appearance`}>
        <h3 id={`${id}-appearance`}>{t('settings.appearance')}</h3>

        <label className="settings-row">
          <span>{t('settings.language')}</span>
          <select
            className="locale"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-row">
          <span>{t('settings.contrast')}</span>
          <select
            className="locale"
            value={contrast}
            onChange={(event) => setContrast(event.target.value as Contrast)}
          >
            {CONTRASTS.map((level) => (
              <option key={level} value={level}>
                {t(`contrast.${level}`)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {workspaces.length > 0 && (
        <section className="sheet-section" aria-labelledby={`${id}-folders`}>
          <h3 id={`${id}-folders`}>{t('settings.folders')}</h3>

          <label className="settings-row">
            <span>{t('settings.folderOrder')}</span>
            <select
              className="locale"
              value={preferences.order}
              onChange={(event) =>
                onPreferencesChange({ ...preferences, order: event.target.value as FolderOrder })
              }
            >
              {FOLDER_ORDERS.map((order) => (
                <option key={order} value={order}>
                  {t(ORDER_KEY[order])}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-row">
            <input
              type="checkbox"
              checked={preferences.hideEmpty}
              onChange={(event) =>
                onPreferencesChange({ ...preferences, hideEmpty: event.target.checked })
              }
            />
            <span>{t('settings.hideEmpty')}</span>
          </label>

          <p className="sheet-label">{t('settings.foldersShown')}</p>
          <div className="settings-folders" role="group" aria-label={t('settings.foldersShown')}>
            {workspaces.map((workspace) => (
              <label className="settings-row" key={workspace.id} title={workspace.directory}>
                <input
                  type="checkbox"
                  checked={!preferences.hidden.includes(workspace.id)}
                  onChange={() => onPreferencesChange(toggleHidden(preferences, workspace.id))}
                />
                <span className="settings-folder-name">{displayTitle(workspace)}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {connected && canListProviders && (
        <details className="sheet-section sheet-collapsible">
          <summary className="sheet-summary">
            <h3>{t('settings.providers')}</h3>
            <ChevronDownIcon />
          </summary>
          <ProvidersSection
            providers={providers}
            canConnect={canConnectProviders}
            loading={providersLoading}
            {...(providersError ? { error: providersError } : {})}
            onTest={onTestProvider}
            onConnect={onConnectProvider}
            onDisconnect={onDisconnectProvider}
          />
        </details>
      )}

      {connected && canPushNotifications && (
        <section className="sheet-section" aria-labelledby={`${id}-notifications`}>
          <h3 id={`${id}-notifications`}>{t('settings.notifications')}</h3>
          <NotificationsSection onEnable={onEnablePush} onDisable={onDisablePush} />
        </section>
      )}

      {connected && (
        <section className="sheet-section" aria-labelledby={`${id}-device`}>
          <h3 id={`${id}-device`}>{t('settings.device')}</h3>

          <div className="sheet-fact">
            <span className="muted small">{t('settings.host')}</span>
            <span className="sheet-host">{hostName}</span>
          </div>

          <div className="sheet-fact">
            <span className="muted small">{t('settings.address')}</span>
            <span className="sheet-endpoint">{endpoint}</span>
          </div>

          {canManageDevices && (
            <div className="sheet-devices">
              <p className="sheet-label">{t('settings.devices')}</p>
              {deviceError ? (
                <p className="error" role="alert">
                  {deviceError}
                </p>
              ) : (
                <PairedDevices
                  devices={devices}
                  {...(currentDeviceId ? { currentId: currentDeviceId } : {})}
                  onRevoke={onRevokeDevice}
                />
              )}
            </div>
          )}

          <div className="sheet-action">
            <ForgetDeviceButton onForget={onForget} />
          </div>
        </section>
      )}

      {!connected && (
        <section className="sheet-section" aria-labelledby={`${id}-address`}>
          <h3 id={`${id}-address`}>{t('settings.address')}</h3>
          <p className="sheet-endpoint">{endpoint}</p>
        </section>
      )}

      <section className="sheet-section" aria-labelledby={`${id}-about`}>
        <h3 id={`${id}-about`}>{t('settings.about')}</h3>
        <div className="sheet-fact">
          <span className="muted small">{t('settings.protocol')}</span>
          <span>
            {PROTOCOL_NAME} v{PROTOCOL_VERSION}
          </span>
        </div>
      </section>
    </Sheet>
  );
}
