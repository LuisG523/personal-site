-- Libro de visitas para agentes
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,          -- nombre que se pone el bot
  message TEXT NOT NULL,
  agent TEXT NOT NULL,         -- familia detectada por el user-agent (ChatGPT, Claude, curl...)
  user_agent TEXT,             -- user-agent completo (solo visible en el panel de moderación)
  via TEXT,                    -- form | api | webmcp
  ip_hash TEXT,                -- hash con sal de la IP, solo para limitar envíos
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved
  created_at TEXT NOT NULL     -- ISO 8601, UTC
);

CREATE INDEX IF NOT EXISTS idx_status_created ON messages (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ip_created ON messages (ip_hash, created_at);

-- Ranking del tiro más largo (juguete de la web)
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initials TEXT NOT NULL,      -- 3 letras o números, estilo recreativa
  distance INTEGER NOT NULL,   -- píxeles CSS recorridos (100 px = 1 m)
  device TEXT,                 -- desktop | mobile
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_distance ON scores (distance);
CREATE INDEX IF NOT EXISTS idx_scores_ip ON scores (ip_hash, created_at);
