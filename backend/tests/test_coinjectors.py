# Co-injectors in injection mode 'kf': water = Vtotal - V1 - sum(co-injectors), validation, case save, PDF
import base64
import io
import os

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
KF = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
      "k_factor": 0.135, "factor_f": 1.093, "desired_index_pct": 2, "fluid_index_pct": 25}
CI = [{"name": "Humectante", "reason": "Deshidratacion", "volume_ml": 473}]


@pytest.fixture
def s():
    return requests.Session()


def calc(s, inputs):
    return s.post(f"{BASE_URL}/api/calculate", json={"type": "injection", "inputs": inputs})


def test_with_coinjector(s):
    r = calc(s, {**KF, "coinjectors": CI})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["total_l"] == 8.93
    assert res["concentrate_ml"] == 714
    assert res["coinjectors_ml"] == 473
    assert res["water_ml"] == 7741
    assert res["coinjectors"][0]["name"] == "Humectante"
    assert res["coinjectors"][0]["reason"] == "Deshidratacion"
    assert res["coinjectors"][0]["volume_ml"] == 473
    assert "co-inyectores 473" in r.json()["summary"]


def test_multiple_coinjectors(s):
    r = calc(s, {**KF, "coinjectors": CI + [{"name": "B", "reason": "R", "volume_ml": 200.5}]})
    assert r.status_code == 200
    res = r.json()["results"]
    assert res["coinjectors_ml"] == round(673.5, 0)
    assert abs(res["water_ml"] - (8214 - 673.5)) <= 1


def test_without_coinjectors(s):
    for extra in ({}, {"coinjectors": []}):
        r = calc(s, {**KF, **extra})
        assert r.status_code == 200
        res = r.json()["results"]
        assert res["water_ml"] == 8214
        assert res["coinjectors_ml"] == 0


@pytest.mark.parametrize("item", [
    {"name": "", "reason": "x", "volume_ml": 100},
    {"name": "   ", "reason": "x", "volume_ml": 100},
    {"name": "A", "reason": "x", "volume_ml": 0},
    {"name": "A", "reason": "x", "volume_ml": -5},
])
def test_invalid_coinjector(s, item):
    r = calc(s, {**KF, "coinjectors": [item]})
    assert r.status_code == 400, r.text


def test_coinjectors_exceed_total(s):
    r = calc(s, {**KF, "coinjectors": [{"name": "A", "reason": "x", "volume_ml": 8300}]})
    assert r.status_code == 400
    assert "superan" in r.text


def test_save_to_case_and_pdf(s):
    c = s.post(f"{BASE_URL}/api/cases", json={"deceased_name": "TEST_coinj", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    try:
        r = s.post(f"{BASE_URL}/api/cases/{cid}/calculations",
                   json={"type": "injection", "inputs": {**KF, "coinjectors": CI}})
        assert r.status_code == 200, r.text
        assert r.json()["calculation"]["results"]["water_ml"] == 7741
        g = s.get(f"{BASE_URL}/api/cases/{cid}").json()["case"]
        last = g["calculations"][-1]
        assert last["inputs"]["coinjectors"][0]["name"] == "Humectante"
        assert last["inputs"]["coinjectors"][0]["volume_ml"] == 473
        rep = s.get(f"{BASE_URL}/api/cases/{cid}/report")
        assert rep.status_code == 200
        pdf = base64.b64decode(rep.json()["pdf_base64"])
        text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
        flat = " ".join(text.split())
        print("PDF snippet:", flat[flat.find("Co-iny") - 20: flat.find("Co-iny") + 80])
        assert "Co-inyectores: Humectante (Deshidratacion) 473 mL" in flat
    finally:
        s.delete(f"{BASE_URL}/api/cases/{cid}")
