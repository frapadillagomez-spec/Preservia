# Iteration 20: bottles per fluid (bottle_ml), fluid templates bottle_ml, mix-sheet PDF + WhatsApp text
import base64
import io
import os

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
SHEET = {"condicion_general": "rutinario", "condiciones": [], "peso": "80", "altura": "175"}
BASE_INP = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
            "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25,
            "fluid_name": "TEST_Arterial"}


@pytest.fixture(scope="module")
def case():
    s = requests.Session()
    c = s.post(f"{API}/cases", json={"name": "TEST_iter20_mix", "deceased_name": "TEST_iter20_mix", "sex": "male", "lot_number": "L-20"}).json()["case"]
    cid = c["case_id"]
    s.put(f"{API}/cases/{cid}/sheet", json={"sheet": SHEET})
    yield cid
    s.delete(f"{API}/cases/{cid}")


# --- calculate: bottles & bottle_ml ---
def test_calc_default_bottle():
    r = requests.post(f"{API}/calculate", json={"type": "injection", "inputs": BASE_INP})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["bottle_ml"] == 473.0
    assert res["bottles"] == pytest.approx(res["v1_l"] * 1000 / 473, abs=0.02)


@pytest.mark.parametrize("bottle", [946, 3785, 500.5])
def test_calc_custom_bottle(bottle):
    r = requests.post(f"{API}/calculate", json={"type": "injection", "inputs": {**BASE_INP, "bottle_ml": bottle}})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["bottle_ml"] == round(bottle, 1)
    assert res["bottles"] == pytest.approx(res["concentrate_ml"] / bottle, abs=0.01)


@pytest.mark.parametrize("bad", [0, -5, "abc", None])
def test_calc_invalid_bottle_falls_back(bad):
    r = requests.post(f"{API}/calculate", json={"type": "injection", "inputs": {**BASE_INP, "bottle_ml": bad}})
    assert r.status_code == 200, r.text
    assert r.json()["results"]["bottle_ml"] == 473.0


# --- fluids with bottle_ml ---
def test_fluid_template_bottle_ml():
    r = requests.post(f"{API}/fluids", json={"name": "TEST_Fluid20", "index_pct": 25, "bottle_ml": 946})
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["bottle_ml"] == 946.0
    try:
        items = requests.get(f"{API}/fluids").json()["items"]
        got = next(i for i in items if i["item_id"] == item["item_id"])
        assert got["bottle_ml"] == 946.0 and got["index_pct"] == 25
        # upsert same name updates bottle
        r2 = requests.post(f"{API}/fluids", json={"name": "test_fluid20", "index_pct": 30, "bottle_ml": 500})
        assert r2.json()["item"]["item_id"] == item["item_id"]
        assert r2.json()["item"]["bottle_ml"] == 500.0
        # default when omitted
        r3 = requests.post(f"{API}/fluids", json={"name": "TEST_Fluid20b", "index_pct": 18})
        assert r3.json()["item"]["bottle_ml"] == 473.0
        requests.delete(f"{API}/fluids/{r3.json()['item']['item_id']}")
        # invalid
        assert requests.post(f"{API}/fluids", json={"name": "TEST_F", "index_pct": 18, "bottle_ml": 30000}).status_code == 400
        assert requests.post(f"{API}/fluids", json={"name": "TEST_F", "index_pct": 18, "bottle_ml": -1}).status_code == 400
    finally:
        assert requests.delete(f"{API}/fluids/{item['item_id']}").status_code == 200


# --- mix sheet ---
def test_mix_sheet_404_without_calc(case):
    r = requests.get(f"{API}/cases/{case}/mix-sheet")
    assert r.status_code == 404
    assert "Guarda primero" in r.json()["detail"]


def test_mix_sheet_404_unknown_case():
    r = requests.get(f"{API}/cases/case_doesnotexist/mix-sheet")
    assert r.status_code == 404 and r.json()["detail"] == "Caso no encontrado"


def test_mix_sheet_after_calc(case):
    inp = {**BASE_INP, "bottle_ml": 946,
           "coinjectors": [{"name": "TEST_Coinj", "reason": "x", "volume_ml": 236.6}]}
    sv = requests.post(f"{API}/cases/{case}/calculations", json={"type": "injection", "inputs": inp})
    assert sv.status_code == 200, sv.text
    r = requests.get(f"{API}/cases/{case}/mix-sheet")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["filename"] == "Mezcla_TEST_iter20_mix.pdf"
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF"
    pdf = PdfReader(io.BytesIO(raw))
    assert len(pdf.pages) == 1
    txt = pdf.pages[0].extract_text()
    assert "Hoja de mezcla" in txt and "TEST_Arterial" in txt and "946 mL" in txt and "TEST_Coinj" in txt
    t = d["text"]
    assert t.startswith("*Hoja de mezcla* · TEST_iter20_mix")
    assert "Agregar" in t and "Index 25%" in t
    assert "• Botellas de arterial:" in t and "(de 946 mL)" in t
    assert "• Co-inyector: TEST_Coinj: 0.237 L" in t
    assert "• Agua a agregar:" in t
    print("\n" + t)
