"""Map Hub data (district outlines, health facilities) and citizen field reports.

* District outlines: geoBoundaries (CC BY 3.0 IGO), stored locally in geo/districts.json.
* Facilities: OpenStreetMap (ODbL), stored locally in geo/facilities.json. Community-mapped, unverified.
* Field reports: SQLite (stdlib) + photo files under var/. No names, phone numbers or accounts are
  collected. The browser re-encodes photos before upload, which removes EXIF/GPS metadata.
"""
from __future__ import annotations

import base64
import math
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import app as core
from common import ROOT

router = APIRouter(prefix="/api")
GEO = ROOT / "geo"
VAR = ROOT / "var"
DB = VAR / "reports.db"
PHOTOS = VAR / "photos"
MAX_PHOTO_BYTES = 1_500_000
MAX_REPORTS = 5000
CATEGORIES = ("waterlogging", "garbage", "sewer", "breeding")
STATUSES = ("new", "reviewed", "resolved")
MAGIC = {b"\xff\xd8\xff": "jpg", b"\x89PNG\r\n\x1a\n": "png"}


@lru_cache(maxsize=4)
def _load(name: str) -> dict | None:
    path = GEO / name
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


@router.get("/geo/districts")
def districts():
    data = _load("districts.json")
    if data is None:
        raise core.ApiError(404, "NO_GEODATA", "District outlines are not installed.")
    return data


@router.get("/facilities")
def facilities(city: str | None = None, type: Literal["hospital", "clinic", "pharmacy"] | None = None,
               limit: int = Query(60, ge=1, le=300),
               lat: float | None = Query(None, ge=20.0, le=27.0), lon: float | None = Query(None, ge=88.0, le=93.0)):
    """With lat/lon (the user's GPS, used only for this request and never stored) results are sorted by
    straight-line distance; otherwise by distance from the city centre. No road distances exist in the data."""
    if city:
        core.need_city(city)
    data = _load("facilities.json")
    if data is None:
        return {"available": False, "facilities": [], "total": 0,
                "note": "Facility data is not installed. Run setup while online."}
    rows = [f for f in data["facilities"] if (not city or f["city"] == city) and (not type or f["type"] == type)]
    if lat is not None and lon is not None:
        k = math.cos(math.radians(lat))
        rows = sorted(({**f, "km_from_you": round(6371 * math.radians(math.hypot((f["lon"] - lon) * k, f["lat"] - lat)), 1)}
                       for f in rows), key=lambda f: (f["km_from_you"], f["id"]))
    return {"available": True, "source": data["source"], "license": data["license"], "retrieved": data["retrieved"],
            "note": data["note"], "total": len(rows), "facilities": rows[:limit]}


# ---------------------------------------------------------------------------
# Field reports
# ---------------------------------------------------------------------------
def _db() -> sqlite3.Connection:
    VAR.mkdir(exist_ok=True)
    PHOTOS.mkdir(exist_ok=True)
    con = sqlite3.connect(DB, timeout=5)
    con.row_factory = sqlite3.Row
    con.execute("""CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, client_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL,
        category TEXT NOT NULL, ward_id TEXT NOT NULL, city TEXT NOT NULL,
        lat REAL, lon REAL, note TEXT NOT NULL DEFAULT '', photo TEXT, status TEXT NOT NULL DEFAULT 'new')""")
    return con


class ReportIn(BaseModel):
    client_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    category: Literal["waterlogging", "garbage", "sewer", "breeding"]
    ward_id: str = Field(max_length=40)
    note: str = Field("", max_length=300)
    lat: float | None = Field(None, ge=20.0, le=27.0)
    lon: float | None = Field(None, ge=88.0, le=93.0)
    photo: str | None = Field(None, max_length=2_100_000, description="data:image/jpeg|png;base64,...")


def _row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["has_photo"] = bool(d.pop("photo"))
    d.pop("client_id")
    return d


