# Iteration 21: fluid inventory (stock PATCH), mix-confirm (logbook + exact bottle deduction), mix-sheet signature, stats mixes_by_month
import base64
import io
import os
import uuid

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
FLUID = f"TEST_Inv21_{uuid.uuid4().hex[:6]}"
SHEET = {"condicion_general": "rutinario", "condiciones": [], "peso": "80", "altura": "175"}
INP = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
       "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25,
       "fluid_name": FLUID, "bottle_ml": 473}
SIG = {"strokes": [[[10, 20], [30, 40], [50, 35], [80, 60]], [[100, 30], [120, 70]]], "w": 340, "h": 320,
       "signed_at": "2026-01-15 10:30"}
TECH = "TEST_Tecnico Firma21"


@pytest.fixture(scope="module")
def fluid():
    r = requests.post(f"{API}/fluids", json={"name": FLUID, "index_pct": 25, "bottle_ml": 473, "stock_bottles": 10})
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    yield item
    requests.delete(f"{API}/fluids/{item['item_id']}")


@pytest.fixture(scope="module")
def case(fluid):
    c = requests.post(f"{API}/cases", json={"deceased_name": "TEST_iter21_mix", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": {**SHEET, "tecnico_responsable": TECH, "firma_tecnico": SIG}})
    yield cid
    requests.delete(f"{API}/cases/{cid}")


def _stock(fid):
    return next(i for i in requests.get(f"{API}/fluids").json()["items"] if i["item_id"] == fid)["stock_bottles"]


# --- Inventory: fluids list + stock PATCH ---
def test_fluid_created_with_stock(fluid):
    assert fluid["stock_bottles"] == 10
    assert _stock(fluid["item_id"]) == 10


def test_stock_delta_and_set(fluid):
    fid = fluid["item_id"]
    r = requests.patch(f"{API}/fluids/{fid}/stock", json={"delta": 1})
    assert r.status_code == 200 and r.json()["item"]["stock_bottles"] == 11
    r = requests.patch(f"{API}/fluids/{fid}/stock", json={"delta": -1})
    assert r.json()["item"]["stock_bottles"] == 10
    r = requests.patch(f"{API}/fluids/{fid}/stock", json={"set": 3.456})
    assert r.json()["item"]["stock_bottles"] == 3.46
    assert _stock(fid) == 3.46
    r = requests.patch(f"{API}/fluids/{fid}/stock", json={"delta": -50})
    assert r.json()["item"]["stock_bottles"] == 0
    r = requests.patch(f"{API}/fluids/{fid}/stock", json={"set": -5})
    assert r.json()["item"]["stock_bottles"] == 0
    assert _stock(fid) == 0
    # restore 10 for confirm test
    assert requests.patch(f"{API}/fluids/{fid}/stock", json={"set": 10}).json()["item"]["stock_bottles"] == 10


def test_stock_invalid_and_404(fluid):
    assert requests.patch(f"{API}/fluids/{fluid['item_id']}/stock", json={"set": "abc"}).status_code == 400
    assert requests.patch(f"{API}/fluids/flu_nope000/stock", json={"delta": 1}).status_code == 404


def test_stock_response_no_mongo_id(fluid):
    it = requests.patch(f"{API}/fluids/{fluid['item_id']}/stock", json={"delta": 0}).json()["item"]
    assert "_id" not in it


# --- Mix confirm ---
def test_confirm_404_without_calc(case):
    r = requests.post(f"{API}/cases/{case}/mix-confirm")
    assert r.status_code == 404


def test_confirm_flow(case, fluid):
    sv = requests.post(f"{API}/cases/{case}/calculations", json={"type": "injection", "inputs": INP})
    assert sv.status_code == 200, sv.text
    ms = requests.get(f"{API}/cases/{case}/mix-sheet").json()
    assert ms["confirmed"] is False
    calc = requests.get(f"{API}/cases/{case}").json()["case"]["calculations"][-1]
    res = calc["results"]
    bottles = round(res["bottles"], 2)
    r = requests.post(f"{API}/cases/{case}/mix-confirm")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["bottles"] == bottles and d["fluid"] == FLUID
    assert d["stock_left"] == pytest.approx(round(10 - bottles, 2), abs=0.001)
    assert _stock(fluid["item_id"]) == d["stock_left"]
    lb = requests.get(f"{API}/cases/{case}").json()["case"]["logbook"]
    mix = [e for e in lb if e.get("source") == "mix"]
    assert len(mix) == 2
    art = next(e for e in mix if e["product"].startswith("Arterial"))
    assert art["product"] == f"Arterial {FLUID} Index 25%"
    assert art["quantity"] == pytest.approx(res["concentrate_ml"], abs=0.01) and art["unit"] == "ml"
    agua = next(e for e in mix if e["product"] == "Agua")
    assert agua["quantity"] == pytest.approx(res["water_ml"], abs=0.01)
    print(f"\nbottles={bottles} stock_left={d['stock_left']} art={art['quantity']} agua={agua['quantity']}")


def test_second_confirm_400(case, fluid):
    before = _stock(fluid["item_id"])
    r = requests.post(f"{API}/cases/{case}/mix-confirm")
    assert r.status_code == 400 and "ya fue confirmada" in r.json()["detail"]
    assert _stock(fluid["item_id"]) == before


def test_mix_sheet_confirmed_and_signature(case):
    d = requests.get(f"{API}/cases/{case}/mix-sheet").json()
    assert d["confirmed"] is True and d["confirmed_at"]
    pdf = PdfReader(io.BytesIO(base64.b64decode(d["pdf_base64"])))
    assert len(pdf.pages) == 1
    txt = pdf.pages[0].extract_text()
    assert TECH in txt and "Firma del técnico responsable - 2026-01-15 10:30" in txt


def test_mix_sheet_blank_signature_line():
    c = requests.post(f"{API}/cases", json={"deceased_name": "TEST_iter21_nosig", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    try:
        requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": SHEET})
        requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {**INP, "fluid_name": "TEST_NotInInv"}})
        d = requests.get(f"{API}/cases/{cid}/mix-sheet").json()
        pdf = PdfReader(io.BytesIO(base64.b64decode(d["pdf_base64"])))
        assert len(pdf.pages) == 1
        txt = pdf.pages[0].extract_text()
        assert "____" in txt and "Firma del técnico responsable" in txt
        # confirm with fluid NOT in inventory -> entries but no stock
        r = requests.post(f"{API}/cases/{cid}/mix-confirm").json()
        assert r["fluid"] is None and r["stock_left"] is None and len(r["entries"]) == 2
    finally:
        requests.delete(f"{API}/cases/{cid}")


def test_new_calc_can_be_confirmed_again(case, fluid):
    """A new injection calc saved after confirmation is a fresh, unconfirmed mix."""
    requests.post(f"{API}/cases/{case}/calculations", json={"type": "injection", "inputs": INP})
    assert requests.get(f"{API}/cases/{case}/mix-sheet").json()["confirmed"] is False


# --- Stats ---
def test_stats_mixes_by_month(case):
    d = requests.get(f"{API}/stats").json()
    m = d["mixes_by_month"]
    assert isinstance(m, list) and len(m) >= 1
    top = m[0]
    for k in ("key", "label", "mixes", "total_bottles", "fluids"):
        assert k in top
    f = next((x for x in top["fluids"] if x["name"] == FLUID), None)
    assert f is not None, top
    assert f["mixes"] >= 1 and f["bottles"] > 0 and f["liters"] > 0
    print("\n", top)
