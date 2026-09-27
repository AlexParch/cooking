CREATE TABLE recipes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  meal_types   TEXT NOT NULL DEFAULT '[]',  -- ["breakfast","lunch","snack","dinner"]
  categories   TEXT NOT NULL DEFAULT '[]',  -- ключи из src/nutrition.ts
  ingredients  TEXT NOT NULL DEFAULT '[]',  -- [{"name":"...","amount":"..."}]
  steps        TEXT NOT NULL DEFAULT '[]',  -- ["...", "..."]
  notes        TEXT NOT NULL DEFAULT '',
  warnings     TEXT NOT NULL DEFAULT '[]',  -- замечания по ПП (глютен, сахар)
  minutes      INTEGER,
  source       TEXT NOT NULL DEFAULT 'manual', -- manual | voice | text | ai
  created_by   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,               -- YYYY-MM-DD
  meal_type   TEXT NOT NULL,               -- breakfast | lunch | snack | dinner
  recipe_id   INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  categories  TEXT NOT NULL DEFAULT '[]',
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX meals_date ON meals(date);

-- Черновики рецептов от ИИ, которые ждут кнопки «Сохранить» в боте
CREATE TABLE drafts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Защита от повторной обработки, если Telegram повторит webhook
CREATE TABLE updates (
  update_id   INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
