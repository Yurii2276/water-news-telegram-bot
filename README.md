# Water News Intelligent Editor

Українськомовний Telegram-бот для каналу “Вода UA”. Бот збирає новини водного сектору, відсіює шум і дублікати, готує професійні публікації українською, веде журнал матеріалів у PostgreSQL і може автоматично публікувати підтверджені матеріали.

## Можливості

- офіційні джерела: НКРЕКП, Кабмін, Верховна Рада та профільні комітети, Мінрозвитку, Держводагентство, АМУ;
- Google News використовується тільки для discovery; у публікаціях показується першоджерело, не Google redirect;
- стійкий discovery після PR #9: ротація targeted Google News queries, transient retry, retry після порожнього scan, технічні повідомлення адміну, продовження scan після помилок джерел;
- сильний title-keyword fallback для очевидних тем: водоканали, водопостачання, водовідведення, тарифи на воду, НКРЕКП, WASH, donor/recovery water infrastructure, wastewater treatment, smart water, leak detection, non-revenue water;
- мінімізація OpenAI-викликів: якщо deterministic acceptance достатній, додатковий AI relevance call не потрібен;
- публікації й дайджести українською: кириличні заголовки зберігаються, латинські заголовки перекладаються через OpenAI або безпечно падають у deterministic fallback;
- без generic-контексту: бот не вигадує “чому це важливо”; публічний контекст береться лише з title/snippet/content першоджерела;
- story-level clustering: дублікати зводяться за URL, нормалізованим заголовком, content similarity і `story_key`;
- source quality classification: official regulator/government/parliament/local authority/utility, international institution, national/public/local media, aggregator;
- редакційні ліміти: технічний максимум 10 публікацій/день, окремий editorial cap і cap на дрібні локальні аварійні повідомлення;
- `/daily_digest` і щотижневий `/weekly_analysis`.

## Запуск

Потрібен Node.js 22 або новіший.

```powershell
npm install
npm start
```

Для локального запуску скопіюйте `.env.example` у `.env` і заповніть секрети. Файл `.env` не комітьте.

## Обов’язкові змінні

| Змінна | Призначення |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | токен Telegram-бота |
| `ADMIN_TELEGRAM_ID` | числовий Telegram ID адміністратора |
| `PUBLISH_CHAT_ID` | ID Telegram-каналу для публікацій |
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | ключ OpenAI API |

## Основні налаштування

| Змінна | Типове значення | Призначення |
| --- | --- | --- |
| `DRY_RUN` | `true` | безпечний режим: перевіряє й журналює, але не публікує в канал |
| `OPENAI_MODEL` | `gpt-5.4-mini` | модель для класифікації/перекладу |
| `NEWS_LIMIT` | `20` | ліміт матеріалів з одного discovery-каналу |
| `DAILY_SCAN_HOUR_UTC` | `5` | щоденний scan, UTC |
| `DAILY_REPORT_HOUR_UTC` | `18` | щоденний технічний звіт адміну, UTC |
| `DAILY_DIGEST_TIMEZONE` | `Europe/Kyiv` | timezone для дайджесту |
| `DAILY_DIGEST_LOCAL_HOUR` | `16` | локальна година дайджесту |
| `DAILY_DIGEST_LOCAL_MINUTE` | `40` | локальна хвилина дайджесту |
| `WEEKLY_ANALYSIS_ENABLED` | `true` | вмикає щотижневий секторний аналіз |
| `WEEKLY_ANALYSIS_TIMEZONE` | `Europe/Kyiv` | timezone weekly analysis |
| `WEEKLY_ANALYSIS_LOCAL_WEEKDAY` | `5` | день тижня, 1=понеділок, 5=п’ятниця |
| `WEEKLY_ANALYSIS_LOCAL_HOUR` | `15` | локальна година weekly analysis |
| `WEEKLY_ANALYSIS_LOCAL_MINUTE` | `0` | локальна хвилина weekly analysis |
| `MAX_DAILY_PUBLICATIONS` | `18` | жорсткий технічний максимум standalone-публікацій за календарний день |
| `PUBLICATION_EDITORIAL_CAP` | `18` | редакційний денний cap для звичайного standalone-потоку |
| `MAX_DAILY_LOCAL_INCIDENTS` | `3` | максимум локальних аварійних/відключених сюжетів за день |
| `PUBLICATION_COUNT_TIMEZONE` | `Europe/Kyiv` | timezone для денного лічильника публікацій |
| `INTERNATIONAL_NEWS_ENABLED` | `true` | вмикає міжнародні institutional/technology Google News запити |
| `MAX_DAILY_INTERNATIONAL_POSTS` | `5` | максимум міжнародних standalone-публікацій у межах загального cap |
| `INTERNATIONAL_STORY_MAX_AGE_DAYS` | `7` | максимальний вік міжнародного сюжету для редакційного відбору |
| `SOURCE_PERMANENT_FAILURE_THRESHOLD` | `3` | кількість повторних 403/404 до cooldown |
| `SOURCE_PERMANENT_FAILURE_COOLDOWN_HOURS` | `168` | тривалість cooldown для direct source discovery |
| `SOURCE_FAILURE_NOTIFICATION_COOLDOWN_HOURS` | `24` | cooldown для технічних повідомлень адміну про джерела |
| `POST_INTERVAL_MINUTES` | `15` | інтервал між постами |
| `PUBLISH_MAX_RETRIES` | `3` | retry публікації |

