"""Preservia backend API tests — full flow: auth, cases, calculations, notes, report."""
import os
import base64
import uuid
import requests
import pytest

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # frontend .env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

API = f"{BASE_URL}/api"
UNIQUE = uuid.uuid4().hex[:8]
USER_A = {"email": f"test_a_{UNIQUE}@preservia.com", "password": "secret123", "name": "TEST User A"}
USER_B = {"email": f"test_b_{UNIQUE}@preservia.com", "password": "secret123", "name": "TEST User B"}

state = {}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------- Auth ----------
def test_register_user_a(s):
    r = s.post(f"{API}/auth/register", json=USER_A, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "access_token" in d and d["user"]["email"] == USER_A["email"]
    state["token_a"] = d["access_token"]
    state["user_a"] = d["user"]


def test_duplicate_email_400(s):
    r = s.post(f"{API}/auth/register", json=USER_A, timeout=20)
    assert r.status_code == 400


def test_login_success(s):
    r = s.post(f"{API}/auth/login", json={"email": USER_A["email"], "password": USER_A["password"]}, timeout=20)
    assert r.status_code == 200
    assert r.json()["user"]["email"] == USER_A["email"]


def test_login_bad_password_401(s):
    r = s.post(f"{API}/auth/login", json={"email": USER_A["email"], "password": "wrong"}, timeout=20)
    assert r.status_code == 401


def test_me_endpoint(s):
    r = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {state['token_a']}"}, timeout=20)
    assert r.status_code == 200
    assert r.json()["user"]["email"] == USER_A["email"]


def test_me_without_token_401(s):
    r = s.get(f"{API}/auth/me", timeout=20)
    assert r.status_code == 401


def test_google_endpoint_rejects_bad_session(s):
    # Cannot fully test Google flow; verify endpoint exists and rejects invalid session
    r = s.post(f"{API}/auth/google", json={"session_id": "invalid_session_xyz"}, timeout=25)
    assert r.status_code == 401


# ---------- Calculators ----------
def _auth(): return {"Authorization": f"Bearer {state['token_a']}"}


def test_calc_volume(s):
    r = s.post(f"{API}/calculate", headers=_auth(),
               json={"type": "volume", "inputs": {"weight_kg": 70}}, timeout=20)
    assert r.status_code == 200
    d = r.json()
    # 70 kg * 2.20462 = 154.32 lb / 50 = 3.086 gal * 3.78541 = ~11.68 L
    assert 11.0 <= d["results"]["liters"] <= 12.5
    assert "L de solucion" in d["summary"]


def test_calc_lbm_male(s):
    r = s.post(f"{API}/calculate", headers=_auth(),
               json={"type": "lbm", "inputs": {"weight_kg": 70, "height_cm": 172, "sex": "male"}}, timeout=20)
    assert r.status_code == 200
    d = r.json()
    # 0.407*70 + 0.267*172 - 19.2 = 28.49 + 45.924 - 19.2 = 55.2
    assert 54.0 <= d["results"]["lbm_kg"] <= 56.5


def test_calc_lbm_female(s):
    r = s.post(f"{API}/calculate", headers=_auth(),
               json={"type": "lbm", "inputs": {"weight_kg": 60, "height_cm": 165, "sex": "female"}}, timeout=20)
    assert r.status_code == 200
    # 0.252*60 + 0.473*165 - 48.3 = 15.12 + 78.045 - 48.3 = 44.865
    assert 43.0 <= r.json()["results"]["lbm_kg"] <= 46.5


def test_calc_concentration(s):
    r = s.post(f"{API}/calculate", headers=_auth(),
               json={"type": "concentration",
                     "inputs": {"total_solution_l": 4, "desired_index_pct": 2, "fluid_index_pct": 25}}, timeout=20)
    assert r.status_code == 200
    d = r.json()
    # (2/25)*4*1000 = 320 mL concentrate; 3680 mL water; 4000 total
    assert d["results"]["concentrate_ml"] == 320
    assert d["results"]["water_ml"] == 3680
    assert d["results"]["total_ml"] == 4000


def test_calc_invalid_400(s):
    r = s.post(f"{API}/calculate", headers=_auth(),
               json={"type": "volume", "inputs": {}}, timeout=20)
    assert r.status_code == 400


def test_calc_unknown_type_400(s):
    r = s.post(f"{API}/calculate", headers=_auth(),
               json={"type": "unknown", "inputs": {"x": 1}}, timeout=20)
    assert r.status_code == 400


# ---------- Cases CRUD ----------
def test_create_case(s):
    r = s.post(f"{API}/cases", headers=_auth(),
               json={"name": "TEST Case Alpha", "case_ref": "REF-001", "deceased_name": "TEST Deceased"},
               timeout=20)
    assert r.status_code == 200
    c = r.json()["case"]
    assert c["name"] == "TEST Case Alpha" and c["case_ref"] == "REF-001"
    assert "_id" not in c
    state["case_id"] = c["case_id"]


def test_list_cases_contains(s):
    r = s.get(f"{API}/cases", headers=_auth(), timeout=20)
    assert r.status_code == 200
    ids = [c["case_id"] for c in r.json()["cases"]]
    assert state["case_id"] in ids


def test_get_case(s):
    r = s.get(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert r.status_code == 200
    c = r.json()["case"]
    assert c["case_id"] == state["case_id"]
    assert isinstance(c.get("notes"), list)


def test_update_case(s):
    r = s.put(f"{API}/cases/{state['case_id']}", headers=_auth(),
              json={"name": "TEST Case Alpha Updated", "case_ref": "REF-002"}, timeout=20)
    assert r.status_code == 200
    # verify via GET
    r2 = s.get(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert r2.json()["case"]["name"] == "TEST Case Alpha Updated"
    assert r2.json()["case"]["case_ref"] == "REF-002"


# ---------- Isolation: user B cannot access user A's case ----------
def test_user_isolation(s):
    r = s.post(f"{API}/auth/register", json=USER_B, timeout=20)
    assert r.status_code == 200
    token_b = r.json()["access_token"]
    state["token_b"] = token_b
    r2 = s.get(f"{API}/cases/{state['case_id']}", headers={"Authorization": f"Bearer {token_b}"}, timeout=20)
    assert r2.status_code == 404
    r3 = s.get(f"{API}/cases", headers={"Authorization": f"Bearer {token_b}"}, timeout=20)
    assert r3.json()["cases"] == []


# ---------- Calculations on case ----------
def test_add_calculation_to_case(s):
    r = s.post(f"{API}/cases/{state['case_id']}/calculations", headers=_auth(),
               json={"type": "volume", "inputs": {"weight_kg": 80}}, timeout=20)
    assert r.status_code == 200
    calc = r.json()["calculation"]
    assert calc["type"] == "volume" and calc["summary"]
    state["calc_id"] = calc["calc_id"]
    # Verify persisted
    r2 = s.get(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert any(c["calc_id"] == state["calc_id"] for c in r2.json()["case"]["calculations"])


def test_delete_calculation(s):
    r = s.delete(f"{API}/cases/{state['case_id']}/calculations/{state['calc_id']}",
                 headers=_auth(), timeout=20)
    assert r.status_code == 200
    r2 = s.get(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert not any(c["calc_id"] == state["calc_id"] for c in r2.json()["case"]["calculations"])


# ---------- Notes ----------
# 1x1 PNG base64
PNG_1X1 = ("data:image/png;base64,"
           "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


def test_add_note(s):
    r = s.post(f"{API}/cases/{state['case_id']}/notes", headers=_auth(),
               json={"text": "TEST first note", "photos": [PNG_1X1]}, timeout=20)
    assert r.status_code == 200
    n = r.json()["note"]
    assert n["text"] == "TEST first note" and len(n["photos"]) == 1
    state["note_id"] = n["note_id"]


def test_note_visible_in_case(s):
    r = s.get(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert any(n["note_id"] == state["note_id"] for n in r.json()["case"]["notes"])


def test_delete_note(s):
    # re-add note first (we still need one for the PDF test)
    r_add_extra = s.post(f"{API}/cases/{state['case_id']}/notes", headers=_auth(),
                         json={"text": "TEST note kept for pdf", "photos": []}, timeout=20)
    assert r_add_extra.status_code == 200
    r = s.delete(f"{API}/notes/{state['note_id']}", headers=_auth(), timeout=20)
    assert r.status_code == 200
    r2 = s.get(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert not any(n["note_id"] == state["note_id"] for n in r2.json()["case"]["notes"])


# ---------- PDF Report ----------
def test_generate_pdf_report(s):
    # add a calc for richer PDF
    s.post(f"{API}/cases/{state['case_id']}/calculations", headers=_auth(),
           json={"type": "lbm", "inputs": {"weight_kg": 70, "height_cm": 172, "sex": "male"}}, timeout=20)
    r = s.get(f"{API}/cases/{state['case_id']}/report", headers=_auth(), timeout=40)
    assert r.status_code == 200
    d = r.json()
    assert d["mime"] == "application/pdf"
    assert d["filename"].endswith(".pdf")
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF", f"Not a valid PDF header: {raw[:8]}"
    assert len(raw) > 1000


# ---------- Delete case ----------
def test_delete_case(s):
    r = s.delete(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert r.status_code == 200
    r2 = s.get(f"{API}/cases/{state['case_id']}", headers=_auth(), timeout=20)
    assert r2.status_code == 404
