# Наша кухня — заметки для разработки

Telegram-бот + WebApp для семейного ПП-меню (без глютена и сахара). Пользователь — неопытный
(жена автора), поэтому интерфейс: крупные кнопки, подсказки на каждом экране, понятные ошибки
по-русски. Все тексты интерфейса, комментарии в коде и сообщения коммитов — на русском

Что умеет продукт — в [README.md](README.md). Здесь — как устроен код и как его дорабатывать

## Стек и два режима запуска

Один код приложения (`src/`) — это Cloudflare Worker (`export default { fetch, scheduled }`)

- **Свой сервер (основной).** `server/main.js` оборачивает Worker в `node:http`: база — файл
  SQLite через `node:sqlite` с интерфейсом D1 (`server/d1.js`), статика из `public/`, таймер
  раз в минуту вызывает `scheduled` раз в час, ночной бэкап базы в `data/backups/` (14 дней).
  При старте применяет миграции и сам вызывает `/setup` (webhook, команды, кнопка «Кухня»),
  если заданы `PUBLIC_URL`, `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`. Собирается esbuild'ом
  в один файл `dist/server.mjs`
- **Cloudflare Workers (запасной).** `wrangler.toml`, база D1, деплой только вручную через Actions

Зависимости минимальные: `@anthropic-ai/sdk`, `zod`. Node 24 в Docker (нужен `node:sqlite`)

## Карта кода

| Файл | Что внутри |
|---|---|
| `src/index.ts` | Роутинг: `/telegram/webhook`, `/setup`, `/api/*` (весь API для WebApp одной функцией `api()`), статика. Проверка `initData` Telegram и `ALLOWED_USER_IDS` |
| `src/bot.ts` | Всё общение в чате: команды, голос/фото/ссылки/текст → рецепт, callback-кнопки, режим «что есть дома» (`chat state`) |
| `src/service.ts` | Сценарии поверх базы, общие для бота и API: меню на неделю, замена блюда, покупки из меню, баланс, идеи, сводка дня, отправка списка в чат |
| `src/db.ts` | `Repo` — все SQL-запросы, типы (`Recipe`, `Meal`, `PlanItem`, `Member`, `Settings`…), `HttpError`, `normalizeRecipe` |
| `src/planner.ts` | Чистая логика: составление недели, список покупок с пересчётом на семью, отделы магазина (`aisleFor`), подготовка заранее, подбор по продуктам |
| `src/nutrition.ts` | Приёмы пищи, группы продуктов с ключевыми словами и недельными целями, баланс питания (общий и по членам семьи), подсказки. **Цели питания меняются здесь** |
| `src/ai.ts` | ИИ: голос → текст (OpenAI), разбор рецепта / фото / ссылки / идея. Все запросы к модели идут через `ask(env, zodSchema, parts)` |
| `src/notify.ts` | Утреннее меню и вечерние напоминания (вызывается из `scheduled`) |
| `src/starter.ts` | 18 готовых ПП-рецептов для мастера первого запуска |
| `src/telegram.ts` | Мини-клиент Bot API, проверка/подпись `initData`, `escapeHtml` |
| `src/env.ts` | Тип `Env`, «сегодня» и текущий час в часовом поясе семьи |
| `server/` | Запуск на Node (см. выше) |
| `public/` | WebApp без сборки: `index.html`, `styles.css`, ES-модули в `public/js/` |
| `migrations/` | SQL-миграции, применяются по порядку имени |
| `test/` | vitest: планировщик, питание, подпись Telegram, D1-обёртка |

### WebApp (`public/js/`)

- `app.js` — точка входа: грузит `/api/config` и рецепты, переключает экраны. Экран — функция
  `render*(root)`, которая заполняет переданный элемент; новый экран регистрируется в `SCREENS`
- `ui.js` — общее: `state` (config, recipes, tab), `api()` (сам добавляет заголовок
  `X-Telegram-Init-Data`), `guard()` для понятных ошибок, `toast`, `haptic`, шторка, `bus.render`/`bus.go`
- Экраны: `home.js`, `week.js`, `recipes.js` (карточка, порции, режим готовки), `shop.js`,
  `more.js` (баланс, настройки, знакомство), `setup.js` (мастер первого запуска), `add.js`
  (добавление рецепта), `members.js` (члены семьи, «кто ел»), `voice.js` (запись голоса), `amounts.js`
- HTML собирается шаблонными строками — любые данные пользователя только через `esc()`

## ИИ

- `aiEnabled` — есть `ANTHROPIC_API_KEY` **или** `OPENAI_API_KEY`. Если ключ Anthropic есть,
  используется Claude (`ANTHROPIC_MODEL`, по умолчанию `claude-opus-5`), иначе GPT через
  `/v1/chat/completions` со строгой JSON-схемой из той же zod-схемы (`OPENAI_MODEL`,
  по умолчанию `gpt-5.4-mini`)
