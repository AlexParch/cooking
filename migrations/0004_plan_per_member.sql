-- Меню: в одной клетке (день + приём пищи) может быть несколько блюд — у каждого своё.
-- Убираем UNIQUE(date, meal_type) (в SQLite — только пересозданием таблицы) и добавляем «для кого».
CREATE TABLE plan_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  meal_type   TEXT NOT NULL,
  recipe_id   INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  leftovers   INTEGER NOT NULL DEFAULT 0,
  eaters      TEXT,                        -- JSON-массив id из members. NULL — вся семья
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO plan_new (id, date, meal_type, recipe_id, title, leftovers, created_at)
  SELECT id, date, meal_type, recipe_id, title, leftovers, created_at FROM plan;
DROP TABLE plan;
ALTER TABLE plan_new RENAME TO plan;
CREATE INDEX plan_slot ON plan(date, meal_type);
