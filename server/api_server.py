"""
GRP_SYS — FastAPI backend
=========================
• REST endpoints for cards, users, file uploads, audit logs
• WebSocket endpoint at /ws for live push-updates to all browser clients
• Auto-creates database tables on startup
"""
from __future__ import annotations
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from dotenv import load_dotenv

from database import engine, Base
from ws_manager import manager
from routes import cards, users, files, audit

load_dotenv()

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
]


# ── Lifecycle ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables (safe to run multiple times)
    Base.metadata.create_all(bind=engine)
    # Add columns introduced after initial schema (idempotent).
    # Each patch runs in its own connection so a failure in one never
    # aborts subsequent patches.
    patches = [
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS revision_number INTEGER",
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS assigned_to_name VARCHAR(100)",
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)",
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS customer_company_name VARCHAR(255)",
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS payment_percent INTEGER DEFAULT 0",
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20)",
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS schedule_stage VARCHAR(40)",
        "ALTER TABLE cards ADD COLUMN IF NOT EXISTS assignment_history JSONB",
        "ALTER TABLE remarks ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(200)",
    ]
    for sql in patches:
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
        except Exception as exc:
            print(f"[startup-migration] skipped (already applied or error): {exc}")
    yield


# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="GRP Internal System API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────

app.include_router(cards.router)
app.include_router(users.router)
app.include_router(files.router)
app.include_router(audit.router)


# ── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Clients connect here and receive real-time JSON events.
    Event shape: { "event": "<type>", ...payload }
    Events: card_created | card_updated | card_deleted |
            user_created | user_updated | user_deleted | user_restored |
            doc_uploaded | audit_quotation | audit_work_order
    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; ignore incoming messages from client
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8001"))
    uvicorn.run("api_server:app", host=host, port=port, reload=True)
