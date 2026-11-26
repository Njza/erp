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
3. **Start.** `./deploy.sh <latest tag>` (see Releases). The API creates its tables on first start.
4. **Website.** In 1Panel → Websites, create a reverse-proxy site for your domain that
   forwards to `http://127.0.0.1:8080`, and enable HTTPS there.
5. Sign in as `admin` with `ADMIN_PASSWORD` and change it on the 修改密码 page. Then delete
   `ADMIN_PASSWORD` from `.env` and run `docker compose up -d`: it is needed only on the first start.

The API needs a database user that may create tables in its own database. It touches no
other database on the shared server.

## Releases

Every deployment is a release tag `vMAJOR.MINOR.PATCH` on `main`, starting at `v0.1.0`.
Before 1.0, a release with new features or a change people must know about raises MINOR
(`v0.2.0`); a release with fixes only raises PATCH (`v0.1.1`).

1. **Release** (on your machine, `main` pushed and `./smoke.sh` passing):
   ```bash
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   gh release create v0.2.0 --title v0.2.0 --notes "what changed, for the people who use it"
   ```
2. **Deploy** (on the server, in the checkout): `./deploy.sh v0.2.0`. It checks out the tag,
   records it as `APP_VERSION` in `.env`, and rebuilds. The side menu shows the version.
3. **Roll back**: `./deploy.sh v0.1.0`. Migrations do not run backwards, so going back past
   a release that changed the database needs a database backup.

The server's checkout sits on a tag (detached HEAD); never edit files there except `.env`.

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
  core/auth.ts             AuthService (signedIn, me, has()), authGuard
  core/http.ts             apiInterceptor (CSRF header + error toast), AppErrorHandler
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

**Session.** Login sets the token in an HttpOnly cookie (`erp_token`, `SameSite=Strict`,
`Secure` outside development); the response body never contains it, so a script on the page
cannot read it. The API accepts the cookie only on a request that has an `X-Requested-With`
header, which the web app adds to every call and another site cannot (CSRF). Programs may
send the same token in an `Authorization: Bearer` header instead. Changing a password ends
that user's sessions. Signing out revokes that one token. Five wrong passwords lock an account
for 15 minutes. Every create, change and delete is written to the audit log (操作日志, `audit.read`). The site must be served over HTTPS, or the browser drops the cookie.

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
