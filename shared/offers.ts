/**
 * Reserved contract for a future first-party offers feed.
 * This module is intentionally not rendered while FEATURE_FLAGS.offersFeed is false.
 * Offers are separate from wishes; saving an offer creates a wish with source metadata.
 */
export type CoupleOffer = {
  id: string;
  title: string;
  partnerName: string;
  summary: string;
  description: string;
  imageUrl?: string;
  validFrom?: string | null;
  validTo?: string | null;
  promoCode?: string | null;
  isActive: boolean;
};

export type OfferEvent =
  | { type: "view"; offerId: string; occurredAt: string }
  | { type: "save_to_wishlist"; offerId: string; wishId: string; occurredAt: string }
  | { type: "promo_redeemed"; offerId: string; occurredAt: string };

export const FUTURE_OFFERS_ROUTES = {
  list: "/api/v1/offers",
  save: "/api/v1/offers/:offerId/save",
  event: "/api/v1/offers/:offerId/events",
  adminStats: "/api/v1/admin/offers/stats",
} as const;
