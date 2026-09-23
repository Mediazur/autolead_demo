-- Intégration du routeur SMS Spot-Hit — remplace la ressaisie manuelle des
-- stats SMS (sms_result) par un vrai envoi + suivi automatique.
-- Voir src/services/spotHit.js pour le client API et sa doc en tête de fichier.

ALTER TABLE campaigns ADD COLUMN spothit_campaign_id TEXT;
ALTER TABLE campaigns ADD COLUMN spothit_status TEXT;

-- Journal brut des événements reçus de Spot-Hit (accusés de statut, STOP,
-- réponses) — sert à l'audit et à recalculer les compteurs si besoin. Les
-- compteurs agrégés utilisés par l'écran admin existant restent dans
-- campaigns.sms_result, pour ne pas dupliquer l'UI déjà en place.
CREATE TABLE sms_events (
  id           SERIAL PRIMARY KEY,
  campaign_id  TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL,   -- 'accuse' | 'stop' | 'reponse'
  numero       TEXT,
  statut       TEXT,
  message      TEXT,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_events_campaign ON sms_events(campaign_id);
CREATE INDEX idx_sms_events_type ON sms_events(event_type);
