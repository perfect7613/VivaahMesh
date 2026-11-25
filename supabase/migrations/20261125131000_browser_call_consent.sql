alter table calls
  add column browser_consent_hash text unique,
  add column browser_consent_expires_at timestamptz,
  add column browser_consented_at timestamptz,
  add column browser_started_at timestamptz;
