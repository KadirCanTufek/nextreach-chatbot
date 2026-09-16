-- NextReach iletişim talepleri
CREATE TABLE IF NOT EXISTS leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  session_id       text NOT NULL,
  ip               text,

  -- Form alanları (adım 1)
  name             text,
  email            text,
  phone            text,
  company          text,
  store_size       text,
  contact_inferred boolean NOT NULL DEFAULT false,

  -- Sohbetten çıkan ihtiyaç profili (adım 2)
  need_summary     text,
  need_profile     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ended_early      boolean NOT NULL DEFAULT false,

  -- Sınıflandırma
  kind             text NOT NULL CHECK (kind IN ('qualified', 'no_contact', 'spam')),
  score_points     smallint CHECK (score_points IS NULL OR (score_points >= 0 AND score_points <= 10)),
  score_breakdown  jsonb,
  urgency          text CHECK (urgency IN ('none', 'normal', 'urgent')),
  score_reason     text,
  completeness     numeric(3,2),

  -- Takip
  status           text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'positive', 'negative')),
  transcript       jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_kind_idx ON leads (kind);

-- IP bazlı rate limit olayları
CREATE TABLE IF NOT EXISTS rate_events (
  id         bigserial PRIMARY KEY,
  ip         text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('message', 'lead')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_events_ip_created_idx ON rate_events (ip, created_at DESC);
