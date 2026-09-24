# CEAT Order Tracking — Backend (v2 deployed to production)

Бэкенд для трекинга заказов CEAT ↔ MTK Rosberg. Фронтенд (React) — в
[`frontend/`](frontend/README.md), отдельный `npm`-проект.

## v2: полный пересбор бизнес-логики

Версия 1 (Фазы 1–11, PI → SO → Container → отгрузка) снесена целиком —
осталась только авторизация (`User`/`AuthModule`/`JwtAuthGuard`/`RolesGuard`)
и `Customer`. Новая концепция — **карточка проформы (PI card)**: одна
сущность `ProformaInvoice` со статусом, вычисляемым из того, какие файлы к
ней прикреплены, вместо графа PI → SO → Container из v1. Это **не миграция
данных** — старая схема и её данные не переносятся, БД пересобирается с
нуля (см. "Пересборка схемы" ниже). История v1 (для справки, если понадобится
логика/паттерны из старой версии) — в git-less памяти проекта, не в этом
README.

- **v2 Фаза 1**: снос v1, новая схема (`ProformaInvoice`, `PiAdditionalFile`,
  `PiLineItem`, `BackorderUpload`), одна миграция `InitSchema`, read-only
  `GET /proforma-invoices` / `GET /proforma-invoices/:id`.
- **v2 Фаза 2**: загрузка исходного PDF проформы с распознаванием номера PI
  из имени файла (ops), загрузка подписанного файла (client), доп. файлы
  (обе роли), approval-флоу предложения замены исходного файла (ops
  предлагает → client утверждает/отклоняет).
- **v2 Фаза 3**: `POST /backorder-uploads` — парсинг реального
  еженедельного xlsx-экспорта завода (листы "Radial BO"/"Bias BO"), апсерт
  карточек PI (`created_from=backorder_row` для новых номеров), полная
  замена их `PiLineItem` на снимок из файла, пересчёт всех 6 агрегатов на
  `ProformaInvoice`.
