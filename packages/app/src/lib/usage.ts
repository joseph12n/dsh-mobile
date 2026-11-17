import type { SessionUsage } from '@deepseekharness-mobile/protocol';

export interface UsageView {
  contextUsed?: number;
  contextWindow?: number;
  contextPercent?: number;
  cacheHit?: number;
  tokensPerSecond?: number;
}

export function usageView(usage: SessionUsage | undefined): UsageView | undefined {
  if (!usage) return undefined;

  const pressure = usage.contextPressure;
  const contextUsed = pressure?.projectedTokens ?? pressure?.pressureTokens;
  const contextWindow = pressure?.contextWindow;
  const contextPercent =
    contextUsed !== undefined && contextWindow !== undefined && contextWindow > 0
      ? Math.round((contextUsed / contextWindow) * 100)
      : undefined;

  const tokens = usage.tokens;
  const promptTokens = tokens ? tokens.uncachedInputTokens + tokens.cacheReadTokens : undefined;
  const cacheHit =
    tokens !== undefined && promptTokens !== undefined && promptTokens > 0
      ? Math.round((tokens.cacheReadTokens / promptTokens) * 100)
      : undefined;

  const stats = usage.stats;
  const tokensPerSecond =
    stats && stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1_000) : undefined;

  const view: UsageView = {
    ...(contextUsed !== undefined ? { contextUsed } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(contextPercent !== undefined ? { contextPercent } : {}),
    ...(cacheHit !== undefined ? { cacheHit } : {}),
    ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
  };

  return Object.keys(view).length > 0 ? view : undefined;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

export function formatTps(value: number): string {
  return value.toFixed(1);
}
