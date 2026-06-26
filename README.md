# GRP_SYS

GRP_SYS is a Dockerized full-stack app:

- Frontend: Next.js (container `grp_sys_frontend`)
- Backend: FastAPI (container `grp_sys_backend`)
- Database: PostgreSQL (container `grp_sys_postgres`)

## Prerequisites

1. Install Docker Desktop
2. Start Docker Desktop
3. Open terminal in project root

## First Time Setup (New Team Member)

Run exactly this from the project root:

```powershell
docker compose up -d --build
```

What happens automatically now:

1. PostgreSQL starts on host port `5433`
2. `Database/grp_sys_schema.sql` is auto-applied on first DB initialization
3. Seed data is inserted (departments, channels, lists, admin pin)
4. App DB user `grp_sys_app` is created with required privileges
5. Backend starts on `http://localhost:8001`
6. Frontend starts on `http://localhost:3001`

## Daily Start / Stop

Start:

```powershell
docker compose up -d
```

Stop:

```powershell
docker compose down
```

## Access URLs

- Frontend: http://localhost:3001
- Backend health: http://localhost:8001/health
- Backend docs: http://localhost:8001/docs

## Useful Commands

Check running containers:

```powershell
docker compose ps
```

Follow backend logs:

```powershell
docker compose logs -f backend
```

Follow frontend logs:

```powershell
docker compose logs -f frontend
```

Follow database logs:

```powershell
docker compose logs -f postgres
```

Rebuild after code/dependency changes:

```powershell
docker compose up -d --build

## Pulling Latest Frontend Changes (Schedule updates)

Frontend now runs in Docker using bind-mounted source (`client/`) in dev mode.
That means after a `git pull`, schedule/frontend UI updates appear on restart without rebuilding the frontend image.

Use:

```powershell
git pull
docker compose up -d frontend
```

Use `--build` only when backend dependencies or Dockerfiles changed.
```

## Reset Database (Only If You Want Fresh Data)

```powershell
docker compose down -v
docker compose up -d --build
```

This removes DB volume and re-runs schema + seed from scratch.

## Notes

- For normal usage, team members do not need to run `Database/setup_db.bat`.
- `setup_db.bat` is still available as a Windows helper, but Docker Compose is now the primary flow.
