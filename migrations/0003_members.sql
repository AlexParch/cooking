-- Члены семьи: баланс питания считается для каждого отдельно
CREATE TABLE members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '🙂',
  kind        TEXT NOT NULL DEFAULT 'adult',  -- adult | child
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Кто ел это блюдо: JSON-массив id из members. NULL — вся семья.
ALTER TABLE meals ADD COLUMN eaters TEXT;
