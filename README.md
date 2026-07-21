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
| `MAX_DAILY_PUBLICATIONS` | `10` | жорсткий технічний максимум публікацій за день |
| `PUBLICATION_EDITORIAL_CAP` | `7` | редакційний денний cap для звичайного потоку |
| `MAX_DAILY_LOCAL_INCIDENTS` | `2` | максимум локальних аварійних/відключених сюжетів за день |
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

## Перевірка

```powershell
npm test
```
