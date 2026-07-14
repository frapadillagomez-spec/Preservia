"""Preservia backend – NO-AUTH mode integration tests.
Tests all /api endpoints work WITHOUT Authorization header. All data is stored
under a single shared local user 'local_user'.
"""
import os
import base64
from pathlib import Path
import requests
import pytest


def _load_base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
                break
    if not url:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not configured")
    return url.rstrip("/")


BASE_URL = _load_base_url()
API = f"{BASE_URL}/api"

state = {}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    # Explicitly set NO Authorization header. Content-Type json only.
    sess.headers.update({"Content-Type": "application/json"})
    yield sess
    # Cleanup created case
    cid = state.get("case_id")
    if cid:
        try:
            sess.delete(f"{API}/cases/{cid}", timeout=15)
        except Exception:
            pass


# ---- Sanity: /auth/me returns the static local_user ----
def test_auth_me_no_token_returns_local_user(s):
    r = s.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u["user_id"] == "local_user"
    assert u["provider"] == "local"


# ---- Cases: list without auth ----
def test_list_cases_no_auth(s):
    r = s.get(f"{API}/cases", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json().get("cases"), list)


def test_create_case_no_auth(s):
    r = s.post(
        f"{API}/cases",
        json={
            "name": "TEST NoAuth Case",
            "case_ref": "TEST-NA-01",
            "deceased_name": "TEST Deceased",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    c = r.json()["case"]
    assert c["name"] == "TEST NoAuth Case"
    assert c["user_id"] == "local_user"
    assert c["status"] == "active"
    assert "_id" not in c
    state["case_id"] = c["case_id"]


def test_get_case_no_auth(s):
    r = s.get(f"{API}/cases/{state['case_id']}", timeout=15)
    assert r.status_code == 200
    c = r.json()["case"]
    assert c["case_id"] == state["case_id"]
    assert isinstance(c.get("notes"), list)
    assert isinstance(c.get("calculations"), list)


# ---- Archive / unarchive ----
def test_patch_status_archive_no_auth(s):
    r = s.patch(
        f"{API}/cases/{state['case_id']}/status",
        json={"status": "archived"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["case"]["status"] == "archived"
    # verify via GET
    r2 = s.get(f"{API}/cases/{state['case_id']}", timeout=15)
    assert r2.json()["case"]["status"] == "archived"


def test_patch_status_unarchive_no_auth(s):
    r = s.patch(
        f"{API}/cases/{state['case_id']}/status",
        json={"status": "active"},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["case"]["status"] == "active"


def test_patch_status_invalid_400(s):
    r = s.patch(
        f"{API}/cases/{state['case_id']}/status",
        json={"status": "bogus"},
        timeout=15,
    )
    assert r.status_code == 400


# ---- Calculations on case (no auth) ----
def test_add_calculation_no_auth(s):
    r = s.post(
        f"{API}/cases/{state['case_id']}/calculations",
        json={"type": "volume", "inputs": {"weight_kg": 75}},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    calc = r.json()["calculation"]
    assert calc["type"] == "volume"
    assert "L de solucion" in calc["summary"]
    state["calc_id"] = calc["calc_id"]
    # verify persisted
    r2 = s.get(f"{API}/cases/{state['case_id']}", timeout=15)
    assert any(c["calc_id"] == state["calc_id"] for c in r2.json()["case"]["calculations"])


def test_add_lbm_calc_no_auth(s):
    r = s.post(
        f"{API}/cases/{state['case_id']}/calculations",
        json={"type": "lbm", "inputs": {"weight_kg": 70, "height_cm": 172, "sex": "male"}},
        timeout=15,
    )
    assert r.status_code == 200
    d = r.json()["calculation"]["results"]
    assert 54.0 <= d["lbm_kg"] <= 56.5


# ---- Notes (no auth, and photos-optional) ----
def test_add_note_no_photos_no_auth(s):
    r = s.post(
        f"{API}/cases/{state['case_id']}/notes",
        json={"text": "TEST note without photos"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    n = r.json()["note"]
    assert n["text"] == "TEST note without photos"
    assert n["photos"] == []
    state["note_id"] = n["note_id"]
    # verify persisted via case GET
    r2 = s.get(f"{API}/cases/{state['case_id']}", timeout=15)
    assert any(nn["note_id"] == state["note_id"] for nn in r2.json()["case"]["notes"])


# ---- PDF report (no auth) ----
def test_pdf_report_no_auth(s):
    r = s.get(f"{API}/cases/{state['case_id']}/report", timeout=40)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["mime"] == "application/pdf"
    assert d["filename"].endswith(".pdf")
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF"
    assert len(raw) > 1000


# ---- /api/stats no auth ----
def test_stats_no_auth(s):
    r = s.get(f"{API}/stats", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("totals", "monthly", "calc_breakdown", "recent_cases"):
        assert key in d, f"missing key {key}"
    t = d["totals"]
    for key in ("cases", "calculations", "notes", "active_cases", "archived_cases", "cases_last_30_days"):
        assert key in t
    assert t["cases"] >= 1  # at least our created case
    # monthly: 6 buckets
    assert isinstance(d["monthly"], list) and len(d["monthly"]) == 6
    assert all({"key", "label", "count"} <= set(m.keys()) for m in d["monthly"])
    # calc_breakdown 3 items
    types = {c["type"] for c in d["calc_breakdown"]}
    assert types == {"volume", "lbm", "concentration"}
    # recent contains our case
    assert any(rc["case_id"] == state["case_id"] for rc in d["recent_cases"])


# ---- Delete note & calc cleanup ----
def test_delete_note_no_auth(s):
    r = s.delete(f"{API}/notes/{state['note_id']}", timeout=15)
    assert r.status_code == 200
    r2 = s.get(f"{API}/cases/{state['case_id']}", timeout=15)
    assert not any(n["note_id"] == state["note_id"] for n in r2.json()["case"]["notes"])


def test_delete_calc_no_auth(s):
    r = s.delete(
        f"{API}/cases/{state['case_id']}/calculations/{state['calc_id']}",
        timeout=15,
    )
    assert r.status_code == 200


# ---- Case not found ----
def test_case_not_found_404(s):
    r = s.get(f"{API}/cases/does_not_exist_xyz", timeout=15)
    assert r.status_code == 404
