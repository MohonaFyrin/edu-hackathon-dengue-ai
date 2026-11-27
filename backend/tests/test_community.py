"""Map data endpoints and citizen field reports (validation, idempotency, safe photo handling)."""
import base64
import uuid

import pytest
from fastapi.testclient import TestClient

import app as core
import community

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(community, "VAR", tmp_path)
    monkeypatch.setattr(community, "DB", tmp_path / "reports.db")
    monkeypatch.setattr(community, "PHOTOS", tmp_path / "photos")
    with TestClient(core.app) as c:
        yield c


def body(**kw):
    return {"client_id": uuid.uuid4().hex, "category": "waterlogging", "ward_id": "DNCC_Ward_01", **kw}


def test_districts_are_real_outlines(client):
    d = client.get("/api/geo/districts").json()
    assert {x["district"] for x in d["districts"]} == {"Dhaka", "Gazipur", "Narayanganj", "Chattogram"}
    assert "CC BY" in d["license"] and all(len(r) > 20 for x in d["districts"] for r in x["rings"][:1])


def test_facilities_endpoint_is_safe_without_data(client):
    r = client.get("/api/facilities", params={"city": "Dhaka North", "type": "hospital"})
    assert r.status_code == 200 and "facilities" in r.json()
    assert client.get("/api/facilities", params={"type": "casino"}).status_code == 422


def test_report_is_stored_and_listed_without_personal_data(client):
    r = client.post("/api/reports", json=body(note="Water standing near the school", lat=23.81, lon=90.41))
    assert r.status_code == 201 and r.json()["stored"] is True
    rep = r.json()["report"]
    assert rep["city"] == "Dhaka North" and rep["status"] == "new" and "client_id" not in rep
    listed = client.get("/api/reports", params={"city": "Dhaka North"}).json()
    assert listed["counts"]["new"] == 1 and listed["reports"][0]["id"] == rep["id"]
    assert client.get("/api/reports").headers["cache-control"] == "no-store"


def test_duplicate_submission_is_not_stored_twice(client):
    b = body()
    first, again = client.post("/api/reports", json=b).json(), client.post("/api/reports", json=b).json()
    assert again["duplicate"] is True and again["report"]["id"] == first["report"]["id"]
    assert client.get("/api/reports").json()["counts"]["new"] == 1


def test_photo_is_validated_by_content(client):
    ok = client.post("/api/reports", json=body(photo=f"data:image/png;base64,{PNG}"))
    assert ok.status_code == 201 and ok.json()["report"]["has_photo"]
    rid = ok.json()["report"]["id"]
    img = client.get(f"/api/reports/{rid}/photo")
    assert img.status_code == 200 and img.headers["x-content-type-options"] == "nosniff"
    fake = base64.b64encode(b"<script>alert(1)</script>").decode()
    assert client.post("/api/reports", json=body(photo=f"data:image/png;base64,{fake}")).status_code == 422
    assert client.post("/api/reports", json=body(photo="data:text/html;base64,AAAA")).status_code == 422
    assert client.get("/api/reports/../../app.py/photo").status_code == 404


def test_invalid_reports_are_rejected(client):
    assert client.post("/api/reports", json=body(ward_id="Nope")).status_code == 404
    assert client.post("/api/reports", json=body(category="noise")).status_code == 422
    assert client.post("/api/reports", json=body(note="x" * 301)).status_code == 422
    assert client.post("/api/reports", json=body(lat=51.5, lon=0.1)).status_code == 422
    assert client.post("/api/reports", json=body(client_id="a b; DROP TABLE reports")).status_code == 422


def test_officer_can_update_status(client):
    rid = client.post("/api/reports", json=body()).json()["report"]["id"]
    assert client.post(f"/api/reports/{rid}/status", json={"status": "resolved"}).json()["report"]["status"] == "resolved"
    assert client.post("/api/reports/unknown/status", json={"status": "resolved"}).status_code == 404
    assert client.post(f"/api/reports/{rid}/status", json={"status": "deleted"}).status_code == 422
