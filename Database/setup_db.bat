@echo off
setlocal enabledelayedexpansion

:: =============================================================================
:: GRP_SYS — Full Setup: Database + Tables + Backend Connection
::
:: What this does:
::   1. Starts the Docker postgres container (port 5433)
::   2. Waits until PostgreSQL is healthy
::   3. Creates GRP_SYS database (auto-created by Docker, verified here)
::   4. Runs grp_sys_schema.sql — all tables + seed data
::   5. Starts the backend and frontend containers
::   6. Verifies backend is reachable and DB connection is live
::
:: Credentials match docker-compose.yml exactly.
:: =============================================================================

:: ── Config (from docker-compose.yml) ─────────────────────────────────────
set PG_HOST=localhost
set PG_PORT=5433
set PG_USER=postgres
set PG_DB=GRP_SYS
set PGPASSWORD=RdDpp2M47i
set APP_DB_USER=grp_sys_app
set APP_DB_PASSWORD=GrpSysApp_2026
set BACKEND_URL=http://localhost:8001/health
set SCRIPT=%~dp0grp_sys_schema.sql

:: Root of project (one folder up from Database\)
set PROJECT_ROOT=%~dp0..
set SERVER_ENV=%PROJECT_ROOT%\server\.env

:: psql path — tries PATH first, then common install locations
set PSQL=psql
where psql >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if exist "C:\Program Files\PostgreSQL\17\bin\psql.exe" set PSQL="C:\Program Files\PostgreSQL\17\bin\psql.exe"
    if exist "C:\Program Files\PostgreSQL\16\bin\psql.exe" set PSQL="C:\Program Files\PostgreSQL\16\bin\psql.exe"
    if exist "C:\Program Files\PostgreSQL\15\bin\psql.exe" set PSQL="C:\Program Files\PostgreSQL\15\bin\psql.exe"
)

echo.
echo  ============================================================
echo   GRP_SYS — Database + Backend Setup
echo   Postgres : %PG_HOST%:%PG_PORT%  (Docker container)
echo   Database : %PG_DB%
echo   App User : %APP_DB_USER%
echo   Backend  : %BACKEND_URL%
echo  ============================================================
echo.

:: ── Step 1: Check Docker is running ──────────────────────────────────────
echo [1/6] Checking Docker...
docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: Docker is not running.
    echo  Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)
echo  OK — Docker is running.
echo.

:: ── Step 2: Start postgres container ─────────────────────────────────────
echo [2/6] Starting PostgreSQL container (grp_sys_postgres)...
cd /d "%PROJECT_ROOT%"
docker-compose up -d postgres
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: Failed to start postgres container.
    echo  Run: docker-compose logs postgres
    echo.
    pause
    exit /b 1
)

:: Wait for healthy status (up to 60 seconds)
echo  Waiting for PostgreSQL to be ready...
set /a TRIES=0
:WAIT_POSTGRES
set /a TRIES+=1
if %TRIES% GTR 24 (
    echo.
    echo  ERROR: PostgreSQL did not become healthy after 60 seconds.
    echo  Run: docker-compose logs postgres
    echo.
    pause
    exit /b 1
)
docker inspect --format="{{.State.Health.Status}}" grp_sys_postgres 2>nul | find "healthy" >nul
if %ERRORLEVEL% NEQ 0 (
    timeout /t 2 /nobreak >nul
    goto WAIT_POSTGRES
)
echo  PostgreSQL is healthy.
echo.

:: ── Step 3: Verify database exists ───────────────────────────────────────
echo [3/6] Verifying database "%PG_DB%" exists...
%PSQL% -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -tc "SELECT 1 FROM pg_database WHERE datname='%PG_DB%';" postgres | find "1" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  Database not found — creating "%PG_DB%"...
    %PSQL% -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -c "CREATE DATABASE \"%PG_DB%\";" postgres
    if %ERRORLEVEL% NEQ 0 (
        echo  ERROR: Failed to create database. Check psql is installed.
        pause
        exit /b 1
    )
    echo  Database created.
) else (
    echo  Database "%PG_DB%" already exists.
)
echo.

:: ── Step 4: Run schema SQL (tables + seed data) ───────────────────────────
echo [4/6] Creating tables and loading seed data...
echo  Running: %SCRIPT%
echo.
%PSQL% -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -d %PG_DB% -f "%SCRIPT%"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: Schema script failed. See output above.
    pause
    exit /b 1
)
echo.
echo  Tables created and seed data loaded.
echo.

:: ── Step 5: Create/update app DB user + grants + .env ─────────────────────
echo [5/6] Creating app DB user and granting permissions...
%PSQL% -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -d %PG_DB% -c "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%APP_DB_USER%') THEN CREATE ROLE %APP_DB_USER% LOGIN PASSWORD '%APP_DB_PASSWORD%'; ELSE ALTER ROLE %APP_DB_USER% WITH LOGIN PASSWORD '%APP_DB_PASSWORD%'; END IF; END $$;"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: Failed creating/updating app DB user.
    pause
    exit /b 1
)

%PSQL% -h %PG_HOST% -p %PG_PORT% -U %PG_USER% -d %PG_DB% -c "GRANT CONNECT ON DATABASE \"%PG_DB%\" TO %APP_DB_USER%; GRANT USAGE, CREATE ON SCHEMA public TO %APP_DB_USER%; GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO %APP_DB_USER%; GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %APP_DB_USER%; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO %APP_DB_USER%; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %APP_DB_USER%;"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: Failed granting permissions to app DB user.
    pause
    exit /b 1
)

echo  Writing server env file: %SERVER_ENV%
(
    echo DATABASE_URL=postgresql+psycopg://%APP_DB_USER%:%APP_DB_PASSWORD%@localhost:%PG_PORT%/%PG_DB%
    echo DB_USER=%APP_DB_USER%
    echo DB_PASSWORD=%APP_DB_PASSWORD%
    echo DB_HOST=localhost
    echo DB_PORT=%PG_PORT%
    echo DB_NAME=%PG_DB%
    echo API_HOST=0.0.0.0
    echo API_PORT=8001
    echo CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001
) > "%SERVER_ENV%"
echo  App DB user and local server environment configured.
echo.

:: ── Step 6: Start backend + frontend, verify connection ──────────────────
echo [6/6] Starting backend and frontend containers...
docker-compose up -d backend frontend
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  WARNING: Could not start backend/frontend containers.
    echo  Run manually: docker-compose up -d
    echo.
)

:: Wait up to 30 seconds for backend /health endpoint
echo  Waiting for backend to be reachable at %BACKEND_URL%...
set /a BTRIES=0
:WAIT_BACKEND
set /a BTRIES+=1
if %BTRIES% GTR 15 (
    echo.
    echo  WARNING: Backend did not respond within 30 seconds.
    echo  Check logs: docker-compose logs backend
    echo  The DB and tables are ready — backend may still be starting.
    goto DONE
)
curl -s -o nul -w "%%{http_code}" %BACKEND_URL% 2>nul | find "200" >nul
if %ERRORLEVEL% NEQ 0 (
    timeout /t 2 /nobreak >nul
    goto WAIT_BACKEND
)

echo  Backend is UP and connected to database.

:DONE
echo.
echo  ============================================================
echo   Setup Complete!
echo.
echo   PostgreSQL : localhost:5433  (DB: %PG_DB%)
echo   DB User    : %APP_DB_USER%
echo   Backend    : http://localhost:8001
echo   Frontend   : http://localhost:3001
echo   API Docs   : http://localhost:8001/docs
echo  ============================================================
echo.
pause
endlocal
