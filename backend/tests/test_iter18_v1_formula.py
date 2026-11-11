# Iteration 18: injection kf formula V1*C1 = Vtotal*Cpi -> v1_l, instruction, fluid_name; save + PDF regression
import base64
import io
import os

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
KF = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
      "k_factor": 0.135, "factor_f": 1.093, "desired_index_pct": 2, "fluid_index_pct": 25}
SHEET = {"condicion_general": "rutinario", "condiciones": ["obesidad_moderada", "diabetes_vascular"],
         "peso": "80", "altura": "175"}


@pytest.fixture
def s():
    return requests.Session()


def calc(s, inputs):
    return s.post(f"{API}/calculate", json={"type": "injection", "inputs": inputs})


# --- formula ---
def test_v1_formula_basic(s):
    r = calc(s, KF)
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["total_l"] == 8.93
    # V1 = Vtotal * Cpi / C1 = 8.93 * 2 / 25 = 0.714 -> 0.71
    assert res["v1_l"] == round(res["total_ml"] * 2 / 25 / 1000, 2) == 0.71
    assert res["instruction"] == "Agregar 0.71 L de Arterial Index 25% a la bomba de inyección"
    assert res["fluid_name"] == ""
    # water = Vtotal - V1 - coinj
    assert res["water_ml"] == pytest.approx(res["total_ml"] - res["concentrate_ml"], abs=1)
    s_txt = r.json()["summary"]
    assert "V1 = Vtotal x Cpi / C1" in s_txt and "0.71 L" in s_txt


def test_v1_with_fluid_name_and_coinj(s):
    inp = {**KF, "fluid_name": "TEST_Permaglo", "coinjectors": [{"name": "TEST_Hum", "reason": "x", "volume_ml": 500}]}
    r = calc(s, inp)
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["fluid_name"] == "TEST_Permaglo"
    assert res["instruction"] == "Agregar 0.71 L de Arterial TEST_Permaglo Index 25% a la bomba de inyección"
    assert res["coinjectors_ml"] == 500
    assert res["water_ml"] == pytest.approx(res["total_ml"] - res["concentrate_ml"] - 500, abs=1)


def test_v1_decimal_index_formatting(s):
    r = calc(s, {**KF, "fluid_index_pct": 18.5, "desired_index_pct": 1.5})
    assert r.status_code == 200
    res = r.json()["results"]
    assert "Index 18.5%" in res["instruction"]
    assert res["v1_l"] == round(res["total_ml"] * 1.5 / 18.5 / 1000, 2)


@pytest.mark.parametrize("c1,c2", [(0, 2), (25, 0), (2, 25)])
def test_v1_invalid_index(s, c1, c2):
    r = calc(s, {**KF, "fluid_index_pct": c1, "desired_index_pct": c2})
    assert r.status_code == 400


def test_v1_coinj_exceeds_total(s):
    r = calc(s, {**KF, "coinjectors": [{"name": "TEST_x", "volume_ml": 9000}]})
    assert r.status_code == 400


@pytest.mark.parametrize("k", [0.1, 0.18])
def test_k_bounds_inclusive(s, k):
    assert calc(s, {**KF, "k_factor": k}).status_code == 200


# --- save to case + PDF ---
def test_save_and_pdf_contains_v1(s):
    c = s.post(f"{API}/cases", json={"deceased_name": "TEST_iter18_v1", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    try:
        assert s.put(f"{API}/cases/{cid}/sheet", json={"sheet": SHEET}).status_code == 200
        inp = {**KF, "fluid_name": "TEST_Permaglo"}
        r = s.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": inp})
        assert r.status_code == 200, r.text
        assert r.json()["calculation"]["results"]["v1_l"] == 0.71
        g = s.get(f"{API}/cases/{cid}").json()["case"]
        last = g["calculations"][-1]
        assert last["results"]["instruction"].startswith("Agregar 0.71 L de Arterial TEST_Permaglo")
        rp = s.get(f"{API}/cases/{cid}/report")
        assert rp.status_code == 200, rp.text
        raw = base64.b64decode(rp.json()["pdf_base64"])
        t = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(raw)).pages)
        t_flat = " ".join(t.split())
        for frag in ["Resumen K y F", "Arterial V1", "0.71 L", "C punto de inyeccion",
                     "Agregar 0.71 L de Arterial TEST_Permaglo Index 25%", "Agua a agregar en la bomba"]:
            assert frag in t_flat, f"missing {frag!r}"
    finally:
        s.delete(f"{API}/cases/{cid}")
