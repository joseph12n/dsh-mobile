import type { Workspace } from '@dsh-mobile/protocol';
import { displayTitle } from '../lib/folders.js';
import {
  FOLDER_ORDERS,
  toggleHidden,
  type FolderOrder,
  type FolderPreferences,
} from '../lib/preferences.js';
import { useI18n } from '../i18n/index.js';
import type { MessageKey } from '../i18n/locales.js';

const ORDER_KEY: Record<FolderOrder, MessageKey> = {
  host: 'settings.order.host',
  name: 'settings.order.name',
  recent: 'settings.order.recent',
};

export function Settings({
  workspaces,
  preferences,
  onChange,
}: {
  workspaces: Workspace[];
  preferences: FolderPreferences;
  onChange: (next: FolderPreferences) => void;
}) {
  const { t } = useI18n();

  return (
    <details className="settings">
      <summary>{t('settings.title')}</summary>

      <label className="settings-row">
        <span>{t('settings.folderOrder')}</span>
        <select
          className="locale"
          value={preferences.order}
          onChange={(event) =>
            onChange({ ...preferences, order: event.target.value as FolderOrder })
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
          onChange={(event) => onChange({ ...preferences, hideEmpty: event.target.checked })}
        />
        <span>{t('settings.hideEmpty')}</span>
      </label>

      {workspaces.length > 0 && (
        <div className="settings-folders" role="group" aria-label={t('settings.title')}>
          {workspaces.map((workspace) => (
            <label className="settings-row" key={workspace.id} title={workspace.directory}>
              <input
                type="checkbox"
                checked={!preferences.hidden.includes(workspace.id)}
                onChange={() => onChange(toggleHidden(preferences, workspace.id))}
              />
              <span>{displayTitle(workspace)}</span>
            </label>
          ))}
        </div>
      )}
    </details>
  );
}
