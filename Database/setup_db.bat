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
set BACKEND_URL=http://localhost:8001/health
set SCRIPT=%~dp0grp_sys_schema.sql

:: Root of project (one folder up from Database\)
set PROJECT_ROOT=%~dp0..

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
echo   Backend  : %BACKEND_URL%
echo  ============================================================
echo.

:: ── Step 1: Check Docker is running ──────────────────────────────────────
echo [1/5] Checking Docker...
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
echo [2/5] Starting PostgreSQL container (grp_sys_postgres)...
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
echo [3/5] Verifying database "%PG_DB%" exists...
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
echo [4/5] Creating tables and loading seed data...
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

:: ── Step 5: Start backend + frontend, verify connection ──────────────────
echo [5/5] Starting backend and frontend containers...
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
echo   Backend    : http://localhost:8001
echo   Frontend   : http://localhost:3001
echo   API Docs   : http://localhost:8001/docs
echo  ============================================================
echo.
pause
endlocal
