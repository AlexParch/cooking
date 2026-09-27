-- Порции, подготовка заранее, оценки, источник-ссылка
ALTER TABLE recipes ADD COLUMN servings INTEGER;                     -- на сколько порций рассчитан рецепт
ALTER TABLE recipes ADD COLUMN prep_ahead TEXT NOT NULL DEFAULT '';  -- «Замочить нут на ночь», «Разморозить филе»
ALTER TABLE recipes ADD COLUMN prep_hours INTEGER;                   -- за сколько часов до готовки
ALTER TABLE recipes ADD COLUMN source_url TEXT;
ALTER TABLE recipes ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recipes ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE meals ADD COLUMN rating INTEGER;                         -- 1 понравилось, -1 не понравилось, 2 любимое

-- Меню (план) на дни вперёд: одно блюдо на приём пищи
CREATE TABLE plan (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  meal_type   TEXT NOT NULL,
  recipe_id   INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  leftovers   INTEGER NOT NULL DEFAULT 0,  -- 1 = доедаем приготовленное накануне
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, meal_type)
);

-- Общий список покупок
CREATE TABLE shopping (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  amount      TEXT NOT NULL DEFAULT '',
  aisle       TEXT NOT NULL DEFAULT 'Прочее',
  checked     INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'manual',  -- manual | plan
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Кто пользуется ботом (для утренних/вечерних сообщений)
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,   -- Telegram ID
  chat_id     INTEGER NOT NULL,
  first_name  TEXT NOT NULL DEFAULT '',
  notify      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Чтобы не отправлять одно и то же напоминание дважды
CREATE TABLE sent (
  key         TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
