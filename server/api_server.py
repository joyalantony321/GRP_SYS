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

from database import engine, Base, SessionLocal
from models import Department, Channel, List as ListModel
from reporting.daily_excel_reports import start_daily_report_task
from ws_manager import manager
from routes import cards, users, files, audit, reports, work_order_export

load_dotenv()

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
]


def _ensure_bootstrap_data() -> None:
    """Ensure core reference data exists even on pre-existing DB volumes."""
    db = SessionLocal()
    try:
        dep_names = ["Quotation", "Technical", "Accounts", "Delivery & Installation"]
        deps = {d.dep_name: d for d in db.query(Department).all()}
        for dep_name in dep_names:
            if dep_name not in deps:
                dep = Department(dep_name=dep_name)
                db.add(dep)
                deps[dep_name] = dep
        db.flush()

        channels_spec = [
            ("Quotation", "Quotation"),
            ("Work Order", "Accounts"),
        ]
        channels = {c.channel_name: c for c in db.query(Channel).all()}
        for channel_name, dep_name in channels_spec:
            if channel_name not in channels:
                dep = deps.get(dep_name)
                if dep is None:
                    continue
                ch = Channel(channel_name=channel_name, dep_id=dep.dep_id)
                db.add(ch)
                channels[channel_name] = ch
        db.flush()

        q_channel = channels.get("Quotation")
        w_channel = channels.get("Work Order")

        if q_channel is not None:
            q_lists = {"Quotation", "Submittal", "Review", "LPO"}
            existing_q = {
                name for (name,) in db.query(ListModel.list_name).filter(ListModel.channel_id == q_channel.channel_id).all()
            }
            for list_name in q_lists - existing_q:
                db.add(ListModel(list_name=list_name, channel_id=q_channel.channel_id))

        if w_channel is not None:
            # Keep both modern and legacy aliases to remain compatible with existing data.
            w_lists = {"Work Order", "Approval", "Payments", "Schedule", "Accounts", "Delivery", "Installation"}
            existing_w = {
                name for (name,) in db.query(ListModel.list_name).filter(ListModel.channel_id == w_channel.channel_id).all()
            }
            for list_name in w_lists - existing_w:
                db.add(ListModel(list_name=list_name, channel_id=w_channel.channel_id))

        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[startup-bootstrap] failed: {exc}")
    finally:
        db.close()


# ── Lifecycle ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    report_task = None
    # Create all tables (safe to run multiple times)
    Base.metadata.create_all(bind=engine)
    _ensure_bootstrap_data()
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
    try:
        report_task = start_daily_report_task()
    except Exception as exc:
        print(f"[daily-reports] scheduler startup failed: {exc}")

    try:
        yield
    finally:
        if report_task:
            report_task.cancel()


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
app.include_router(reports.router)
app.include_router(work_order_export.router)


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
