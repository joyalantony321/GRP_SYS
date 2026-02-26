"""
Users router — manage users and admin settings (PIN, etc.).
Uses integer FKs: dep_id references departments.dep_id.
"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User, Department, AppSetting
from ws_manager import manager

router = APIRouter(prefix="/users", tags=["users"])


# ── Pydantic schemas ────────────────────────────────────────────────────────

class UserIn(BaseModel):
    username:  str
    pin:       str
    dep_id:    Optional[int] = None


class UserUpdate(BaseModel):
    pin:    Optional[str] = None
    dep_id: Optional[int] = None


class AdminPinUpdate(BaseModel):
    pin: str


# ── Helpers ─────────────────────────────────────────────────────────────────

def _user_to_dict(u: User) -> dict:
    dep_name = u.department.dep_name if u.department else None
    return {
        "userId":    u.user_id,
        "username":  u.username,
        "pin":       u.pin,
        "depId":     u.dep_id,
        "depName":   dep_name,
        "isDeleted": u.is_deleted,
        "deletedAt": u.deleted_at.isoformat() if u.deleted_at else None,
    }


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/")
def list_users(include_deleted: bool = False, db: Session = Depends(get_db)):
    """Return active users (and optionally deleted users)."""
    query = db.query(User)
    if not include_deleted:
        query = query.filter(User.is_deleted == False)  # noqa: E712
    return [_user_to_dict(u) for u in query.all()]


@router.get("/app-data")
def get_app_data(db: Session = Depends(get_db)):
    """Return app data in the format the frontend expects."""
    users   = db.query(User).filter(User.is_deleted == False).all()   # noqa: E712
    deleted = db.query(User).filter(User.is_deleted == True).all()   # noqa: E712
    depts   = db.query(Department).all()
    pin_row = db.query(AppSetting).filter(AppSetting.key == "admin_pin").first()
    admin_pin = pin_row.value if pin_row else "9656"
    return {
        "adminPin":    admin_pin,
        "users":       [_user_to_dict(u) for u in users],
        "deletedUsers":[_user_to_dict(u) for u in deleted],
        "departments": [{"depId": d.dep_id, "depName": d.dep_name} for d in depts],
    }


@router.get("/departments")
def list_departments(db: Session = Depends(get_db)):
    depts = db.query(Department).all()
    return [{"depId": d.dep_id, "depName": d.dep_name} for d in depts]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_user(user_in: UserIn, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user_in.username).first():
        raise HTTPException(status_code=400, detail="User with this username already exists")
    user = User(username=user_in.username, pin=user_in.pin, dep_id=user_in.dep_id)
    db.add(user)
    db.commit()
    db.refresh(user)
    result = _user_to_dict(user)
    await manager.broadcast(json.dumps({"event": "user_created", "user": result}))
    return result


@router.put("/{user_id}")
async def update_user(user_id: int, update: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id, User.is_deleted == False).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if update.pin is not None:
        user.pin = update.pin
    if update.dep_id is not None:
        user.dep_id = update.dep_id
    db.commit()
    db.refresh(user)
    result = _user_to_dict(user)
    await manager.broadcast(json.dumps({"event": "user_updated", "user": result}))
    return result


@router.delete("/{user_id}", status_code=status.HTTP_200_OK)
async def soft_delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id, User.is_deleted == False).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_deleted = True
    user.deleted_at = datetime.now(timezone.utc)
    db.commit()
    await manager.broadcast(json.dumps({"event": "user_deleted", "userId": user_id}))
    return {"detail": "User soft-deleted"}


@router.post("/{user_id}/restore")
async def restore_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id, User.is_deleted == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="Deleted user not found")
    user.is_deleted = False
    user.deleted_at = None
    db.commit()
    db.refresh(user)
    result = _user_to_dict(user)
    await manager.broadcast(json.dumps({"event": "user_restored", "user": result}))
    return result


@router.delete("/{user_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id, User.is_deleted == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="Deleted user not found")
    db.delete(user)
    db.commit()
    await manager.broadcast(json.dumps({"event": "user_permanently_deleted", "userId": user_id}))


@router.put("/settings/admin-pin")
async def update_admin_pin(data: AdminPinUpdate, db: Session = Depends(get_db)):
    row = db.query(AppSetting).filter(AppSetting.key == "admin_pin").first()
    if row:
        row.value = data.pin
    else:
        db.add(AppSetting(key="admin_pin", value=data.pin))
    db.commit()
    await manager.broadcast(json.dumps({"event": "admin_pin_updated"}))
    return {"detail": "Admin PIN updated"}
