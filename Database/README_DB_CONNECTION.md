# GRP_SYS DB Setup and Connection Guide

This guide fixes the PostgreSQL authentication/port issue and standardizes DB credentials for both local backend runs and Docker.

## Root cause of your error

Your backend tried to connect to `localhost:5432` with `postgres`, but this project Docker DB is exposed on `localhost:5433`.

## Standard credentials used by this project

- Postgres admin user: `postgres`
- Postgres admin password: `RdDpp2M47i`
- Database: `GRP_SYS`
- App DB user: `grp_sys_app`
- App DB password: `GrpSysApp_2026`
- Host: `localhost`
- Port: `5433`

Backend CORS supports localhost/127.0.0.1 on any port (for example 3000, 3001, 3002). Explicit defaults include:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://localhost:3001`
- `http://127.0.0.1:3001`

## One-command setup (recommended)

From project root, run:

```bat
Database\setup_db.bat
```

What this now does:

1. Starts Docker PostgreSQL (`grp_sys_postgres`) on port `5433`.
2. Recreates schema and seed data from `Database/grp_sys_schema.sql`.
3. Creates or updates app user `grp_sys_app`.
4. Grants required privileges on tables/sequences.
5. Writes `server/.env` with working DB connection values.
6. Starts backend and frontend containers.

## Connect from local backend (without Docker backend)

Use this connection URL:

```env
DATABASE_URL=postgresql+psycopg://grp_sys_app:GrpSysApp_2026@localhost:5433/GRP_SYS
```

The backend defaults in `server/database.py` already match this.

## Fix dependency install error on Python 3.14

`psycopg2-binary` can fail to build on Python 3.14 (requires Visual C++ Build Tools).
This project now uses psycopg v3 binary wheels via:

```txt
psycopg[binary]==3.2.12
```

Install server dependencies:

```powershell
cd server
pip install -r requirements.txt
```

## Quick verification

1. Check DB container:
```powershell
docker ps --filter "name=grp_sys_postgres"
```
2. Check backend health:
```powershell
curl http://localhost:8001/health
```
3. Open API docs:
- http://localhost:8001/docs

## If auth still fails

1. Remove stale DB volume and recreate:
```powershell
docker compose down -v
docker compose up -d postgres
```
2. Re-run:
```bat
Database\setup_db.bat
```

## If frontend shows "Failed to fetch" on Kanban

This usually means backend `/cards/...` is returning `500`.

1. Check backend health:
```powershell
curl http://localhost:8001/health
```
2. Check cards endpoint directly:
```powershell
curl http://localhost:8001/cards/Quotation
```
3. If you see missing-column errors (for example `revision_number`), run:
```bat
Database\setup_db.bat
```

The schema now includes all card/remark columns expected by the backend models.