Старі `DAILY_DIGEST_HOUR_UTC` і `DAILY_DIGEST_MINUTE_UTC` залишені для сумісності, але новий runtime використовує локальні `DAILY_DIGEST_*` налаштування.

## Команди адміністратора

- `/scan` — запустити збір;
- `/queue` — показати чергу автопублікації;
- `/news` — показати останні опубліковані матеріали;
- `/retry_failed_publish` — повернути в чергу матеріали, які впали тільки на етапі публікації;
- `/publish_queue_now` — вручну запустити drain черги;
- `/daily_digest` — сформувати денний дайджест;
- `/weekly_analysis` — сформувати тижневий аналіз сектору.

## Railway

Проєкт налаштований як long-polling worker через `railway.json`. HTTP server, public domain і `PORT` не потрібні. На Railway додайте PostgreSQL service і всі required Variables з `.env.example`.

Для production-публікації явно встановіть `DRY_RUN=false`. До перевірки Telegram-каналу, admin ID і Railway Variables залишайте `DRY_RUN=true`.

## Production publication contract

- Публічні Telegram-пости використовують HTML `parse_mode` і ніколи не показують raw URL у видимому тексті. Посилання має формат `🔗 <a href="{url}">Читати джерело</a>`.
- Стандартний standalone-пост публікується лише тоді, коли з повного тексту статті, офіційного документа або надійного RSS/snippet можна сформувати 5–10 фактологічних речень українською без вигадування фактів.
- Для standalone-постів бот спершу використовує повний article content, publisher/source, дату, RSS snippet і виявлені факти як grounded source basis, а потім може попросити OpenAI сформувати 5–10 українських речень лише з цих даних.
- Згенерований опис перевіряється перед публікацією: 5–10 речень, достатня довжина, відсутність generic filler, видимих URL, непідтверджених чисел і дат; після першої невдалої перевірки дозволена одна correction attempt.
- Якщо контексту недостатньо, матеріал не публікується як standalone і отримує внутрішній статус/причину `insufficient_public_context` або `title_only`; такі матеріали можуть лишатися корисними для digest/аналізу.
- Категорії публікуються тільки як зрозумілі українські labels. Тарифні сюжети мають пріоритет над загальною “водною безпекою” і показуються як `💰 Тарифи`.
- Денний standalone cap рахується за календарним днем `Europe/Kyiv`: effective limit = `min(MAX_DAILY_PUBLICATIONS, PUBLICATION_EDITORIAL_CAP)`, за замовчуванням 18. `/daily_digest`, `/weekly_analysis`, admin previews і технічні повідомлення не споживають цей cap.
- Джерела `unicef_ukraine`, `undp_ukraine`, `world_bank_ukraine`, `ebrd_ukraine`, `usaid_ukraine` мають discovery mode `google_news_only`: їхні застарілі/заблоковані listing URL не fetch-яться напряму, але організації залишаються у source registry для класифікації, display name, ranking і аналізу.
- Targeted Google News discovery має максимум чотири запити за scan: український official/regulatory, український personnel/government, міжнародне financing/institution, global water technology/professional. Ротація детермінована за датою `Europe/Kyiv`.
- Повторні 403/404 direct source failures записуються в additive `source_health`; після threshold джерело входить у cooldown, а diagnostics залишаються admin-only.

## Перевірка

```powershell
npm test
```
