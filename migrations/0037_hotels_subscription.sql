-- ============================================
-- V18 — Stripe Subscription (50€/mois, paiement immédiat, pas d'essai)
-- ============================================
-- Ajoute les colonnes nécessaires sur hotels pour gérer l'abonnement Stripe.
-- subscription_status : 'pending' (avant paiement), 'active' (paiement OK + accès app),
--                       'past_due' (paiement échoué), 'canceled' (annulé), 'incomplete'
-- stripe_customer_id  : identifiant Customer Stripe (cus_xxx)
-- stripe_subscription_id : identifiant Subscription Stripe (sub_xxx)

ALTER TABLE hotels ADD COLUMN subscription_status TEXT DEFAULT 'pending';
ALTER TABLE hotels ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE hotels ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE hotels ADD COLUMN subscription_current_period_end DATETIME;

-- Hôtels existants : on les marque 'active' (ils existent déjà = legacy, pas de paiement requis)
-- Si tu veux forcer tous les hôtels existants à payer, change 'active' → 'pending'
UPDATE hotels SET subscription_status = 'active' WHERE subscription_status IS NULL OR subscription_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_hotels_stripe_customer ON hotels(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_hotels_stripe_subscription ON hotels(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_hotels_subscription_status ON hotels(subscription_status);