def _save_photo(data_url: str, rid: str) -> str:
    head, _, b64 = data_url.partition(",")
    if not head.startswith("data:image/") or ";base64" not in head:
        raise core.ApiError(422, "BAD_PHOTO", "Photo must be a JPEG or PNG image.")
    try:
        raw = base64.b64decode(b64, validate=True)
    except ValueError:
        raise core.ApiError(422, "BAD_PHOTO", "Photo could not be read.")
    if len(raw) > MAX_PHOTO_BYTES:
        raise core.ApiError(413, "PHOTO_TOO_LARGE", "Photo is larger than 1.5 MB.")
    ext = next((e for m, e in MAGIC.items() if raw.startswith(m)), None)
    if ext is None:  # trust the bytes, never the declared type or a client file name
        raise core.ApiError(422, "BAD_PHOTO", "Photo must be a JPEG or PNG image.")
    name = f"{rid}.{ext}"
    (PHOTOS / name).write_bytes(raw)
    return name


@router.post("/reports", status_code=201)
def create_report(body: ReportIn, request: Request):
    if int(request.headers.get("content-length") or 0) > 2_200_000:
        raise core.ApiError(413, "TOO_LARGE", "Report is too large.")
    core.need_ward(body.ward_id)
    con = _db()
    try:
        old = con.execute("SELECT * FROM reports WHERE client_id = ?", (body.client_id,)).fetchone()
        if old:  # same submission sent twice (double tap, retry): return the stored one
            return {"stored": True, "duplicate": True, "report": _row(old)}
        if con.execute("SELECT COUNT(*) FROM reports").fetchone()[0] >= MAX_REPORTS:
            raise core.ApiError(507, "STORE_FULL", "Report storage is full. Please contact the administrator.")
        rid = uuid.uuid4().hex
        photo = _save_photo(body.photo, rid) if body.photo else None
        con.execute("INSERT INTO reports (id, client_id, created_at, category, ward_id, city, lat, lon, note, photo) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (rid, body.client_id, datetime.now(timezone.utc).isoformat(timespec="seconds"), body.category,
                     body.ward_id, core.store().ward_city[body.ward_id], body.lat, body.lon, body.note.strip(), photo))
        con.commit()
        return {"stored": True, "duplicate": False,
                "report": _row(con.execute("SELECT * FROM reports WHERE id = ?", (rid,)).fetchone())}
    finally:
        con.close()


@router.get("/reports")
def list_reports(city: str | None = None, status: Literal["new", "reviewed", "resolved"] | None = None,
                 limit: int = Query(100, ge=1, le=500)):
    if city:
        core.need_city(city)
    con = _db()
    try:
        sql, args = "SELECT * FROM reports WHERE 1=1", []
        if city:
            sql += " AND city = ?"
            args.append(city)
        if status:
            sql += " AND status = ?"
            args.append(status)
        rows = con.execute(sql + " ORDER BY created_at DESC LIMIT ?", (*args, limit)).fetchall()
        counts = dict(con.execute("SELECT status, COUNT(*) FROM reports GROUP BY status").fetchall())
        return {"reports": [_row(r) for r in rows], "counts": {s: counts.get(s, 0) for s in STATUSES}}
    finally:
        con.close()


class StatusIn(BaseModel):
    status: Literal["new", "reviewed", "resolved"]


@router.post("/reports/{report_id}/status")
def set_status(report_id: str, body: StatusIn):
    con = _db()
    try:
        cur = con.execute("UPDATE reports SET status = ? WHERE id = ?", (body.status, report_id))
        con.commit()
        if cur.rowcount == 0:
            raise core.ApiError(404, "UNKNOWN_REPORT", "Unknown report.")
        return {"report": _row(con.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone())}
    finally:
        con.close()


@router.get("/reports/{report_id}/photo")
def report_photo(report_id: str):
    con = _db()
    try:
        r = con.execute("SELECT photo FROM reports WHERE id = ?", (report_id,)).fetchone()
    finally:
        con.close()
    if not r or not r["photo"]:
        raise core.ApiError(404, "NO_PHOTO", "This report has no photo.")
    path = (PHOTOS / r["photo"]).resolve()
    if PHOTOS.resolve() not in path.parents or not path.is_file():  # stored name only; never a client path
        raise core.ApiError(404, "NO_PHOTO", "This report has no photo.")
    return FileResponse(path, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
