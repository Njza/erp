# ERP skeleton

.NET 11 minimal API + Angular 22 + PostgreSQL 18. It contains login, RBAC, database
initialisation and one error/notification contract. Business modules go on top.

## Deploy (Docker, external database)

The stack is two containers. The database is not part of it: the API connects to a
PostgreSQL that already exists, such as the shared one a 1Panel server manages.

| Service | Image | Reachable from |
|---|---|---|
| `web` | nginx: serves the Angular build, forwards `/api/` to `api` | `127.0.0.1:WEB_PORT` on the host |
| `api` | ASP.NET runtime; migrates and seeds the database at startup | the compose network only |

On a 1Panel server:

1. **Database.** In 1Panel → Databases → PostgreSQL, create a database and a user for the ERP.
   Note the container name from the connection info (it looks like `1Panel-postgresql-xxxx`).
2. **Settings.** `cp .env.example .env`, then set `DB_HOST` to that container name, the
   database name, user and password, a random `JWT_KEY`, and `ADMIN_PASSWORD`.
   `DB_NETWORK` stays `1panel-network`.
3. **Start.** `docker compose up -d --build`. The API creates its tables on first start.
4. **Website.** In 1Panel → Websites, create a reverse-proxy site for your domain that
   forwards to `http://127.0.0.1:8080`, and enable HTTPS there.
5. Sign in as `admin` with `ADMIN_PASSWORD`, then change it by editing the user.

Update after a code change: `git pull && docker compose up -d --build`.

The API needs a database user that may create tables in its own database. It touches no
other database on the shared server.

## Run for development

```bash
docker compose -f docker-compose.dev.yml up -d    # local Postgres on localhost:5433
cd api && dotnet run --launch-profile http        # API on :5283; settings from appsettings.Development.json
cd web && npm start                               # UI on :4200 with live reload; proxies /api to :5283
./smoke.sh                                        # 22 checks: login, RBAC, error contract
```

Sign in as `admin` with `Seed:AdminPassword` from `api/appsettings.Development.json`.
The values in that file are development defaults; the deployment never reads them.

To try the deployment stack on your own machine, point `.env` at the dev database:
`DB_NETWORK=erp-dev`, `DB_HOST=db`, `DB_USER=erp`, `DB_PASSWORD=erp_dev`; then
`docker compose up -d --build` and `./smoke.sh http://localhost:8080/api`.

## Layout

```
api/                       one project, one namespace; a modular monolith
  Program.cs               wiring: auth, rate limit, error contract, endpoint groups
  Shared/                  the shared kernel; keep it small
    AppException.cs        a business error, thrown anywhere
    Errors.cs              the one exception handler
    AuthExtensions.cs      RequirePermission(), RequireActiveUser()
  Modules/                 one folder per bounded context, layers inside
    Identity/              Domain/ (User, Role, Perm), Infrastructure/ (TokenService), Endpoints/
    Billing/               Domain/ (PartsBill, PartsBillRow), Endpoints/
    Catalog/               Domain/ (Product, NameOption), Application/ (Catalog: learns names from a saved bill), Endpoints/
  Persistence/             AppDb (DbContext), DbInit (migrate + seed), Migrations/
  Dockerfile
web/src/app/
  core/auth.ts             AuthService (token, me, has()), authGuard
  core/http.ts             apiInterceptor (token + error toast), AppErrorHandler
  core/notify.ts           NotifyService: the only way to show a message
  app.routes.ts            routes; also the source of the side menu
  shell.ts                 layout with the side menu
  identity/                login, users, roles
  billing/                 parts-bill, rmb (amount in Chinese capitals)
  catalog/                 products, names (customers, staff)
web/Dockerfile, web/nginx.conf
docker-compose.yml       deployment: api + web
docker-compose.dev.yml   development: local Postgres only
.env.example
```

## Rules of the skeleton

**RBAC.** User ↔ Role is many-to-many. A role holds a list of permission codes
(`module.action`). The codes live in code (`Perm`), not in a table. The API checks the
database on every request, so a role change or a disabled user takes effect at once.
The `admin` role is built in and gets every code at startup. The UI hides what the user
cannot do with `auth.has('code')`; that is cosmetic, the API is the gate.

**Errors.** Every non-2xx response is RFC 9457 ProblemDetails:

```json
{ "status": 409, "title": "给用户看的中文提示。", "code": "DUPLICATE", "traceId": "…" }
```

Validation failures add `"errors": { "Field": ["…"] }`. On the server, throw
`new AppException(status, "CODE", "Message")`; never build an error response by hand.
On the client, the interceptor shows every API error as a toast, so a page only does
`catch { return; }`. A 401 signs the user out.

**Messages.** Success: `notify.success('…')` from the page. Errors: automatic.

## Add a module

1. Add entities in `Modules/<Module>/Domain/` and a `DbSet` in `Persistence/AppDb.cs`, then `dotnet ef migrations add <Name> -o Persistence/Migrations` in `api/`.
2. Add permission constants to `Perm`, and their Chinese names to `PERM_LABELS` in `web/src/app/identity/roles.ts`.
3. Add `Modules/<Module>/Endpoints/<Name>Endpoints.cs` with `.RequirePermission(Perm.X)`; map it in `Program.cs`.
4. Add a page in `web/src/app/<module>/` and one line in `app.routes.ts` (`data: { label, perm }`).
