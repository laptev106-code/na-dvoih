/**
 * Product capabilities that can be switched on without changing the core wishlist model.
 * Offers stay disabled until a later product decision and backend rollout.
 */
export const FEATURE_FLAGS = {
  offersFeed: false,
  telegramMiniApp: true,
  householdModule: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
