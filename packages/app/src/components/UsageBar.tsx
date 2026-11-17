import type { SessionUsage } from '@deepseekharness-mobile/protocol';
import { useI18n } from '../i18n/index.js';
import { formatTokens, formatTps, usageView } from '../lib/usage.js';

export function UsageBar({ usage }: { usage: SessionUsage | undefined }) {
  const { t } = useI18n();
  const view = usageView(usage);
  if (!view) return null;

  return (
    <p className="usage-bar" aria-label={t('usage.label')}>
      {view.contextUsed !== undefined && (
        <span className="usage-chip">
          {t('usage.context')} {formatTokens(view.contextUsed)}
          {view.contextWindow !== undefined && `/${formatTokens(view.contextWindow)}`}
          {view.contextPercent !== undefined && ` · ${view.contextPercent}%`}
        </span>
      )}
      {view.cacheHit !== undefined && (
        <span className="usage-chip">
          {t('usage.cache')} {view.cacheHit}%
        </span>
      )}
      {view.tokensPerSecond !== undefined && (
        <span className="usage-chip">{formatTps(view.tokensPerSecond)} tok/s</span>
      )}
    </p>
  );
}