- Голос — только OpenAI (`OPENAI_TRANSCRIBE_MODEL`, по умолчанию `gpt-4o-transcribe`)
- Новый ИИ-сценарий: описать zod-схему ответа и вызвать `ask()` — оба провайдера заработают сразу.
  В API проверять доступность через `needAi(env)`, в боте — `aiEnabled(env)` с понятным текстом

## База

- SQLite/D1. Списки хранятся JSON-строками в TEXT-колонках (`meal_types`, `categories`,
  `ingredients`, `steps`, `warnings`, `meals.eaters`), разбираются в `rowTo*` в `db.ts`
- `meals.eaters` — JSON-массив id из `members`; `NULL` значит «ела вся семья»
- `plan.eaters` — то же для меню: для кого блюдо. В одной клетке (день + приём пищи) может быть
  несколько блюд с непересекающимися `eaters` — у членов семьи разные блюда. Инвариант держит
  `Repo.setPlan`: блюдо «для всех» убирает остальные блюда клетки, блюдо для части семьи забирает
  этих людей у других блюд. Покупки для такого блюда считаются на число его едоков
- `settings` — ключ/значение, типизировано через `Settings` и `DEFAULT_SETTINGS` в `db.ts`
- Служебные таблицы: `updates` (защита от повторных webhook), `sent` (напоминание не уйдёт
  дважды), `drafts` (черновики рецептов до кнопки «Сохранить» в боте)
- **Изменить схему:** новый файл `migrations/000N_что_меняем.sql` (только добавлять, старые
  не править). На сервере применится при старте, в Cloudflare — `wrangler d1 migrations apply`.
  Потом обновить тип и `rowTo*` в `db.ts`

## Как добавлять фичи

- Новый эндпоинт — ветка в `api()` в `src/index.ts`, логика в `service.ts` (если нужна и боту)
  или прямо в `Repo`. Ошибки для пользователя — `throw new HttpError(status, "по-русски")`
- Новая команда бота — `case` в `handleUpdate` в `bot.ts` и строка в `setMyCommands` в `/setup`
  (`src/index.ts`)
- Чистую логику (подсчёты, подбор, разбор текста) держать в `planner.ts`/`nutrition.ts` и покрывать тестами
- Даты — строки `YYYY-MM-DD` в часовом поясе семьи (`today(env)`, `addDays`), не `new Date()` напрямую

## Проверка

```bash
npm run typecheck && npm test            # то же гоняет CI (.github/workflows/ci.yml)
npm run build:server && DEV_AUTH=1 ALLOWED_USER_IDS=1 npm start   # http://localhost:8080
```

`DEV_AUTH=1` пускает в WebApp из обычного браузера без Telegram. Бот локально не подключается
(нет `PUBLIC_URL`), для ИИ-функций нужен `OPENAI_API_KEY` в окружении

## Правила работы (пока идёт разработка)

- **Каждое законченное изменение сразу коммитить, пушить и выкладывать** на тестовый сервер
  (`./deploy.sh web cooking 8080`), не спрашивая отдельно, — автор смотрит результат вживую.
  Перед коммитом — `npm run typecheck && npm test`, после деплоя — проверить `/health`
- **База на сервере — настоящая: Катя заносит туда рецепты и семью. Её нельзя потерять.**
  Никогда не удалять и не пересоздавать `/srv/projects/cooking/data/`, не чистить таблицы,
  не делать `docker compose down -v`. Миграции — только такие, что сохраняют данные.
  `deploy.sh` перед выкладкой сам делает бэкап (`scripts/backup-server.sh`): снимок в
  `data/backups/before-deploy-*.db` на сервере (последние 30) и копию в `backups/` на этом
  компьютере (в git не попадает). Не получился бэкап — деплой останавливается, обходить это нельзя.
  Плюс сервер сам делает ночной бэкап в 3:00 (`data/backups/cooking-*.db`, 14 дней)

## Деплой на тестовый сервер

```bash
./deploy.sh web cooking 8080
```

- Сервер `143.198.120.25`, пользователь `deploy`, ключ `~/.ssh/exp_server`. Общая инструкция
  по серверу — `/Users/vasya/Work/exp/DEPLOY-TO-TEST-SERVER.md`
- Скрипт rsync'ает проект в `/srv/projects/cooking/app/` и делает `docker compose up -d --build`
  в `/srv/projects/cooking/`. Там свой `docker-compose.yml` (Traefik вместо Caddy), `.env`
  и папка `data/` с базой — они лежат вне `app/` и при деплое не затираются
- Адрес `https://cooking.more-momentov.ru` (`PUBLIC_URL` и правило Traefik в серверном
  `docker-compose.yml`; старый вариант на sslip.io — в `docker-compose.yml.bak-sslip`). Бот — @jjdhbrhfjbot
- Ключа Anthropic на сервере нет, рецепты/фото/идеи идут через GPT
- Новая переменная окружения: добавить в `Env` (`src/env.ts`), в объект `env` в `server/main.js`,
  в `.env.example`, в `scripts/make-env.mjs` и в `.env` на сервере

Автодеплой через GitHub Actions (`deploy-server.yml`, при пуше в `main`) и Cloudflare остались
как вариант для чистого сервера — см. README
