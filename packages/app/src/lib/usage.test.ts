import { describe, expect, it } from 'vitest';
import { formatTokens, usageView } from './usage.js';

describe('usageView', () => {
  it('calcula contexto, cache hit y tok/s', () => {
    const view = usageView({
      contextPressure: { projectedTokens: 64_000, contextWindow: 128_000 },
      tokens: {
        uncachedInputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 3_000,
        cacheWriteTokens: 0,
      },
      stats: {
        turns: 1,
        steps: 1,
        llmMs: 1_000,
        toolMs: 0,
        ttftMs: 100,
        ttftSteps: 1,
        decodeMs: 1_000,
        decodeTokens: 42,
      },
    });

    expect(view).toEqual({
      contextUsed: 64_000,
      contextWindow: 128_000,
      contextPercent: 50,
      cacheHit: 75,
      tokensPerSecond: 42,
    });
  });

  it('omite lo que no hay', () => {
    expect(usageView(undefined)).toBeUndefined();
    expect(usageView({})).toBeUndefined();
    expect(usageView({ contextPressure: { pressureTokens: 500, contextWindow: 1_000 } })).toEqual({
      contextUsed: 500,
      contextWindow: 1_000,
      contextPercent: 50,
    });
  });
});

describe('formatTokens', () => {
  it('abrevia k y M', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_500)).toBe('1.5k');
    expect(formatTokens(2_000_000)).toBe('2.0M');
  });
});
