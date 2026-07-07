from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from reporting.daily_excel_reports import generate_daily_reports, get_pending_report_details

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/daily/generate")
def generate_daily_report(
    for_date: Optional[str] = Query(default=None, description="Optional date in YYYY-MM-DD format"),
    db: Session = Depends(get_db),
):
    run_date: Optional[date] = None
    if for_date:
        run_date = date.fromisoformat(for_date)

    outputs = generate_daily_reports(db, run_date=run_date)
    return {
        "date": (run_date or date.today()).isoformat(),
        "reports": outputs,
    }


@router.get("/daily/pending-details")
def get_daily_pending_details(
    for_date: Optional[str] = Query(default=None, description="Optional date in YYYY-MM-DD format"),
    db: Session = Depends(get_db),
):
    run_date: Optional[date] = None
    if for_date:
        run_date = date.fromisoformat(for_date)
    return get_pending_report_details(db, run_date=run_date)
