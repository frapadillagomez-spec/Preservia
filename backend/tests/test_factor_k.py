"""Preservia backend – Factor K de condición general tests.

Covers: /api/calculate type 'kvolume' (V = K x masa magra x F), K range validation,
injection optional k_factor, case_sheet.condicion_general persistence, saving kvolume
to a case, PDF row 'Condicion general (Factor K)'.
"""
import base64
import os
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
BASE = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average"}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    yield sess
    if state.get("case_id"):
        sess.delete(f"{API}/cases/{state['case_id']}", timeout=20)


def calc(s, t, inputs):
    return s.post(f"{API}/calculate", json={"type": t, "inputs": inputs}, timeout=20)


# ---- kvolume calculation ----
def test_kvolume_sheet_factor(s):
    r = calc(s, "kvolume", {**BASE, "k_factor": 0.135, "case_type": "sheet", "factor_f": 1.093})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["volume_l"] == 8.93
    assert res["k_factor"] == 0.135
    assert res["factor_f"] == 1.093
    assert res["lbm_kg"] == 60.5
    assert res["case_type"] == "Factor F (hoja del caso)"
    assert "8.93" in r.json()["summary"]


@pytest.mark.parametrize("ct,f", [("normal", 1.0), ("jaundice", 1.15), ("edema", 0.85)])
def test_kvolume_case_types(s, ct, f):
    r = calc(s, "kvolume", {**BASE, "k_factor": 0.135, "case_type": ct})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["factor_f"] == f
    assert abs(res["volume_l"] - 0.135 * 60.505 * f) <= 0.02


@pytest.mark.parametrize("k", [0.10, 0.18])
def test_kvolume_k_bounds_inclusive(s, k):
    r = calc(s, "kvolume", {**BASE, "k_factor": k})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("k", [0.09, 0.19, 0.5, "abc", None])
def test_kvolume_k_invalid(s, k):
    inputs = {**BASE, "k_factor": k}
    r = calc(s, "kvolume", inputs)
    assert r.status_code == 400, r.text


def test_kvolume_missing_k(s):
    r = calc(s, "kvolume", dict(BASE))
    assert r.status_code == 400


def test_kvolume_female_and_method(s):
    r = calc(s, "kvolume", {"weight_kg": 60, "height_cm": 160, "sex": "female", "lbm_method": "boer", "k_factor": 0.11})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    boer = 0.252 * 60 + 0.473 * 160 - 48.3
    assert res["lbm_method"] == "Boer"
    assert abs(res["volume_l"] - 0.11 * boer) <= 0.02


# ---- injection optional k_factor ----
def test_injection_with_k(s):
    inp = {**BASE, "fluid_index_pct": 25, "desired_index_pct": 2, "case_type": "normal"}
    r = calc(s, "injection", {**inp, "k_factor": 0.135})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["recommended_l"] == 8.17
    assert res["k_factor"] == 0.135
    r0 = calc(s, "injection", inp)
    assert r0.status_code == 200
    assert "k_factor" not in r0.json()["results"]
    assert r0.json()["results"]["recommended_l"] != 8.17


def test_injection_k_invalid(s):
    r = calc(s, "injection", {**BASE, "fluid_index_pct": 25, "desired_index_pct": 2, "k_factor": 0.3})
    assert r.status_code == 400


def test_injection_k_with_sheet_f(s):
    r = calc(s, "injection", {**BASE, "fluid_index_pct": 25, "desired_index_pct": 2,
                              "k_factor": 0.135, "case_type": "sheet", "factor_f": 1.093})
    assert r.status_code == 200
    assert r.json()["results"]["recommended_l"] == 8.93


# ---- Case sheet condicion_general + save calc + PDF ----
def test_case_sheet_condicion_general(s):
    r = s.post(f"{API}/cases", json={"name": "TEST_FactorK", "deceased_name": "TEST K"}, timeout=20)
    assert r.status_code == 200
    state["case_id"] = r.json()["case"]["case_id"]
    sheet = {"nombre_difunto": "TEST K", "peso": "80", "altura": "175",
             "condicion_general": "rutinario", "condiciones": ["obesidad_moderada", "diabetes_vascular"]}
    r = s.put(f"{API}/cases/{state['case_id']}/sheet", json={"sheet": sheet}, timeout=20)
    assert r.status_code == 200
    g = s.get(f"{API}/cases/{state['case_id']}", timeout=20).json()["case"]
    assert g["case_sheet"]["condicion_general"] == "rutinario"


def test_save_kvolume_to_case(s):
    r = s.post(f"{API}/cases/{state['case_id']}/calculations",
               json={"type": "kvolume", "inputs": {**BASE, "k_factor": 0.135, "case_type": "sheet", "factor_f": 1.093}},
               timeout=20)
    assert r.status_code == 200, r.text
    c = r.json()["calculation"]
    assert c["label"] == "Volumen por Factor K"
    assert c["results"]["volume_l"] == 8.93
    g = s.get(f"{API}/cases/{state['case_id']}", timeout=20).json()["case"]
    assert any(x["type"] == "kvolume" for x in g["calculations"])


def test_save_kvolume_invalid_k_to_case(s):
    r = s.post(f"{API}/cases/{state['case_id']}/calculations",
               json={"type": "kvolume", "inputs": {**BASE, "k_factor": 0.25}}, timeout=20)
    assert r.status_code == 400


def test_report_pdf_factor_k_row(s):
    r = s.get(f"{API}/cases/{state['case_id']}/report", timeout=60)
    assert r.status_code == 200
    raw = base64.b64decode(r.json()["pdf_base64"])
    text = "\n".join(p.extract_text() or "" for p in PdfReader(BytesIO(raw)).pages)
    flat = " ".join(text.split())
    state["pdf"] = flat
    assert "Condicion general (Factor K)" in flat
    assert "Caso rutinario" in flat
    assert "0.12-0.15" in flat
    assert "0.135" in flat
    assert "Volumen por Factor K" in flat


def test_stats_counts_kvolume(s):
    r = s.get(f"{API}/stats", timeout=20)
    assert r.status_code == 200, r.text
