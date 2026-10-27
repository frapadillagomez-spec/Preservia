"""Preservia backend – Factor de corrección F (condiciones del cuerpo) tests.

Covers: compute_factor_f unit rules, /api/calculate volume & injection with
case_type='sheet' + factor_f (clamped 0.75-1.35), sheet condiciones persistence
and PDF report rows 'Condicion del cuerpo' / 'Factor de correccion F sugerido'.
"""
import base64
import os
import sys
from io import BytesIO
from pathlib import Path

import pytest
import requests
from pypdf import PdfReader


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


API = f"{_load_base_url()}/api"
state = {}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    yield sess
    if state.get("case_id"):
        sess.delete(f"{API}/cases/{state['case_id']}", timeout=20)


# ---- compute_factor_f unit tests (import server module directly) ----
@pytest.fixture(scope="module")
def srv():
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import server  # noqa
    return server


def test_unit_single_condition(srv):
    r = srv.compute_factor_f(["diabetes_vascular"])
    assert r["f"] == 1.15 and r["adjustment_pct"] == 0 and r["secondary"] is None


def test_unit_dominant_plus_small_second(srv):
    r = srv.compute_factor_f(["obesidad_moderada", "diabetes_vascular"])
    assert r["dominant"] == "diabetes_vascular"
    assert r["secondary"] == "obesidad_moderada"
    assert r["adjustment_pct"] == -5
    assert r["f"] == 1.093


def test_unit_large_second_10pct(srv):
    # dominant putrefaccion_avanzada 1.275 (dev .275), second autopsiado 1.225 (dev .225 >.10) => +10% => 1.4025 -> clamp 1.35
    r = srv.compute_factor_f(["autopsiado", "putrefaccion_avanzada"])
    assert r["dominant"] == "putrefaccion_avanzada" and r["adjustment_pct"] == 10
    assert r["f"] == 1.35


def test_unit_clamp_low(srv):
    # anasarca 0.80 dominant, edema_generalizado 0.85 (dev .15) => -10% => 0.72 -> 0.75
    r = srv.compute_factor_f(["anasarca", "edema_generalizado"])
    assert r["f"] == 0.75 and r["adjustment_pct"] == -10


def test_unit_rutinario_second_no_adjust(srv):
    r = srv.compute_factor_f(["rutinario", "ictericia"])
    assert r["dominant"] == "ictericia" and r["adjustment_pct"] == 0 and r["f"] == 1.05


def test_unit_empty_and_unknown(srv):
    assert srv.compute_factor_f([]) is None
    assert srv.compute_factor_f(["foo"]) is None


# ---- /api/calculate with case_type sheet ----
def test_calc_volume_sheet_factor(s):
    r = s.post(f"{API}/calculate", json={"type": "volume", "inputs": {"weight_kg": 70, "case_type": "sheet", "factor_f": 1.2}}, timeout=20)
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["liters"] == 14.02
    assert res["adjustment"] == "x1.2"
    assert res["case_type"] == "Factor F (hoja del caso)"


@pytest.mark.parametrize("ff,expected", [(2.0, "x1.35"), (0.1, "x0.75")])
def test_calc_volume_sheet_clamped(s, ff, expected):
    r = s.post(f"{API}/calculate", json={"type": "volume", "inputs": {"weight_kg": 70, "case_type": "sheet", "factor_f": ff}}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["results"]["adjustment"] == expected


def test_calc_volume_sheet_invalid_factor(s):
    r = s.post(f"{API}/calculate", json={"type": "volume", "inputs": {"weight_kg": 70, "case_type": "sheet", "factor_f": "abc"}}, timeout=20)
    assert r.status_code == 400


def test_calc_volume_regression_normal_jaundice_edema(s):
    out = {}
    for ct in ["normal", "jaundice", "edema"]:
        r = s.post(f"{API}/calculate", json={"type": "volume", "inputs": {"weight_kg": 70, "case_type": ct}}, timeout=20)
        assert r.status_code == 200
        out[ct] = r.json()["results"]["adjustment"]
    assert out == {"normal": "x1.0", "jaundice": "x1.15", "edema": "x0.85"}


def test_calc_injection_sheet_factor(s):
    base = {"weight_kg": 70, "height_cm": 170, "sex": "male", "fluid_index_pct": 25, "desired_index_pct": 2}
    r0 = s.post(f"{API}/calculate", json={"type": "injection", "inputs": {**base, "case_type": "normal"}}, timeout=20)
    r1 = s.post(f"{API}/calculate", json={"type": "injection", "inputs": {**base, "case_type": "sheet", "factor_f": 1.093}}, timeout=20)
    assert r0.status_code == 200 and r1.status_code == 200, r1.text
    n, f = r0.json()["results"], r1.json()["results"]
    assert f["adjustment"] == "x1.093"
    assert f["case_type"] == "Factor F (hoja del caso)"
    assert abs(f["total_ml"] - n["total_ml"] * 1.093) <= 2
    assert abs(f["recommended_l"] - n["recommended_l"] * 1.093) <= 0.02


# ---- Sheet condiciones persistence + PDF ----
def test_create_case_and_save_condiciones(s):
    r = s.post(f"{API}/cases", json={"name": "TEST_FactorF", "deceased_name": "TEST Difunto"}, timeout=20)
    assert r.status_code == 200
    state["case_id"] = r.json()["case"]["case_id"]
    sheet = {"nombre_difunto": "TEST Difunto", "peso": "70", "altura": "170",
             "condiciones": ["obesidad_moderada", "diabetes_vascular"]}
    r = s.put(f"{API}/cases/{state['case_id']}/sheet", json={"sheet": sheet}, timeout=20)
    assert r.status_code == 200
    g = s.get(f"{API}/cases/{state['case_id']}", timeout=20).json()["case"]
    assert g["case_sheet"]["condiciones"] == ["obesidad_moderada", "diabetes_vascular"]
    assert "_id" not in g


def test_report_pdf_has_factor_rows(s):
    r = s.get(f"{API}/cases/{state['case_id']}/report", timeout=60)
    assert r.status_code == 200
    raw = base64.b64decode(r.json()["pdf_base64"])
    text = "\n".join(p.extract_text() or "" for p in PdfReader(BytesIO(raw)).pages)
    flat = " ".join(text.split())
    assert "Condicion del cuerpo" in flat
    assert "Factor de correccion F sugerido" in flat
    assert "F = 1.093" in flat
    assert "-5%" in flat
