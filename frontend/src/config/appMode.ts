const truthyValues = new Set(['1', 'true', 'yes', 'on']);

export const isScreenshotSeedEnabled = truthyValues.has(
  (process.env.EXPO_PUBLIC_SCREENSHOT_SEED ?? '').trim().toLowerCase(),
);