- **v2 Фаза 4**: реальные экраны фронтенда поверх Фаз 1–3 (список
  карточек, детальная страница с файлами/approval-флоу, загрузка
  бэкордера) — см. [frontend/README.md](frontend/README.md). Перед этим —
  правка формулы агрегатов (см. "Парсинг бэкордера" ниже, раздел про сумму
  сырых значений вместо построчных отношений) и два бэкенд-бага, найденных
  живым тестом фронтенда под обеими ролями (см. ниже, "Два бага, найденных
  живой интеграцией с фронтендом").
- **v2 Фаза 3, доделано**: при подключении `cardsArchived`/
  `cardsSkippedInvalidRows` к фронтенду обнаружилось, что архивация
  карточек (п. 4 исходного ТЗ Фазы 3) и подсчёт пропущенных строк не были
  реализованы вообще — `BackorderUploadsService.upload` никогда не менял
  `is_archived_shipped`. Закрыто до Фазы 5 — см. "Парсинг бэкордера" ниже.
- **Продакшн-деплой v2**: смена паролей `ops`/`buyer`,
  `nginx` reverse-proxy на `/api/*` + закрытие порта 3000 в `ufw`, HTTPS
  осознанно отложен (нет домена, решение пользователя) — v2-бэкенд и
  v2-фронтенд теперь на проде вместо всё ещё сломанного (после сноса
  v1-схемы в Фазе 1) v1. См. "Продакшн-деплой v2" ниже.
- **v2 Фаза 5**: выгрузка в Excel — по отдельной карточке PI
  (`GET /proforma-invoices/:id/export-xlsx`, обе роли, с owner-check для
  `client`) и по всему активному бэкордеру целиком
  (`GET /backorder/export-xlsx`); плюс штамп даты загрузки на имя
  физически сохранённого файла бэкордера. См. "Экспорт в Excel" ниже.
- **v2 Фаза 6**: `GET /backorder/export-xlsx` открыт и для
  `client` — раньше был `ops`-only, теперь `client` тоже может выгрузить
  бэкордер, но видит в нём только строки своего `customer_id` (скоуп в
  сервисе, не в декораторе — тот же паттерн, что и остальные
  client-эндпоинты). Кнопка "Выгрузить весь бэкордер" перенесена с
  `/ops/backorder-upload` на общий список карточек (`PiListPage.tsx`,
  `/ops/pi` и `/client/pi`), доступна обеим ролям. См. "Экспорт в Excel"
  ниже.
- **v2 Фаза 7**: приоритизация позиций клиентом — первый шаг
  режима планирования отгрузок. Новая колонка `priority_qty` на
  `PiLineItem` (миграция), `PATCH /pi-line-items/:id/priority` (client-only,
  явная проверка роли в сервисе — не просто `@Roles()`, см. "Приоритизация
  позиций" ниже), owner-check по `customer_id`, валидация
  `0 ≤ priorityQty ≤ balanceToBeDelivered`. Приоритет **переносится** через
  еженедельную перезагрузку бэкордера (по ключу material_num+so_number,
  clamp'ится вниз, если остаток уменьшился) — без этого правки клиента
  стирались бы каждой загрузкой. Новые агрегаты `priorityTotalQty`/
  `priorityTotalContainers` в ответе `GET /proforma-invoices/:id` (вычисляемые
  геттеры, не колонки). См. "Приоритизация позиций" ниже.
- **v2 Фаза 7.1**: кнопка "Сбросить" в режиме приоритизации —
  массово обнуляет `priorityQty` всех строк карточки одним запросом,
  `PATCH /proforma-invoices/:id/reset-priority` (client-only, owner-check,
  один `UPDATE` на все строки, не N `PATCH .../priority` с фронта), с
  подтверждением (`window.confirm`) перед необратимым массовым действием.
  См. "Приоритизация позиций" ниже.
- **v2 Фаза 7.2**: приоритет — только целые штуки, не дробные.
  `UpdatePriorityDto` теперь `@IsInt()` вместо `@IsNumber()` (`400` с
  сообщением "приоритет указывается в целых штуках"), тот же
  `Number.isInteger`-чек продублирован в `PiLineItemsService.updatePriority`
  (DTO/ValidationPipe не покрыты юнит-тестами этого проекта, см.
  "Приоритизация позиций" ниже). На фронте `PriorityInput.tsx` — оба пути
  (ручной ввод и кнопка "Весь остаток") теперь идут через один `commit()`
  с округлением, `step={1}`; раньше `step="0.01"` не мешал вручную
  напечатать дробное число с клавиатуры.
- **v2 Фаза 7.3** (эта правка, только фронт): кнопка "Сбросить" раньше
  была видна при том же условии, что и переключатель "Режим
  приоритизации" (`isClient && !pi.isArchivedShipped`) — то есть и вне
  режима редактирования тоже. Сужено до `isPriorityMode` — видна строго
  пока режим включён. Логика самого действия не менялась, только условие
  рендера в `PiDetailPage.tsx`. См. [frontend/README.md](frontend/README.md).
- **v2 Фаза 11** (фронтенд, **задеплоено на прод 2026-09-21**): экраны `/ops|client/actual-containers`
  ("Готовые контейнеры": список, деталь, правка дат и файлы для ops) и поле
  "Отправлено" на карточке PI — см. [frontend/README.md](frontend/README.md). Заодно
  на backend исправлено имя загружаемого файла (см. "Имена файлов не на латинице" в
  разделе Фазы 10) — отдельный коммит, задеплоено вместе с Фазой 11; там же ETD/ETA из
  `ETA-15 days` как запасной источник.
- **v2 Фаза 10** (только backend, **задеплоено на прод 2026-09-21**, первая
  загрузка нового формата ещё не делалась): фактические отгрузки из
  того же еженедельного файла — Radial/Bias Dispatch, ETD-ETA, ETA-15
  days (раньше игнорировались) → ActualContainer/строки/файлы, поле
  shippedQty на карточке PI, неизменяемый архив всех строк всех листов
  (BackorderUploadSnapshot) и его выгрузка в xlsx; вся загрузка теперь
  в одной транзакции. См. "Фаза 10: фактические отгрузки" ниже.
- **v2 Фаза 9** (фронтенд "Готово к отгрузке" + небольшие доработки backend,
  **задеплоено на прод 2026-09-19**): экраны `/client/ready-to-ship` и `/ops/ready-to-ship` — см.
  [frontend/README.md](frontend/README.md); на backend добавлены `POST
  /ready-to-ship/remove`, поле `undoableActions` в виде раздела и сокращение
  числа запросов на действие — см. "Фаза 9: доработки backend".
- **v2 Фаза 8** (только backend, задеплоено на прод 2026-09-18): раздел "Готово к
  отгрузке" — клиент раскладывает недельный план отгрузки
  (`current_week_dispatch_qty` по всем активным PI-карточкам) по
  контейнерам-слотам, отменяет действия, подтверждает план; ops точечно
  разблокирует контейнер; клиент прикладывает по одному файлу маркировки на
  позицию контейнера. 4 новые таблицы (одна миграция), 8 эндпоинтов. Есть
  три отличия от ТЗ — см. "Готово к отгрузке" ниже, раздел "Где реализация
  отличается от ТЗ".

## Стек

- Node.js + NestJS + TypeScript
- PostgreSQL, миграции через **TypeORM** (raw SQL миграции, `synchronize: false`)
- Swagger/OpenAPI (`@nestjs/swagger`), с bearer-auth
- Auth: Passport + `@nestjs/jwt` (JWT в заголовке `Authorization: Bearer <token>`)

**Почему TypeORM, а не Prisma**: NestJS даёт нативную интеграцию через
декораторы прямо на entity-классах (`@Entity`, `@Column`, `@ManyToOne`...),
которые и так требуются по ТЗ, — с Prisma пришлось бы дублировать эту схему
ещё и в отдельном `schema.prisma` DSL.

## Структура проекта

```
src/
  common/
    entities/base.entity.ts         # id (uuid), createdAt, updatedAt — общие для всех сущностей
    enums/payment-terms.enum.ts     # общий enum условий оплаты (Customer)
    enums/role.enum.ts              # Role.OPS / Role.CLIENT
    utils/get-by-path.ts            # 'a.b.c' -> obj.a.b.c, для CustomerScopeInterceptor
    testing/fake-repo.ts            # Фаза 3: hand-rolled in-memory Repository-фейк, вынесен из
                                     # proforma-invoices.service.spec.ts, переиспользуется
                                     # backorder-uploads.service.spec.ts. Фаза 7.1: + update()
    auth/
      public.decorator.ts           # @Public() — пропустить JwtAuthGuard (login)
      roles.decorator.ts            # @Roles(Role.OPS) — контроллер только для ops
      client-write-allowed.decorator.ts  # @ClientWriteAllowed() — точечное исключение из read-only
      scope-by-customer.decorator.ts     # @ScopeByCustomer('pi.customer.id') — путь до customer_id
      current-user.decorator.ts     # @CurrentUser() req.user
      request-user.interface.ts
      jwt-auth.guard.ts             # аутентификация (глобальный APP_GUARD #1)
      roles.guard.ts                # авторизация: ops/client, read-only, ops-only (APP_GUARD #2)
      customer-scope.interceptor.ts # фильтрация по customer_id для client (APP_INTERCEPTOR)
  data-source.ts                    # TypeORM DataSource для CLI миграций
  main.ts, app.module.ts

  auth/                             # POST /auth/login, JwtStrategy — без изменений с v1
  users/                            # User entity + UsersService — без изменений с v1
  customers/                        # Customer entity — без изменений с v1
  files/                            # StoredFile + POST /files/upload, GET /files/:id/download.
                                     # Фаза 2: download теперь проверяет владение для client
                                     # (FilesService.assertClientCanAccess) — первая фаза, где
                                     # client-загруженные файлы реально попадают в эту таблицу
  seed/create-user.ts               # CLI для создания пользователей

  proforma-invoices/
    proforma-invoice.entity.ts      # ProformaInvoice — см. "Схема" ниже
    proforma-invoice.entity.spec.ts # unit-тест вычисляемого .status
    proforma-invoices.service.ts    # findAll/findOne + Фаза 2: uploadPi/uploadSigned/
                                     # addAdditionalFile/proposeReplacement/replacementDecision +
                                     # Фаза 7.1: resetPriority (bulk UPDATE, client-only)
    proforma-invoices.service.spec.ts # Фаза 2: extraction/dedup/fill-in/replacement-cycle
    proforma-invoices.controller.ts # GET /, GET /:id + 5 Фаза-2 write-эндпоинтов (см. ниже)
    enums/pi-status.enum.ts         # PiStatus — вычисляемый, не колонка
    enums/pi-created-from.enum.ts   # PiCreatedFrom — реальная колонка (enum в БД)
    utils/extract-pi-number.ts      # regex на 6+ цифр — Фаза 2
    dto/add-additional-file.dto.ts, dto/replacement-decision.dto.ts
  pi-additional-files/              # PiAdditionalFile — только entity + модуль (записи создаются
                                     # из ProformaInvoicesService, отдельного контроллера всё ещё нет)
  pi-line-items/
    pi-line-item.entity.ts          # + priorityQty (Фаза 7, миграция ниже) — строки пишет
                                     # BackorderUploadsService, priorityQty пишет только
                                     # PATCH /pi-line-items/:id/priority (client-only)
    pi-line-items.service.ts        # Фаза 7: updatePriority — owner-check + range-валидация
    pi-line-items.service.spec.ts
    pi-line-items.controller.ts     # PATCH /:id/priority
    dto/update-priority.dto.ts
  backorder-uploads/
    backorder-upload.entity.ts      # BackorderUpload — аудит-строка одной загрузки
    backorder-uploads.service.ts    # парсинг + группировка по PI + upsert карточек/line items +
                                     # пересчёт агрегатов (см. "Парсинг бэкордера" ниже)
    backorder-uploads.service.spec.ts
    backorder-uploads.controller.ts # GET / (список загрузок), POST / (сама загрузка), ops-only
    utils/parse-backorder-file.ts   # чистый парсер xlsx -> ParsedBackorderRow[] (exceljs)
    utils/parse-backorder-file.spec.ts
    utils/compute-pi-aggregates.ts  # чистая функция агрегации — см. её же doc-комментарий
    utils/compute-pi-aggregates.spec.ts
    utils/stamp-date-on-filename.ts # Фаза 5: "name.xlsx" + дата -> "name_2026-09-03.xlsx"
    utils/stamp-date-on-filename.spec.ts
    utils/build-backorder-export-workbook.ts  # Фаза 5: exceljs-воркбук всего бэкордера
    utils/build-backorder-export-workbook.spec.ts
    backorder-upload-snapshot.entity.ts  # Фаза 10: сырые строки всех листов каждой загрузки
    utils/cell-values.ts            # Фаза 10: общие чтения ячеек (0 = пусто, дата 1899 = нет даты)
    utils/parse-actual-containers.ts  # Фаза 10: ETD-ETA / ETA-15 days / Radial+Bias Dispatch
    utils/snapshot-sheets.ts        # Фаза 10: все листы <-> JSON <-> xlsx (архив и его выгрузка)
    testing/weekly-workbook.ts      # Фаза 10: сборка xlsx в форме реального файла для тестов
    backorder.controller.ts         # Фаза 5: GET /backorder/export-xlsx — отдельный
                                     # контроллер, т.к. /backorder-uploads уже занят аудитом
                                     # загрузок, а этот эндпоинт про текущий срез PI. Фаза 6:
                                     # открыт и для client (скоуп по customer_id в сервисе)

  actual-containers/                # Фаза 10: фактические контейнеры (см. "Фаза 10" ниже)
    actual-container.entity.ts, actual-container-line-item.entity.ts, actual-container-file.entity.ts
    actual-containers-import.service.ts  # часть загрузки бэкордера: upsert/замена/пересчёт shipped_qty
    actual-containers.service.ts, actual-containers.controller.ts  # GET/PATCH/POST, файлы
    dto/update-container-dates.dto.ts, dto/add-container-file.dto.ts

  common/utils/format-date.ts       # Фаза 5: Date -> "YYYY-MM-DD" (UTC), общее для обоих экспортов
  common/utils/numeric.ts           # Фаза 5: numeric-колонка (строка из Postgres) -> number | null
  common/utils/sum-by-loadability.ts  # Фаза 7: сгруппировать по loadability и поделить один раз
                                       # на группу — вынесено из compute-pi-aggregates.ts, общее
                                       # с compute-priority-aggregates.ts (см. ниже)

  proforma-invoices/
    utils/compute-line-items-totals.ts  # Фаза 5: строка "Всего" — 1-в-1 логика с фронтом
    utils/compute-line-items-totals.spec.ts
    utils/build-pi-export-workbook.ts   # Фаза 5: exceljs-воркбук одной карточки PI
    utils/build-pi-export-workbook.spec.ts
    utils/compute-priority-aggregates.ts  # Фаза 7: priorityTotalQty/priorityTotalContainers —
                                           # переиспользует sumByLoadabilityGroups
    utils/compute-priority-aggregates.spec.ts

  migrations/
    1788010000000-InitSchema.ts     # вся схема v2 с нуля
    1788273456000-AddBackorderUploadArchiveAndSkippedCounts.ts  # Фаза 3, доделано
    1788946343615-AddPriorityQtyToPiLineItems.ts                # Фаза 7
    1789746739709-AddReadyToShip.ts                             # Фаза 8

  ready-to-ship/                    # Фаза 8 — см. раздел "Готово к отгрузке"
    shipping-container.entity.ts, container-line-allocation.entity.ts,
    allocation-action.entity.ts, marking-file.entity.ts
    ready-to-ship.service.ts        # view/move/undoLast/undoAll/confirm/unlock — всё через
                                     # dataSource.transaction(em => ...), не через InjectRepository
    marking-files.service.ts        # загрузка/удаление/скачивание маркировки
    allocation-relink.service.ts    # перенос аллокаций на новые PiLineItem при перезагрузке бэкордера
    ready-to-ship.controller.ts     # GET /ready-to-ship, POST move|undo-last|undo-all|confirm
    shipping-containers.controller.ts   # POST /containers/:id/unlock (ops)
    container-allocations.controller.ts # /container-allocations/:id/marking-file[/download]
    utils/compute-container-fill.ts # fill = Σ qty/loadability, totalPossibleContainers, эпсилон для float
    testing/ready-to-ship-harness.ts    # общий набор fake-репозиториев для 4 спеков этой фазы
  pi-line-items/utils/line-item-key.ts  # (materialNum, soNumber) — общий ключ для priority и аллокаций
  common/testing/fake-data-source.ts    # Фаза 8: fake DataSource с transaction(em => ...)
```

## Схема (v2 Фаза 1)

### ProformaInvoice — карточка PI

Заменяет весь граф v1 (`ProformaInvoice → SalesOrder → Container →
ShipmentDocument/Payment/TelexReleaseEvent`) одной сущностью. Её жизненный
цикл — не переход по FSM-колонке, а **вычисляемое** поле `status`
(геттер `ProformaInvoice.status`, помечен `@Expose()` для сериализации, как
уже был `PiLineItem.qtyRemaining` в v1):

```
isArchivedShipped                    → archived_shipped
pendingReplacementFileUrl задан      → replacement_pending
signedFileUrl задан                  → signed
piFileUrl задан                      → missing_signed_document
иначе                                → missing_pi_document
```

**Почему вычисляемое поле, а не колонка** — статус карточки полностью
определяется тем, какие файлы к ней прикреплены и флагом архивации; если
хранить его отдельной колонкой, любой путь записи (ручной `PATCH`,
сид-скрипт, будущий парсер бэкордера), забывший её обновить, тихо
рассинхронизирует статус с реальным состоянием документов. Вычисление
исключает этот класс багов по построению — колонки-источники истины и
представление никогда не могут разойтись.

Остальные поля: `piNumber` (unique), `customer` (FK), три файловых слота
(`piFile*`, `signedFile*`, `pendingReplacementFile*` — каждый со своими
`*UploadedAt`/`*UploadedBy` (или `*ProposedBy`/`*ProposedAt`) полями, FK на
`User`), `isArchivedShipped`, `createdFrom` (`pi_upload` | `backorder_row` —
реальная enum-колонка, не вычисляется), и агрегаты `totalQty`,
`totalContainers`, `qtyPending`, `containersPending`,
`currentWeekPlanContainers`, `currentWeekPlanQty` — все `numeric`,
`nullable`, не пересчитываются в этой фазе (заполнит парсинг бэкордера,
Фаза 3). Позже добавлено `label` (`varchar(30)`, nullable) — название, которое
задаёт client до подписания; см. "Название карточки PI".

### PiAdditionalFile

Произвольные доп. файлы к карточке (не PI/подписанный/замена — например,
сопроводительное письмо). `pi` (FK), `fileUrl`, `uploadedBy` (FK User),
`uploadedAt`, `description` (nullable).

### PiLineItem

Строка PI: `pi` (FK), `soNumber`, `materialNum`, `materialDesc`,
`balanceToBeDelivered`, `quantity`, `mt`, `loadFactor`, `loadability`,
`currentWeekDispatchLoadFactor`, `currentWeekDispatchQty` — все `numeric`/
`varchar` nullable в этой фазе, заполняются парсингом файла/бэкордера
(Фазы 2–3), поэтому нет ни одного write-эндпоинта для них ещё.

### BackorderUpload

Аудит-строка одной загрузки файла бэкордера: `uploadedAt`, `uploadedBy` (FK
User), `fileName`, `rowsProcessed`, `newCardsCreated`. Сам парсинг — Фаза 3.

### `pi_created_from_enum`: `pi_upload` | `backorder_row`

Откуда возникла карточка — вручную загруженный файл PI, или строка из
загруженного бэкордера.

## Загрузка файлов и approval-флоу замены (Фаза 2)

Все 5 write-эндпоинтов ниже — `multipart/form-data`, поле `file` (кроме
`replacement-decision` — обычный JSON `{ approved: boolean }`). Каждый
внутри вызывает `FilesService.save()` напрямую (не HTTP `POST
/files/upload`) — сохранение байтов и создание карточки/обновление PI
происходит в одном запросе, без отдельного шага "сначала залей файл,
получи URL, потом пришли URL сюда".

### `POST /proforma-invoices/upload-pi` (ops)

Номер PI читается из **имени файла**, не из поля формы — регэксп на первую
последовательность из 6+ цифр (`extractPiNumber`,
[extract-pi-number.ts](src/proforma-invoices/utils/extract-pi-number.ts)):
`"100037320.pdf"` и `"signed_100037320.pdf"` дают одно и то же
`"100037320"` (короткие пробеги вроде 4-значного года тоже не мешают —
регэксп требует минимум 6 цифр подряд). Логика:

1. Номер не найден → `400 "не удалось распознать номер PI из имени файла"`,
   файл не сохраняется.
2. Карточка с этим номером уже есть, и `pi_file_url` уже заполнен → `409
   "проформа с этим номером уже загружена, используйте предложение замены"`
   — эту проверку делаем **до** сохранения файла, чтобы конфликтующий
   апload не оставлял приплода в `stored_files`.
3. Карточка есть, но `pi_file_url` пуст (`created_from = backorder_row`,
   т.е. карточка родилась из бэкордера раньше, чем пришёл сам файл) →
   дозаполняем `pi_file_url`/`pi_file_uploaded_at`/`pi_file_uploaded_by` на
   существующей карточке.
4. Карточки нет вообще → создаём новую, `created_from = pi_upload`,
   `customer` — **`customersService.findFirst()`**, т.к. в пилоте всего
   один клиент (`CustomersService.findFirst`,
   [customers.service.ts](src/customers/customers.service.ts) —
   `TODO(multi-client)` прямо в коде: с появлением второго клиента это
   обязано стать явным выбором вызывающего, а не "первый попавшийся").
   Уникальный индекс на `pi_number` — подстраховка от гонки двух
   одновременных `create` с одним номером (ловится через
   `isUniqueViolation` → тот же `409`, не `500`).

### `POST /proforma-invoices/:id/upload-signed` (client)

Просто перезаписывает `signed_file_url`/`*_uploaded_at`/`*_uploaded_by` —
без approval, это собственное действие клиента, ему не нужно ничьё
подтверждение. `@ClientWriteAllowed()`, доступен и ops (RolesGuard "ops
always allowed" — не блокируем).

### `POST /proforma-invoices/:id/additional-files` (обе роли)

Добавляет запись в `PiAdditionalFile`, без ограничения на количество.
`description` — опциональное текстовое поле формы (`AddAdditionalFileDto`).

### `POST /proforma-invoices/:id/propose-replacement` (ops)

Заполняет `pending_replacement_file_url`/`*_proposed_by`/`*_proposed_at`.
Если уже есть незакрытое предложение (`pending_replacement_file_url` не
пуст) → `409` до сохранения нового файла — нельзя предложить второе поверх
первого, пока клиент не решил по первому.

### `POST /proforma-invoices/:id/replacement-decision` (client)

`{ "approved": true | false }`.

- Нет активного предложения (`pending_replacement_file_url` пуст) → `400
  "нет активного предложения замены для этого PI"`.
- `approved: true` → `pi_file_url` = `pending_replacement_file_url`, и
  **`pi_file_uploaded_at`/`pi_file_uploaded_by` тоже переносятся** с
  предложения (не только `pi_file_url`) — иначе эти два поля продолжали бы
  описывать старый файл, хотя `pi_file_url` уже указывает на новый.
  `pending_replacement_*` очищаются.
- `approved: false` → `pi_file_url` не трогается, `pending_replacement_*`
  просто очищаются.

### Владение проверяется в сервисе, не только интерцептором

`uploadSigned`/`addAdditionalFile`/`replacementDecision` (все client-facing
записи) грузят карточку через `findOwnedByActor` — тот же паттерн, что был
в v1 у `client-sign`/`report-advance-payment`
(`ProformaInvoicesService`): `CustomerScopeInterceptor` фильтрует только
*ответ* (`map()` после хендлера), так что мутация над чужим PI успела бы
выполниться, если полагаться только на него. `findOwnedByActor` — no-op
для `ops` (роль всегда проходит), 404 для `client` с чужим `customer_id`.
`uploadPi`/`proposeReplacement` — чисто ops-эндпоинты (нет
`@ClientWriteAllowed()`, `RolesGuard` блокирует `client` ещё до контроллера),
им эта проверка не нужна.

### Скачивание: `GET /files/:id/download` теперь проверяет владение для `client`

До этой фазы файл, попавший в `stored_files`, был доступен на скачивание
любому аутентифицированному пользователю без проверки — это было безопасно
случайно, пока единственный, кто грузил файлы, был `ops`. Фаза 2 впервые
даёт `client` возможность класть в эту же таблицу файлы (подписанный PI,
доп. файлы, решение по замене), так что дыра стала реальной. Не стали
изобретать новый эндпоинт — расширили существующий:
`FilesService.getDownloadable(id, actor)` теперь для `client` вызывает
`assertClientCanAccess()`, которая проверяет точным совпадением URL
(`/files/:id/download`), что этот файл фигурирует хотя бы в одном из
`pi_file_url`/`signed_file_url`/`pending_replacement_file_url` PI **или**
`file_url` в `PiAdditionalFile` PI, принадлежащей `customer_id` актора; иначе
— `404` (не `403`, чтобы не подтверждать сам факт существования файла).
`ops` по-прежнему не ограничен. `FilesModule` ради этого регистрирует
`ProformaInvoice`/`PiAdditionalFile` через свой собственный
`TypeOrmModule.forFeature(...)` (а не импортирует
`ProformaInvoicesModule`/`PiAdditionalFilesModule` целиком) — это read-only
проверка владения, а не бизнес-логика, и так короче цепочка модульных
импортов (`ProformaInvoicesModule` уже импортирует `FilesModule` для
`FilesService`; обратный импорт создал бы цикл).

### Два бага, найденных живой интеграцией с фронтендом (Фаза 4)

Оба — в этом же контроллере, оба всплыли только когда `client` реально
попробовал вызвать соответствующий эндпоинт из браузера (не curl из-под
`ops`, где `RolesGuard`'s "ops always allowed" маскировал первый баг,
и не unit-тестами, которые мокают репозитории и не гоняют настоящий
`ClassSerializerInterceptor`/TypeORM relations):

1. **`@ScopeByCustomer("customer.id")` был на уровне класса контроллера**,
   применяясь ко всем методам одинаково — включая `addAdditionalFile`,
   который возвращает `PiAdditionalFile`, а не `ProformaInvoice`.
   `CustomerScopeInterceptor` пытался прочитать `customer.id` у объекта, где
   этот путь ведёт в никуда (на `PiAdditionalFile` правильный путь —
   `pi.customer.id`), получал `undefined`, сравнивал с реальным
   `customerId` из токена и кидал `NotFoundException()` **на каждый
   успешный запрос client**, хотя `INSERT` уже прошёл (файл реально
   сохранён и в БД, и на диске) — клиент получал `404` на операцию,
   которая на самом деле удалась. Фикс: декоратор снят с класса, поставлен
   только на `GET /` и `GET /:id` (единственные хендлеры, чей ответ
   реально имеет форму `ProformaInvoice`); остальные методы и так проверяют
   владение сами (`findOwnedByActor`), декоратор был для них лишней и
   в одном случае битой подстраховкой.
2. **`findAll`/`findOne` не запрашивали `additionalFiles.uploadedBy`** —
   только `additionalFiles` без вложенного relation, так что
   `PiAdditionalFile.uploadedBy` был `undefined` на любом `GET`-ответе
   (сама запись при создании временно держит `{id}` в памяти, но после
   перезагрузки из БД relation не подтягивается без явного запроса). Уронило
   фронтенд намертво (`Cannot read properties of undefined (reading
   'email')`) при рендере списка доп. файлов на второй и последующий рендер
   страницы. Фикс — `"additionalFiles.uploadedBy"` добавлен в оба списка
   `relations`.

Ни один из двух багов не ловился юнит-тестами (`makeFakeRepo` не
воспроизводит ни `ClassSerializerInterceptor`, ни фактическую загрузку
TypeORM-relations) — оба нашлись только прогоном настоящего браузера против
настоящего бэкенда с обеими ролями, что и стало поводом добавить их сюда
как напоминание не полагаться только на unit-тесты для этого класса ошибок.

### Живая проверка (Фаза 4)

Полный цикл в Claude Browser поверх живой Neon-БД, обеими ролями: `ops`
загружает исходную проформу на реальную карточку → предлагает замену →
`client` (после перелогина в том же сеансе — заодно всплыла и оказалась
ложной тревогой гонка react-query кэша между ролями, см. ниже) видит
`replacement_pending`, скачивает оба файла, загружает подписанный файл,
добавляет доп. файл, одобряет замену → статус и метаданные (`uploaded_at`/
`uploaded_by`) корректно переносятся на исходный слот. Отдельно — список
`GET /backorder-uploads` (4 реальные записи с прошлых фаз), чекбокс
"показать архивные" (флаг временно проставлен и снят через прямой SQL — в
бэкенде до сих пор нет эндпоинта для архивации, см. frontend README).

**Ложная тревога, зафиксированная здесь чтобы не перепроверять заново**:
после переключения роли (logout → login другим пользователем) список на
секунду показал устаревший статус карточки — оказалось, `QueryClient`
(`frontend/src/main.tsx`) один на весь SPA-сеанс и не сбрасывается при
логине/логауте; `staleTime: 30_000` может на короткое время отдать
кэш предыдущей роли до того, как реальный ответ от сервера перерисует
экран. В финальном скриншоте (после того как сеть отработала) данные были
верны — это не бага авторизации/скоупинга, а обычная гонка рендера при
ручном тестировании. Не чинили: сценарий "два разных человека в одной
вкладке браузера" не встречается в реальном использовании (`ops` и
`client` — разные физические пользователи на разных устройствах).

Тестовые файлы/записи (`stored_files`, `pi_additional_files`, fake PDF на
диске), созданные в процессе — удалены после проверки; временный
архивный флаг — возвращён в `false`. Реальные 23 карточки пилота, их
`PiLineItem` и агрегаты — не тронуты (кроме самой формулы агрегатов,
пересчитанной переуплоадом того же файла, см. выше).

### Тесты (Фаза 2)

`extract-pi-number.spec.ts` — распознавание номера: с расширением, с
`signed_` префиксом, с коротким пробегом цифр (год) перед настоящим
номером, без цифр (`null`), только короткий пробег (`null`).

`proforma-invoices.service.spec.ts` (лёгкий hand-rolled fake-репозиторий —
in-memory массив строк с матчингом по `where`, тот же принцип, что
`FakeManager` в v1, не настоящая БД): 400 на нераспознанный номер, создание
новой карточки, 409 на повторную загрузку исходного файла, дозаполнение
карточки из `backorder_row`, полный цикл `propose-replacement` →
`replacement-decision` (approve и reject), 409 на второе предложение
поверх первого, 400 на решение без активного предложения.

Backend test count: 19 (было 5 после Фазы 1: 5 на `.status` +
5 на `extractPiNumber` + 9 на `ProformaInvoicesService`).

Проверено и вживую (live Neon-БД, не только юнит-тесты): полный цикл через
`curl` — `upload-pi` (400 → создание → 409 на дубль) →
`upload-signed` (client) → `additional-files` (ops, с `description`) →
скачивание клиентом своего файла (`200`) → скачивание клиентом чужого
(несвязанного) файла (`404`, `ops` тот же файл видит) →
`propose-replacement` → 409 на второе предложение → `replacement-decision`
(`approved: true`, статус карточки и `piFileUploadedBy` обновились
правильно) → на втором PI то же самое с `approved: false` (файл не
поменялся). Тестовые данные (PI-карточки, `stored_files`, файлы на диске)
удалены после проверки.

## Парсинг бэкордера (Фаза 3)

### `POST /backorder-uploads` (ops, multipart, поле `file`)

Принимает еженедельный xlsx-экспорт завода как есть (реальный пример:
`2907_MTK_ROSBERG_INR.xlsx`, 7 листов). Разбираются **только** листы
`Radial BO` и `Bias BO` — `parseBackorderFile`
([parse-backorder-file.ts](src/backorder-uploads/utils/parse-backorder-file.ts))
матчит имя листа регистронезависимо и **молча игнорирует любой другой
лист**, сейчас или в будущем (`Summary`, `Radial/Bias Dispatch`, `ETD-ETA`,
`ETA-15 days` — это уже отгруженное/оплаченное состояние, вне схемы
`ProformaInvoice` этой фазы) — намеренное решение: разобрать то, что
понятно, а не гадать по структуре незнакомых листов и не падать на них.

Реальный файл оказался не полностью единообразным — на листе `Radial BO`
перед строкой заголовков есть отдельная строка с одним кодом клиента
(`66000402`), на `Bias BO` её нет, заголовки сразу в строке 1. Парсер не
предполагает фиксированный номер строки заголовка — сканирует первые 5
строк листа и берёт ту, где есть ячейка `MaterialNum` (без учёта регистра).
Колонка **`Quotation`** — это номер PI (тот же формат, что распознаётся из
имени файла в `upload-pi`, Фаза 2); `Loadability` матчится по подстроке,
т.к. на одном листе она называется `Radial Load.Loadability`, на другом —
`Bias Load.Loadability`. Строки без номера PI (пустые/итоговые в хвосте
листа) пропускаются, не считаются ошибкой.

### Апсерт карточек и line items (`BackorderUploadsService.upload`)

1. Все строки обоих листов группируются по `piNumber` (`Quotation`).
2. На каждую группу: если карточки с этим `pi_number` нет — создаётся новая
   (`createdFrom = backorder_row`, `customer` — тот же
   `customersService.findFirst()` с TODO про мультиклиента, что и в
   `upload-pi`). Если карточка уже есть (неважно, создана раньше через
   `upload-pi` или предыдущей загрузкой бэкордера) — `createdFrom` **не**
   переписывается, она просто получает свежие line items.
3. Line items этой карточки полностью заменяются: `DELETE` всех
   существующих `PiLineItem` по `pi_id`, затем `INSERT` строк из этой
   загрузки. Загрузка — это снимок текущего открытого бэкордера, не
   дельта: без замены повторная загрузка того же файла удваивала бы каждую
   строку. Подтверждено вживую — 3 последовательные загрузки одного и того
   же реального файла дали `newCardsCreated: 23, 0, 0` и стабильные
   182 строки в `pi_line_items` (не 182, 364, 546).
4. 6 агрегатов PI пересчитываются с нуля по строкам этой загрузки
   (`computePiAggregates`,
   [compute-pi-aggregates.ts](src/backorder-uploads/utils/compute-pi-aggregates.ts)):
   - `totalQty` / `qtyPending` / `currentWeekPlanQty` — прямые суммы
     `Quantity` / `Balance To be Delivered` / `Current Week Dispatch Plan
     (Qty)`.
   - `totalContainers` / `containersPending` / `currentWeekPlanContainers` —
     `Quantity`/`Balance`/`Current Week Dispatch Qty`, каждое делённое на
     `Loadability`, **пересчитанное самостоятельно из сырых колонок**, а не
     взятое из собственных колонок файла `Load Factor`/`Current Week
     Dispatch Plan (Load Factor)`. Строки группируются по значению
     `Loadability`, их количества суммируются **внутри группы**, и только
     потом — одно деление на группу, а не деление на каждой строке с
     последующим суммированием уже поделённых значений.

   **Важная находка при первой попытке сверки с листом `Summary`
   реального файла**: изначальное предположение (Фаза 3, по одной
   проверенной строке) — что `Load Factor` файла это `Quantity /
   Loadability` — оказалось неверным. Прямое сравнение по всем строкам, где
   `Quantity ≠ Balance To be Delivered` (иначе обе гипотезы неотличимы),
   показало: `Load Factor` файла — это `Balance To be Delivered /
   Loadability` (17 из 17 однозначных случаев), не `Quantity /
   Loadability` (0 из 17). То есть колонка файла — это уже "контейнеры
   в ожидании", а не "контейнеры всего"; выдавать её за `totalContainers`
   значило бы путать эти два понятия местами. Плюс у 18 реальных строк
   `Loadability = 0`, но `Load Factor` файла всё равно ненулевой (устаревшие
   мастер-данные) — доверять этой колонке напрямую means наследовать эту
   нестыковку. Пересчёт из сырых `Quantity`/`Balance`/`Loadability`
   устраняет оба источника рассинхронизации и держит `totalContainers`/
   `containersPending` семантически честными по отношению друг к другу
   (как и `totalQty`/`qtyPending`).
5. **Архивация**: после апсерта всех PI из загрузки — любая карточка
   (независимо от `created_from`), у которой `is_archived_shipped = false`
   и её `pi_number` **не входит** в множество номеров этой загрузки,
   получает `is_archived_shipped = true` — файл считается источником
   истины "что сейчас открыто", выпадение карточки из снимка значит "уже
   отгружено". `PiLineItem` таких карточек не трогаются — остаются
   последним известным фактом. Если ранее архивная карточка снова
   встретилась в новой загрузке — флаг снимается (`is_archived_shipped =
   false`) в этом же проходе, до сравнения со снимком. Реализовано через
   `find({ where: { isArchivedShipped: false } })` + фильтр в JS + bulk
   `save()`, а не raw SQL `UPDATE` — на пилотных объёмах (десятки карточек)
   не имеет значения, а `makeFakeRepo` не эмулирует query builder.
6. Пишется `BackorderUpload` (`uploadedAt`, `uploadedBy`, `fileName`,
   `rowsProcessed` — все валидные строки обоих листов, `newCardsCreated` —
   сколько из групп были новыми картами, `cardsArchived` — сколько
   заархивировано этим проходом (шаг 5), `rowsSkipped` — см. ниже).
   Миграция `1788273456000-AddBackorderUploadArchiveAndSkippedCounts.ts`
   добавляет колонки `cards_archived`/`rows_skipped` (обе `int default 0`)
   — прогнана на живой Neon-БД.

`GET /backorder-uploads` — список загрузок (аудит), ops-only, новые сверху.

### "Пропущенные" строки (`rowsSkipped` / ответ: `cardsSkippedInvalidRows`)

`parseBackorderFile` считает строку "пропущенной" только если у неё есть
`MaterialNum`, но нет читаемого номера PI (`Quotation`) — то есть похожа на
настоящую строку данных, которую просто не удалось привязать ни к одной
карточке. Полностью пустая строка (Excel-паддинг в конце листа) **не**
считается — у неё нет ни `MaterialNum`, ни номера PI, это не бизнес-событие,
а формальность файла. Явной проверки "нечитаемого Customer Code" нет —
парсер вообще не читает эту колонку ни для чего другого (весь апсерт
работает по `Quotation`), так что реалистичный прокси для "не удалось
прочитать строку" — это именно "материал есть, номер PI не читается", а не
изобретение отдельной валидации по Customer Code, которая нигде больше не
используется.

### Тесты (Фаза 3, дополнено при находке пробела в архивации)

`parse-backorder-file.spec.ts` — сборка настоящего xlsx-буфера через
`exceljs` (не мок): чтение обоих листов и игнор прочих, устойчивость к
разному положению строки заголовка, пустая хвостовая строка не считается
пропущенной, строка с `MaterialNum` без номера PI считается пропущенной,
пустой результат (`{ rows: [], skippedRowCount: 0 }`), если ни одного
целевого листа нет.

`compute-pi-aggregates.spec.ts` — прямые суммы (qty/pending/CWP), `Quantity/
Loadability` для `totalContainers` **из сырых колонок, игнорируя
`row.loadFactor`, даже если он задан и не совпадает** (регрессионный тест
на саму находку выше), группировка нескольких строк с одинаковым
`Loadability` в одно деление, защита от `NaN`/`Infinity` при отсутствующей
или нулевой `loadability` (в т.ч. что `totalQty` всё равно учитывает
количество такой строки), все нули на пустом наборе строк.

`backorder-uploads.service.spec.ts` (тот же `makeFakeRepo`, что и
`proforma-invoices.service.spec.ts` — вынесен в общий
[fake-repo.ts](src/common/testing/fake-repo.ts)): создание новой карточки,
дозаполнение существующей без повторного вызова `customersService`, замена
line items без накопления дублей при повторной загрузке, группировка
нескольких строк одного PI в одну карточку с несколькими line items, **и
сценарий из задания на архивацию буквально**: загрузка A создаёт X/Y/Z →
загрузка B без Z → `Z.isArchivedShipped=true`, `cardsArchived=1`, X/Y не
тронуты → загрузка C снова с Z → `Z.isArchivedShipped=false`,
`newCardsCreated=0`; плюс отдельные тесты на "уже архивная карточка не
архивируется повторно и не считается в `cardsArchived`" и на подсчёт
`cardsSkippedInvalidRows`.

Backend test count: 39 (было 35: +4 на архивацию/пропуски — 2 в парсере, 2
в сервисе; часть старых тестов расширена, не просто добавлена).

Живая проверка (Фаза 3, актуально): реальным файлом
`2907_MTK_ROSBERG_INR.xlsx` против Neon-БД — 182 строки, 23 новые карточки
с первого прогона, 3 последовательные загрузки без дублирования. **Эти 23
карточки — реальные данные пилота, не тестовые, оставлены в БД
намеренно, не удалены.**

Живая проверка архивации/анархивации (эта правка): т.к. прогонять реальный
файл БЕЗ части из 23 реальных карточек означало бы по-настоящему
заархивировать их (риск для данных пилота), тест сделан безопасно —
взята копия реального файла, в неё добавлена одна синтетическая строка
(`pi_number=999999901`) через `exceljs`, без изменения ни одной реальной
строки. Загрузка с синтетической строкой → создаёт её, 23 реальные
карточки просто обновляются своими же настоящими данными (безопасно,
идемпотентно). Загрузка без нее → `cardsArchived: 1`, у синтетической
карточки `is_archived_shipped=true`, все 23 реальные — нет. Повторная
загрузка с ней → `cardsArchived: 0`, `is_archived_shipped=false` снова.
Синтетическая карточка и тестовые записи `backorder_uploads` удалены после
проверки.

## Приоритизация позиций (Фаза 7)

Первый шаг режима планирования отгрузок: клиент проставляет, сколько из
остатка каждой позиции (`balance_to_be_delivered`) он хочет приоритизировать
к отгрузке. Пока это только сам ввод + агрегаты — ничего в остальной
системе ещё не читает `priority_qty` (не влияет на бэкордер, экспорт и т.д.,
кроме двух новых read-only агрегатов на `ProformaInvoice`, см. ниже);
следующие шаги планирования будут наращиваться поверх этого поля.

### `pi_line_items.priority_qty`

Новая колонка (`numeric(14,2) NOT NULL DEFAULT 0`, миграция
`1788946343615-AddPriorityQtyToPiLineItems.ts`) — единственное поле на
`PiLineItem`, которое не приходит из файла бэкордера/парсинга: значение
целиком под управлением приложения, поэтому не `nullable` (в отличие от
остальных `numeric`-колонок этой сущности) и всегда стартует с "не
приоритизировано" (`0`).

### `PATCH /pi-line-items/:id/priority` (client-only)

Body: `{ "priorityQty": number }`. Два уровня защиты, ни один не сводится к
одному лишь декоратору:

- **Роль** — `RolesGuard`'s правило "ops всегда разрешено" (см. "Авторизация"
  ниже) здесь намеренно нарушено: `ops` видит `priorityQty` (обычная колонка
  в ответе `GET /proforma-invoices/:id`), но не должен иметь возможность
  менять её напрямую — это ввод клиента, а не то, что ops вводит от его
  имени. `@Roles(Role.CLIENT)` не решает эту задачу (`RolesGuard` пропускает
  `ops` мимо любой ролевой проверки безусловно), поэтому
  `PiLineItemsService.updatePriority` сам кидает `403`, если
  `actor.role !== Role.CLIENT`, до какого-либо чтения/записи.
- **Владение** — карточка PI этой позиции должна принадлежать
  `actor.customerId`, проверяется в сервисе (`item.pi.customer.id !==
  actor.customerId` → `404`, не `403` — тот же принцип "не подтверждать
  существование чужого ресурса", что и везде в проекте), не полагается на
  `CustomerScopeInterceptor`/response-scoping.

Валидация диапазона: `0 ≤ priorityQty ≤ balanceToBeDelivered` этой строки —
нижняя граница декоратором (`@Min(0)` в `UpdatePriorityDto`, статическая),
верхняя — в сервисе (`400`, т.к. зависит от конкретной строки, не может
быть decorator-уровня).

**Только целые штуки (Фаза 7.2)** — шины не бывают дробными.
`@IsInt({ message: "приоритет указывается в целых штуках" })` на
`priorityQty` в `UpdatePriorityDto` (заменил `@IsNumber()`) — `400` с этим
сообщением на любое нецелое значение (`0.02` и т.п.) прямо на границе
HTTP, до сервиса. Тот же `Number.isInteger(priorityQty)`-чек **продублирован**
в `PiLineItemsService.updatePriority` — не избыточность ради неё самой:
юнит-тесты этого проекта инстанцируют сервисы напрямую (см. "Запуск" —
`makeFakeRepo`), минуя контроллер/DTO/`ValidationPipe` целиком, так что
декоратор сам по себе не покрывается автотестом; сервисный чек — то же
самое правило там, где его реально можно проверить `expect(...).rejects`.
`PATCH /proforma-invoices/:id/reset-priority` этой проверки не требует —
у него вообще нет тела запроса, каждая строка получает литеральный `"0"`.

### Перенос приоритета при перезагрузке бэкордера

**Критично**: `BackorderUploadsService.upload()` полностью заменяет
`PiLineItem` каждой карточки при каждой загрузке (см. "Апсерт карточек и
line items" выше) — без явного переноса `priority_qty` любая правка клиента
стиралась бы каждую еженедельную загрузку. Перед `DELETE` старых строк
карточки их `priority_qty` снимается в `Map`, ключ — `(materialNum,
soNumber)` (та же пара, что однозначно идентифицирует "ту же самую позицию"
неделя к неделе — у строк нет другого стабильного id через перезагрузки,
раз они целиком удаляются и создаются заново). После вставки новых строк —
для каждой ищется совпадение по этому ключу в старой `Map`; если есть,
значение переносится, **но `clamp`'ится вниз до нового
`balanceToBeDelivered`** (`Math.min(carried, newBalance)`) — если остаток
уменьшился ниже прежнего приоритета, приоритет уменьшается вместе с ним, а
не остаётся невалидным (`priorityQty > balance` в любой момент — это ровно
то, что `PATCH .../priority` запрещает на запись, так что и перенос обязан
это соблюдать). Ключа не было в старой `Map` (новая позиция, или старая
имела приоритет `0`) — новая строка стартует с `priority_qty = 0`.

### Агрегаты `priorityTotalQty` / `priorityTotalContainers`

Два новых **вычисляемых** (не персистентных) геттера на `ProformaInvoice`,
как и `status` — пересчитываются на каждом чтении из загруженных
`lineItems`, а не хранятся отдельной колонкой: в отличие от
`totalQty`/`totalContainers` и т.п. (снимок на момент загрузки бэкордера,
см. `computePiAggregates`), приоритет меняется клиентом в произвольный
момент, независимо от загрузок — держать его как отдельную персистентную
сумму означало бы либо пересчитывать её при каждом
`PATCH .../priority` (лишняя запись, лишний источник рассинхронизации),
либо рисковать её устареванием. `priorityTotalContainers` переиспользует ту
же формулу группировки по `loadability`, что и `computePiAggregates`
(вынесена в общий `sumByLoadabilityGroups`,
[sum-by-loadability.ts](src/common/utils/sum-by-loadability.ts)) — не
две разные копии одной и той же математики, см.
`computePriorityAggregates`,
[compute-priority-aggregates.ts](src/proforma-invoices/utils/compute-priority-aggregates.ts).
Геттеры возвращают `0`, а не бросают, если `lineItems` не загружены —
на практике оба текущих читателя (`findAll`/`findOne`) всегда грузят эту
relation.

### Массовый сброс приоритета — `PATCH /proforma-invoices/:id/reset-priority` (Фаза 7.1)

"Сбросить" на фронте вызывает этот эндпоинт вместо N отдельных
`PATCH /pi-line-items/:id/priority` (один на строку) — намеренно: N
запросов с фронта означало бы лишнюю нагрузку пропорционально числу
позиций и реальный риск частичного сбоя (сеть оборвалась после половины
строк — карточка осталась в наполовину сброшенном состоянии, непонятном
ни клиенту, ни ops). Вместо этого — один `lineItemsRepo.update({ pi: { id
} }, { priorityQty: "0" })`, который компилируется в один SQL `UPDATE ...
WHERE pi_id = $1` — уже атомарен на уровне БД сам по себе (единственный
statement), так что отдельная обёртка `DataSource.transaction()` не нужна
ради атомарности как таковой (в проекте пока и нет ни одного места, где
она была бы нужна — см. структуру выше).

Тот же паттерн доступа, что и `PiLineItemsService.updatePriority`: явная
проверка `actor.role !== Role.CLIENT` → `403` в сервисе (не просто
`@Roles()`/декоратор — `RolesGuard`'s "ops всегда разрешено" не
останавливается сама по себе, см. "PATCH /pi-line-items/:id/priority"
выше), затем `findOwnedByActor` — чужой `client` получает `404`, не
`403`, ничего не меняется. Метод возвращает `this.findOne(pi.id)` —
свежую карточку с уже обнулёнными `lineItems`, тот же ответ, что и любой
другой write-эндпоинт этого контроллера.

### Тесты (Фаза 7)

`pi-line-items.service.spec.ts`: `priorityQty` в допустимом диапазоне
сохраняется; `priorityQty > balanceToBeDelivered` → `400`, ничего не
записано; `priorityQty === balanceToBeDelivered` (граница) разрешена;
чужой `client` (другой `customerId`) → `404`, ничего не записано; неизвестный
id → `404`; `ops`-актор → `403`, ничего не записано.

`compute-priority-aggregates.spec.ts`: прямая сумма `priorityQty`;
группировка по `loadability` перед делением (в т.ч. несколько строк с
одинаковым `loadability`); строка без/с нулевым `loadability` даёт `0`
контейнеров, не `NaN`; пустой набор строк → нули.
`proforma-invoice.entity.spec.ts` дополнен: геттеры считают по загруженным
`lineItems`; не бросают и возвращают `0`, если `lineItems` не загружены.

`backorder-uploads.service.spec.ts`, новый блок "priorityQty carry-over on
re-upload" — сценарий из задания буквально: приоритет `8` проставлен на
строке с остатком `10` → повторная загрузка с тем же
`(materialNum, soNumber)`, но остатком `3` → перенесённый приоритет
`clamp`'ится до `3`, не остаётся невалидным `8`; отдельно — перенос без
изменений, когда новый остаток всё ещё покрывает старый приоритет; и что
позиция без совпадения по ключу (новый `materialNum`) стартует с `0`, даже
если другие строки той же карточки перенесли ненулевой приоритет.

Backend test count (после Фазы 7): 74 (было 59 после Фазы 6: +15 — 6 в
`pi-line-items.service.spec.ts`, 4 в `compute-priority-aggregates.spec.ts`,
2 в `proforma-invoice.entity.spec.ts`, 3 в
`backorder-uploads.service.spec.ts`). После Фазы 7.1 (`resetPriority`): 77
(+3 в `proforma-invoices.service.spec.ts` — обнуление всех строк одним
вызовом `update()` (проверено `toHaveBeenCalledTimes(1)`, не по числу
строк), чужой `client` → `404`/ничего не изменено, `ops` → `403`/ничего не
изменено). Потребовал расширения общего тестового фейка —
`common/testing/fake-repo.ts`'s `update(where, partial)` не существовал до
этой правки, добавлен тем же `matches()`-based подходом, что и `delete()`.

Живая проверка (Claude Browser + curl, dev-сервер, реальная Neon-БД):
временная карточка с двумя позициями (остаток 10/loadability 20, остаток
5/loadability 10) под временным customer'ом; `client` включил "Режим
приоритизации", ввёл `6` в первую строку — живой пересчёт "= 0.30 конт."
и сводная строка "6 / 0,3 конт." обновились мгновенно, до сохранения;
нажал "Весь остаток" на второй строке (остаток `5`) — сводная строка
мгновенно стала "11 / 0,8 конт."; оба `PATCH` ушли по debounce (500мс) и
вернули `200` с сохранённым `priorityQty`; переключение в read-only режим
показало те же `6`/`5`. `ops` тем же адресом видит те же значения
read-only, без кнопки "Режим приоритизации" и без интерактивных полей.

Живая проверка "Сбросить" (Фаза 7.1, тот же приём — временная карточка,
удалена после): клик на кнопку **без** подтверждения диалога — не ушло
ни одного запроса (подтверждено по сети), значит guard реально
блокирует случайный клик; клик с подтверждённым `window.confirm` — один
`PATCH .../reset-priority`, `200`, обе позиции вернулись с
`priorityQty: "0.00"` и одинаковым `updatedAt` (подтверждает один
`UPDATE`, не два последовательных); таблица и сводная строка "Приоритет"
показали нули сразу, без ручного обновления страницы. Отдельно через
`curl`: `client` с другим `customerId`, пытающийся сбросить чужую
карточку — `404`. Также при живой проверке всплыл и был устранён
неполадочный момент самой сессии, не бага в коде: фоновый dev-сервер,
запущенный в предыдущей задаче, к моменту этой проверки был "осиротевшим"
процессом без своего `nest --watch`-наблюдателя (его родительский процесс
был остановлен отдельно, а сам скомпилированный `node`-процесс остался
висеть) — новый код на диск попадал, но не подхватывался запущенным
процессом, отсюда первый прогон отдавал `404 Cannot PATCH
.../reset-priority` на совершенно корректный маршрут. Разобрано через
`Get-NetTCPConnection -LocalPort 3000` → `Stop-Process` по фактическому
PID, слушающему порт (а не по фильтру командной строки на "nest", который
осиротевший процесс не проходил), и чистый перезапуск `npm run
start:dev` — маршрут появился в логе запуска сразу.

Дополнительно через `curl`: `ops`, вызвавший `PATCH .../priority` напрямую
(не через UI, которого у него и нет) — `403`; `client`, отправивший
`priorityQty=999` на строку с остатком `10` — `400` с точным сообщением о
границе. Временные customer/карточка/пользователи удалены после проверки.

После Фазы 7.2 (целые штуки): 79 (+2 в `pi-line-items.service.spec.ts` —
`priorityQty=0.02` → `400`, ничего не записано; `priorityQty=10` в
допустимом диапазоне → `200`).

Живая проверка Фазы 7.2 (dev-сервер + curl): `curl` напрямую на
`PATCH .../priority` с `priorityQty: 0.02` — `400`,
`{"message":["приоритет указывается в целых штуках"],...}`; с
`priorityQty: 10` — `200`. В браузере, ручной ввод с клавиатуры (не через
"Весь остаток"): первая попытка через UI-автоматизацию дала обманчивый
результат — поле показывало значение `10` до правки, клик в поле не
очистил его, и напечатанное `"0.02"` подряд с уже стоявшим `"10"` дало
буквально `"100.02"` в DOM, что `Math.round()` корректно округлил до
`100` (`Math.round(100.02) === 100`, проверено отдельно) — не баг
компонента, артефакт способа ввода в автоматизации. Передиагностировано
через прямую установку значения поля нативным сеттером
(`HTMLInputElement.prototype.value` setter + `dispatchEvent(new
Event('input'))`) — тот же путь, через который React получает реальные
нажатия клавиш: `"0.02"` → поле показало `0`; `"17.6"` → поле показало
`18`; "Весь остаток" на остатке `150` — поле показало `150` (целое).
Дебounced `PATCH` за первым вводом (`0.02`) вернул `priorityQty: "0"` —
дробное значение действительно никогда не покидало браузер. Временные
customer/карточка/пользователь удалены после проверки.

## Приоритет в Excel-выгрузках и счётчик приоритетных позиций (после Фазы 11, задеплоено на прод 2026-09-21)

**Деплой (коммит `26a08a5`).** Backend без миграции (`migration:show`: все 5 применены) и
фронтенд. Побайтовая сверка `.js`: отличаются ровно `backorder-uploads/utils/build-backorder-export-workbook`,
`proforma-invoices/proforma-invoice.entity`, `utils/build-pi-export-workbook`,
`utils/compute-priority-aggregates`, плюс новый `utils/priority-export-cells`. Бэкап
`dist.bak-20260921-priority`; фронтенд собран с `VITE_API_URL=/api`, прежний билд —
`ceat-frontend.prev`. Проверено на проде (временные `phase15-verify-*`, удалены — `401` на
повторный логин; отпечаток БД до и после совпал; всё только чтение): `GET
/proforma-invoices` 200 (28 карточек, 525 строк), `/actual-containers` и `/backorder-uploads`
200, без токена — `401`, порт 3000 закрыт, журнал без ошибок.
`priorityLineItemsCount` на каждой карточке равен пересчёту по строкам из API; реальные
приоритеты есть у одной карточки (`100039270`: 5 строк, Σ 1055). Выгрузка карточки с
приоритетами (116 строк) и без (50 строк): 12 колонок, ячейки всех строк совпали с
расчётом, итог `1055` / `—`, у ops тот же файл; общий бэкордер: 14 колонок, строка на
каждую позицию активных карточек, 5 строк с приоритетом, Σ совпала, голых нулей нет. В
браузере на проде: на плитке `Приоритетных позиций: 5`, в детали 5 жёлтых строк из 116,
без полей ввода в режиме просмотра.

- **Две новые колонки в конце обеих выгрузок бэкордера** — `GET /proforma-invoices/:id/export-xlsx`
  и `GET /backorder/export-xlsx` (доступ и owner-check прежние: PI — своя карточка для
  client, бэкордер — свой `customer_id`): `Priority Qty` и `Priority Load Factor`.
  Существующие колонки и их порядок не тронуты, новые идут после
  `Current Week Dispatch Qty`.
  - `Priority Qty` = `priorityQty` строки; `0` → прочерк `"—"`, не 0.
  - `Priority Load Factor` = `priorityQty / loadability`, округление до 4 знаков;
    `"—"`, если `priorityQty = 0` ИЛИ `loadability` пуст/0.
  - В итоговой строке "Всего" (она есть только в выгрузке одной карточки; в общем
    бэкордере итога нет и он не добавлялся) — сумма `Priority Qty` (0 → `"—"`), а
    `Priority Load Factor` — `"—"` (величина не аддитивна, как и обычный Load Factor).
  Общий код ячеек — `proforma-invoices/utils/priority-export-cells.ts`.
- **`priorityLineItemsCount`** — новое вычисляемое поле `ProformaInvoice` (getter с
  `@Expose`, не хранится): число строк с `priorityQty > 0`, считается на лету по уже
  загруженным `lineItems`, поэтому есть и в `GET /proforma-invoices/:id`, и в списке
  `GET /proforma-invoices`; без загруженных строк — `0`.
- **Frontend:** на детальной странице карточки строки с приоритетом подсвечены светло-жёлтым
  (`bg-yellow-50`, в тёмной теме `bg-yellow-500/10`) всегда, в том числе в режиме
  просмотра и у ops; рядом с "Всего / Ожидает / Отправлено" — "Приоритетных позиций: N"
  (на странице карточки считается по текущим черновикам, поэтому следует за правкой в
  режиме приоритизации, после сохранения равен серверному); в списке карточек то же
  число на плитке.
- **Проверено:** 275 юнит-тестов (выгрузка с несколькими приоритетными и неприоритетными
  строками — прочерки, округление, сумма, `loadability` пусто/0; `priorityLineItemsCount`
  на карточке с частичным приоритетом, в сериализации и без загруженных строк). Живой
  прогон на реальном файле в локальной БД: на карточке из 116 строк три приоритета
  (2, 1, 3) → `priorityLineItemsCount` 3 в детали и в списке (у остальных карточек 0);
  выгрузка карточки — 12 колонок, ячейки всех 116 строк совпали с расчётом, итог 6 и
  `"—"`; общий бэкордер — 523 строки, 14 колонок, 3 строки с приоритетом, Σ 6, у ops
  и client одинаково; в браузере три строки жёлтые в режиме просмотра, счётчик 3, при
  правке в режиме приоритизации подсветка и счётчик меняются сразу, у ops видны, но
  без полей ввода.

## Название карточки PI — поле `label` (после Фазы 11, задеплоено на прод 2026-09-21)

**Деплой (коммит `444fbc9`).** Порядок: **сначала миграция, потом код.** `dist.new` распакован
рядом (SHA-256 архива сверен), `migration:show` с него показал ровно одну ожидающую
(`AddProformaInvoiceLabel1790008954730`), `migration:run` применил её, пока работал прежний код
(одна nullable-колонка, старому коду не мешает); затем `stop` → `mv dist dist.bak-20260921-label`
→ `mv dist.new dist` → `start` (~20 с до готовности). Побайтовая сверка `.js`: отличаются ровно
`backorder-uploads/utils/build-backorder-export-workbook`, `proforma-invoices/{proforma-invoice.entity,
proforma-invoices.controller,proforma-invoices.service}`, `utils/build-pi-export-workbook`,
`ready-to-ship/{ready-to-ship.service,testing/ready-to-ship-harness}`,
`utils/build-ready-to-ship-export-workbook`, плюс новые `dto/update-label.dto` и миграция.
Фронтенд собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`, есть `/label`),
`/var/www/ceat-frontend` → `.prev` (прежний `.prev` сохранён как `.prev-before-label`),
`nginx -t` → `reload`. Бэкап: `dist.bak-20260921-label`.
Проверено на проде (временные `phase16-verify-*`, удалены — `401` на повторный логин; отпечаток БД
до, после миграции, после деплоя и после очистки один и тот же, всё только чтение): `GET
/proforma-invoices` 200 (28 карточек, 525 строк, у каждой ключ `label`, названий пока нет,
подписанных карточек нет), `/actual-containers`, `/backorder-uploads` 200, без токена `401`
(включая `PATCH …/label`); `PATCH` от ops `403`, 31 символ / не строка / нет поля — `400`, чужой
id — `404`, название неподписанной карточки после отказов не изменилось (**запись названия на
проде не проверялась — там реальный клиент; проверка блокировки после подписания на проде не
гонялась, т.к. подписанных карточек нет, локально проверена**); выгрузка карточки —
строка `Название` второй, 12 колонок таблицы на месте; общий бэкордер — 15 колонок, `Название`
после `PI Number`, строка на каждую позицию активных карточек; выгрузка «Готово к отгрузке» —
8 колонок, `Название` 7-я, `SO` 8-я; `GET /ready-to-ship` 200 с `piLabel` у строк и размещений
(1,2 с); порт 3000 снаружи закрыт, журнал без ошибок.

Клиент может дать карточке PI короткое название (например, "Орел"), которое показывается
рядом с номером везде, где показан номер PI. Задать его можно **только до подписания
проформы**; после — заблокировано навсегда, разблокировки нет.

- **Миграция** `AddProformaInvoiceLabel1790008954730`: `proforma_invoices.label varchar(30)
  NULL` (аддитивная, предыдущий релиз колонку просто не видит — на проде запускается ДО
  замены кода).
- **`PATCH /proforma-invoices/:id/label`**, тело `{ "label": string | null }`.
  - Только `client` и только свой PI (owner-check, чужой — `404`). У `ops` — `403` (как у
    `reset-priority`: `@ClientWriteAllowed()` пропускает ops до обработчика, отказ — явной
    проверкой роли в сервисе).
  - Не более 30 символов, иначе `400` (пробелы по краям перед проверкой обрезаются; поле
    обязательно, не строка и не `null` — `400`). Пустая или из одних пробелов строка и
    `null` сохраняются как `NULL` ("без названия").
  - Если у PI уже есть `signed_file_url` — `400` "название можно менять только до
    подписания проформы", независимо от того, было ли название задано (в том числе
    пустое) и в том числе для `null`. `signed_file_url` в системе никогда не сбрасывается
    (повторная загрузка подписанного его лишь перезаписывает, решение по замене трогает
    только `pi_file_*`), поэтому простой проверки достаточно для "навсегда".
    Гонка "клиент подписывает и меняет название одновременно" сочтена пренебрежимой.
  - Ответ — карточка целиком. `label` есть в `GET /proforma-invoices` и `/:id`.
- **"Один раз"** реализовано как "меняется, пока проформа не подписана, потом навсегда
  заблокировано" — так задано в ТЗ ("до момента подписания").
- **Excel.** Колонка/строка "Название" (пусто — пустая ячейка) в трёх выгрузках:
  - `GET /proforma-invoices/:id/export-xlsx` — строка `Название | …` в шапке сразу под
    `PI number`;
  - `GET /backorder/export-xlsx` — колонка `Название` сразу после `PI Number` в каждой
    строке (**порядок колонок сдвинулся: 14 → 15**, приоритетные колонки теперь 14–15);
  - `GET /ready-to-ship/export-xlsx` — колонка `Название` сразу после `Проформа (PI)` во
    всех строках, включая "OK to mix" (**`SO` теперь 8-я колонка, а не 7-я**).
  Для этого в `GET /ready-to-ship` у `UnallocatedLineView` и `AllocationView` появилось поле
  `piLabel: string | null`.
- **Frontend.** Везде, где показан номер PI, — `«100039270: Орел»` (без двоеточия, если
  названия нет; хелпер `formatPiTitle` в `lib/format.ts`): плитки списка, шапка карточки,
  "Готово к отгрузке" (таблица, карточки контейнеров, диалоги "Переместить"/"Убрать"; поиск
  по таблице ищет и по названию), фактический контейнер (колонка PI), тост загрузки. У
  client на неподписанной карточке рядом с номером — поле ввода (макс. 30) и кнопка
  "Сохранить" (`PiLabelEditor`); после подписания — обычный текст без подсказок и кнопок.
  У ops поле никогда не редактируется.
- **Проверено:** 292 юнит-теста (PATCH до подписания, смена, обрезка и `null`/пусто → `NULL`;
  `400` после подписания в т.ч. для `null` и когда названия не было; `403` у ops, `404`
  у чужого клиента; DTO — 30 символов ок / 31 — нет, пробелы не считаются, нет поля и не
  строка — отказ; `piLabel` в `getView`; три выгрузки с названием и без, "OK to mix").
  Живой прогон в локальной БД (миграция накатана): PATCH → 200, 30/31 символов, пусто →
  `null`, ops `403`, без токена `401`; после загрузки подписанного клиенту `400`
  ("название можно менять только до подписания проформы"), название не изменилось, ops
  `403`; выгрузки карточки, бэкордера и "Готово к отгрузке" (строки контейнера и "OK to
  mix") — `Орел` у нужного PI, пустая ячейка у остальных. В браузере: плитки
  `100037314: Орел` / `100038680: Сокол-2` (и просто номер у остальных), поле и "Сохранить"
  у client на неподписанной карточке (тост "Название сохранено"), на подписанной поля нет,
  у ops нет никогда; "Готово к отгрузке" (строки, поиск "орел", диалоги "Переместить" и
  "Убрать"), фактический контейнер.

## Подсветка "Готовых контейнеров" с файлом — `filesCount` (после Фазы 11, задеплоено на прод 2026-09-21)

**Деплой (коммит `6c319a0`).** Backend без миграции (`migration:show`: все 6 применены) и
фронтенд. Побайтовая сверка `.js`: отличаются ровно `actual-containers/actual-container.entity`
и `actual-containers/actual-containers.service`, больше ничего. `dist.new` рядом (SHA-256
архива сверен), `stop` → `mv dist dist.bak-20260921-filesgreen` → `mv dist.new dist` → `start`
(~20 с). Фронтенд собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`), прежний билд —
`ceat-frontend.prev` (предыдущий `.prev` сохранён как `.prev-before-filesgreen`), `nginx -t`
→ `reload`. Проверено на проде (временные `phase17-verify-*`, удалены — `401`; отпечаток БД
до и после совпал; всё только чтение): `GET /actual-containers` у ops и client — 77 строк,
у каждой числовой `filesCount` и нет массива `files`, а сам список **посимвольно совпал с
снятым до деплоя** (тот же состав, порядок и поля, кроме нового `filesCount`); `filesCount`
равен `files.length` детали у всех 77 контейнеров (файл сейчас у одного); `/proforma-invoices`,
`/backorder-uploads`, `/ready-to-ship` 200, без токена `401`; отдаваемый бандл содержит
`data-has-files`; порт 3000 закрыт, журнал без ошибок. Бэкап: `dist.bak-20260921-filesgreen`.

В списке "Готовые контейнеры" строка контейнера, у которого есть хотя бы один
`ActualContainerFile`, подсвечена светло-зелёным; без файла — обычный фон, никаких градаций.

- **Backend, без миграции.** `GET /actual-containers` теперь отдаёт на каждом контейнере
  `filesCount` (число прикреплённых файлов). Сервис грузит `files` вместе с контейнерами и
  сворачивает их в число (сами файлы в список не попадают — как и раньше, они только в
  детали); `GET /actual-containers/:id` тоже отдаёт `filesCount` (плюс `files`). Скоуп
  прежний: client считает только по контейнерам своего `customer_id`. `filesCount` — не
  колонка, а обычное необъявленное в БД поле сущности, заполняется сервисом при чтении.
- **Frontend.** `filesCount > 0` → `bg-green-50 hover:bg-green-100/70 dark:bg-green-500/10
  dark:hover:bg-green-500/15` на строке (тот же приём, что у жёлтого приоритета; в тексте
  под заголовком одна строка-пояснение). Добавление и удаление файла на детальной странице
  теперь инвалидируют и список (раньше — только деталь), поэтому подсветка меняется сразу,
  а не через `staleTime` (30 с).
- **Проверено:** 296 юнит-тестов (в т.ч. `filesCount` 2/0 у контейнеров с файлами и без,
  без массива `files` в списке; возврат к 0 после удаления; client видит счёт только своих
  контейнеров; деталь отдаёт файлы и счёт). Живьём в локальной БД (77 контейнеров): API —
  `filesCount` на всех строках; добавление файла ops'ом → у client счёт 1 только у этого
  контейнера; в браузере после загрузки через форму строка стала зелёной
  (`bg-green-50`), после удаления через диалог — снова обычной, остальные 76 строк без
  изменений. Тёмной темы в приложении нет (переключателя нет, класс `dark` не ставится),
  поэтому `dark:`-вариант — только по аналогии с жёлтым.

## Маркер прибытия контейнера — `arrivalStatus` (после Фазы 11, задеплоено на прод 2026-09-22)

**Деплой (коммит `020144b`).** Порядок, как обычно: **сначала миграция, потом код.**
`dist.new` рядом (SHA-256 архива сверен), `migration:show` с него показал ровно одну
ожидающую (`AddActualContainerArrivalConfirmation1790095361000`), `migration:run` применил
её, пока работал прежний код (две nullable-колонки, старому коду не мешают); затем `stop` →
`mv dist dist.bak-20260922-arrival` → `mv dist.new dist` → `start` (~20 с, маршрут
`POST /actual-containers/:id/confirm-arrival` в логе сразу после старта). Побайтовая сверка
`.js`: отличаются ровно `actual-containers/{actual-container.entity,
actual-containers.controller, actual-containers.service}`, плюс новая миграция — больше
ничего. Фронтенд собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`, есть
`confirm-arrival`), файлы после распаковки на сервере побайтово совпали с локальной сборкой;
`/var/www/ceat-frontend` → `.prev` (прежний `.prev` — `.prev-before-arrival`), `nginx -t` →
`reload`. Бэкапы: `dist.bak-20260922-arrival`, `ceat-frontend.prev-before-arrival`.
Публично: отдаётся новый бандл, `GET /` — 200, `GET /api/actual-containers` и
`POST .../confirm-arrival` без токена — 401, порт 3000 закрыт.
Проверено на проде (временные `phase20-verify-*`, удалены — 401 на повторный логин;
отпечаток БД до и после совпал; журнал без ошибок): `GET /actual-containers` — 77 строк у
обеих ролей, у каждой `arrivalStatus` (только `null`/`"expected"`/`"arrived"`) и
`arrivalConfirmedBy` (строка или `null`, и `null` всегда, если `arrivalStatus` не `"arrived"`)
— распределение `{null: 44, expected: 7, arrived: 26}`; список client — подмножество списка
ops по своему `customer_id`, те же значения; деталь отдаёт оба поля тоже.
**`confirm-arrival` намеренно не вызывался с реальным токеном client на реальном
контейнере** — это подтверждение затронуло бы данные живого клиента (тот же принцип, что
"никогда не запускать confirm/undo/unlock на проде" из README); проверены только пути без
записи: `403` у ops, `404` у несуществующего id, `401` без токена.

В разделе "Отгружено" (`ActualContainer`) появился маркер, показывающий, ожидается ли
прибытие контейнера или оно уже произошло, плюс кнопка ручного подтверждения для client.

- **Миграция** `AddActualContainerArrivalConfirmation1790095361000`: `actual_containers`
  получает `arrival_confirmed_at timestamptz NULL` и `arrival_confirmed_by uuid NULL` (FK →
  `users`, `ON DELETE NO ACTION`) — обе аддитивные и nullable, старый код их не видит.
- **`POST /actual-containers/:id/confirm-arrival`** — client-only (`@ClientWriteAllowed()`
  пропускает client мимо `RolesGuard`, ops получает `403` явной проверкой в сервисе, тот же
  приём, что у `resetPriority`/`updateLabel`). Owner-check через существующий `findOne` —
  чужой или несуществующий id → `404`. Ставит `arrival_confirmed_at = now()`,
  `arrival_confirmed_by = actor.id`; при повторном вызове — `400` "прибытие уже
  подтверждено". Пишет через `.save()` загруженной сущности (не `.update()`), как и все
  остальные поля "кто сделал X" в проекте (`piFileUploadedBy` и т. п.), а не как
  `updateDates`/`resetDates` этого же сервиса, которые правят только простые колонки.
- **`arrivalStatus`** — вычисляемый геттер на сущности (`@Expose()`, не хранится, считается
  заново на каждый ответ от сегодняшней даты и эффективной ETA = `override_eta ?? source_eta`):
  - `null` — ETA не задана, или до неё больше 10 дней;
  - `"expected"` — от 0 до 10 дней до ETA включительно, либо ETA прошла, но меньше 7 дней
    назад, и прибытие ещё не подтверждено;
  - `"arrived"` — подтверждено вручную (`arrival_confirmed_at` заполнено) ИЛИ прошло 7+ дней
    после эффективной ETA (автоматически, без записи в БД).
  Границы (10 дней до, день ETA, 6/7/8 дней после) проверены юнит-тестами напрямую на классе
  сущности — фейковый репозиторий в `actual-containers.service.spec.ts` отдаёт простые
  объекты, не инстансы класса, поэтому геттер через сервис не вызвать; для него отдельный
  `actual-container.entity.spec.ts`.
  `arrivalConfirmedBy` — geттер, отдающий email подтвердившего (`null`, если подтверждения не
  было или оно автоматическое); сама связь на `User` (`arrivalConfirmedByUser`) помечена
  `@Exclude` и в JSON не попадает. И `GET /actual-containers`, и `GET /:id` теперь грузят
  relation `arrivalConfirmedByUser`.
- **Frontend.** В списке "Отгружено" колонка "ETA-15" и текстовые бейджи B/L/Telex/Оплата
  под ней убраны целиком (те же данные остаются на детальной странице в блоке "Документы и
  оплата (ETA-15)" — он не тронут); на их месте, сразу после колонки ETA — новая колонка
  "Прибытие" / "Arrival". На детальной странице маркер — отдельное поле "Прибытие" рядом с
  ETD/ETA (у client — под полями дат, у ops — под редактором `ContainerDatesEditor`), только
  когда `arrivalStatus` не `null`. Общий компонент `ArrivalMarker.tsx`:
  - `"expected"` → жёлтый бейдж "Ожидается прибытие" / "Arrival expected"; рядом, только для
    client, кнопка "Подтвердить прибытие" / "Confirm arrival" → мутация, тост
    успеха/ошибки, инвалидация и списка, и детали (через тот же `useContainerCacheWriter`,
    что у `updateDates`/`resetDates`).
  - `"arrived"` → зелёный бейдж; вручную — "Прибыло" / "Arrived" с подсказкой
    "Подтвердил(а) {{email}} · {{date}}" / "Confirmed by {{email}} · {{date}}"; автоматически
    — "Прибыло (default)" / "Arrived (default)" (слово "default" не переводится, одинаково
    в обоих языках), без подсказки.
  - `null` → компонент возвращает `null`, ничего не рендерится.
  В списке кнопка не всплывает клик по строке (`e.stopPropagation()`, тот же приём, что у
  ссылки на номер контейнера) — подтверждение не уводит на детальную страницу. Все тексты —
  через `i18n` (`shipped.arrival.*`, `shipped.columns.arrival`, `shipped.detail.arrival`), ничего
  не захардкожено.
- **Проверено:** 7 новых юнит-тестов в `actual-container.entity.spec.ts` на границы
  `arrivalStatus` (11/10 дней до, 0 дней, 6/7/8 дней после, ручное подтверждение перекрывает
  любую ETA, override ETA — эффективная, сериализация прячет `arrivalConfirmedByUser` и
  отдаёт `arrivalConfirmedBy`/`arrivalStatus`) плюс 5 на `confirmArrival` в
  `actual-containers.service.spec.ts` (подтверждает один раз, `400` при повторе без
  изменения времени первого подтверждения, `404` у чужого client, `403` у ops, `404` у
  несуществующего id) — 308 тестов всего, все проходят. Живьём в локальной БД (77
  контейнеров, миграция накатана):
  распределение `{null: 44, expected: 7, arrived: 26}`; `ops` на confirm-arrival — `403`;
  `client` подтверждает — `200`, `arrivalConfirmedBy` = email клиента; повтор — `400` с
  нужным текстом. В браузере: список без колонки ETA-15, новая колонка "Arrival" между ETA и
  Commercial invoice, "Arrived (default)" у контейнера, что прошёл ETA 7+ дней назад без
  подтверждения, "Arrived" (с подсказкой) — у подтверждённого; клик "Confirm arrival" в
  строке списка не открыл детальную страницу, тост и смена бейджа — мгновенно; на детали у
  client — поле "Прибытие" рядом с ETD/ETA и кнопка, после подтверждения кнопка исчезает; у
  ops — тот же бейдж под редактором дат, без кнопки, ни в детали, ни в списке; переключение
  RU/EN на лету меняет весь текст маркера и колонки; блок "Документы и оплата (ETA-15)" на
  детальной странице не тронут.

## Фаза 21: контейнер "OK to mix" и сворачивание карточек (задеплоено на прод 2026-09-24, коммит `568a0ba`)

**Деплой.** Порядок: **сначала миграция, потом код.** `dist.new` рядом (SHA-256
архивов сверен), `migration:show` — ровно одна новая
`AddShippingContainerOkToMix1790700000000`, прогнана при работающем прежнем коде
(13/13; колонка аддитивная с `DEFAULT false`, старому коду не мешает). Read-only
сверка: `is_ok_to_mix boolean NOT NULL DEFAULT false`, частичный уникальный
индекс на месте, все 47 существующих контейнеров — `false`, OK to mix ещё нет
(появится при первом открытии "Готово к отгрузке"). `diff -rq dist dist.new` —
ровно файлы фазы. `stop` → `mv dist dist.bak-20260924-p21` → `mv dist.new dist` →
`start`: `POST /ready-to-ship/move-remaining-to-mix` зарегистрирован, 51 маршрут,
ошибок нет. Фронтенд с `VITE_API_URL=/api` (`index-V3v6o5yE.js`), прежний —
`ceat-frontend.prev-before-p21`, `nginx -t` → `reload`. Публичные проверки: `/`,
бандл и CSS — `200`; `/ready-to-ship`, `move-remaining-to-mix` и `/audit-log`
без токена — `401 UNAUTHORIZED`; неверный логин — `INVALID_CREDENTIALS`; ufw —
только 22/80. Действия с живыми данными клиента (перенос, подтверждение,
отмены) на проде не выполнялись.

Строки, которые клиент не распределяет по номерным контейнерам (или не может —
без loadability), теперь явно складываются в один общий контейнер "OK to mix".

- **Колонка `shipping_containers.is_ok_to_mix`** (миграция
  `AddShippingContainerOkToMix1790700000000`, аддитивная: `boolean NOT NULL
  DEFAULT false` плюс частичный уникальный индекс `(customer_id) WHERE
  is_ok_to_mix` — у клиента не больше одного). Существующие контейнеры
  становятся номерными без изменений.
- **Создаётся лениво**, ровно один на клиента, при первом просмотре "Готово к
  отгрузке" (там же, где досоздаются слоты) — даже когда план пуст. Метка
  `OK to mix` — универсальная, не переводится ни на экране, ни в Excel. В
  списке контейнеров всегда последний.
- **Не слот плана:** не входит в `totalPossibleContainers`, не участвует в
  досоздании слотов и не перерабатывается "Отменить всё" (его id сохраняется).
  В представлении у него `isOkToMix: true`, `fillPercent: 0`, `isOverfilled:
  false`, у позиций `fillContribution: 0`; вместо заполнения — `totalQty` и
  `totalLines` (они есть у каждого контейнера).
- **`move`** в него — без проверки loadability: строка без loadability может
  попасть только сюда (в номерной — по-прежнему `400 LINE_NO_LOADABILITY`).
- **Подтверждение** никогда не блокируется им (проверка >100% пропускает OK to
  mix); сам он подтверждается, разблокируется (целиком и по позиции),
  отменяется и принимает маркировку той же логикой, что и номерные.
- **`POST /ready-to-ship/move-remaining-to-mix`** (только client): весь
  нераспределённый остаток каждой строки, включая строки без loadability, — в OK
  to mix одной транзакцией. Строки блокируются `FOR UPDATE`, сначала все
  проверки (заблокированная позиция в OK to mix → `ALLOCATION_LOCKED`, OK to mix
  подтверждён целиком и нужна новая позиция → `CONTAINER_LOCKED`), потом запись —
  всё или ничего. Существующая позиция строки в OK to mix пополняется, иначе
  создаётся новая. На каждую строку — своё `AllocationAction`, так что "Отменить
  одно действие" возвращает по строке, "Отменить всё" — всё. Нечего переносить —
  `400 NOTHING_TO_MOVE`. В журнале — одно `rts.moved_remaining_to_mix` (метка,
  число строк, штуки), в той же транзакции.
- **Фронтенд.**
  - Карточка OK to mix — после номерных, всегда видна: вместо шкалы и цвета
    заполнения — "N позиций / M шт.", у позиций нет процента. В счётчики "в
    работе / подтверждено / свободно" и в "Контейнеров: N" не входит.
  - В модалке "Переместить" — последним вариантом, со сводкой вместо шкалы и
    прогноза.
  - Строки без loadability теперь активны (жёлтая метка "только в OK to mix"):
    в модалке номерные контейнеры недоступны с пометкой "нужна loadability",
    OK to mix выбран сразу.
  - Кнопка "Скинуть остаток в OK to mix" над списком готового (рядом с поиском,
    только у клиента, неактивна при пустом списке) — с подтверждением, где
    названы число строк и штук.
  - Каждую карточку (номерную и OK to mix) можно свернуть и развернуть стрелкой в
    заголовке. По умолчанию подтверждённая свёрнута, черновик развёрнут; смена
    статуса (подтверждение, разблокировка) возвращает к умолчанию. Состояние
    только на экране, не сохраняется. Свёрнутая — одна строка: название плюс
    процент (номерная) или "N позиций / M шт." (OK to mix).
  - Тексты — en/ru.
- **Тесты:** 463 всего (+15, `ready-to-ship.ok-to-mix.spec.ts`). OK to mix не в
  `totalPossibleContainers`, создаётся один и последним; строка без loadability
  — только в OK to mix; подтверждение не блокируется переполнением OK to mix, но
  блокируется номерным; `move-remaining-to-mix` переносит всё одной транзакцией
  с действием на строку, пополняет существующую позицию, откатывается "Отменить
  одно действие" (по строке) и "Отменить всё" (целиком), `NOTHING_TO_MOVE`,
  заблокированная позиция → ничего не записано, только client; маркировка и
  разблокировка ops работают на позициях OK to mix. Существующие тесты
  получили хелпер `slots()` (только номерные контейнеры).
- **Проверено живьём** (локально, 231 строка / 2 845 шт.): API — OK to mix
  создан один и последним, `totalPossibleContainers` не изменился, строка без
  loadability в номерной → `LINE_NO_LOADABILITY`, в OK to mix → ok;
  `move-remaining-to-mix` → 231 позиция / 2 845 шт., повтор → `NOTHING_TO_MOVE`;
  "Отменить одно действие" вернул ровно одну строку, запись в журнале.
  В браузере (RU/EN): карточка и счётчики, модалка (40 номерных недоступны,
  OK to mix выбран), перенос, кнопка с подтверждением, сворачивание вручную и
  автоматически после "Подтвердить". "Отменить всё" локально не проверить:
  локальная база в WIN1252 не хранит кириллические метки пересоздаваемых слотов
  (было так и до этой фазы, прод — UTF-8), это покрыто unit-тестами.
- **При деплое:** сначала миграция, затем backend и фронтенд вместе. OK to mix
  появится у клиента при первом открытии "Готово к отгрузке".

## Фаза 20b: журнал действий (задеплоено на прод 2026-09-24, коммит `40e5d03`)

**Деплой.** Порядок: **сначала миграция, потом код.** `dist.new` рядом (SHA-256
архивов сверен), `migration:show` — ровно одна новая `AddAuditLog1790600000000`,
прогнана при работающем прежнем коде (12/12). Read-only сверка: `audit_log` со
всеми колонками и 4 индексами, пустая. `diff -rq dist dist.new` — ровно файлы
фазы. `stop` → `mv dist dist.bak-20260924-p20b` → `mv dist.new dist` → `start`:
`AuditLogModule` поднялся, `GET /audit-log` зарегистрирован, 50 маршрутов, ошибок
нет. Фронтенд с `VITE_API_URL=/api` (`index-mmh4VHpb.js`), прежний —
`ceat-frontend.prev-before-p20b`, `nginx -t` → `reload`. Публичные проверки: `/`,
бандл и CSS — `200`; `/audit-log` и `/users` без токена — `401 UNAUTHORIZED`;
неверный логин — `INVALID_CREDENTIALS`; ufw — только 22/80. Журнал начнёт
наполняться с первого действия после деплоя — более раннюю историю
восстановить нельзя.

Кто что менял, прикреплял и удалял — просмотр только для ops.

- **Таблица `audit_log`** (миграция `AddAuditLog1790600000000`, аддитивная):
  `actor_user_id` (FK users), `action`, `entity_type`, `entity_id`, `metadata`
  (jsonb — детали события: было/стало, имя файла, количества, номер PI для
  показа…), `created_at`. Только добавление строк, без `updated_at`. Индексы по
  дате, (тип, id) сущности, автору и действию.
- **Реестр действий** — `src/audit-log/audit-actions.ts` (как коды ошибок в
  Фазе 18): 30 действий. PI — `pi.file_uploaded`, `pi.replacement_proposed`,
  `pi.replacement_approved/rejected`, `pi.signed` (первый подписанный файл =
  подписание) / `pi.signed_file_replaced`, `pi.additional_file_added`,
  `pi.label_changed`, `pi.priority_changed`, `pi.priority_reset`; бэкордер —
  `backorder.uploaded`; готово к отгрузке — `rts.moved/removed/confirmed`,
  `rts.container_unlocked/position_unlocked`, `rts.marking_uploaded/deleted`, плюс
  `rts.undone_last/undone_all` (отмены тоже меняют состав — без них в журнале были
  бы перемещения, которых на деле уже нет); отгружено —
  `container.arrival_confirmed/revoked`, `container.dates_changed/reset`,
  `container.file_uploaded/deleted`; пользователи — `user.created/deactivated/
  reactivated`. Удаления PI-файлов (исходный, подписанный, доп.) в API нет —
  только замена, она и журналируется.
- **Где пишется** — `AuditLogService.record` в конце каждого из этих методов,
  логика не менялась: там, где у метода есть транзакция (upload-signed, решение
  по замене, дозаполнение PI, бэкордер, move/remove/undo/confirm, маркировка),
  запись идёт **в той же транзакции** — изменение и запись фиксируются вместе,
  а сбой журнала отменяет действие; где транзакции нет — **после** сохранения, и
  сбой журнала пишется в лог, а не превращается в ошибку для пользователя
  (действие уже состоялось, ошибка лишь спровоцировала бы повтор). Не
  журналируется то, что ничего не изменило: название/приоритет с тем же
  значением, повторная деактивация, отказ по любой проверке.
  `DELETE /actual-container-files/:id` и `POST /users` теперь получают
  пользователя из токена (раньше он им был не нужен).
- **`GET /audit-log`** — только ops (`403 OPS_ONLY_ACTION` клиенту, даже на GET).
  Фильтры `entityType`, `entityId`, `actorUserId`, `action`, `from` (включительно)
  и `to` (не включительно, ISO-время); страницы `page`/`pageSize` (по умолчанию
  50, максимум 200), ответ `{ items, total, page, pageSize }`, новые сверху.
- **Фронтенд.** «Журнал действий» (`/ops/audit-log`, пункт меню у ops): таблица
  (дата и время, email автора, действие человеческим текстом, объект — тип плюс
  ссылка на PI / отгруженный контейнер, название слота, имя файла бэкордера,
  email пользователя), детали раскрываются по клику (поля подписаны, было/стало
  рядом, у файлов — «Скачать»; порядок полей задаёт фронт — jsonb его не
  хранит). Фильтры: пользователь, тип объекта, «с»/«по» (дни в часовом поясе
  пользователя). Тексты действий — `audit.actions.<код>` в `en.json`/`ru.json`
  (вложенно: i18next читает точку в коде как вложенность).
- **Тесты:** 448 всего (+25). Для каждого действия — запись с нужным кодом,
  автором, сущностью и деталями, в транзакции там, где она есть, и отсутствие
  записи при отказе (`proforma-invoices`, `pi-line-items`, `backorder-uploads`,
  `ready-to-ship.audit`, `actual-containers`, `users`). `audit-log.service.spec.ts`
  — запись через транзакцию и без неё (сбой: бросает / только логирует), фильтры,
  диапазон дат, пагинация, ops-only гвард, каждое действие реестра где-то
  пишется, у каждого есть текст en/ru. Фейковый репозиторий научился
  `findAndCount`, `MoreThanOrEqual`/`LessThan`/`And` и сортировке по нескольким
  ключам.
- **Проверено живьём** (локально): сценарий из 21 действия (client и ops) — все
  в журнале по порядку, с автором и деталями; пагинация, все фильтры, `403`
  клиенту, `400` на неверный `pageSize`/тип. В браузере (EN/RU): раздел и пункт
  меню, таблица, детали, «Скачать» из деталей (`200`), фильтры по типу,
  пользователю, датам и сброс.

## Фаза 20a: управление пользователями (задеплоено на прод 2026-09-23, коммит `5c61604`)

**Деплой.** Порядок: **сначала миграция, потом код.** `dist.new` рядом (SHA-256
архивов сверен), `migration:show` — ровно одна новая `AddUserIsActive1790500000000`,
прогнана при работающем прежнем коде. Read-only сверка: `users.is_active` —
`boolean NOT NULL DEFAULT true`, оба пользователя прода (1 ops, 1 client) активны.
`diff -rq dist dist.new` — ровно файлы фазы. `stop` → `mv dist
dist.bak-20260923-p20a` → `mv dist.new dist` → `start`: `/users` (GET/POST),
`/users/:id/deactivate|reactivate`, `/auth/change-password` зарегистрированы, 49
маршрутов, ошибок нет. Фронтенд с `VITE_API_URL=/api` (`index-sCHkXkYY.js`),
прежний — `ceat-frontend.prev-before-p20a`, `nginx -t` → `reload`. Публичные
проверки: `/`, бандл и CSS — `200`; `/users` и `change-password` без токена,
мусорный токен — `401 UNAUTHORIZED`; неверный логин — `INVALID_CREDENTIALS`;
ufw — только 22/80. Живые учётки не создавались и не деактивировались.

Несколько сотрудников на роль: ops заводит учётные записи сам, без seed-скрипта
(он остаётся для самой первой ops-учётки на пустой базе).

- **Миграция `AddUserIsActive1790500000000`** — `users.is_active boolean NOT NULL
  DEFAULT true`: все существующие пользователи остаются активными, прежний код
  колонку не замечает.
- **`/users` — только ops** (весь контроллер `@Roles(OPS)`: client получает `403
  OPS_ONLY_ACTION` даже на GET):
  - `GET /users` — email, роль, клиент, `isActive`, `createdAt`, без
    `passwordHash` (ответ собирается явно, не сериализацией сущности);
  - `POST /users` — `{ email, password, role, customerId? }`; bcrypt с той же
    стоимостью 10, что и seed; email хранится обрезанным и в нижнем регистре;
    `client` без `customerId` → `400 CUSTOMER_REQUIRED_FOR_CLIENT`, неизвестный
    клиент → `404`, занятый email → `409 EMAIL_TAKEN`, пароль короче 8 →
    `400 PASSWORD_TOO_SHORT`; у `ops` присланный `customerId` игнорируется;
  - `PATCH /users/:id/deactivate` и `/reactivate` — строка никогда не удаляется.
    Себя деактивировать нельзя (`400 CANNOT_DEACTIVATE_SELF`) — иначе последний
    активный ops мог бы запереть всех.
- **Деактивированный:** логин → `401 ACCOUNT_DEACTIVATED` (проверяется *после*
  пароля, чтобы ответ не выдавал, какие email существуют; неверный пароль по-
  прежнему `INVALID_CREDENTIALS`). **Уже выданный токен перестаёт работать сразу**,
  а не через `JWT_EXPIRES_IN` (8 ч): `JwtStrategy` проверяет `isActive` через
  кэш в памяти `UsersService` (TTL 60 с, деактивация/восстановление пишут в него
  сразу) — одна выборка на пользователя в минуту, а не на каждый запрос. Письма
  (Фаза 13) деактивированным не уходят — `findOpsUsers`/`findClientUsers`
  фильтруют по `is_active`.
- **`POST /auth/change-password`** — `{ currentPassword, newPassword }`, обе роли
  (`@ClientWriteAllowed`), всегда пароль самого вызывающего (id берётся из
  токена, передать чужой нельзя). Неверный текущий → `400
  WRONG_CURRENT_PASSWORD`, **не 401** — фронтенд трактует 401 как конец сессии и
  выкинул бы пользователя.
- **Фронтенд.** Раздел «Пользователи» (`/ops/users`, пункт меню только у ops):
  таблица, «Добавить пользователя» (поле «Клиент» появляется только для роли
  client), «Деактивировать» с подтверждением / «Восстановить»; у своей строки
  кнопки деактивации нет. В сайдбаре обеих ролей под email — «Сменить пароль»
  (диалог: текущий, новый, повтор; несовпадение ловится в форме). `client.ts`
  теперь сохраняет тело ответа и при 401: логин показывает «учётная запись
  деактивирована», а пользователя, которого деактивировали посреди сессии,
  после выброса на страницу входа встречает тот же текст (причина переживает
  перезагрузку через `sessionStorage`; тост откладывается на тик — `<Toaster/>`
  в `main.tsx` стоит после `<App/>` и подписывается позже эффекта страницы).
- **Тесты:** 420 всего (+28). `users.service.spec.ts` — создание обеих ролей
  (хеш, нормализация email, клиент без customer/неизвестный customer, дубль),
  список без хеша, деактивация/восстановление (строка остаётся, кэш обновляется
  сразу, запрет на себя), TTL кэша, получатели писем без деактивированных.
  `auth.service.spec.ts` — деактивированный не логинится, неверный пароль
  остаётся `INVALID_CREDENTIALS`, смена пароля только своего (чужой пароль не
  помогает, хеш другого не меняется), `400` на неверный текущий, токен
  деактивированного отклоняется сразу. `users.guard.spec.ts` — настоящий
  `RolesGuard` на декораторах: все 4 маршрута `/users` → `403` client'у, открыты
  ops; `change-password` открыт обеим ролям.
- **Проверено живьём** (локально): API-сценарий 26/26 — гвард, создание обеих
  ролей, все ошибки, новые пользователи логинятся и работают, деактивация →
  логин `401`, старый токен `401` сразу, восстановление, смена пароля. В
  браузере (EN): раздел и пункт меню, форма (поле клиента только для client,
  валидация, создание → строка в таблице), деактивация через подтверждение и
  восстановление, смена пароля (несовпадение, неверный текущий — сессия
  сохраняется, успех), выброс деактивированного посреди сессии на логин с
  объяснением.

## Фаза 19: история версий файлов PI (задеплоено на прод 2026-09-23, коммиты `4ca354b`, `b71be1e`)

**Деплой.** Порядок: **сначала миграция, потом код.** `dist.new` рядом (SHA-256
архивов сверен), `migration:show` с него — ровно одна новая
`AddPiFileVersions1790400000000`; прогнана, пока работал прежний код (только новая
таблица и тип — старый код их не замечает). Read-only сверка схемы: колонки
`pi_file_versions` как в миграции, `pi_file_type_enum = {original,signed}`, строк
0 (замен до фазы не сохранялось). `diff -rq dist dist.new` — ровно файлы фазы.
`stop` → `mv dist dist.bak-20260923-p19` → `mv dist.new dist` → `start`, маршрут
`GET /proforma-invoices/:id/file-history` зарегистрирован (44 маршрута), ошибок нет.
Фронтенд с `VITE_API_URL=/api` (бандл `index-PuYrtjSn.js`), прежний —
`ceat-frontend.prev-before-p19`, `nginx -t` → `reload`. Публичные проверки: `/` и
бандл — `200`, `file-history`/список PI/скачивание файла без токена — `401`
`UNAUTHORIZED`, ufw — только 22/80. Замены файлов на живых карточках клиента не
выполнялись — первая настоящая запись в истории появится при первой реальной
замене.

Раньше замена исходного файла проформы (одобренная замена) или повторная заливка
подписанного перезаписывала поле без следа. Теперь старая версия сохраняется.

- **Таблица `pi_file_versions`** (миграция `AddPiFileVersions1790400000000`,
  аддитивная: новый тип `pi_file_type_enum` + таблица): `pi_id`, `file_type`
  (`original`/`signed`), `file_url`, `uploaded_by`, `uploaded_at`, `replaced_at`.
  Хранит **только заменённые** версии; текущий файл остаётся в самой карточке
  (`pi_file_url`/`signed_file_url`) и не дублируется. Поэтому после первой
  загрузки история в таблице пуста, а каждая замена добавляет ровно одну строку.
- **Когда пишется** — перед перезаписью поля, в одной транзакции с ней
  (`archiveReplacedFile`): `replacement-decision` с `approved=true` (архивируется
  прежний исходный файл), повторный `upload-signed` (прежний подписанный),
  `upload-pi` при дозаполнении карточки (сейчас там всегда пусто — заполненная
  карточка даёт `409`, — вызов оставлен, чтобы правило держалось на всех путях).
  В строку идёт старое значение с тем, кто и когда его загрузил, и
  `replaced_at = now`. Отклонённое предложение замены версией не считается — оно
  никогда не было текущим.
- **`GET /proforma-invoices/:id/file-history`** — обе роли, owner-check для
  client (`404 NOT_FOUND` на чужую/несуществующую карточку). Возвращает текущие
  версии (собираются из карточки: `id: null`, `replacedAt: null`,
  `isCurrent: true`) и все архивные, по `uploadedAt` от новых к старым.
- **Скачивание** — обычным `/files/:id/download` по `fileUrl`. Проверка доступа
  client'а (`FilesService.assertClientCanAccess`) дополнена: архивная версия
  своей карточки скачивается, чужой — `404`. Без этого заменённый файл был бы
  client'у недоступен, потому что карточка на него больше не ссылается.
- **Фронтенд.** Блок «История файлов» (`PiFileHistory.tsx`) под блоком «Файлы»,
  свёрнут по умолчанию; запрос уходит только при раскрытии. Внутри — исходная и
  подписанная версии: кнопка «Скачать», бейдж «Текущая»/«Архив», дата и кто
  загрузил, у архивных — когда заменена. Только чтение, обе роли. Ключ запроса
  лежит под `["proforma-invoices", id]`, поэтому после замены/заливки история
  обновляется сама.
- **Тесты:** 392 всего (+10). В `proforma-invoices.service.spec.ts`: первая
  загрузка (новая карточка, дозаполнение, первый подписанный) ничего не
  архивирует; одобренная замена даёт ровно одну строку со старым URL, прежним
  загрузившим и `replacedAt` = моменту одобрения; отклонённая — ноль;
  повторная заливка подписанного архивирует прежний; цепочка из пяти версий
  (две замены исходного и перезаливка подписанного) с правильными
  `replacedAt` и сортировкой; чужой client — `404` и на истории, и на записи.
  `files.service.spec.ts` (новый): архивная версия скачивается владельцем, чужой
  client получает `404`. Фейковый репозиторий научился OR-условию (`where` как
  массив), которым пользуется проверка доступа к файлам.
- **Проверено живьём** (локально, настоящий бэкенд + браузер): на карточке
  `999999999`, где уже висело предложение замены, client одобрил его — старый
  исходный файл ушёл в историю и скачивается с теми же байтами (sha256 сверен), у
  второго клиента `404` и на истории, и на файле. На новой карточке: загрузка →
  предложение → одобрение → подписанный дважды → 4 записи (2 текущие + 2 архив),
  каждая версия скачивается с байтами именно своей загрузки. В браузере (EN/RU,
  client и ops) блок свёрнут и без запроса до раскрытия, архивная версия
  скачивается (`200`), ошибок в консоли нет.
- **Кнопка «Заменить подписанный файл»** у client'а на уже подписанной карточке
  (раньше после подписания форма загрузки просто пропадала): диалог с той же
  формой загрузки PDF, тот же `upload-signed`, без одобрения CEAT — собственное
  действие клиента. Предыдущий подписанный файл уходит в историю по правилу
  выше. У ops кнопки нет. Проверено в браузере: замена через диалог → тост
  «Signed file replaced», прежний текущий файл стал архивным, новый — текущим.
- Замены, сделанные до этой фазы, восстановить нельзя — следов не осталось.

## Фаза 18: локализация ошибок API через коды (задеплоено на прод 2026-09-23, коммиты `eb645e7`, `4190fca`)

**Деплой.** Миграций нет (`migration:show` с `dist.new` — все 9 `[X]`). Backend и
фронтенд — вместе: новый фронт читает `code` из тела ошибки и больше не показывает
авто-тост на 403. `diff -rq dist dist.new` — ровно файлы фазы плюс новая папка
`common/errors`. `stop` → `mv dist dist.bak-20260923-p18` → `mv dist.new dist` →
`start`, в журнале чисто. Фронтенд собран с `VITE_API_URL=/api` (бандл
`index-DRJD6Z6I.js`), прежний — `ceat-frontend.prev-before-p18`, `nginx -t` →
`reload`. Публичные проверки: `/` и бандл — `200`; API без токена — `401`
`{"code":"UNAUTHORIZED",…}`, неверный логин — `INVALID_CREDENTIALS`, неизвестный
маршрут — `404` `UNKNOWN_ERROR`; ufw — только 22/80; ошибок в журнале после
переключения нет. Записывающие сценарии (move/confirm и т.п.) на живых данных
клиента не выполнялись.

До этой фазы API отдавал текст ошибки как есть — в основном по-русски, и в
EN-интерфейсе тосты показывали русский текст сервера. Теперь у каждой ошибки
есть стабильный код, а текст выбирает фронтенд.

- **Формат любой ошибки:** `{ statusCode, code, message, params? }`. `code` —
  идентификатор (`MOVE_EXCEEDS_REMAINING`, `ARRIVAL_NOT_CONFIRMED`, …), все коды —
  в одном реестре `src/common/errors/api-error.ts`; `message` — прежний текст
  сервера (запасной вариант); `params` — значения для подстановки
  (`{ qty: 80, remaining: 30 }`).
- **Место броска** меняет только аргумент, класс исключения и HTTP-статус те же,
  логика проверок не тронута:
  `throw new BadRequestException(apiError("MOVE_EXCEEDS_REMAINING", "нельзя переместить …", { qty, remaining }))`.
  Один код — один смысл: все «X id not found» (включая проверки владельца) →
  `NOT_FOUND`, все «доступно только клиенту» → `CLIENT_ONLY_ACTION`, все «только
  CEAT» → `OPS_ONLY_ACTION`.
- **Глобальный фильтр** `ApiExceptionFilter` (`APP_FILTER`) приводит к этому
  формату всё: ошибку без кода — к `UNKNOWN_ERROR` с текстом как есть, не-HTTP
  исключение — к `500` «Internal server error» без внутренностей (SQL, пути), со
  стеком в логе. `ValidationPipe` получил `exceptionFactory`: правило DTO может
  назвать свой код через `context: errorContext("…")` (так сделано для всех правил
  с русскими текстами и для дат), иначе `VALIDATION_FAILED` с английскими
  деталями class-validator в `params.details`. 401 от `JwtAuthGuard` → `UNAUTHORIZED`.
- **`CONTAINER_OVERFILLED`** передаёт в `params.containers` только номера и
  проценты (`#1 (150%)`) — метки слотов в БД русские («Контейнер N»).
- **Фронтенд.** `ApiError` несёт `code`/`params`; единственная точка —
  `getErrorMessage` (`lib/errors.ts`): есть перевод `errors.<CODE>` в
  `en.json`/`ru.json` — показывает его с подстановкой (числа по локали), нет —
  текст сервера. `UNKNOWN_ERROR` намеренно без перевода. `download.ts` разбирает
  тело ошибки той же функцией, что и `client.ts`. **403 больше не показывает
  автоматический тост** в `client.ts` — раньше на каждую 403 было два тоста
  (общий «нет доступа» + «Forbidden» от вызывающего); все 27 мутаций имеют свой
  `onError`, так что причина показывается один раз и переведённой. Экспорты PI /
  бэкордера и открытие файла на детали PI теперь тоже показывают причину от
  сервера, а не только общий текст.
- **EN-проход по UI** (обе роли, все страницы и диалоги, локально): в коде
  фронтенда кириллица только в комментариях и в регулярке, распознающей
  «Контейнер N»; все метки слотов идут через `containerName()`. Русского в
  EN-интерфейсе не найдено. Двуязычные письма Фазы 13 не трогались.
- **Excel-выгрузки — всегда на английском**, независимо от языка интерфейса
  (структура и расчёты не менялись; старые описания колонок в разделах Фаз 5, 10,
  11 выше — историческая запись, актуальные названия здесь):
  - `GET /proforma-invoices/:id/export-xlsx`: «Название» → `Name`, итоговая
    строка «Всего» → `Total`;
  - `GET /backorder/export-xlsx`: «Бэкордер от {дата}» → `Backorder as of {дата}`,
    «Выгружено: {дата}» → `Exported: {дата}`, колонка «Название» → `Name`;
  - `GET /ready-to-ship/export-xlsx`: `Container | SKU | Description | Quantity |
    Load Factor | Proforma (PI) | Name | SO` (было «Контейнер», «Описание»,
    «Количество», «Проформа (PI)», «Название»); `OK to mix` как был. Номер
    контейнера по-прежнему берётся из метки «Контейнер N» — это разбор данных, а
    не подпись.
- **Тесты:** 382 всего. `api-exception.filter.spec.ts` — фильтр на уровне
  функции и через настоящий HTTP (ошибка с кодом, без кода, синхронный и
  асинхронный crash, ValidationPipe с кодом из DTO и без, 404 на несуществующий
  маршрут); `error-dictionary.spec.ts` — у каждого кода есть текст в en и ru, нет
  лишних, плейсхолдеры совпадают; `coded-throws.spec.ts` — статическая проверка,
  что в `src` не осталось `throw new XxxException(...)` без `apiError`.
- **Проверено живьём** (EN): превышение остатка при Move со «старой» страницы —
  «Can't move 8: only 3 of this line is left unallocated.»; повторное
  подтверждение прибытия — «Arrival has already been confirmed.» (один тост);
  чужой контейнер у второго клиента — «Not found — it may have been deleted, or
  it isn't available to you.» вместо сырого «ActualContainer <uuid> not found»;
  403 и ошибки DTO переводятся в EN и RU без авто-тоста.

## Фаза 17: отмена подтверждения прибытия (задеплоено на прод 2026-09-24, коммит `9809c65`)

Аварийная кнопка для ops на случай, если client подтвердил прибытие контейнера
по ошибке — дополнение к маркеру прибытия выше.

- **`POST /actual-containers/:id/revoke-arrival-confirmation`** — ops-only
  (`@Roles(Role.OPS)` → `403` client'у через `RolesGuard`, плюс явная проверка
  роли в сервисе, как у соседних методов). Очищает `arrival_confirmed_at` и
  `arrival_confirmed_by` обратно в `null`, возвращает контейнер целиком.
- **Когда можно отменять.** `arrival_confirmed_at` пишет **только**
  `confirm-arrival` — автоматическое "прибыло через 7+ дней после ETA"
  вычисляется геттером и нигде не хранится. Поэтому "поле заполнено" — это
  ровно "было ручное подтверждение", и отдельной проверки на "ручное vs авто"
  не понадобилось: если поле пустое (подтверждения не было вовсе **или**
  "прибыло" сработало автоматически) — `400` «прибытие не было
  подтверждено». Для авто-прибывшего контейнера отменять просто нечего —
  хранимого подтверждения нет.
- **Что происходит после отмены** — `arrivalStatus` пересчитывается от даты,
  как на любом запросе: до 7-дневного порога контейнер возвращается к
  «Ожидается прибытие» (или вовсе к "маркера нет", если до ETA больше 10
  дней); после порога остаётся «Прибыло (default)» — автоматическое правило
  всё равно пересиливает отмену, и визуально меняется только то, что пропал
  подтвердивший (подсказка с email/датой). Это предупреждение есть и в тексте
  confirm-диалога на фронтенде.
- **Фронтенд.** `ArrivalMarker.tsx` получил необязательный `canRevoke`: детальная
  страница контейнера передаёт его для ops, список — нет. Кнопка «Отменить
  подтверждение прибытия» (с confirm-диалогом) видна только при
  `arrivalStatus === "arrived"` **и** непустом `arrivalConfirmedAt` — то есть
  только для ручного подтверждения; у «Прибыло (default)» её нет. Хук
  `useRevokeArrivalConfirmationMutation` пишет ответ сразу в кэш детали и
  обновляет список (тот же `useContainerCacheWriter`, что у `confirm-arrival`).
  Тексты — `shipped.arrival.revoke*` в `en.json`/`ru.json`.
- **Тесты:** 361 всего (+8). В `actual-containers.service.spec.ts` — отмена
  ручного подтверждения очищает оба поля, `400` на пустом, `400` на повторной
  отмене, `403` у client (подтверждение остаётся), `404` на неизвестном id. В
  `actual-container.entity.spec.ts` (геттер через фейковый репозиторий не
  проверить, см. "Маркер прибытия") — после отмены `arrivalStatus` = `expected`
  до порога (3 дня до ETA, 6 дней после), `arrived` без подтвердившего с 7-го
  дня, `null` при ETA через 30 дней.
- **Проверено живьём** (локально, реальный бэкенд + браузер): на контейнере с
  ETA 4 дня назад — отмена без подтверждения `400`, client подтвердил → `arrived`,
  отмена от client → `403`, от ops → `expected`, повторно → `400`; на
  контейнере с ETA 3,5 недели назад — отмена авто-прибывшего → `400`, client
  подтвердил → отмена от ops → остался `arrived` без подтвердившего. В браузере
  под ops: кнопка рядом с «Arrived», диалог с предупреждением про 7 дней, после
  подтверждения маркер мгновенно сменился на «Arrival expected» и кнопка
  пропала; у «Arrived (default)» кнопки нет; client на своём вручную
  подтверждённом контейнере кнопку не видит; в списке кнопок отмены нет, высота
  строк с бейджем «Arrived» не изменилась. Состояние локальной БД после проверки
  возвращено к исходному (`{null: 44, expected: 7, arrived: 26}`).

## Фаза 12: сверка "план vs факт" по количеству (задеплоено на прод 2026-09-22, коммит `34dd161`)

Только количества, без цен — распознавание цен из PI отложено на отдельный
заход. На карточке PI теперь виден разрыв между тем, что клиент подтвердил к
отгрузке (`ContainerLineAllocation` в подтверждённых контейнерах "Готово к
отгрузке"), и тем, что CEAT реально отгрузил по своей системе
(`ActualContainerLineItem` из файла бэкордера) — двумя независимыми до сих пор
подсистемами (см. "Фаза 10"), сведёнными здесь только для показа, без записи.

- **`GET /proforma-invoices/:id`** — новое вычисляемое поле `reconciliation`:
  массив, по одной строке на `material_num` **в рамках этой карточки**, а не
  на строку `PiLineItem` (один материал может лежать в нескольких SO-строках
  одного PI — они складываются в одну строку сверки):
  `{ materialNum, materialDesc, plannedQty, shippedQty, delta }`.
  - `plannedQty` = Σ `allocated_qty` по `ContainerLineAllocation`, только там,
    где `container.is_confirmed = true` — черновые контейнеры не считаются
    планом, они ещё не финальны.
  - `shippedQty` = Σ `quantity` по `ActualContainerLineItem` с этим `pi_number`
    и совпадающим `material_num` — та же логика, что уже даёт
    `ProformaInvoice.shippedQty` (Фаза 10), только теперь с разбивкой по
    материалу вместо одной суммы на карточку.
  - `delta = shippedQty - plannedQty` — не бизнес-правило, чисто
    информационное число, может быть и отрицательным (запланировано больше,
    чем уехало), и положительным (уехало больше, чем сейчас висит в
    подтверждённых контейнерах — например контейнер разблокировали и
    опустошили уже после того, как более ранняя партия физически уехала).
    Никакой валидации или алерта на его основе нет.
  - Список строится по **всем** материалам карточки (в том числе с
    `plannedQty = shippedQty = 0`) — фильтрация "показывать только активные"
    сделана на фронтенде, не здесь (см. ниже).
  - Только в детальном ответе (список `GET /proforma-invoices` это поле не
    считает — два лишних запроса на каждую карточку списка того не стоят).
    `PiLineItem`-строки без `material_num` пропускаются — группировать не по
    чему.
  - Реализовано как чистая функция `computeReconciliation` в
    `src/proforma-invoices/utils/compute-reconciliation.ts` (тот же приём, что
    `compute-priority-aggregates.ts`/`compute-pi-aggregates.ts`) — сама делает
    группировку и фильтр "только подтверждённые", поэтому проверяется юнитами
    без базы. `ProformaInvoicesModule` регистрирует `ContainerLineAllocation`
    и `ActualContainerLineItem` через свой `TypeOrmModule.forFeature([...])`
    (ни `ReadyToShipModule`, ни `ActualContainersModule` не экспортируют
    `TypeOrmModule`) — отдельный репозиторий на ту же таблицу, без изменений в
    этих модулях.
- **Frontend.** На детальной странице PI, сразу под таблицей позиций — карточка
  "Сверка: план vs факт" / "Reconciliation: planned vs shipped": колонки SKU,
  Описание, Запланировано, Отгружено, Разница. Показывается только если у
  карточки есть хоть одна строка с `plannedQty > 0` или `shippedQty > 0`
  (`activeReconciliation`, `useMemo`-фильтр по `pi.reconciliation`) — иначе
  блок не рендерится вовсе (на карточке с полным набором материалов, но без
  единой активности, это были бы десятки строк 0/0/0, увиденные на живых
  данных прода — см. ниже). Колонка "Разница" — нейтральный/зелёный текст при
  положительной разнице, обычный при отрицательной или нулевой, **без
  предупреждающих цветов**: это не ошибка. Тексты — `piDetail.reconciliation.*`
  в `en.json`/`ru.json`.
- **Проверено:** 8 юнит-тестов на `computeReconciliation` (группировка
  нескольких SO-строк одного материала, дельта в обе стороны, только
  подтверждённые контейнеры входят в план — черновик игнорируется, нулевая
  строка при отсутствии всякой активности, чужой материал из
  `ActualContainerLineItem` не создаёт строку, строки без `material_num`
  пропускаются, пустой результат без позиций, сортировка по `materialNum`) +
  2 теста на `findOne` в `proforma-invoices.service.spec.ts` — 318 тестов всего
  по бэкенду, все проходят; `tsc`/`eslint --fix` чисто. Фронтенд: `tsc`/`vite
  build`/`oxlint` чисто, 323/323 совпадение ключей `en.json`/`ru.json`.
  Живьём:
  - **Прод, только чтение** (отдельный одноразовый read-only SQL-скрипт по
    SSH напрямую к Postgres прода, копия той же логики группировки, без
    деплоя нового кода и без единой строки `UPDATE`; скрипт удалён с сервера
    после использования) — PI 100037115: материал `106259`, `plannedQty 8`,
    `shippedQty 500`, `delta 492`. PI 100039270: 116 материалов, 0
    подтверждённых контейнеров сейчас (`plannedQty` везде 0), у 6 из 116
    материалов есть отгруженное количество (например `106259: 360`,
    `106266: 36`, `107492: 2`, `107582: 22`, `113905: 4`, `114475: 8`) — это и
    есть тот случай, из-за которого на фронтенде добавлен фильтр "только
    активные строки": без него карточка показала бы 116 строк, 110 из которых
    0/0/0.
  - **Локально, сквозь настоящий эндпоинт** (не копия логики): `POST
    /ready-to-ship/move` (qty 3, материал `113114`, PI 100037116) в черновой
    контейнер → `POST /ready-to-ship/confirm` → `GET
    /proforma-invoices/:id` — `plannedQty 3`, `shippedQty 9`, `delta 6`
    (9 − 3 = 6, как и ожидалось); до подтверждения контейнера та же строка
    показывала `plannedQty 0` (черновик не в счёт).

## Фаза 13: email-уведомления по четырём событиям (задеплоено на прод 2026-09-23, коммит `ee90dc8`)

`nodemailer` + `EventEmitter2` (`@nestjs/event-emitter`) + `@nestjs/schedule`. Explицит-emit в
конце соответствующих транзакционных методов, не TypeORM subscribers — тот же выбор в пользу
точного контроля, что и раньше в проекте (subscriber реагирует на любое сохранение сущности,
explicit emit — только на конкретное действие).

### Инфраструктура

- **`EmailService`** (`src/notifications/email.service.ts`) — тонкая обёртка над `nodemailer`.
  Транспорт строится только если `EMAIL_HOST`/`EMAIL_USER`/`EMAIL_PASSWORD` все три заданы;
  иначе `send()` логирует `"email not sent: SMTP not configured"` и просто возвращается — ни
  одно из четырёх событий никогда не роняет вызвавшее его действие (загрузку, подтверждение,
  ежедневный cron) из-за письма. Пустой список получателей — отдельный `warning` в лог, тоже
  без исключения. Ошибка самой отправки (транспорт настроен, но SMTP недоступен) — тоже
  логируется и проглатывается, не пробрасывается наружу.
- **`EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_USER`/`EMAIL_PASSWORD`/`EMAIL_FROM`** — уже были в
  локальном `.env` (не в `.env.example` — заведены отдельно на этой машине при переезде
  окружения), но пустые и нигде не использовались до этой фазы (см. `FUNCTIONAL_OVERVIEW.md`,
  "Нет уведомлений"). Актуализировано: добавлены в `.env.example` с комментарием;
  `EMAIL_FROM` по умолчанию `noreply@ceat-order-track.local`. Прод — значения не проверялись
  (это отдельный сервер, `.env` там не читался в рамках этого захода); реальный SMTP нигде
  сейчас не настроен ни локально, ни (предположительно) на проде.
- **`NOTIFICATION_CHECK_CRON`** — новая переменная (`.env`/`.env.example`), по умолчанию
  `0 8 * * *` (08:00). Существующие `DEMURRAGE_CHECK_CRON`/`PAYMENT_REMINDER_CRON` в `.env` —
  заготовки под **другие**, ещё не реализованные фичи (демередж, напоминания об оплате по
  `PAYMENT_REMINDER_DAYS_THRESHOLD`), не переиспользованы здесь: разное назначение, несмотря на
  похожее имя.
- **`ArrivalNotificationsService`** (`src/actual-containers/`) регистрирует `CronJob` вручную
  через `SchedulerRegistry.addCronJob()` в `onModuleInit()`, а не статическим декоратором
  `@Cron(...)`: декоратор вычисляется в момент определения класса — то есть когда этот файл
  впервые `require`-ится при построении дерева модулей `AppModule`, **до** того как
  `ConfigModule.forRoot()` успевает загрузить `.env` — `process.env.NOTIFICATION_CHECK_CRON`
  в этот момент ещё не существует. Динамическая регистрация в `onModuleInit()` читает его
  через `ConfigService` уже после полной инициализации Nest.
- **AuditLog** — искали по всему кодовому дереву (README, `src/`): нигде не осталось со времён
  Фазы 1 (снесена при пересборке v2, как и предполагал сам запрос). Каждая отправка/попытка
  просто идёт в обычный `Logger` (`EmailService`), отдельной таблицы под это не заводили.

### Четыре события

1. **`pi.ready-to-sign`** — `ProformaInvoicesService.uploadPi`, в обеих ветках (новая карточка
   и дозаполнение карточки из бэкордера), сразу после сохранения `pi_file_url`. `status` —
   вычисляемый геттер (`ProformaInvoice.status`, не колонка), а не хранимое состояние: `uploadPi`
   никогда не трогает `signed_file_url`, поэтому результат всегда `missing_signed_document`, без
   дополнительной проверки. Получатели — `role=client` этого `customer_id`.
2. **`pi.replacement-proposed`** — `proposeReplacement`, после сохранения
   `pending_replacement_file_url`. Получатели — те же.
3. **`container.reopened-for-client`** — адаптировано (как и просили проверить): у
   `ShippingContainer` нет статуса `proposed_to_client` вообще — это булев `is_confirmed`,
   которым распоряжается только client (сам раскладывает позиции по контейнерам и сам же
   подтверждает, без предложения от ops). Единственное действие ops, которое возвращает
   контейнер в состояние "клиенту нужно посмотреть и подтвердить" — `unlock()`: он переводит
   ранее подтверждённый контейнер обратно в черновик. Emit — сразу после `containerRepo.save()`
   внутри `unlock()`. Получатели — `role=client` этого `customer_id` (не ops — событие клиентское).
4. **`container.arrival-expected`** — единственное без явного действия: `arrivalStatus` у
   `ActualContainer` — геттер, пересчитываемый на лету от сегодняшней даты (см. "Маркер прибытия
   контейнера" выше), никто не нажимает кнопку. `ArrivalNotificationsService.checkArrivals()` раз
   в день (или напрямую в тестах) проходит по всем `ActualContainer`, и для тех, где
   `arrival_notification_sent_at IS NULL` и `arrivalStatus === "expected"`, ставит
   `arrival_notification_sent_at = now()` и эмитит событие. Поле никогда не сбрасывается — значит,
   это одновременно и "уже уведомляли" на будущее: контейнер, у которого ETA сдвинули вперёд
   после уведомления и который позже **снова** попал в окно "expected", повторно не уведомит
   (принятое упрощение — за рамками того, что просили). **Миграция**
   `AddActualContainerArrivalNotification1790200000000`: аддитивная nullable-колонка
   `arrival_notification_sent_at timestamptz` на `actual_containers`. Получатели — `role=client`
   этого `customer_id` **и все** `role=ops` (единственное двустороннее событие из четырёх).

### Тексты писем

Ни в модели данных, ни на бэкенде нигде не хранится язык конкретного пользователя (RU/EN-тумблер
на фронтенде живёт только в браузере, см. `frontend/README.md`) — поэтому каждое письмо содержит
**оба языка сразу** (`"RU-текст\n\nEN-текст"`, тема — `"RU / EN"`), тот же приём, что уже
использовался для двуязычных подписей в интерфейсе (например бейджи маркера прибытия). Заголовок
карточки PI в теме/тексте — через `formatPiTitle` (`src/notifications/utils/format-pi-title.ts`),
зеркало фронтендового `frontend/src/lib/format.ts` (`"{number}: {label}"`, только когда label не
пуст) — событие 2 в этом плане не отличается: спецификация просила только номер без лейбла, так и
сделано. Все четыре шаблона — чистые функции в
`src/notifications/utils/build-notification-content.ts`, тестируются без моков сервисов.

### Получатели

`UsersService.findClientUsers(customerId)` / `findOpsUsers()` — прямой запрос по `role`
(+ `customer_id` для клиентских). Пустой список получателей не приводит ни к исключению, ни к
пропуску отправки — `NotificationsListener` всё равно вызывает `EmailService.send([], ...)`, а
уже он логирует `warning` и не делает сетевого вызова.

### Тесты

70 новых тестов (344 всего, было 318): 8 на чистые построители писем (оба языка, форматирование
лейбла), 6 на `NotificationsListener` (правильные получатели на все 4 события, включая
пустой список), 5 на `EmailService` (не настроено → лог без исключения; пустые получатели →
warning; настроено → реальный вызов `nodemailer.createTransport`/`sendMail` с моком; сбой
транспорта → проглатывается), 7 на `ArrivalNotificationsService.checkArrivals` (эмит и штамп при
первом входе в `expected`, повторный прогон не шлёт дважды, слишком рано — не шлёт, без ETA — не
шлёт, контейнер, "проскочивший" `expected` мимо cron прямо в `arrived` — тоже не шлёт, несколько
контейнеров за один проход независимо) + 1 на регистрацию cron через `SchedulerRegistry` с
дефолтным выражением, плюс новые ассерты внутри существующих `proforma-invoices.service.spec.ts`
(3) и `ready-to-ship.service.spec.ts` (2) на сам факт эмита с правильным payload.

Заодно чинили сам тестовый `common/testing/fake-repo.ts`: `hydrate()`/`upsert()` раньше отдавали
`{...row}` — плоский spread, который **теряет геттеры** класса-сущности (они живут на
прототипе, не как собственные свойства), если тест засеивал репозиторий настоящим инстансом
(`Object.assign(new ActualContainer(), {...})`, как уже делает `actual-container.entity.spec.ts`)
**и** запрашивал `relations`. Раньше это не всплывало, потому что ни один существующий сервис не
комбинировал геттер сущности с `relations` в одном тесте; `ArrivalNotificationsService` — первый
такой случай (`arrivalStatus`/`eta` через `relations: ["customer"]`). Теперь `hydrate`/`upsert`
копируют поверх `Object.create(Object.getPrototypeOf(row))`, а не голого `{}` — прототип, а с ним
и геттеры, сохраняются.

### Живая проверка

Локально (пересобранный `dist`, миграция накатана, `npm run migration:run` — 3 миграции применены,
включая пропущенные Фазы 11/12 на этой машине): события 1 и 2 проверены сквозь реальные эндпоинты
(`POST /proforma-invoices/upload-pi`, `POST /proforma-invoices/:id/propose-replacement`) — лог
показал правильные двуязычные темы (`"Проформа 999999999 готова к подписанию / Proforma 999999999
is ready to sign"`, `"CEAT предложил замену файла проформы 999999999 / CEAT proposed a replacement
file for proforma 999999999"`) с `"email not sent: SMTP not configured"` (SMTP локально не
настроен). Событие 3 (`unlock`) **не получилось** проверить тем же способом — упёрлись в
известное ограничение этой машины: локальный embedded Postgres в WIN1252, а
`ReadyToShipService.ensureContainerSlots` создаёt слоты с кириллическими лейблами ("Контейнер N") —
`INSERT` падает 500-й (см. `project_pending_deploys`/README про WIN1252-ограничение локальной БД,
не имеет отношения к Фазе 13). Проверено вместо этого юнит-тестом с моком `EventEmitter2`
(`ready-to-ship.service.spec.ts`, "Phase 13: emits container.reopened-for-client…"). Событие 4 —
по самой природе триггера тестируется прямым вызовом `checkArrivals()`, что и сделано (7 тестов
выше); реального ежедневного прогона не ждали.

**Реальное тестовое письмо на реальный SMTP не отправлено** — ни локальный, ни (предположительно)
продовый `.env` не содержат настоящих `EMAIL_HOST`/`EMAIL_USER`/`EMAIL_PASSWORD`; нужны реальные
учётные данные от пользователя, чтобы это сделать.

## Экспорт в Excel (Фаза 5)

### `GET /proforma-invoices/:id/export-xlsx` (обе роли)

Отдаёт `.xlsx` (`StreamableFile`, тот же паттерн, что `FilesController.download()`)
с одной карточкой PI: шапка (номер PI, статус, SO-номера, все 6 агрегатов) →
пустая строка → таблица `PiLineItem` этой карточки (10 колонок: material_num,
material_desc, so_number, balance_to_be_delivered, quantity, mt, load_factor,
loadability, current_week_dispatch_load_factor, current_week_dispatch_qty) →
жирная строка "Всего" с теми же суммами, что на детальной странице фронтенда
(`buildPiExportWorkbook` вызывает `computeLineItemsTotals` —
[compute-line-items-totals.ts](src/proforma-invoices/utils/compute-line-items-totals.ts),
портированную логику `PiDetailPage.tsx`'s "Всего": Остаток/Кол-во/план недели
(Qty-часть) — из готовых агрегатов PI, MT/Load Factor/план недели (Load
Factor-часть) — суммой по строкам, Loadability — прочерк). Никаких данных не
скрывается от `client` — так же, как на самой странице, `so_number` и
остальные поля видны обеим ролям без урезания.

Владение проверяется в сервисе (`findOwnedByActor`, тот же паттерн, что и
Фаза 2), не декоратором — `@ScopeByCustomer` тут не подходит по той же
причине, что и на `addAdditionalFile` (см. выше): ответ бинарный, не
`ProformaInvoice`-объект, `CustomerScopeInterceptor` нечего фильтровать.
`client` с чужим PI получает `404`.

Имя файла: `PI_{pi_number}_export_{дата выгрузки}.xlsx`
(`formatDateForFilename`, UTC `YYYY-MM-DD` — то же самое форматирование, что
`todayIsoDate()` на фронтенде).

### `GET /backorder/export-xlsx` (обе роли, с Фазы 6 — раньше ops-only)

Отдельный контроллер `BackorderController` (не
`BackorderUploadsController`, который занят `/backorder-uploads` — аудитом
загрузок и остаётся ops-only) — этот эндпоинт про текущий *срез* активных
PI, а не про историю загрузок файла. Отдаёт одну строку на каждый
`PiLineItem` каждой карточки с `is_archived_shipped = false` (архивные — не
источник истины "что сейчас открыто", см. "Парсинг бэкордера" выше — не
включаются), `pi_number`/`pi_status` в начале строки, дальше все 10 колонок
позиции — как на детальной странице PI, без урезания.

**Скоуп по `customer_id` для `client` (Фаза 6)**: `ops` получает весь
активный бэкордер, без ограничений; `client` — только строки карточек
своего `customer_id`. Реализовано в сервисе
(`BackorderUploadsService.exportXlsx(actor)` добавляет `where.customer =
{ id: actor.customerId }` при `actor.role === Role.CLIENT` до `piRepo.find`),
не декоратором — тот же принцип, что и на PI-экспорте выше и на всех
остальных client-эндпоинтах проекта: `@ScopeByCustomer`/
`CustomerScopeInterceptor` фильтрует только *ответ* и не может ничего
сделать со `StreamableFile`. Контроллер больше не помечен
`@Roles(Role.OPS)` (это единственное, что раньше блокировало `client` —
`RolesGuard` и так разрешает `client` любой `GET`), `@CurrentUser()`
прокидывается в сервис. Юнит-тесты заводят двух разных клиентов
(`clientActor`/`otherClientActor`, разные `customerId`) на общий набор из
двух карточек разных customer'ов и проверяют, что каждый экспорт содержит
только "свою" строку — `ops` получает обе. Живая проверка (Claude Browser +
curl, dev-сервер): два временных customer'а + PI-карточки + пользователи
(`TEST-` префикс, тот же принцип, что и во всех прежних живых проверках),
каждый `client` получил в файле ровно одну "свою" строку, `ops` — обе плюс
весь реальный бэкордер пилота; тестовые данные удалены сразу после.

Шапка файла — две даты, явно разделённые по смыслу (не дата генерации
выдаётся за дату данных): **"Бэкордер от {дата последней загрузки
BackorderUpload}"** — берётся из `uploadedAt` самой свежей записи
`BackorderUpload` (`find({ order: { uploadedAt: "DESC" }, take: 1 })`), не из
текущей даты — сам факт запроса экспорта не означает, что бэкордер только
что обновлялся. **"Выгружено: {дата генерации файла}"** — `new Date()` на
момент запроса. Если ни одной загрузки ещё не было — первая строка
показывает "—" вместо даты источника (а не текущую дату, что было бы
неверным утверждением).

Имя файла: `Backorder_source_{дата последней загрузки}_export_{дата
выгрузки}.xlsx` (`"none"` вместо даты источника, если загрузок ещё не было).

### Штамп даты на сохранённый файл бэкордера

`POST /backorder-uploads` теперь сохраняет исходный файл (через
`FilesService.save()`, как и раньше) под именем со штампом даты **загрузки**:
`stampDateOnFilename("MTK ROSBERG INR.xlsx", uploadedAt)` →
`"MTK ROSBERG INR_2026-09-03.xlsx"` — вставляется перед расширением (файл
без расширения или начинающийся с точки — дата просто дописывается в конец).
Только про физическое хранение на диске/в `stored_files` — колонка "Файл" в
истории загрузок (`GET /backorder-uploads`) по-прежнему показывает
оригинальное имя как есть, это не переименование ради отображения, а способ
не потерять "от какой даты какой файл" на диске, когда оригинальное имя от
CEAT из недели в неделю повторяется (`MTK ROSBERG INR.xlsx`,
`2907_MTK_ROSBERG_INR.xlsx` — оба реально встречались). `uploadedAt`
захватывается один раз в начале `BackorderUploadsService.upload()` и
переиспользуется и для штампа имени, и для самой записи `BackorderUpload` —
не два отдельных `new Date()`, которые могли бы разойтись на миллисекунды.

### CORS: `Content-Disposition` в `exposedHeaders`

Кросс-origin `fetch()` (дев-режим: фронтенд на `:5173`, бэкенд на `:3000`)
по умолчанию скрывает от JS все заголовки ответа, кроме "simple"-списка —
`Content-Disposition` (откуда фронтенд берёт реальное имя файла для
скачивания) в него не входит. `app.enableCors({ exposedHeaders:
["Content-Disposition"] })` в [main.ts](src/main.ts) открывает его явно. На
проде (один origin через nginx-проксирование `/api/*`) это не обязательно,
но и не мешает.

### Тесты (Фаза 5)

`compute-line-items-totals.spec.ts`, `build-pi-export-workbook.spec.ts`,
`stamp-date-on-filename.spec.ts`, `build-backorder-export-workbook.spec.ts` —
новые файлы, чистые функции проверены на реальных exceljs-буферах (не моки),
тем же приёмом, что `parse-backorder-file.spec.ts` в Фазе 3. Плюс новые
тесты в `proforma-invoices.service.spec.ts` (форма буфера/имени файла, `404`
для `client` с чужим PI, успех для своего) и `backorder-uploads.service.spec.ts`
(штамп даты на сохраняемом файле, фильтрация только активных карточек в
экспорте, дата последней загрузки в имени файла).

`common/testing/fake-repo.ts` расширен: `find()` теперь понимает `order`
(сортировка по одному полю ASC/DESC) и `take` (лимit) — нужно
`exportXlsx()`-у бэкордера, который ищет самую свежую запись
`BackorderUpload` через `find({ order: { uploadedAt: "DESC" }, take: 1 })`.

Backend test count (после Фазы 5): 57 (было 39 после Фазы 3.1: +18 на
экспорт). После Фазы 6 (client-скоуп на `/backorder/export-xlsx`): 59 (+2 —
`exportXlsx` тесты на "ops видит оба customer'а" / "каждый client видит
только свой").

Живая проверка Фазы 5 (Claude Browser, dev-сервер, `ops`): скачан экспорт
карточки PI 100039270 (`PI_100039270_export_2026-09-03.xlsx`, 200 OK,
`Content-Type` верный) — шапка, все 117 строк позиций, строка "Всего"
совпадает с тем, что показывает `PiDetailPage.tsx` (4895 / 4931 / 272.489 /
32.4289 / — / 16.1202 / 1255). Скачан экспорт всего бэкордера
(`Backorder_source_2026-09-03_export_2026-09-03.xlsx`, 200 OK) — 534 строки
across 25 активных PI, обе даты в шапке — "Бэкордер от 2026-09-03" (дата
последней реальной загрузки, `03.09.2026, 17:42` в истории загрузок) и
"Выгружено: 2026-09-03" — верно проставлены, различаются семантически даже
когда совпадают по значению (загрузка и выгрузка в один день).

Живая проверка Фазы 6 (Claude Browser + curl, dev-сервер, реальная
Neon-БД): заведены два временных customer'а (`TEST-CustomerA`/`-B`), по
одной PI-карточке с одной позицией на каждого, три временных пользователя
(`test-ops-verify@ceat.com`, `test-client-a-verify@ceat.com`,
`test-client-b-verify@ceat.com`, префикс `-verify@ceat.com` в email — для
адресного удаления после). `client` A получил ровно одну строку
(`TEST-900001`), `client` B — ровно одну (`TEST-900002`), `ops` — обе плюс
весь реальный активный бэкордер пилота (28 PI, 538 строк) в одном файле —
подтверждает и скоуп, и то, что он не ломает `ops`-путь. Все временные
customer'ы/карточки/пользователи удалены сразу после проверкой скриптом,
запущенным и стёртым в той же сессии — в БД не осталось следов.

## Готово к отгрузке (Фаза 8, backend)

Клиент раскладывает `current_week_dispatch_qty` строк **всех своих активных
(не архивных) PI-карточек сразу** по контейнерам-слотам. Остаток строки к
распределению = `current_week_dispatch_qty` − Σ уже размещённого в любых
контейнерах (черновых и подтверждённых). Заполнение контейнера = Σ
`allocated_qty / loadability`; `> 100%` контейнер считается перегруженным.

Миграция `1789746739709-AddReadyToShip.ts` (прогнана на локальном Postgres,
`down` проверен): `shipping_containers` (unique `customer_id+label`),
`container_line_allocations` (unique `container_id+pi_line_item_id`,
`allocated_qty > 0`), `allocation_actions` (лог для undo), `marking_files`
(unique по allocation). Все FK — `NO ACTION`, как в остальной схеме: удаления
делаются явно в сервисе, а не каскадом.

| Эндпоинт | Роль | Что делает |
|---|---|---|
| `GET /ready-to-ship` | client (свой `customer_id`); ops с `?customerId=` | нераспределённые строки + контейнеры с аллокациями, `fillPercent`/`isOverfilled`, счётчик маркировки "N из M", `totalPossibleContainers`, `canConfirm`. Держит не меньше `totalPossibleContainers` слотов: первый заход создаёт все, дальше — только недостающие (см. "Досоздание слотов") |
| `POST /ready-to-ship/move` `{piLineItemId, containerId, qty}` | client | `qty` — целое, `0 < qty ≤ остаток`; контейнер не подтверждён; upsert аллокации + запись в лог. В перегруженный контейнер класть можно — блокирует только `confirm` |
| `POST /ready-to-ship/remove` `{allocationId, qty}` | client | (Фаза 9) вернуть `qty` шт. позиции из **неподтверждённого** контейнера в список готового (`qty = всё` удаляет строку); пишется как отрицательное действие в лог, файл маркировки этой строки удаляется |
| `POST /ready-to-ship/undo-last` | client | откат самого нового действия среди неподтверждённых контейнеров (в том числе удаления — см. "Фаза 9: доработки backend"); `404`, если откатывать нечего |
| `POST /ready-to-ship/undo-all` | client | откат всех таких действий, удаление опустевших неподтверждённых контейнеров, пересоздание слотов |
| `POST /ready-to-ship/confirm` | client | подтверждает разом все неподтверждённые контейнеры **с позициями**; если любой `> 100%` — `400` со списком (`overfilledContainers`), ничего не сохраняется |
| `POST /containers/:id/unlock` | ops | (Фаза 16) `is_locked=false` у **всех** позиций этого контейнера разом; файлы маркировки не трогает |
| `POST /container-allocations/:id/unlock` | ops | (Фаза 16) `is_locked=false` у **одной** этой позиции — остальные позиции того же контейнера остаются как были |
| `POST /container-allocations/:id/marking-file` | client | один файл на строку — повторная загрузка заменяет; только для заблокированной (подтверждённой) позиции |
| `DELETE /container-allocations/:id/marking-file` | client | `204` |
| `GET /container-allocations/:id/marking-file/download` | обе роли | client — только своё |

Все ответы `GET`/`move`/`undo-*`/`confirm` — один и тот же объект
"вид раздела", чтобы фронту хватало одного запроса на обновление экрана.
Права — как везде в проекте: owner-check в сервисе (чужое — `404`, не
`403`), клиентские `POST` помечены `@ClientWriteAllowed()` и дополнительно
проверяют роль явно (ops проходит `RolesGuard` по правилу "ops всегда можно",
но действия клиента ему недоступны — `403`).

Любое изменение `allocated_qty` существующей строки (`move` на
разблокированный контейнер, `undo-*`) удаляет её файл маркировки — количество
изменилось, старый файл неактуален. Файлы соседних строк не затрагиваются.

### Где реализация отличается от ТЗ

1. **`totalPossibleContainers` считается из `current_week_dispatch_qty /
   loadability`, а не из колонки `current_week_dispatch_load_factor`**
   (ТЗ: `ceil(Σ current_week_dispatch_load_factor)`). Причина — находка из
   "Парсинга бэкордера": load-factor колонки файла ненадёжны (это
   `Balance/Loadability`, и у 18 реальных строк они ненулевые при
   `Loadability = 0`), а заполнение контейнера везде в этой фазе считается как
   `qty / loadability` — слотов должно хватать под ту же арифметику. Формула —
   общий `sumByLoadabilityGroups`, тот же, что у `currentWeekPlanContainers`.
   Сумма округляется вверх с поправкой на float-шум: `2/2 + 33/25 + 34/50`
   даёт `3.0000000000000004` и без поправки сделало бы 4 контейнера вместо 3
   (тест на это в `compute-container-fill.spec.ts`). Если нужна именно
   колонка файла — правка в одном месте, `computeTotalPossibleContainers`.
2. **`undo-all` пересоздаёт `totalPossibleContainers − (сколько контейнеров
   осталось)` слотов**, а не ровно `totalPossibleContainers`. Без
   подтверждённых контейнеров это одно и то же; с ними иначе получилось бы
   больше слотов, чем нужно всему плану. Нумерация продолжается после
   наибольшего занятого `Контейнер N`.
3. **Перезагрузка бэкордера трогает аллокации.** `BackorderUploadsService`
   удаляет и пересоздаёт `PiLineItem` целиком, а аллокации ссылаются на них
   по id (FK) — без доработки любая загрузка бэкордера падала бы, как только
   у карточки есть аллокации. Теперь порядок такой: сохранить новые строки →
   `AllocationRelinkService.relink` переносит аллокации и лог действий на новые
   строки по `(materialNum, soNumber)` (тот же ключ, что у переноса приоритета;
   ключ, повторяющийся внутри карточки, разводится сначала по совпадению
   `(current_week_dispatch_qty, balance_to_be_delivered)` — числа сравниваются
   как числа, `"5.00"` = `"5"`, — а то, что не нашло пары, и строки с
   одинаковой подписью (взаимозаменяемы) спариваются по порядку один-к-одному;
   единственная строка ключа пары находит всегда, что бы ни изменилось в
   числах за неделю: `utils/pair-line-items.ts`) → удалить **только старые**
   строки по id. Аллокации строки, которой нет в новом снимке, удаляются вместе
   с файлом маркировки и логом. Количества не подрезаются, если новый
   `current_week_dispatch_qty` стал меньше — остаток такой строки в виде просто
   пустой (`max(0, …)`).

### Уточнения, которых не было в ТЗ

- Загрузка маркировки — только для контейнера с `is_confirmed = true`
  (черновик может поменяться, и файл тут же удалится). Разблокированный
  контейнер после правки надо подтвердить заново, прежде чем грузить файл.
- `unlock` сбрасывает `confirmed_at`/`confirmed_by`; разблокировать
  неподтверждённый контейнер — `400`.
- `confirm` без единого контейнера с позициями — `400`.
- Строка без `loadability` не может быть размещена (`400` на `move`): её вклад
  в заполнение не вычислить, и она молча пропускала бы проверку 100%.
- Аллокации карточки, которая целиком выпала из бэкордера (архивирована),
  остаются как есть; её строки при этом исчезают из списка нераспределённых и
  из `totalPossibleContainers`. Что делать с архивной отгрузкой — следующий
  этап (см. п. 10 ТЗ), здесь не решалось.
- Физически файлы маркировки с диска не удаляются (как и заменённый
  подписанный PI) — удаляется только запись `marking_files`.

### Конкурентность

Проверено вживую на Postgres, не только юнит-тестами: `move` берёт
`pessimistic_write` на строку — два параллельных `move` по 100 из остатка 150
дают одно `201` и одно `400`, аллокация не превышает остаток (двойной клик);
10 параллельных `move` по 1 в один контейнер дают одну аллокацию с корректной
суммой; 8 параллельных первых `GET` создают ровно `totalPossibleContainers`
слотов (проигравший `unique(customer_id, label)` глотается в
`ensureInitialContainers`). `confirm` сохраняет весь набор одним `save()`, то
есть одной транзакцией.

### Тесты (Фаза 8)

Все записи идут через `dataSource.transaction(em => ...)`, поэтому спеки
используют новый `makeFakeDataSource` (общий, `common/testing`) и расширенный
`makeFakeRepo`: оператор `In(...)` и разворачивание связей по id
(`relationRepos`) — сервис пишет ссылки вида `{ id }`, как и с настоящей БД.

- `ready-to-ship.service.spec.ts` — ленивое создание слотов, состав списка
  (архивные/чужие/нулевые строки), валидация `move` (дробное/0/минус/NaN, сверх
  остатка с учётом всех контейнеров, подтверждённый контейнер, без
  `loadability`, архивная строка, чужие строка/контейнер → `404`, ops → `403`),
  `undo-last`/`undo-all`, `confirm` (ровно 100% проходит, `>100%` блокирует и
  называет контейнеры, весь набор одним `save()`), `unlock`.
- `ready-to-ship.scenario.spec.ts` — весь путь из ТЗ: move → undo-last → move →
  undo-all → несколько move → confirm (блок при 140%, потом проходит) → файлы
  маркировки → unlock → move меняет количество → файл этой строки удалён, файлы
  соседей целы; плюс undo-all/undo-last после unlock.
- `marking-files.service.spec.ts`, `allocation-relink.service.spec.ts`,
  `compute-container-fill.spec.ts`; в `backorder-uploads.service.spec.ts` —
  порядок "новые строки → relink → удаление только старых".

Сверх юнит-тестов прогнан сквозной сценарий по HTTP на локальном Postgres
(53 проверки: те же шаги + RBAC + перезагрузка бэкордера с живыми
аллокациями, включая замену материала внутри открытой карточки).

### Деплой Фазы 8

Задеплоено 2026-09-18 — см. "Редеплой Фазы 8" в разделе "Продакшн-деплой
v2". Фронтенда у этой фазы нет.

## Фаза 16: частичная разблокировка контейнера (задеплоено на прод 2026-09-24, коммит `9925238`)

Ops может разблокировать **одну позицию** внутри уже подтверждённого
контейнера, не трогая остальные его позиции — раньше "заблокировано" было
булевым полем на всём контейнере целиком (`shipping_containers.is_confirmed`),
теперь это персональный признак каждой строки размещения
(`container_line_allocations.is_locked`). Прежняя разблокировка контейнера
целиком (`POST /containers/:id/unlock`) осталась рядом как более грубый
вариант — оба эндпоинта теперь просто расставляют `is_locked` на разном
уровне гранулярности.

### Перенос семантики "заблокировано" на уровень позиции

- **Миграция** `1790300000000-AddContainerLineAllocationIsLocked.ts`:
  аддитивная `is_locked boolean NOT NULL DEFAULT false` на
  `container_line_allocations`, сразу же бэкфилл `true` для всех строк, чьи
  контейнеры на момент миграции были `is_confirmed = true` — то есть новая
  модель на старте буквально идентична старой. `shipping_containers.is_confirmed`
  **намеренно не удалён** — старый код (ещё работающий в окне между накаткой
  миграции и заменой `dist`) продолжает его читать; колонка просто становится
  мёртвой после деплоя, дропнуть её можно будет отдельной чисткой позже.
- **`ShippingContainer.isConfirmed` стал вычисляемым**, а не хранимым полем —
  тот же принцип, что уже применялся к `ProformaInvoice.status` и
  `ActualContainer.arrivalStatus` ("не хранить то, что может разойтись с
  реальным состоянием"): контейнер подтверждён, только если у него есть хотя
  бы одна позиция и **все** они заблокированы; `isPartiallyUnlocked` — когда
  среди позиций смешаны заблокированные и нет. Считается в
  `ReadyToShipService.loadView` из уже загруженного списка аллокаций (лишних
  запросов не добавляет — они и так читались). `confirmedAt`/`confirmedBy` на
  контейнере остались — это метка "когда/кем в последний раз подтверждали
  что-то из этого контейнера", а не признак блокировки.
- **`move`/`remove`** проверяют блокировку на уровне позиции: `move` в уже
  существующую строку размещения смотрит на `existing.isLocked`; `move`,
  создающий новую строку в контейнере, где такой строки раньше не было,
  блокируется только если контейнер заблокирован **целиком** (частично
  разблокированный или ещё пустой контейнер принимает новую позицию).
  `remove` смотрит на `found.isLocked` напрямую.
- **`confirm`** (bulk) переосмыслен: раньше — "подтвердить все
  неподтверждённые контейнеры", теперь — "заблокировать все текущие
  незафиксированные **позиции** across всех контейнеров клиента", сгруппированные
  по контейнеру для проверки перегруза (в проверку `> 100%` идёт **весь**
  контейнер — заблокированные и незаблокированные позиции вместе, физическая
  вместимость не смотрит на статус блокировки). Один и тот же код теперь
  обслуживает и "подтвердить свежий план", и "повторно подтвердить после
  частичной разблокировки" — второй сценарий не потребовал отдельной ветки,
  просто естественно возник из смены единицы группировки с "контейнер" на
  "позиция".
- **`undoLast`/`undoAll`** пришлось передумать дважды. Первая попытка —
  искать "разблокированные позиции" и через них ограничивать выборку
  контейнеров — не работает: позиция, которую полностью убрали (`remove` на
  всё количество), удаляет саму строку `container_line_allocations`, и её
  больше нет как "разблокированной строки", хотя откатывать её всё ещё нужно.
  Рабочая версия ищет **обратное множество** — какие (контейнер, строка PI)
  сейчас **заблокированы** — и считает откатываемым любое действие, чья пара
  в этом множестве не встречается; отсутствующая строка размещения по
  построению не заблокирована. `undoAll` то же самое для отбора "какие
  контейнеры вообще можно чистить" — пустой слот на переработку годится,
  только если на контейнере вообще нет ни одной заблокированной позиции
  (частично разблокированный контейнер, даже полностью опустошённый по
  незаблокированной части, не трогается — его заблокированная часть должна
  выжить).
- **Файл маркировки** по-прежнему стирается точечно, за строку — это уже было
  устроено per-allocation (`setAllocatedQty`/`reduceAllocation`), Фаза 16 тут
  ничего не меняла, только подтвердила тестом.
- **`compute-reconciliation.ts` (Фаза 12) обновлён**: `plannedQty` теперь
  суммирует `allocation.isLocked`, не `allocation.container.isConfirmed` —
  реконсиляция «план vs факт» на карточке PI отражает точную позицию, а не
  контейнер целиком (заодно `ProformaInvoicesService` перестал грузить лишнюю
  `container`-связь для аллокаций — она была нужна только ради этой проверки).

### Новый эндпоинт

`POST /container-allocations/:id/unlock` (ops-only по умолчанию — POST без
`@ClientWriteAllowed()` уже 403-ит клиента через `RolesGuard`, без нужды в
`@Roles(Role.OPS)`, но явная проверка роли в сервисе всё равно есть, тем же
текстом ошибки, что у разблокировки контейнера) — `404`, если позиции нет,
`400`, если она уже разблокирована. Эмитит то же событие Фазы 13
`container.reopened-for-client`, что и разблокировка контейнера целиком — тот
же смысл на более мелком уровне: клиенту снова нужно посмотреть в этот
контейнер.

### Фронтенд

- `ContainerCard.tsx`: у каждой позиции — кнопка "Разблокировать эту позицию"
  (только ops, только у заблокированных строк), рядом с уже существующей
  общей кнопкой "Разблокировать" на карточке контейнера (показывается, пока
  на контейнере есть хоть одна заблокированная позиция — не только когда он
  подтверждён целиком). Заголовок контейнера — теперь три состояния, не два:
  "Подтверждён" (зелёный) / "Частично разблокирован" (жёлтый, переиспользует
  уже существующий `AMBER_BADGE`) / "Черновик". Кнопка "Убрать" и показ блока
  маркировки у client — по `allocation.isLocked` конкретной строки, не по
  контейнеру целиком: клиент видит и правит именно те позиции, что
  разблокированы, соседние строки того же контейнера остаются read-only.
- `MoveDialog.tsx` не потребовал изменений: список контейнеров-целей уже
  фильтровался по `container.isConfirmed`, и с новым (вычисляемым) значением
  этого поля логика осталась верной без правок — частично разблокированный
  контейнер снаружи выглядит как обычный "ещё доступный", просто с частью
  строк уже занятых. Не покрыто: если у конкретной строки уже есть
  заблокированная позиция именно в выбранном контейнере, диалог этого не
  знает заранее и просто покажет ошибку с бэкенда после клика — принятое
  упрощение, редкий кейс.
- Новый хук `useUnlockAllocationMutation` в `api/readyToShip.ts`, рядом с
  `useUnlockContainerMutation`. Тексты — новые ключи
  `readyToShip.card.partiallyUnlocked`/`unlockLine` и блок
  `readyToShip.unlockLine.*` в `en.json`/`ru.json`.

### Тесты

353 теста всего (было 344, +9 новых в `ready-to-ship.service.spec.ts`,
`describe("unlockAllocation (Phase 16...")`): разблокировка одной позиции не
трогает соседние (их `isLocked` остаётся `true`), контейнер после этого
читается как `isPartiallyUnlocked`, `move`/`remove` работают на
разблокированной строке и `400`-ят на заблокированной, `confirm` возвращает
разблокированную позицию обратно в `locked` вместе с прочими черновиками,
смена количества стирает файл маркировки только у изменённой строки, `404`
на неизвестной позиции и `400` на уже разблокированной, ops-only, тот же
ивент Фазы 13. Остальные существующие тесты `ready-to-ship`/
`marking-files`/`allocation-relink`/`compute-reconciliation`/
`proforma-invoices` — адаптированы под новую модель (seed `isLocked` на
аллокации вместо `isConfirmed` на контейнере) и продолжают проходить как
прежде, включая `ready-to-ship.scenario.spec.ts`, которому не потребовалось
ни одной правки — он читает только вид (`view.containers[i].isConfirmed`),
не сырые строки.

Заодно нашли и поправили баг в самом тестовом `common/testing/fake-repo.ts`:
`repo.create()` там — простой `{...data}`, он не применяет `@Column({default})`
из entity (в отличие от настоящего TypeORM); `move()`, создающий новую
аллокацию, полагался на дефолт `is_locked = false` из декоратора и не задавал
его явно — в проде это сработало бы штатно (TypeORM/Postgres подставили бы
дефолт), а в тестах создавало строки без `isLocked` вовсе (`undefined`), из-за
чего они не находились в выборках `where: { isLocked: false }`. Тот же приём,
что уже был осознанно выбран для `ShippingContainer.isConfirmed` в
`createEmptyContainers` (там дефолт всегда прописывался явно) — теперь и
`move()`, и `restoreRemoved()` делают то же самое для `isLocked`.

### Живая проверка

Локально: полный юнит-набор (353/353), `tsc`/`eslint --fix`/`oxlint`/`vite
build` чисто, 335/335 (плюс 2 существующих `_few`/`_many` варианта
множественного числа) совпадение ключей `en.json`/`ru.json`. Сквозь реальный
запущенный бэкенд (не юнит-моки): создана вручную (напрямую в локальной
Postgres — обычная разблокировка через `getView()` на этой машине упирается в
уже известное ограничение локальной БД в WIN1252, не хранящей кириллические
лейблы контейнеров, см. предыдущие фазы) тестовая позиция, помеченная
заблокированной; дальше — только через настоящие HTTP-эндпоинты:
`POST /container-allocations/:id/unlock` от client — `403`; от ops — `201` с
правильным телом ответа; повторный вызов на ту же позицию — `400` с нужным
текстом; `POST /ready-to-ship/remove` на теперь разблокированную позицию —
запись в БД реально изменилась (6 → 5 шт., `is_locked` осталась `false`);
`remove` на соседнюю **оставшуюся заблокированной** позицию того же
контейнера — `400` с текстом «позиция заблокирована…», её количество не
изменилось (проверено прямым SELECT). Тестовые строки удалены после
проверки.

## Выгрузка в Excel "Готово к отгрузке" (после Фазы 11, задеплоено на прод 2026-09-21)

`GET /ready-to-ship/export-xlsx` — обе роли; client получает свой список, ops
обязан указать `?customerId=` (как и для `GET /ready-to-ship`: без него `400`,
не-UUID — `400`, без токена — `401`). Строится из того же вида, что показывает экран
(`ReadyToShipService.getView` → `buildReadyToShipExportWorkbook`), поэтому скоуп
и числа совпадают с экраном. Имя файла — `ReadyToShip_{YYYY-MM-DD}.xlsx`.

Один лист `Ready to ship`, шапка в первой строке (закреплена, есть автофильтр),
плоский список:
`Контейнер | SKU | Описание | Количество | Load Factor | Проформа (PI) | SO`.

- **По строке на каждое размещение** (`ContainerLineAllocation`, включая ещё
  неподтверждённые контейнеры): Контейнер — число N из метки `Контейнер N`
  (числом, чтобы Excel сортировал 2 раньше 10; другая метка выводится как есть),
  Количество = `allocated_qty`, Load Factor = `allocated_qty / loadability`, до 4 знаков.
- **По строке на каждую позицию с нераспределённым остатком > 0**: Контейнер =
  `OK to mix`, Количество = остаток, Load Factor = остаток / loadability. Позиция без
  loadability (её нельзя разместить) тоже попадает сюда, Load Factor — пустая ячейка
  (не текст, чтобы не ломать суммы).
- **Порядок:** сначала строки с номером контейнера по возрастанию номера (внутри
  контейнера — по PI, затем SKU), потом контейнеры с нечисловой меткой, `OK to mix`
  в конце. Строка = материал одной позиции бэкордера, поэтому одна и та же позиция
  может встретиться и в контейнере, и в `OK to mix` (размещённая часть и остаток).

Проверено: 122 юнит-теста раздела (порядок, округление, пустой Load Factor, скоуп,
ops без клиента) и живой прогон на реальном файле в локальной БД: 4 размещения +
231 строка `OK to mix`, номера в порядке `1, 2, 3, 10`, Σ «Количество» = 2845 =
Σ плановой отгрузки по позициям, у ops и client файлы идентичны.

**Деплой (2026-09-21, коммит `1e08862`).** Только backend (без миграции; `migration:show`:
все 5 применены) и фронтенд. Побайтовая сверка `.js`: отличаются ровно
`ready-to-ship/ready-to-ship.controller.js` и `ready-to-ship.service.js`, плюс новый
`ready-to-ship/utils/build-ready-to-ship-export-workbook.js`. Backend — `dist.new` рядом
→ `stop` → `mv dist dist.bak-20260921-export` → `mv dist.new dist` → `start` (поднялся
за ~1 с, маршрут `/ready-to-ship/export-xlsx` в журнале). Фронтенд — сборка с
`VITE_API_URL=/api`, `.prev` сохранён как `.prev-before-export`, `nginx -t` → `reload`.
Проверено на проде (временные `phase14-verify-*`, удалены — `401` на повторный
логин; отпечаток БД до и после совпал): `GET /proforma-invoices` 200 (28 карточек),
`/actual-containers` 200 (77), без токена — `401`, порт 3000 снаружи закрыт, журнал без
ошибок. Экспорт на реальных данных (40 нужно, 47 слотов, 8 размещений клиента в
Контейнере 1, 224 позиции с остатком): файл `ReadyToShip_2026-09-21.xlsx` 16 КБ, одна
вкладка, семь заголовков, 8 строк контейнера + 224 строки `OK to mix` (= размещения +
позиции с остатком), номера по возрастанию, Load Factor до 4 знаков, Σ Количество = Σ
размещённого + Σ остатка = 2845; у ops с `customerId` тот же файл, без — `400`, не-UUID —
`400`; клиент с чужим `customerId` получает `404`.

Frontend: кнопка "Выгрузить в Excel" в шапке страницы "Готово к отгрузке" (обе роли,
ops передаёт выбранного клиента); при ошибке тост показывает текст ответа API —
для этого `downloadFile`/`openFile` теперь разбирают JSON-тело неуспешного ответа
(раньше на любой сбой было общее "Не удалось скачать файл").

## Фаза 9: доработки backend под фронтенд "Готово к отгрузке"

Сам фронтенд — в [frontend/README.md](frontend/README.md). Под него на backend
добавлено (задеплоено на прод 2026-09-19, миграций нет — см. "Редеплой Фазы 9"):

### `POST /ready-to-ship/remove` — "убрать позицию из контейнера"

В ТЗ фронтенда была кнопка "убрать позицию", а на backend такого действия не
было: `move` принимает только `qty ≥ 1`, `undo-*` откатывают лог. Добавлен
`POST /ready-to-ship/remove {allocationId, qty}` (client-only, owner-check → `404`
для чужого, ops → `403`): `1 ≤ qty ≤ allocated_qty` (иначе `400`), контейнер не
подтверждён (иначе `400`), целые штуки. Строка аллокации под `pessimistic_write`
на время проверки (два быстрых клика не уберут больше, чем есть); `qty` =
всё → аллокация удаляется; любое изменение количества, как всегда, удаляет файл
маркировки этой строки. Возвращает тот же "вид раздела", что и остальные.

**Действие пишется в лог с отрицательным `delta_qty`**, поэтому "Отменить одно
действие" откатывает и удаление, а инвариант "действия контейнера в сумме дают
его аллокации" сохраняется (`undo-all` считает нетто по каждой паре
контейнер+строка). `undo-last` отрицательного действия возвращает количество
(создаёт аллокацию заново, если строку убрали целиком) — с проверкой остатка:
строго LIFO это всегда помещается, но `confirm` может заморозить более позднее
размещение тех же единиц в другом контейнере, пока удаление всё ещё самое новое
из откатываемых, — тогда `400` "нельзя отменить удаление: … уже размещены в
другом контейнере", и ничего не меняется.

### `undoableActions` в виде раздела

Число записей лога, которые ещё можно откатить (контейнеры не подтверждены).
Нужно фронтенду, чтобы панель "Отменить/Подтвердить" была видна, пока есть что
откатывать: если клиент убрал вообще всё, контейнеры выглядят пустыми, но
отмена удаления должна оставаться доступной.

### Число сетевых запросов на действие

Живой тест на копии реальных данных (ветка Neon) показал, что каждое действие
занимает секунды: с VPS до Neon (us-east-2) **106 мс на запрос**, а одно
перемещение делало ~21 последовательный запрос (≈2,2 с на проде, 3,3 с с
машины разработчика при 155 мс). Сделано, без изменения поведения:

- `loadView` читает независимое параллельно (активные строки ∥ контейнеры, затем
  аллокации ∥ счётчик отмен) — вне транзакции это настоящий параллелизм пула;
  досоздание слотов больше не открывает транзакцию на каждом чтении, только когда
  слота реально не хватает;
- внутри транзакции `move` один запрос аллокаций строки вместо двух;
  `setAllocatedQty` — `update()` вместо `save()` (тот перечитывал строку);
- `extra.idleTimeoutMillis = 300000` для пула: `pg` по умолчанию закрывает
  простаивающее соединение через 10 с, а новое до Neon стоит 1–1,5 с (TLS +
  аутентификация через океан) — то есть любая пауза дольше 10 с между кликами
  добавляла это к следующему действию.

Замер на ветке (155 мс): `GET` тёплый 1,3 → 0,4–0,5 с; `move` 3,3 → 2,2–2,8 с;
`remove` 2,7 → 1,9 с; `undo-all` 4,6 → 2,3 с; первый запрос после паузы 15–30
с 1,9 → 0,95 с. На проде (106 мс) соответственно меньше. Оставшееся — по сути
число запросов внутри транзакции (BEGIN, чтение строки/контейнера, блокировка,
запись, запись лога, COMMIT); дальше уменьшать можно только оптимистичным
обновлением на фронте или рефакторингом чтения в один SQL.

Тесты: 190 юнит-тестов (было 173) — `remove` (частично/целиком, файл маркировки,
блокировка строки, валидация, подтверждённый контейнер, чужое/ops), откат
удаления (частичного и полного) и его отказ при уже размещённом в другом
контейнере, `undo-all` с нетто-логом, `undoableActions`; `makeFakeRepo` получил
`count`.

## Фаза 10: фактические отгрузки из файла бэкордера

Спецификация — `TZ_v2_addendum_actual_containers.md`. Это **не** связано с
`ShippingContainer` из "Готово к отгрузке" (там черновой план клиента, здесь —
то, что CEAT уже реально отгрузил, по его собственной системе). Только backend;
экран "Готовые контейнеры" (раздел 5 ТЗ) и поле "Отправлено" на карточке PI на
фронтенде **не сделаны** — не входили в этот заход (это Фаза 11). Задеплоено на
прод 2026-09-21 — см. "Редеплой Фазы 10"; миграция
`AddActualContainers1789823053358` (аддитивная: 4 новые таблицы и одна колонка
с `DEFAULT 0`, прежний релиз с ней совместим).

### Что делает `POST /backorder-uploads` теперь

Один файл — **одна транзакция**: либо ложится всё, либо ничего. (Раньше
транзакции не было вовсе: каждый шаг писался отдельно, ошибка посередине
оставляла половину загрузки. `AllocationRelinkService.relink` получил
необязательный `EntityManager`, чтобы работать внутри общей транзакции — новые
строки PI, на которые он переставляет аллокации, снаружи ещё не видны.) Сырая
копия файла (`StoredFile`) по-прежнему пишется до транзакции и остаётся даже
при откате — это след "что прислали", а не часть состояния.

1. **`BackorderUploadSnapshot`** — сырые строки **всех** листов (включая
   `Summary` и оба BO), по строке на запись: `sheet_name`, `sheet_index`,
   `row_index` (номер строки в Excel), `raw_row_data` (`jsonb`, ячейки по
   колонкам; дата хранится как `{"$date": ISO}`, формула — как её значение).
   Только `INSERT`, никогда не обновляется и не удаляется. Реальный файл — 1219
   строк на загрузку (~0,5 МБ). `GET /backorder-uploads/:id/snapshot-export`
   (ops) собирает из них xlsx: те же листы в том же порядке, каждая ячейка на
   своём месте (формулы — значением, оформление не хранится).
2. **`ETD-ETA`** → upsert `ActualContainer` по `container_number`: создаётся при
   первой встрече, при повторной перезаписываются `port`, `vessel_name`,
   `source_etd/eta`, `preshipment_invoice`, `commercial_invoice_number`;
   `override_etd/eta` **не трогаются** никогда (только `PATCH .../dates` и
   `reset-dates`). `last_seen_in_upload_id` двигается у каждого контейнера,
   названного любым из листов, одним `UPDATE` на всех.
3. **`ETA-15 days`** → `bl_number`, `currency`, `invoice_value`,
   `documents_release_status`, `telex_release_date`, `payment_receipt_status` у
   совпавших по номеру контейнеров; контейнеры, не попавшие в выборку этой
   недели, сохраняют прежние значения (не обнуляются). Строка с неизвестным
   контейнером пропускается и считается в ответе (`eta15Unmatched`).
4. **`Radial Dispatch` + `Bias Dispatch`** → для каждого `Container ID` полная
   замена его `ActualContainerLineItem`. Оба листа склеиваются **до** замены:
   в реальном файле 33 контейнера разбиты между Radial и Bias, замена
   "по листам" стёрла бы первую половину второй. Контейнеры, которых в файле нет,
   остаются как были (история). Повторяющиеся строки (одинаковый контейнер/PI/
   материал/инвойс) сохраняются как есть — их в реальном файле две пары, у
   одной количество разное (3 и 22) — это данные CEAT, не дедуплицируются.
5. **`ProformaInvoice.shippedQty`** (новая колонка, `numeric(14,2) NOT NULL
   DEFAULT 0`) = Σ `Quantity` по **всем** `ActualContainerLineItem` с тем же
   `pi_number`, полный пересчёт с нуля при каждой загрузке (Dispatch кумулятивен,
   инкремент задвоил бы), включая архивные карточки; пишутся только изменившиеся.
   Виден в `GET /proforma-invoices` и `/:id` для обеих ролей (это обычная
   колонка сущности). Строки с `pi_number`, у которого нет карточки, остаются
   историей контейнера и ни в чьей сумме не участвуют.

В ответ `POST /backorder-uploads` добавлено `snapshotRows` и объект
`actualContainers` (`containersCreated/Updated`, `containersWithoutTransportData`,
`eta15Updated/Unmatched`, `containersReplaced`, `dispatchLinesStored`,
`dispatchRowsSkipped`, `cardsShippedQtyChanged`). Файл без этих листов (как
старые тесты) оставляет контейнеры и строки нетронутыми.

### Особенности реального файла, которые парсер обязан переваривать

Проверено на `MTK_ROSBERG_INR.xlsx` (7 листов): 77 контейнеров, 602 строки
Dispatch (Σ 8004 шт., 35 разных PI, из них 23 — карточки из BO), 6 строк
`ETA-15`.

- Идентификаторы лежат **числами** (`Quotation Number`, `Material Number`,
  `Invoice Number`, `Preshipment Invoice`, `Commercial Invoice number`): выводятся
  как текст без `.0`.
- Литеральный **`0` = "нет"**: `Preshipment Invoice` = 0 у 40 контейнеров из 77,
  `Vessel Name` = 0 у 11 → `NULL`, а не строка "0".
- Пустая дата = **`1899-12-30`** (ячейка с датой, в которой лежит 0): `ETA` пуст у
  50 контейнеров из 77, `Telex release date`/`Payment Receipt Status` — у всех
  шести → `NULL`. Любая дата до 1900 читается как "нет даты".
- `Documents Release` = число `0` → хранится как текст `"0"` (что оно значит —
  из файла не понять, оставлено как есть).
- Заголовки с хвостовыми пробелами (`Customer code   `), `B/L No.` со
  хвостовыми пробелами в значении — обрезаются; номер контейнера приводится к
  верхнему регистру без пробелов. Строка заголовка ищется в первых 5 строках
  листа (как у BO).
- **ETD/ETA из `ETA-15 days` как запасной источник (решение пользователя,
  2026-09-21).** У шести контейнеров, попавших в `ETA-15 days`, в листе `ETD-ETA` ETA
  пуст (1899), а в `ETA-15 days` стоит `2026-09-20` — а это как раз ближайшие к
  приходу контейнеры. Поэтому `source_etd`/`source_eta` = дата из `ETD-ETA` →
  иначе дата из строки этого контейнера в `ETA-15 days` → иначе то, что уже было
  сохранено раньше (дата, которую в новом файле нигде нет, не стирает известную) →
  иначе `NULL` (экраны показывают прочерк). Для контейнера, которого в `ETD-ETA`
  этой недели нет, но который есть в `ETA-15`, заполняются только ещё пустые даты.
  Ручные `override_*` по-прежнему не трогаются. На реальном файле: ETA известна у 33
  контейнеров из 77 (было 27), у остальных 44 нигде нет — прочерк.

### Решения там, где ТЗ молчит

- `customer_id` контейнера: сначала по коду клиента из файла
  (`Customer code` / `Sold to Party Code` = `customers.customer_code`), иначе
  первый клиент — тот же приём, что для новых карточек PI (пилот с одним
  клиентом; при втором клиенте надо будет выбирать явно).
- Контейнер, у которого есть строки Dispatch, но нет строки в `ETD-ETA` ни сейчас,
  ни раньше: создаётся "голым" (без порта/судна/дат) и считается в
  `containersWithoutTransportData` — за ним реальные отгруженные количества.
- Добавлены поля, которых нет в схеме ТЗ: `sheet_index` (порядок листов в
  выгрузке) в снапшоте, `file_name` в `ActualContainerFile` (показывать имя без
  обращения к `stored_files`).
- `PATCH .../dates`: `{ overrideEtd?, overrideEta? }` — дата `YYYY-MM-DD`
  (календарная, `2026-02-30` → `400`) ставит override, `null` снимает только его,
  отсутствие поля — не трогает; пустое тело — `400`. `reset-dates` обнуляет оба.
- Ответы контейнера содержат вычисляемые `etd`/`eta` (override, иначе файл) и
  `isEtdOverridden`/`isEtaOverridden`; `source_*` и `override_*` тоже отдаются.
  Список — новейший эффективный ETD первым, без пагинации (пилотный масштаб).
- Файл контейнера удаляется только как строка `ActualContainerFile`; сам файл на
  диске и `stored_files` остаются (как у файлов маркировки).

### Имена файлов не на латинице (исправлено при живом тесте Фазы 11, не задеплоено)

`multer` (через `busboy`) читает байты имени файла в multipart как latin1, а браузер
шлёт их в UTF-8, поэтому `упаковочный лист.pdf` приходил как `Ð¿Ð°Ð...` — это
касалось **всех** загрузок (PI, файлы маркировки, файлы контейнеров) и портило имя в
`stored_files.original_name` и при скачивании; в БД с не-UTF-8 кодировкой запись
вообще падала (`Internal server error`). `FilesService.save` теперь возвращает имя
через `decodeMultipartFilename` (`src/common/utils/decode-multipart-filename.ts`):
mojibake перекодируется обратно, ASCII, уже верное имя и имя с невалидным UTF-8 не
трогаются. Уже сохранённые на проде имена не пересчитываются. Юнит-тестов теперь 249.

### Проверено

- **Юнит-тесты: 244** (было 190): парсер листов на синтетическом xlsx в форме
  реального файла (числа-идентификаторы, 0, дата 1899, split Radial/Bias, шапка
  не в первой строке), архив листов туда-обратно, полный цикл загрузки на fake-репо
  (создание и upsert, override переживает загрузку, замена строк только у
  названных контейнеров, `shipped_qty` при нескольких контейнерах на один PI, при
  повторной загрузке не задваивается, при уменьшении файла падает; история
  выпавшего контейнера учитывается), скоуп по клиенту, даты, файлы, валидация DTO.
- **Живой прогон на реальном файле, локально (Postgres 18, не прод):** первая
  загрузка — 77 контейнеров, 602 строки, 1219 строк снапшота, `shipped_qty` каждой
  из 26 карточек совпал с независимым расчётом прямо из xlsx; повторная загрузка
  того же файла ничего не задваивает (строки и суммы те же, снапшоты копятся,
  отпечаток `pi_line_items` совпал); override дат переживает загрузку, `reset` и
  `null` работают; клиент видит свои 77, чужой клиент — 0/`404`, скачивание
  файла чужим — `404`; выгрузка снапшота — все 16401 непустых ячеек совпали с
  исходником; принудительный сбой посреди загрузки (CHECK на строках Dispatch) →
  откат **всего**: ни строки загрузки, ни снапшота, ни контейнеров, `pi_line_items`
  не изменились. `migration:revert` и повторный `run` — чисто.
- **Живой прогон на копии прода (ветка Neon, 2026-09-19):** ветка — копия прод-БД
  (28 карточек, из них 2 архивных, 538 строк, 5 прежних загрузок), миграция
  применена на ней, локальный backend на :3100 (прод не трогался). Реальный файл:
  77 контейнеров, 602 строки, 1219 строк архива, `shipped_qty` у 25 из 28 карточек
  совпал с независимым расчётом из xlsx (6414 из 8004 шт. Dispatch приходятся на
  PI, у которых здесь есть карточка, остальное — история чужих PI). Все проверки
  из локального прогона (кроме принудительного отката, он делается только на
  локальной БД) прошли и здесь: идемпотентность, override дат, файлы, скоуп,
  выгрузка архива (16401 ячейка).
- **Время загрузки** (с dev-машины, 155 мс до Neon; с VPS — 106 мс): новый код —
  36–42 с; **прежний код на тех же данных — 58 с** (одна транзакция вместо
  отдельной на каждую карточку и отдельных коммитов быстрее, несмотря на новые
  листы). `nginx` проксирует с `proxy_read_timeout` по умолчанию (60 с): на VPS
  ожидается ~25–30 с, но запас невелик — если файл заметно вырастет, понадобится
  либо поднять `proxy_read_timeout` для `/api/backorder-uploads`, либо сократить
  число запросов в цикле по карточкам (сейчас ~9 запросов на карточку).

## Авторизация

Не изменилось с v1 — три глобальных механизма, подключённых один раз в
`AppModule`:

1. **`JwtAuthGuard`** (`APP_GUARD`) — проверяет JWT, кладёт `{ id, email,
   role, customerId }` в `request.user`. Пропускает `@Public()`
   (`POST /auth/login`).
2. **`RolesGuard`** (`APP_GUARD`) — `ops` всегда разрешено; `client` — 403
   на контроллерах с `@Roles(Role.OPS)`, 403 на любом методе кроме `GET`,
   если не `@ClientWriteAllowed()` (в Фазе 1 таких методов ещё нет —
   `ProformaInvoicesController` целиком read-only).
3. **`CustomerScopeInterceptor`** (`APP_INTERCEPTOR`) — на контроллерах с
   `@ScopeByCustomer('путь.до.customer.id')` фильтрует ответ для `client`
   по `customer_id` из токена. `ProformaInvoicesController` помечен
   `@ScopeByCustomer('customer.id')` — прямой путь, никакого
   `EXISTS`-подзапроса больше не нужно (в v1 он требовался только из-за
   `Container`, у которого не было прямого `customer_id`; `Container`
   снесён, `common/utils/customer-scope-sql.ts` снесён вместе с ним).

### Матрица доступа (Фаза 3)

| Сущность / действие | ops | client |
|---|---|---|
| Customer | всё | read-only, только свой (`id === customerId`) |
| `GET /proforma-invoices`, `GET /:id` | всё | read-only, только свои (`customer.id`) |
| `POST /proforma-invoices/upload-pi` | да | 403 |
| `POST /:id/upload-signed` | да | да, только свой PI (проверка владения в сервисе) |
| `POST /:id/additional-files` | да, любой PI | да, только свой PI |
| `POST /:id/propose-replacement` | да | 403 |
| `POST /:id/replacement-decision` | да | да, только свой PI (проверка владения в сервисе) |
| `GET /files/:id/download` | всё | только файлы, на которые ссылается PI своего `customer_id` |
| `GET /backorder-uploads`, `POST /backorder-uploads` | да | 403 (`@Roles(Role.OPS)` на весь контроллер — внутренние данные планирования завода) |
| `GET /proforma-invoices/:id/export-xlsx` | да, любой PI | да, только свой PI (owner-check в сервисе, `404` иначе) |
| `GET /backorder-uploads/:id/snapshot-export` | да | 403 (тот же ops-only контроллер) |
| `GET /actual-containers`, `GET /actual-containers/:id` | всё | только свой `customer_id` (скоуп в сервисе, чужой id — `404`) |
| `PATCH /actual-containers/:id/dates`, `POST /:id/reset-dates`, `POST /:id/files`, `DELETE /actual-container-files/:id` | да | 403 |
| `GET /actual-container-files/:id/download` | да | да, только файлы контейнеров своего `customer_id` (`404` иначе) |
| `GET /backorder/export-xlsx` | да, весь бэкордер | да, только строки своего `customer_id` (скоуп в сервисе) |
| `PATCH /pi-line-items/:id/priority` | 403 (явная проверка роли в сервисе — см. "Приоритизация позиций") | да, только своя позиция (owner-check в сервисе, `404` иначе) |
| `PATCH /proforma-invoices/:id/reset-priority` | 403 (та же явная проверка роли) | да, только свой PI (owner-check в сервисе, `404` иначе) |
| `PATCH /proforma-invoices/:id/label` | 403 (та же явная проверка роли) | да, только свой PI и только до подписания (`400` после; `404` для чужого) |

### Важное изменение: `User` теперь исключает `passwordHash` из сериализации

`ProformaInvoice` — первая сущность в проекте, которая вкладывает `User` в
свой собственный API-ответ (`piFileUploadedBy`, `signedFileUploadedBy`,
`pendingReplacementProposedBy`). Раньше `User` никогда не попадал в
сериализуемый через `ClassSerializerInterceptor` ответ, поэтому отсутствие
`@Exclude()` на `passwordHash` было безопасно случайно. Добавлен
`@Exclude({ toPlainOnly: true })` на `User.passwordHash` — без него bcrypt-хэш
пароля утекал бы в JSON `GET /proforma-invoices/:id`.

### Login / создание пользователей

Не изменилось:

```
POST /auth/login
{ "email": "<ops-email>", "password": "..." }
→ { "accessToken": "eyJhbGciOi..." }
```

```bash
npm run seed:user -- --email=<ops-email> --password=change-me --role=ops
npm run seed:user -- --email=<client-email> --password=change-me --role=client --customerId=<customer-uuid>
```

## Пересборка схемы (v2, чистый rebuild — не миграция данных)

Единственная стартовая миграция в репозитории — `1788010000000-InitSchema.ts`
— это **полный `up`**, не diff поверх v1. Она **не может** быть просто
прогнана поверх БД, где уже стоят таблицы v1 (конфликт имён/типов). Перед
первым запуском на существующей v1-базе:

```sql
-- Осторожно: необратимо удаляет все данные v1. Только для пилотной БД,
-- где явно решено не переносить старые данные.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

затем `npm run migration:run` создаст схему v2 с нуля. На **новой** (пустой)
БД тот же `migration:run` — единственный нужный шаг. Прод и dev делят одну
и ту же Neon-БД (см. "Продакшн-деплой v2" ниже) — этот шаг уже выполнен там
же, в Фазе 1.

## Продакшн-деплой v2

Прод (`<server-ip>`, тот же Contabo VPS, что и в v1) переведён на v2.
Три вещи, закрытые непосредственно перед этим деплоем:

> **Важно: фронтенд на проде не обновляется автоматически.** После этого
> первого деплоя фронтенд-фичи (например, строка "Всего" — см. frontend
> README) продолжали разрабатываться локально, но на прод не
> перевыкладывались, пока их отдельно не попросили проверить там же — то
> есть между "готово и проверено на localhost" и "видно на
> `<server-ip>`" **не было автоматической связи**. Если фича должна
> быть видна на проде — её нужно явно передеплоить (см. "Сам деплой" ниже),
> просто `npm run build` локально недостаточно.
>
> Отдельная накладка при первом таком повторном деплое фронтенда: билд,
> который до этого гонялся для локальной проверки в браузере, использует
> `frontend/.env` (`VITE_API_URL=http://localhost:3000`) — если задеплоить
> именно этот `dist/` на прод как есть, фронтенд на `<server-ip>`
> продолжит слать запросы на `localhost:3000` **из браузера пользователя**,
> что там ничего не резолвит, и залогиниться станет невозможно. Перед
> **любым** деплоем фронтенда на прод обязательно пересобрать с
> `VITE_API_URL=/api` (временный `.env.production.local`, см. "Сам деплой"),
> даже если локально уже есть свежий `dist/` — доверять существующему
> `dist/` без проверки, каким `VITE_API_URL` он собран, нельзя.

### 1. Смена паролей `<ops-email>` / `<client-email>`

Оба пароля заменены на случайные 20-символьные строки (bcrypt-хэш через
существующий `bcryptjs`, тем же способом, что и `seed:user`, только `UPDATE`
вместо `INSERT` — прямого "update password" скрипта в репозитории нет,
использован одноразовый временный скрипт, удалённый сразу после). Новые
пароли сообщены пользователю отдельно в чате, не сохранены ни в этом файле,
ни в логах, ни в каком-либо файле репозитория.

### 2. HTTPS — осознанно отложен

Спросил про домен (свой у CEAT или временный `nip.io`-поддомен) — решено
пока оставить как есть, плоский HTTP, домена нет. `certbot`/Let's Encrypt не
настроен. Значит: логин и все запросы всё ещё идут открытым текстом по
публичному IP — тот же компромисс, что был явно принят при первом v1-деплое
(см. decision log в памяти проекта), теперь по факту продлён на v2.
Возвращаться к этому вопросу нужно, если/когда появится домен.

### 3. `nginx` как reverse proxy, порт 3000 закрыт наружу

Раньше: nginx отдавал только статику фронтенда, порт 3000 (сырой Node/Nest)
был открыт наружу в `ufw` напрямую — фронтенд ходил в API по
`http://<server-ip>:3000`. Теперь:

```nginx
server {
    listen 80 default_server;
    server_name _;
    root /var/www/ceat-frontend;
    index index.html;

    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`proxy_pass http://localhost:3000/` с завершающим слэшем (при location
`/api/`, тоже с слэшем) — стандартный приём nginx для **вырезания**
префикса: запрос `/api/proforma-invoices` на бэкенд уходит как
`/proforma-invoices` — ровно то, что ожидают реальные Nest-маршруты (в
приложении нет `app.setGlobalPrefix()`, все контроллеры объявлены без
`/api`). `ufw delete allow 3000/tcp` (и v6-версия) — порт 3000 закрыт для
внешних подключений; nginx достаёт бэкенд по `localhost`, что `ufw` не
трогает.

Фронтенд собран заново с `VITE_API_URL=/api` (относительный путь — фронтенд
и API теперь на одном origin, `http://<server-ip>/`, так что запросы
`fetch('/api/...')` идут без CORS-preflight вообще; `CORS_ORIGIN` в
бэкендовском `.env` всё равно обновлён на `http://<server-ip>` для
консистентности, а не по необходимости).

### Сам деплой

1. Локально: `npm run build` (бэкенд) → `dist/`; фронтенд —
   `VITE_API_URL=/api` во временном `frontend/.env.production.local`,
   `npm run build`, файл сразу удалён (тот же приём, что и в v1 — иначе
   каждый последующий локальный `npm run build` фронтенда молча целился бы
   в прод).
2. На сервере: бэкап текущих `dist/`, `package.json`, `package-lock.json`,
   `/var/www/ceat-frontend`, `/etc/nginx/sites-available/ceat-frontend` (с
   суффиксом `.v1.bak`, не удалены — на случай отката).
3. `systemctl stop ceat-backend` → распаковка нового `dist`/`package*.json`
   → `npm ci --omit=dev` от имени `ceatapp` → правка `.env` (снесены
   `EMAIL_*`/`DEMURRAGE_CHECK_CRON`/`PAYMENT_REMINDER_*` — в v2 их никто не
   читает, `NotificationsModule` снесён ещё в Фазе 1; `CORS_ORIGIN`
   обновлён; `DB_*`/`JWT_SECRET`/`UPLOAD_DIR` не тронуты) →
   `systemctl start ceat-backend`.
4. Миграции — уже применены к этой же Neon-БД в Фазе 1 (`migration:show` на
   сервере подтвердил: обе миграции отмечены выполненными, `migration:run`
   не требовался).
5. Новый статический билд фронтенда — на место `/var/www/ceat-frontend`.
6. Новый `nginx`-конфиг (см. выше) → `nginx -t` → `systemctl reload nginx`.
7. `ufw delete allow 3000/tcp` (+ v6).

### Проверено публично (curl с локальной машины на `<server-ip>`, не по SSH)

- `curl http://<server-ip>:3000/...` — соединение отклонено (порт закрыт).
- `GET http://<server-ip>/` — `200`, отдаёт новый v2-фронтенд.
- `GET http://<server-ip>/api/proforma-invoices` без токена — `401`.
- `POST http://<server-ip>/api/auth/login` новым паролем — `200`,
  реальный `accessToken`; тем же токеном `GET .../api/proforma-invoices` —
  все 23 реальные карточки пилота, корректно вычисленный `status`.
- Логин `<client-email>` новым паролем — `200`.
- HTTPS-редирект не проверялся — HTTPS не настроен (см. "2." выше).

### Редеплой Фазы 5 (экспорт в Excel)

И бэкенд, и фронтенд обновлены на проде тем же процессом (см. "Сам деплой"
выше): бэкенд — `npm run build` → tar → SFTP → `systemctl stop` → замена
`dist`/`package.json`/`package-lock.json` (старые сохранены с суффиксом
`.bak-20260903-phase5`, не `.v1.bak` — тот зарезервирован под самую первую
миграцию v1→v2) → `npm ci --omit=dev` от имени `ceatapp` (**нюанс**: `su -
ceatapp -c '...'` не работает — у `ceatapp` шелл `/usr/sbin/nologin`
специально, чтобы через него нельзя было залогиниться; сработал `sudo -u
ceatapp bash -c '...'`, который не консультирует `/etc/passwd`-шелл для
неинтерактивного запуска команды) → `systemctl start`. Фронтенд — пересборка
с `VITE_API_URL=/api` (временный `.env.production.local`, удалён сразу после
билда, как и раньше) → старый `/var/www/ceat-frontend` переименован в
`.prev` (тот же приём, что уже использовался при редеплое "Всего"-строки) →
новый билд на его место → `nginx -t` → `reload`.

Проверено публично, не по SSH: `GET http://<server-ip>/` — `200`, новый
билд; `grep` по задеплоенному JS-бандлу на сервере подтвердил обе новые
строки кнопок ("Скачать Excel", "Выгрузить весь бэкордер") присутствуют и
`localhost:3000` нигде не осталось; `GET .../api/api/docs-json` (Swagger
JSON через nginx-прокси) содержит оба новых пути
(`/proforma-invoices/{id}/export-xlsx`, `/backorder/export-xlsx`);
`journalctl` на сервере подтвердил, что Nest замапил оба новых роута при
старте. Полный поведенческий прогон (реальный логин + реальное скачивание
файла) на самом проде **не делался** в рамках этой правки — текущий
`ops`-пароль на проде (заменён отдельно на этапе безопасности, см. выше) не
хранится ни в памяти агента между сессиями, ни в этом репозитории; структурная
проверка (роуты замаплены, бандл содержит новый код, порт 3000 по-прежнему
закрыт наружу) сочтена достаточной, полное поведенческое покрытие уже
сделано на dev-сервере (см. "Экспорт в Excel" выше).

### Редеплой Фаз 6-7 (client-скоуп бэкордер-экспорта + приоритизация позиций)

Тот же процесс, что и в Фазе 5 (см. выше) — `dist`/`package.json`/
`package-lock.json` сохранены с суффиксом `.bak-20260911-phase7`, `sudo -u
ceatapp` для `npm ci --omit=dev`, фронтенд пересобран с `VITE_API_URL=/api`.
Единственный новый шаг — **миграция `priority_qty`**: прод и dev делят одну
и ту же Neon-БД (см. "Архитектура" выше), поэтому `npm run migration:run`,
уже выполненный локально при разработке Фазы 7, **фактически уже применил
эту миграцию и к проду** до самого деплоя кода. На сервере всё равно
явно прогнан `migration:show` (подтвердил все 3 миграции как выполненные)
и `migration:run` (вернул "No migrations are pending") — не чтобы что-то
реально изменить, а чтобы явно закрыть пункт чеклиста и не полагаться на
память о том, что БД общая. **Нюанс**: на сервере не установлен
`ts-node`/`typescript` (`devDependencies`, не ставятся `npm ci
--omit=dev`) — локальный `npm run migration:run` использует `ts-node -r
tsconfig-paths/register src/data-source.ts`, что на сервере не сработает;
вместо этого — обычный `typeorm`-CLI (он в `dependencies`, не
`devDependencies`) напрямую против скомпилированного `dist/data-source.js`
(`npx typeorm migration:run -d dist/data-source.js`).

Проверено публично, не по SSH — на этот раз с полным поведенческим
покрытием, не только структурным (см. оговорку в конце записи о Фазе 5
выше): временные `ops`/`client`-пользователи и временная
карточка/customer созданы напрямую в БД (тот же приём, что для живых
проверок Фаз 6-7 на dev — `-verify@ceat.com`-суффикс для адресного
удаления после). Через публичный `http://<server-ip>/api/...`
(не `localhost`, не по SSH): `POST /auth/login` под обеими временными
ролями — `200`, реальные токены; `GET /proforma-invoices` под `ops` —
карточка содержит `priorityQty` на позиции и `priorityTotalQty`/
`priorityTotalContainers` на самой PI; `PATCH
/pi-line-items/:id/priority` под `client` с допустимым значением — `200`,
сохранено; тот же запрос с `priorityQty` больше остатка — `400` с точным
сообщением о границе; тот же запрос под `ops` — `403` ("Приоритизация
доступна только клиенту"); повторный `GET /proforma-invoices` подтвердил
`priorityTotalQty`/`priorityTotalContainers` пересчитались после сохранения
(`0` → `7` / `0.35`). Временные пользователи/карточка/customer удалены
сразу после — отдельно подтверждено `401` на повторный логин тем же
временным аккаунтом. `grep` по задеплоенному JS-бандлу подтвердил обе
новые строки UI ("Режим приоритизации", "Весь остаток") и отсутствие
`localhost:3000`.

### Редеплой Фазы 7.1 (массовый сброс приоритета)

Тот же процесс. Никакой новой миграции в этой правке — `reset-priority`
переиспользует уже существующую колонку `priority_qty`, схема не менялась;
`migration:show`/`migration:run` всё равно прогнаны на сервере явно, как и
раньше — подтвердили "No migrations are pending", ни одна не пропущена по
недосмотру.

Проверено публично — на этот раз не только структурно и не только через
`curl`, а прямо через **живой продовый фронтенд** в браузере
(`http://<server-ip>`, реальный `client`-логин, реальные клики):
включён режим приоритизации, "Весь остаток" на второй позиции (баланс
`5`, loadability `10`) — сеть подтвердила `PATCH
.../pi-line-items/.../priority` с телом `priorityQty: 5` (не `50` и не
`0.5` — units-баг, о котором был предыдущий тик задачи, действительно
отсутствует и на самом проде, не только в dev); сводная строка "Приоритет"
мгновенно показала `55 / 3 конт.`. Клик "Сбросить" (с застабленным
`window.confirm`, т.к. автоматизированный браузер тихо отклоняет нативные
диалоги, если их не обработать явно) — ровно один `PATCH
.../reset-priority`, ответ содержал обе позиции с `priorityQty: "0.00"` и
**одинаковым `updatedAt`** (доказательство одного `UPDATE`, не двух
последовательных записей), таблица и сводная строка обнулились без
перезагрузки страницы. Временный `customer`/карточка/пользователь удалены
сразу после, отдельно подтверждён `401` на повторный логин тем же
временным аккаунтом.

**Уточняющая проверка после этого деплоя**: изначальная живая проверка
Фазы 7.1 выше кликала только "Весь остаток" — ручной ввод числа с
клавиатуры отдельно не проверялся, хотя именно ручной ввод был предметом
исходной жалобы про ввод "в контейнерах". Разобран код заново: `PriorityInput.tsx`'s
`<Input onChange>` и `<Button onClick="Весь остаток">` вызывают один и тот
же проп `onChange(value)` — единственный путь дальше, `loadability`
участвует только в отдельном `containers = value / loadability`,
локальном для строки "= X конт." и никак не влияющем на то, что уходит в
`onChange`/`PATCH`. Второго, отдельного обработчика для ручного ввода не
существует и не существовало — гипотеза "фикс применили только к одной
из двух веток" не подтвердилась в этом коде.

Живая проверка именно ручного набора (клик по инпуту, `Ctrl+A`, ввод "17"
с клавиатуры — не через "Весь остаток") на живом проде: карточка с
остатком `200`, loadability `20` (т.е. умножение/деление дало бы `340`
или `0.85` — невозможно спутать с верным `17`). Живой пересчёт под
инпутом сразу показал `= 0.85 конт.`, сводная строка — `17 / 0,85 конт.`;
debounced `PATCH .../priority` (без клика "Весь остаток") ушёл сам и
вернул `priorityQty: "17"` — ровно то, что было набрано. Переключение в
read-only после сохранения подтвердило то же `17`. Временные
customer/карточка/пользователь удалены после проверки.

### Редеплой Фазы 7.2 (целые штуки в приоритете)

Тот же процесс. Никакой новой миграции — `priority_qty` остаётся
`numeric(14,2)` в схеме, целочисленность — только на уровне
DTO/сервиса, не БД (см. "Только целые штуки" выше). `migration:show`/
`migration:run` на сервере всё равно прогнаны явно — "No migrations are
pending", как и ожидалось.

Проверено публично — и напрямую `curl`, и через реальный клик/набор с
клавиатуры на живом продовом фронтенде (`http://<server-ip>`):

- `curl` напрямую на публичный `PATCH .../priority` с `priorityQty: 0.02`
  — `400`, `{"message":["приоритет указывается в целых штуках"],...}`.
- В браузере, реальные нажатия клавиш (не программная подмена значения):
  поле очищено (клик → `Ctrl+A` → `Delete`, явно подтверждено `value ===
  "0"` перед вводом — after проблема с "0.02" дописавшимся к старому "10"
  в предыдущей живой проверке (см. запись про Фазу 7.2 выше), в этот раз
  чистота поля перед вводом проверялась на каждом шаге), затем набрано
  `.02` посимвольно — поле осталось на `0`, не приняло дробь. Отдельно
  набрано `5.7` — поле показало `6` (округление, не обрезание). Сводная
  строка "Приоритет" мгновенно отразила оба случая (`0 / 0 конт.`, затем
  `6 / 0,3 конт.`); debounced `PATCH` для второго случая вернул
  `priorityQty: "6"` — то, что видно на экране, то и ушло на сервер.
  Файл бандла на сервере (`index-CWhCdj6s.js`) совпал по имени/хэшу с
  тем, что был собран локально непосредственно перед деплоем — не старая
  закэшированная версия.

Временные customer/карточка/пользователь удалены сразу после проверки,
отдельно подтверждён `401` на повторный логин тем же временным аккаунтом.

### Редеплой Фазы 7.3 (видимость кнопки "Сбросить")

Фронтенд-only деплой — бэкенд не пересобирался и не перезапускался вообще
(правка была чисто в JSX-условии рендера, `dist`/`package.json` бэкенда не
менялись), никаких миграций. Только: `npm run build` фронтенда с
`VITE_API_URL=/api`, `/var/www/ceat-frontend` → `.prev`, новый билд на его
место, `nginx -t` → `reload`. `systemctl is-active ceat-backend` после
деплоя подтвердил, что бэкенд-сервис даже не перезапускался (не
`stop`/`start`, просто не тронут).

Проверено публично на живом фронтенде (`http://<server-ip>`, реальные
клики, не `curl` — тут нечего проверять через API, изменение чисто
визуальное): свежий вход `client` на карточку — виден "Режим
приоритизации" и "Скачать Excel", "Сбросить" отсутствует; клик "Режим
приоритизации" — "Сбросить" появляется рядом с "Готово"; клик "Готово" —
"Сбросить" пропадает снова. Тем же URL под `ops` — ни переключателя, ни
"Сбросить" не видно вообще ни при каком состоянии. Временные
customer/карточка/пользователи удалены сразу после, отдельно подтверждён
`401` на повторный логин тем же временным аккаунтом.

### Редеплой Фазы 8 (готово к отгрузке, только backend)

Фронтенд не пересобирался. Отличия от прошлых редеплоев:

- **Миграция раньше кода, без простоя.** Новый `dist` распакован рядом
  (`/opt/ceat-backend/dist.new`), пока работал старый код;
  `npx typeorm migration:show -d dist.new/data-source.js` показал ровно одну
  ожидающую (`AddReadyToShip1789746739709`), `migration:run` применил её
  (только новые таблицы — старому коду не мешает), затем `systemctl stop` →
  `mv dist dist.bak-20260918-phase8` → `mv dist.new dist` → `start`.
  Откат: `stop`, вернуть `dist.bak-20260918-phase8`, `start`; при
  необходимости `migration:revert` (дропает 4 пустые таблицы).
- **Локальный dev теперь на Docker Postgres, а не на Neon** (см. "Запуск"),
  так что эта миграция на прод раньше сама не применялась — в отличие от Фазы 7.
  Прогнана явно, через тот же `typeorm`-CLI на сервере, что и раньше.
- Перед деплоем `.js` из локального `dist/` сверены побайтово (SHA-256) с
  задеплоенными: отличаются ровно файлы Фазы 8 плюс строка версии Swagger в
  `main.js` (`alpha.11` на сервере) — то есть на сервере был именно тот код,
  что в репозитории. `package.json`: зависимости идентичны, `npm ci` не нужен.
- Бэкапы: `dist.bak-20260918-phase8`, `package*.json.bak-20260918-phase8`.

**Проверено на реальных данных прода** (публичный URL через nginx, временные
`phase8-verify-*` пользователи на реальном клиенте, удалены после — `401` на
повторный логин; реальных паролей `buyer`/`ops` у агента нет). Данные:
28 карточек PI (26 активных, 2 архивные), 245 строк с недельным планом
отгрузки, последняя загрузка бэкордера — 2026-09-03.

- `GET /ready-to-ship`: `totalPossibleContainers = 42`, 42 пустых слота,
  245 нераспределённых строк из нескольких карточек, общий остаток 3293 шт.
  Независимый расчёт прямо из БД: `Σ qty/loadability = 41.67 → 42`; по колонке
  `current_week_dispatch_load_factor` файла — `41.88 → 42`. На текущих данных
  обе формулы дают одно число (различие из п. 1 "Где реализация отличается от
  ТЗ" сейчас не проявляется); строк без `loadability` нет.
- один `move` (1 шт. строки PI 100037116 с остатком 1, loadability 172 →
  заполнение 0.58%), один `confirm` (подтвердился только этот контейнер,
  остальные 41 пустых не тронуты), дальнейший `move` в него — `400`.
- откат: `unlock` от клиента — `403`, от ops — `201`, затем `undo-all`:
  аллокаций нет, снова 42 пустых слота, 245 строк, общий остаток ровно 3293
  и остаток той строки — исходный.
- После: пустые слоты удалены (а не оставлены — на тот момент число слотов
  задавалось один раз, при первом заходе, и устаревшее число клиент увидел бы
  после следующей загрузки бэкордера; с досозданием слотов, см. ниже, это уже не
  так), таблицы Фазы 8 пусты, отпечатки
  (`md5` по `pi_line_items`: 538 строк, `proforma_invoices`: 28) **совпали**
  до и после — реальные данные не тронуты.

**Не проверено на проде, и это надо помнить:** перенос аллокаций
(`AllocationRelinkService`) при перезагрузке бэкордера. Он срабатывает только
на живых аллокациях, а тестовые откачены до всякой загрузки, и запускать
настоящую загрузку ради проверки нельзя (она архивирует карточки). На
локальном Postgres он проверен сквозным сценарием, на проде впервые сработает
при первой еженедельной загрузке **после того, как клиент что-то разложит**.
Безопасный способ проверить на реальных данных заранее — ветка Neon
(copy-on-write) и прогон загрузки против неё.

**Relink проверен на копии реальных данных** (ветка Neon `relink-test`,
скопированная с прода 2026-09-18; локальный бэкенд на :3100 с `DB_*` ветки,
продовый сервис не трогался). Сценарий: `move` + `confirm` + файлы маркировки
на 9 позициях из 5 карточек, `unlock` контейнера, изменение количества в нём,
черновой контейнер; затем "недельный" файл, собранный из строк ветки
(501 строка из 24 карточек: две карточки убраны, у одной строки заменён
материал) и загруженный через `POST /backorder-uploads`. Результат: аллокации,
файлы маркировки и лог действий переехали на новые строки с тем же ключом
(количество, контейнер и счётчики не изменились); строка с заменённым
материалом потеряла аллокацию и файл; аллокации выпавших (архивных) карточек
остались как были; остальные данные открытых карточек загрузка не изменила;
`undo-last`/`undo-all` после переноса откатывают именно перенесённые записи.
На дублях ключа `(materialNum, soNumber)` карточки PI 100037116 (113646 — две
одинаковые строки; 114699 — остатки 5 и 13) каждая аллокация осталась на строке
с тем же остатком — благодаря спариванию по `(dispatch, balance)`; до этого
исправления в локальной репетиции 114699 менялись местами. Чтобы 114699 можно
было разложить, на ветке им был поднят `current_week_dispatch_qty` с 0 до 1
(данные ветки, прод не менялся). Исправление спаривания задеплоено на прод
(см. ниже "Редеплой исправления relink").

### Досоздание слотов (после деплоя Фазы 8; в ТЗ было "один раз при первом заходе")

Открытый вопрос из деплоя Фазы 8 закрыт: число слотов создавалось один раз,
и если следующая загрузка бэкордера поднимала `totalPossibleContainers`, у
клиента оставался прежний набор. Теперь каждый `GET /ready-to-ship` (и вид,
который возвращают `move`/`undo-*`/`confirm`) сверяет число контейнеров клиента
с `totalPossibleContainers` и **достраивает только недостающие**:

- считаются все контейнеры клиента — и пустые, и с позициями, и подтверждённые:
  достраивается `totalPossibleContainers − уже существует`, тот же подсчёт, что у
  `undo-all`; существующие контейнеры, их id и содержимое не трогаются;
- новые метки продолжают нумерацию после наибольшей занятой (`Контейнер N+1…`);
- строго аддитивно: если потребность упала, лишние пустые слоты остаются, ничего
  не удаляется;
- параллельные чтения, обнаружившие нехватку, пытаются создать те же метки —
  проигравший упирается в `unique(customer_id, label)`, ошибка глотается (тот же
  механизм, что у первого захода): 10 параллельных `GET` после роста дают ровно
  недостающее число контейнеров, без дублей и пропусков нумерации;
- слот, потерянный любым способом, тоже восстанавливается при следующем чтении.

Проверено на локальном Postgres по HTTP: 13 слотов → рост плана на 300 ед. →
16, → рост ещё → 10 параллельных `GET` → 18 без дублей; `confirm` число не
меняет; падение потребности до 10 оставляет все 18; рост до 33 при одном
подтверждённом контейнере достраивает ровно 15. Юнит-тесты: 6 новых сценариев в
`ready-to-ship.service.spec.ts` (добавлены недостающие с сохранением
существующих, идемпотентность, учёт подтверждённых, "никогда не удаляет",
восстановление потерянного, добор после записи, гонка).

**Задеплоено на прод 2026-09-18** (коммит `60ab47d`), тем же процессом, что
и остальные редеплои: бэкап `dist.bak-20260918-slot-topup`, `dist.new` рядом,
проверка SHA-256 архива, `migration:show` (все 4 применены, миграций нет),
`stop` → `mv` → `start`. Побайтовая сверка `.js` с задеплоенными: отличается
ровно `ready-to-ship/ready-to-ship.service.js`. Проверено публично через
временного ops-пользователя (удалён после): логин `200`; `GET
/proforma-invoices` — `200`, 28 карточек, 538 строк; `GET /backorder-uploads` —
`200`; без токена `/proforma-invoices` и `/ready-to-ship` — `401`; порт 3000
снаружи недоступен; повторный логин временным пользователем — `401`; журнал
без ошибок; таблицы Фазы 8 на проде по-прежнему пусты — `GET /ready-to-ship`
на проде в проверках намеренно не вызывался (он создаёт слоты клиента, ровно
как делает реальный заход), поведение проверено локально на Postgres.

### Редеплой исправления relink (спаривание дублей ключа)

2026-09-18, только backend, миграций нет (`migration:show` с нового `dist`:
все 4 применены). Порядок тот же, что выше: `dist.new` рядом → проверка
SHA-256 архива после загрузки → `stop` → `mv dist
dist.bak-20260918-relink-pairing` → `mv dist.new dist` → `start`. Перед
деплоем `.js` сверены с задеплоенными: отличаются ровно
`ready-to-ship/allocation-relink.service.js` (изменён) и
`ready-to-ship/utils/pair-line-items.js` (новый), больше ничего.

Проверено публично (временный ops-пользователь `relink-deploy-verify-ops@…`,
удалён после): `POST /auth/login` — `200`; `GET /proforma-invoices` — `200`,
28 карточек, 538 строк, `status` и агрегаты приоритета на месте;
`GET /backorder-uploads` — `200`; без токена `/proforma-invoices` и
`/ready-to-ship` — `401`; порт 3000 снаружи недоступен; повторный логин
временным пользователем — `401`; журнал сервиса без ошибок; таблицы Фазы 8 на
проде по-прежнему пусты. Сам перенос на прод по-прежнему сработает впервые на
живых аллокациях — на копии реальных данных (ветка Neon) он уже проверен,
см. выше.

### Редеплой Фазы 9 (фронтенд "Готово к отгрузке" + backend)

2026-09-19 (коммит `0212611`), backend и фронтенд вместе (фронтенд без backend
не работает: нужны `POST /ready-to-ship/remove` и `undoableActions`). Миграций
нет (`migration:show` с нового `dist`: все 4 применены). **Фаза 10 (коммиты
`0ab17e6`, `525b054`) на прод не выкладывалась** — собран и выложен именно
`0212611`.

- **Backend:** `dist.new` рядом → проверка SHA-256 архива → `stop` → `mv dist
  dist.bak-20260919-phase9` → `mv dist.new dist` → `start`. Перед деплоем `.js`
  сверены побайтово с задеплоенными: отличаются ровно `app.module.js`,
  `common/testing/fake-repo.js`, `ready-to-ship/ready-to-ship.controller.js`,
  `ready-to-ship/ready-to-ship.service.js`, плюс новый
  `ready-to-ship/dto/remove-allocation.dto.js`. `package.json` не менялся.
  (Права `dist` после `tar` с Windows выходили 777 — приведены к 755.)
- **Фронтенд:** собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`),
  `/var/www/ceat-frontend` → `.prev` (прежний `.prev` сохранён как
  `.prev-before-phase9`), `nginx -t` → `reload`.
- **Проверено публично** (временные `phase9-verify-*` на реальном клиенте,
  удалены после — `401` на повторный логин): `GET /proforma-invoices` — `200`, 28
  карточек, 538 строк; `GET /backorder-uploads` — `200`; без токена — `401`;
  порт 3000 снаружи закрыт; журнал без ошибок; `/` и `/client/ready-to-ship` —
  `200`.
- **`GET /ready-to-ship` на реальных 28 карточках** (первый заход в жизни этих
  данных — создаёт слоты): **первый вызов 1,9 с** (создал 42 слота, `totalPossibleContainers`
  = 42, 245 нераспределённых строк, остаток 3 293 шт.), тёплые — **0,7–0,9 с**,
  после 12 с простоя 1,05 с; ответ ~82 КБ. Не 21 последовательный запрос.
- **Действия на реальной строке:** `move` 2,0 с, `remove` 2,1 с, `undo-last` 2,2 с,
  `undo-all` 2,1 с; `remove` больше, чем размещено, — `400`; ops — `403`; `undo-last`
  возвращает убранное; после `undo-all` — 0 аллокаций, `undoableActions` 0, остатки
  каждой строки и суммарный остаток равны исходным. Отпечатки `md5`
  (`pi_line_items`: 538 строк, `proforma_invoices`: 28) **совпали** до и после.
- **В браузере на проде** (под временным клиентом): страница показала 245 строк,
  42 слота, без ошибок; "Переместить" 8 шт. → диалог закрылся за 2,5 с, карточка
  "Контейнер 1" 1,6%, тост, появилась панель действий; "Отменить всё" → 2,5 с, всё
  вернулось.
- **Оставлено на проде:** 42 пустых слота клиента — их всё равно создаёт первый
  реальный заход, а с готовыми слотами он быстрее. Аллокаций, действий и файлов
  маркировки нет.
- Бэкапы: `dist.bak-20260919-phase9`; фронтенд `ceat-frontend.prev`,
  `ceat-frontend.prev-before-phase9`. Откат: `stop`, вернуть
  `dist.bak-20260919-phase9`, `start`, вернуть `ceat-frontend.prev`.

### Редеплой Фазы 10 (фактические отгрузки, только backend)

2026-09-21 (коммиты `0ab17e6`, `525b054`). Фронтенд не менялся. Порядок, как
просили: **сначала миграция, потом код.**

- **Миграция раньше кода, без простоя:** `dist.new` распакован рядом (проверен
  SHA-256 архива), `migration:show` с него показал ровно одну ожидающую
  (`AddActualContainers1789823053358`), `migration:run` применил её, пока
  работал прежний код (только новые таблицы и колонка `shipped_qty` с
  `DEFAULT 0` — старому коду не мешают). Затем `stop` → `mv dist
  dist.bak-20260921-phase10` → `mv dist.new dist` → `start`. Откат: `stop`,
  вернуть `dist.bak-20260921-phase10`, `start`; при необходимости
  `migration:revert` (дропает 4 новые таблицы и колонку — данные Фазы 10 пропадут).
- Перед заменой `.js` сверены побайтово с задеплоенными: отличаются ровно 8 файлов
  (`app.module`, `backorder-uploads.{controller,module,service}`,
  `dto/backorder-upload-result.dto`, `utils/parse-backorder-file`,
  `proforma-invoice.entity`, `ready-to-ship/allocation-relink.service`) плюс 15
  новых (`actual-containers/*`, снапшот, `utils/{cell-values,parse-actual-containers,
  snapshot-sheets}`, миграция, `testing/weekly-workbook`), больше ничего.
  `package.json` не менялся, `npm ci` не нужен.
- Старт сервиса на VPS занял ~15 с (окно недоступности при `start`); проверка
  "порт слушает" сразу через 7 с вернула `000` — надо ждать ~20 с.
- **Проверено публично** (временные `phase10-verify-*` на реальном клиенте, удалены
  после — `401` на повторный логин): логин обеих ролей `200`; `GET
  /proforma-invoices` — `200`, 28 карточек, 538 строк, у каждой есть `shippedQty`
  (0 до первой загрузки); `GET /backorder-uploads` — `200`; без токена
  `/proforma-invoices`, `/actual-containers`, `/ready-to-ship`, `/backorder-uploads`
  — `401`; `GET /actual-containers` — `200` и пусто для обеих ролей, чужой/несуществующий
  id — `404`, `PATCH .../dates` от client — `403`, `snapshot-export` от client —
  `403`, от ops для несуществующей загрузки — `404`; раздел "Готово к
  отгрузке" (Фаза 9) по-прежнему `200`, 42 слота, 245 строк; порт 3000 снаружи
  закрыт; журнал без ошибок. Отпечатки `md5` (`pi_line_items`: 538, `proforma_invoices`:
  28) до и после совпали, новые таблицы пусты.
- **Первая загрузка нового формата на проде намеренно не делалась** (по решению
  пользователя: дождаться обычной еженедельной загрузки от CEAT). Она принесёт
  77 контейнеров с марта, ~1200 строк снапшота, `shipped_qty` на карточках; по
  замерам на копии прода займёт ~25–35 с (лимит `nginx` — 60 с). Сверка read-only:
  присланный `MTK_ROSBERG_INR.xlsx` — **не тот файл, что уже на проде**
  (последняя загрузка 2026-09-03; в присланном 523 строки BO против 536 активных
  на проде, различаются ~33/46 строк), то есть это более новая неделя —
  "повторно загрузить тот же файл" им не заменить.
- Бэкап: `dist.bak-20260921-phase10`.
- **`nginx`: `proxy_read_timeout` 60 с → 120 с** (2026-09-21, разовая правка
  конфига, без редеплоя): строка `proxy_read_timeout 120s;` в `location /api/`
  файла `/etc/nginx/sites-available/ceat-frontend` — то есть для всего API, не
  только для загрузки бэкордера (остальным запросам она не мешает). Бэкап
  конфига: `ceat-frontend.bak-20260921-timeout` рядом; `nginx -t` → `reload`, в
  `nginx -T` директива видна, `/` — `200`, `/api/...` без токена — `401`.
  `client_max_body_size` не задан (по умолчанию 1 МБ): реальный файл — 117 КБ,
  запас есть; если файл когда-нибудь перерастёт 1 МБ, загрузка упрётся в `413`.

### Зачистка бизнес-данных на проде для повторного теста (2026-09-21)

По просьбе пользователя очищены 12 таблиц: `marking_files`, `allocation_actions`,
`container_line_allocations`, `shipping_containers`, `actual_container_files`,
`actual_container_line_items`, `actual_containers`, `pi_additional_files`,
`pi_line_items`, `proforma_invoices`, `backorder_upload_snapshots`,
`backorder_uploads`. Остались: `customers` (1), `users` (2), `stored_files` (2 — записи
о файлах и сами файлы на диске не трогались), `migrations`, схема.

- **Бэкап до очистки:** `pg_dump -Fc` этих 12 таблиц (схема + данные) —
  `/opt/ceat-backend/backups/pre-wipe-20260921-131416.dump` на VPS (root, 600),
  SHA-256 `89f7b211…f890e5`. В дампе было: `shipping_containers` 42, `pi_line_items`
  538, `proforma_invoices` 28, `backorder_uploads` 5, остальное 0.
  Восстановление — `pg_restore` из этого файла (данные в пустые таблицы).
- **Очистка:** одна транзакция из `DELETE` строго от дочерних таблиц к родительским;
  перед началом скрипт сверил счётчики с теми, на которых снят дамп (иначе отказ),
  перед `COMMIT` проверил, что `customers`/`users` не изменились (иначе откат).
  Результат: 0 во всех 12 таблицах.
- Для дампа на VPS установлен `postgresql-client-18` из официального репозитория
  PostgreSQL (`/etc/apt/sources.list.d/pgdg.list`; версия клиента должна быть не
  ниже версии сервера БД, 18.6, а в Ubuntu 24.04 клиент — 16).
- Следствие: карточки PI появятся снова при следующей загрузке бэкордера
  (`createdFrom = BACKORDER_ROW`), слоты контейнеров клиента — при первом заходе в
  "Готово к отгрузке"; PI-файлы и подписанные документы, если они были, — только из дампа.

### Редеплой Фазы 11 (фронтенд "Готовые контейнеры" + два исправления backend)

2026-09-21, коммиты `2179289` (Фаза 11), `8787969` (имена файлов), `fd59d73`
(ETD/ETA из ETA-15). Миграций нет (`migration:show`: все 5 применены).

- **Backend:** `dist.new` рядом (SHA-256 архива сверен), `stop` → `mv dist
  dist.bak-20260921-phase11` → `mv dist.new dist` → `start` (поднялся за ~2 с).
  Побайтовая сверка `.js`: отличаются ровно `actual-containers-import.service`,
  `backorder-uploads/testing/weekly-workbook`, `utils/parse-actual-containers`,
  `files/files.service` + новый `common/utils/decode-multipart-filename`.
- **Фронтенд:** собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`),
  `/var/www/ceat-frontend` → `.prev` (прежний `.prev` сохранён как
  `.prev-before-phase11`), `nginx -t` → `reload`.
- **К моменту деплоя на проде уже были две реальные загрузки нового формата**
  (файлы `…2026-07-21` и `…2026-08-26`, загружены после зачистки, старым кодом): 68
  контейнеров, 28 карточек PI, 47 слотов, 1910 строк снапшота. Контейнеры, у которых
  `ETA` пуст (шесть из группы 31.07), заполнятся при следующей загрузке файла, где они
  есть в `ETA-15 days` (или при повторной загрузке того же последнего файла —
  идемпотентно).
- **Финальная проверка на реальных данных прода** (временные `phase11-verify-*`,
  удалены — `401` на повторный логин; отпечаток БД до и после совпал):
  - 68 контейнеров у ops и client, computed `etd/eta` на месте; ETA у 27, у 41 нигде нет
    (прочерк); ETA-15 у 28; `GET /actual-containers` 0,3 с;
  - `shippedQty` каждой из 28 карточек равен Σ строк по всем 68 контейнерам (пересчитано
    здесь из API), у 21 карточки > 0; в БД расхождений 0;
  - запись на одном чистом контейнере с откатом: `PATCH` дат → эффективные даты =
    ручные; client `PATCH` — `403`; `reset-dates` вернул даты файла; файл с
    кириллическим именем и описанием загружен (`fileName`/`description` без искажений),
    client скачал те же байты (`Content-Disposition` раскодируется в
    `упаковочный лист.txt`), client `DELETE` — `403`, ops `DELETE` — `204`; контейнер
    вернулся в исходное состояние;
  - `POST /files/upload` с именем `проверка имени файла.txt` → `originalName` сохранён
    кириллицей (исправление имён работает на проде); оба тестовых файла (записи в
    `stored_files` и файлы на диске) удалены, `stored_files` снова 4;
  - в браузере на проде под ops и client: список — 68 строк, сортировка по ETA по
    возрастанию, без ETA — внизу, 28 строк с бейджами `B/L`/`Telex`; деталь —
    поля, блок ETA-15 (`Documents release: TELEX`, `Telex release 20.07.2026`), таблица
    позиций; у контейнера без карточек PI номера — обычный текст, у контейнера с карточкой
    номер — ссылка; переход по ссылке — карточка с `Отправлено: 24` (API `24.00`); client
    — без редактора дат и без формы файлов.
- Бэкапы: `dist.bak-20260921-phase11`, `ceat-frontend.prev`.

### Редеплой Фазы 12 (сверка план vs факт, backend + фронтенд)

2026-09-22, коммит `34dd161`. Миграций нет (`migration:show` с нового `dist`:
все 7 применены).

- **Backend:** `dist.new` рядом (SHA-256 архива сверен: `7e6a6c98…addc696`),
  `stop` → `mv dist dist.bak-20260922-phase12` → `mv dist.new dist` → `start`
  (поднялся за ~2 с, все маршруты в логе, включая существующий
  `GET /proforma-invoices/:id` — новых эндпоинтов у этой фазы нет, только
  новое поле в существующем ответе). Побайтовая сверка `.js`: отличаются
  ровно `proforma-invoices/{proforma-invoice.entity,
  proforma-invoices.module, proforma-invoices.service}` + новый
  `proforma-invoices/utils/compute-reconciliation` — больше ничего (не считая
  `tsconfig.build.tsbuildinfo`, который меняется на каждой сборке).
- **Фронтенд:** собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`,
  есть `planned vs shipped`/`план vs факт`), `/var/www/ceat-frontend` →
  `.prev-before-phase12`, `nginx -t` → `reload`; новый бандл
  (`index-CNWg--Sz.js`) отдаётся, старый (`index-CPzxf3Sc.js`) остался только
  в бэкапе.
- **Проверено публично** (без токена): `GET /` — `200`; `GET
  /api/proforma-invoices` без токена — `401`; порт 3000 снаружи закрыт (в
  `ufw` разрешены только `22` и `80`); журнал старта — без ошибок.
- **Финальная проверка аутентифицированным запросом на реальных данных прода**
  (одноразовые `phase12-verify-ops@ceat.local`/`phase12-verify-client@ceat.local`,
  создание сначала заблокировал классификатор auto-режима как запись в общий
  ресурс — пользователь явно подтвердил повторно, после чего прошло; удалены
  сразу после проверки, повторный логин — `401`): `GET
  /proforma-invoices/:id` под client и под ops (обе роли видят
  `reconciliation`) на тех же карточках, что и в read-only SQL-сверке до
  деплоя — числа совпали один в один. PI 100037115: материал `106259`,
  `plannedQty 8`, `shippedQty 500`, `delta 492`. PI 100039270: 116 групп
  всего, 6 активных (`106259: 360`, `106266: 36`, `107492: 2`, `107582: 22`,
  `113905: 4`, `114475: 8`, у всех `plannedQty 0`) — совпадает с прогнозом до
  деплоя. Плюс то, что было проверено раньше: (1) та же логика группировки
  сквозь настоящий эндпоинт локально (`move` → `confirm` → `GET`, `plannedQty
  3`/`shippedQty 9`/`delta 6`); (2) чистый лог старта и корректная
  401/200-раздача на проде сразу после свапа.
- Бэкапы: `dist.bak-20260922-phase12`, `ceat-frontend.prev-before-phase12`.
  Откат: `stop`, вернуть `dist.bak-20260922-phase12` в `dist`, `start`,
  вернуть `ceat-frontend.prev-before-phase12` в `/var/www/ceat-frontend`,
  `nginx -t` → `reload`.

### Редеплой Фаз 13-14 (email-уведомления + тёмная тема, backend + фронтенд)

2026-09-23, коммиты `ee90dc8` (Фаза 13), `2f90ef6` (Фаза 14). Порядок, как
просили: **сначала миграция, потом код.**

- **Миграция.** `dist.new` рядом (SHA-256 архива сверен: `9ec05873…d52ac92`),
  `migration:show` с него показал ровно одну ожидающую
  (`AddActualContainerArrivalNotification1790200000000`, ещё не была
  задеплоена — Фаза 13 писалась уже после того, как Фаза 12 ушла на прод в
  этом же заходе, отдельным коммитом), накатана командой `migration:run`
  **до** остановки сервиса (аддитивная nullable-колонка, старый код её не
  видит).
- **Новые npm-зависимости.** Фаза 13 впервые за всю историю деплоев этого
  проекта добавила пакеты (`nodemailer`, `@nestjs/event-emitter`,
  `@nestjs/schedule`, `cron` + `@types/nodemailer` в dev) — раньше ни одна
  фаза этого не требовала. `package.json`/`package-lock.json` на проде
  сохранены как `*.bak-20260923-p13deps`, залиты новые, `npm install`
  (добавил 517 пакетов — транзитивные зависимости четырёх новых, не считая
  каких-то ещё, `node_modules` явно не переустанавливался с нуля долгое
  время), проверено `require()` каждого нового пакета напрямую перед
  перезапуском сервиса — все резолвятся.
- **Backend:** `stop` → `mv dist dist.bak-20260923-p121314` → `mv dist.new
  dist` → `chmod -R 755` → `start` (поднялся штатно, в логе
  `ScheduleModule`/`EventEmitterModule`/`NotificationsModule` "dependencies
  initialized" без единой ошибки — то есть `ArrivalNotificationsService`
  успешно зарегистрировал cron-джобу через `SchedulerRegistry` при
  старте). Побайтовая сверка `.js` от уже задеплоенной на этом же заходе
  Фазы 12: отличаются `actual-containers/{actual-container.entity,
  actual-containers.module}` + новые `arrival-notifications.service`/`utils`,
  `app.module`, `common/testing/fake-repo` (тестовый хелпер, тоже
  компилируется в `dist` — так было и раньше, см. Фазу 9), новая миграция,
  весь новый `notifications/`, `proforma-invoices.service`,
  `ready-to-ship.service` + его тестовый `testing/ready-to-ship-harness`,
  `users.service` — то есть ровно файлы Фазы 13, больше ничего.
- **Фронтенд (только Фаза 14, backend у неё нет):** собран с
  `VITE_API_URL=/api` (в бандле нет `localhost:3000`, есть `ui-theme`),
  `/var/www/ceat-frontend` → `.prev-before-p121314`, `nginx -t` → `reload`;
  новый бандл (`index-CLB5Z4wi.js`) отдаётся.
- **Проверено публично:** `GET /` — `200`, `GET /api/proforma-invoices` и
  `/api/customers` без токена — `401`, порт 3000 снаружи закрыт (`ufw`:
  только `22`/`80`), журнал за первые минуты после рестарта — без единой
  строки `error`/`exception`.
- **Живая проверка на реальных данных прода — сознательно ограничена.**
  Триггеры четырёх email-событий Фазы 13 (`upload-pi`, `propose-replacement`,
  `unlock`) — это записи в реальные карточки живого клиента; ни один не
  вызывался на проде (тот же принцип, что уже применялся для
  `confirm-arrival` в Фазе 11 — "никогда не запускать confirm/undo/unlock
  или загрузки на проде"). Вместо этого: чистый лог регистрации всех трёх
  новых модулей при старте (подтверждает, что `ArrivalNotificationsService`
  не упал при построении cron-джобы) и юнит-тесты (см. "Фаза 13" выше).
  Тёмная тема (Фаза 14) — чисто фронтенд, без риска для данных: открыт
  реальный `http://169.58.224.105/login` в браузере, `<html class="dark">`
  проставился (система в тёмном режиме), переключателя темы на странице
  входа нет — как и задумано.
- Бэкапы: `dist.bak-20260923-p121314`, `ceat-frontend.prev-before-p121314`,
  `package.json.bak-20260923-p13deps`/`package-lock.json.bak-20260923-p13deps`.
  Откат: `stop`, вернуть `dist.bak-20260923-p121314` в `dist`, вернуть оба
  `package*.json.bak-*` и `npm install` (откатит и `node_modules`), `start`,
  вернуть `ceat-frontend.prev-before-p121314` в `/var/www/ceat-frontend`,
  `nginx -t` → `reload`. Миграция Фазы 13 аддитивна — откатывать её вместе с
  кодом не обязательно (старый код просто её не видит), но
  `migration:revert` с бэкапного `dist` тоже сработает, если понадобится.

### Редеплой Фазы 15 (кнопка скачивания снимка бэкордера, только фронтенд)

2026-09-23, коммит `2438145`. Backend не менялся (эндпоинт
`GET /backorder-uploads/:id/snapshot-export` существует с Фазы 10 — не
хватало только кнопки), миграций тоже нет.

- Собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`, есть
  `snapshot-export`), `/var/www/ceat-frontend` → `.prev-before-p15`,
  `nginx -t` → `reload`; новый бандл (`index-Bw6fTppd.js`) отдаётся,
  CSS не менялся (у Фазы 15 нет новых стилей — переиспользованы
  существующие `common.download`/`downloadFailed`).
- **Проверено публично:** `GET /` — `200`, `GET /api/proforma-invoices` без
  токена — по-прежнему `401` (backend не трогали, но перепроверено, что
  фронтенд-деплой его не задел), порт 3000 снаружи закрыт.
- **Живой клик по кнопке на реальных данных прода не делался** — уже
  проверено тщательно локально на реальной загрузке 2026-09-21 (см. Фазу 15
  в `frontend/README.md`: все 7 листов, реальные данные, сверено `exceljs`),
  код между локальной проверкой и этим деплоем не менялся, а сам эндпоинт —
  чтение без побочных эффектов; отдельный временный аккаунт под это решили
  не заводить.
- Бэкап: `ceat-frontend.prev-before-p15`. Откат: вернуть его в
  `/var/www/ceat-frontend`, `nginx -t` → `reload`.

### Редеплой Фазы 16 (частичная разблокировка контейнера, backend + фронтенд)

2026-09-24, коммит `9925238`. Порядок, как просили: **сначала миграция, потом
код.**

- **Миграция.** `dist.new` рядом (SHA-256 архива сверен:
  `fc247205…35c892a`), `migration:show` показал ровно одну ожидающую
  (`AddContainerLineAllocationIsLocked1790300000000`), накатана **до**
  остановки сервиса: добавила `is_locked` на `container_line_allocations` и
  забэкфилила её из `shipping_containers.is_confirmed`. Read-only проверка
  сразу после: все 8 существующих на проде размещений оказались
  `is_locked = true` (все они лежат в уже подтверждённых контейнерах — 8 шт.
  материала 106259, та же цифра, что уже фигурировала в сверке план/факт
  Фазы 12) — бэкфилл сработал корректно, расхождений нет.
- **Backend:** `stop` → `mv dist dist.bak-20260924-p16` → `mv dist.new dist`
  → `chmod -R 755` → `start` (поднялся штатно, `journalctl --since '2
  minutes ago'` показал новый маршрут `POST
  /container-allocations/:id/unlock` и `Nest application successfully
  started` без единой ошибки — первый `journalctl -n 60` без `--since`
  случайно зацепил старые строки из предыдущего деплоя и на секунду
  выглядел так, будто новый маршрут не появился; с ограничением по времени
  всё встало на место). Побайтовая сверка `.js`: отличаются ровно новая
  миграция, `proforma-invoices.service` + `compute-reconciliation`
  (Фаза 12 теперь проверяет `allocation.isLocked` вместо
  `allocation.container.isConfirmed`), `container-allocations.controller`
  (новый маршрут), `container-line-allocation.entity`,
  `marking-files.service`, `ready-to-ship.service`,
  `shipping-container.entity` — то есть ровно файлы Фазы 16, больше ничего.
- **Фронтенд:** собран с `VITE_API_URL=/api` (в бандле нет
  `localhost:3000`, есть `unlockLine`/`partiallyUnlocked`), только новый JS
  (CSS не менялся — новых стилей у этой фазы нет, всё через уже
  существующий `AMBER_BADGE`), `/var/www/ceat-frontend` →
  `.prev-before-p16`, `nginx -t` → `reload`; новый бандл
  (`index-BnHwCOY0.js`) отдаётся.
- **Проверено публично:** `GET /` — `200`, `GET /api/proforma-invoices` и
  `GET /api/ready-to-ship` без токена — `401`, порт 3000 снаружи закрыт
  (`ufw`: только `22`/`80`).
- **Живая проверка аутентифицированным запросом на этот раз не выполнена** —
  создание одноразового `phase16-verify-*` пользователя (тот же приём, что
  в Фазах 9–12) на этот раз заблокировал классификатор auto-режима как
  запись в общий ресурс; агент не стал его обходить и оставил это на
  усмотрение пользователя. Ни один из write-путей этой фазы (`unlock`
  контейнера/позиции, `move`, `remove`, `confirm`) на проде не вызывался —
  тот же принцип "никогда не запускать confirm/undo/unlock на проде", что
  и раньше; уверенность в корректности — из полного набора юнит-тестов
  (353/353) и отдельной живой проверки на локальном бэкенде перед этим
  деплоем (см. "Фаза 16" выше).
- Бэкапы: `dist.bak-20260924-p16`, `ceat-frontend.prev-before-p16`. Откат:
  `stop`, вернуть `dist.bak-20260924-p16` в `dist`, `start`, вернуть
  `ceat-frontend.prev-before-p16` в `/var/www/ceat-frontend`, `nginx -t` →
  `reload`. Миграция аддитивна — откатывать её вместе с кодом не
  обязательно (старый код `is_locked` не видит и не читает), но
  `migration:revert` с бэкапного `dist` тоже сработает, если понадобится.

### Редеплой Фазы 17 (отмена подтверждения прибытия, backend + фронтенд)

2026-09-24, коммит `9809c65`. Миграций нет (`migration:show` с нового `dist`:
все 9 применены — эндпоинт только очищает уже существующие nullable-колонки).

- **Backend:** `dist.new` рядом (SHA-256 архива сверен: `cc32dc64…5c9e551`),
  `stop` → `mv dist dist.bak-20260924-p17` → `mv dist.new dist` → `chmod -R
  755` → `start`; в логе новый маршрут `POST
  /actual-containers/:id/revoke-arrival-confirmation` и `Nest application
  successfully started`, ошибок нет. Побайтовая сверка `.js`: отличаются ровно
  `actual-containers.controller` и `actual-containers.service` — больше ничего.
- **Фронтенд:** собран с `VITE_API_URL=/api` (в бандле нет `localhost:3000`, есть
  `revoke-arrival-confirmation`), изменился только JS (`index-CZWVO2Z-.js`),
  `/var/www/ceat-frontend` → `.prev-before-p17`, `nginx -t` → `reload`.
- **Проверено публично:** `GET /` и новый бандл — `200`; `GET
  /api/actual-containers` и `POST .../revoke-arrival-confirmation` без токена —
  `401`; `ufw` пропускает только `22`/`80` (порт 3000 закрыт); в журнале за
  минуты после рестарта — 0 строк с `error`/`exception`.
- **Сама отмена на реальном контейнере не вызывалась** — это запись в данные
  живого клиента (тот же принцип, что для `confirm-arrival` в Фазе 11);
  корректность — из юнит-тестов (361/361) и живой проверки на локальном бэкенде
  перед деплоем (см. "Фаза 17" выше).
- Мелочь для следующего раза: инструмент PowerShell отказывается выполнять
  команду, если в одном её тексте есть и `rm`/`Remove-Item`, и строка вида
  `'...\n'` (например формат `curl -w`), — удаления временных архивов надо
  запускать отдельным вызовом.
- Бэкапы: `dist.bak-20260924-p17`, `ceat-frontend.prev-before-p17`. Откат:
  `stop`, вернуть `dist.bak-20260924-p17` в `dist`, `start`, вернуть
  `ceat-frontend.prev-before-p17` в `/var/www/ceat-frontend`, `nginx -t` →
  `reload`.

### Что не тронуто / известные пробелы

- HTTPS/домен — см. "2." выше, отложено по решению пользователя.
- `JWT_SECRET` не менялся (не просили — его смена разлогинила бы всех
  активных пользователей без необходимости).
- Neon DB и её пароль — не менялись, тот же инстанс, что и в dev.
- Собственного скрипта/команды "поменять пароль пользователя" в
  `package.json` по-прежнему нет — если менять пароли ещё раз, придётся
  повторить одноразовый скрипт (или дописать нормальную команду, если это
  станет частой операцией).

## Запуск

### 1. Поднять Postgres

```bash
cp .env.example .env
docker compose up -d
```

Задайте `JWT_SECRET` в `.env` для чего-то отличного от дефолтного. `CORS_ORIGIN` —
через запятую origin'ы, которым разрешён доступ (по умолчанию
`http://localhost:5173`, дев-сервер фронтенда).

### 2. Установить зависимости

```bash
npm install
```

### 3. Прогнать миграции

См. "Пересборка схемы" выше, если БД уже содержит таблицы v1.

```bash
npm run migration:run
```

### 4. Создать первого ops-пользователя (если ещё нет)

```bash
npm run seed:user -- --email=<ops-email> --password=change-me --role=ops
```

### 5. Запустить в dev-режиме

```bash
npm run start:dev
```

API поднимется на `http://localhost:3000`, Swagger — на
`http://localhost:3000/api/docs`.

### 6. Запустить фронтенд (отдельно, опционально)

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Поднимется на `http://localhost:5173` — см. [frontend/README.md](frontend/README.md).

## Полезные команды

| Команда | Что делает |
|---|---|
| `npm run start:dev` | Запуск с watch-режимом |
| `npm run build` | Сборка в `dist/` |
| `npm run migration:generate -- src/migrations/Name` | Сгенерировать миграцию из diff entities/БД |
| `npm run migration:create -- src/migrations/Name` | Создать пустой файл миграции |
| `npm run migration:run` | Прогнать все непримененные миграции |
| `npm run migration:revert` | Откатить последнюю миграцию |
| `npm run seed:user -- --email=... --password=... --role=ops\|client [--customerId=...]` | Создать пользователя |
| `npm test` | Прогнать unit-тесты (Jest) |
| `npm run test:watch` | Тесты в watch-режиме |

## Эндпоинты (Фаза 3)

Все эндпоинты (кроме `POST /auth/login`) требуют `Authorization: Bearer
<token>`.

| Сущность | Base path |
|---|---|
| Auth | `POST /auth/login` |
| Customer | `/customers` (`GET`/`POST`/`PATCH`, без изменений с v1) |
| ProformaInvoice (PI) | `GET /proforma-invoices`, `GET /proforma-invoices/:id`, `POST /upload-pi` (ops), `POST /:id/upload-signed` (client), `POST /:id/additional-files` (обе роли), `POST /:id/propose-replacement` (ops), `POST /:id/replacement-decision` (client), `GET /:id/export-xlsx` (обе роли, owner-check для client), `PATCH /:id/reset-priority` (client-only, owner-check), `PATCH /:id/label` (client-only, owner-check, только до подписания) — см. "Загрузка файлов и approval-флоу замены", "Экспорт в Excel" и "Приоритизация позиций" выше |
| Files | `POST /files/upload` (ops-only, multipart, generic — не используется PI-эндпоинтами выше, они грузят файл напрямую через `FilesService`) + `GET /files/:id/download` (любая роль, для `client` — с проверкой владения через PI) |
| BackorderUpload | `GET /backorder-uploads` (аудит загрузок), `POST /backorder-uploads` (ops-only, multipart) — см. "Парсинг бэкордера" выше |
| Backorder export | `GET /backorder/export-xlsx` (обе роли, client скоуплен по `customer_id`) — см. "Экспорт в Excel" выше |
| PiLineItem | `PATCH /pi-line-items/:id/priority` (client-only, owner-check) — см. "Приоритизация позиций" выше |
| ActualContainer | `GET /actual-containers`, `GET /:id` (обе роли, скоуп по customer), `PATCH /:id/dates`, `POST /:id/reset-dates`, `POST /:id/files` (ops-only, multipart), `DELETE /actual-container-files/:id` (ops-only), `GET /actual-container-files/:id/download` (обе роли, owner-check); `GET /backorder-uploads/:id/snapshot-export` (ops-only) — см. "Фаза 10" выше |
| Ready to ship | `GET /ready-to-ship` (обе роли), `GET /ready-to-ship/export-xlsx` (обе роли, ops с `?customerId=`) — см. "Выгрузка в Excel" в разделе Фазы 9, `POST /ready-to-ship/move`, `/remove`, `/undo-last`, `/undo-all`, `/confirm` (client-only), `POST /containers/:id/unlock` (ops-only), `POST`/`DELETE /container-allocations/:id/marking-file` (client-only), `GET /container-allocations/:id/marking-file/download` (обе роли) — см. "Готово к отгрузке" выше |

`PiLineItem` теперь имеет свой первый write-эндпоинт (`priority`, выше) —
строки по-прежнему создаются/заменяются только через
`BackorderUploadsService`, читаются как вложенный relation в ответе
`GET /proforma-invoices/:id`. `PiAdditionalFile` — своей схемы/контроллера
по-прежнему нет, но записи в неё уже создаются (`POST
/:id/additional-files`), просто через `ProformaInvoicesController`, не
отдельный.

Полная схема запросов/ответов — в Swagger (`/api/docs`).

## Явно не реализовано в этой фазе

- Архивация теперь **реализована** автоматически (см. "Парсинг бэкордера" —
  шаг 5) как побочный эффект каждой загрузки бэкордера; отдельного ручного
  эндпоинта архивации/разархивации (например, `PATCH .../archive` для
  ops) по-прежнему нет — единственный способ изменить `is_archived_shipped`
  — через `POST /backorder-uploads`.
- Собственного контроллера/CRUD для `PiAdditionalFile` (список/удаление по
  id) — записи создаются через PI-эндпоинт, отдельно не читаются/не удаляются.
- MIME-type-валидация загружаемых файлов (принимается что угодно, как и в
  v1 `POST /files/upload`) — то же и для `POST /backorder-uploads`
  (принимает что угодно, не только реальный `.xlsx`; `exceljs` сам бросит
  при действительно нечитаемом файле).
- Листы `Radial/Bias Dispatch`, `ETD-ETA`, `ETA-15 days` реального
  бэкордер-файла (уже отгруженное, контейнеры/ETD-ETA, оплата/телекс-релиз)
  осознанно не разбираются — они описывают состояние за пределами модели
  `ProformaInvoice` (контейнеры/платежи ещё не спроектированы в v2). Если/
  когда появится модель для этого — потребуется отдельный парсер, не
  расширение `parseBackorderFile`.
- Деплой v2 на прод — сделан, см. "Продакшн-деплой v2" ниже.
