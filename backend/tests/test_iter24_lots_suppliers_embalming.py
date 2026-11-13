# Iteration 24: lots per product, logbook categories + lot deduction, purchases/mix by lot, embalming timer, suppliers, PDF Lote column
import base64
import io
import os
import re
import uuid

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = uuid.uuid4().hex[:6]
FLUID = f"TEST_Fl24_{TAG}"
CREATED = {"fluids": [], "cases": [], "suppliers": [], "purchases": []}


def _fluid(fid):
    return next(x for x in requests.get(f"{API}/fluids").json()["items"] if x["item_id"] == fid)


def _lot(f, lot_id):
    return next((l for l in f["lots"] if l["lot_id"] == lot_id), None)


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for p in CREATED["purchases"]:
        requests.delete(f"{API}/purchases/{p}")
    for c in CREATED["cases"]:
        requests.delete(f"{API}/cases/{c}")
    for f in CREATED["fluids"]:
        requests.delete(f"{API}/fluids/{f}")
    for s in CREATED["suppliers"]:
        requests.delete(f"{API}/suppliers/{s}")


@pytest.fixture(scope="module")
def arterial():
    r = requests.post(f"{API}/fluids", json={"name": FLUID, "index_pct": 25, "bottle_ml": 473, "stock_bottles": 5,
                                             "lot": "L-A1", "kind": "arterial"})
    assert r.status_code == 200, r.text
    it = r.json()["item"]
    CREATED["fluids"].append(it["item_id"])
    return it


@pytest.fixture(scope="module")
def case():
    c = requests.post(f"{API}/cases", json={"deceased_name": f"TEST_iter24_{TAG}", "sex": "male"}).json()["case"]
    CREATED["cases"].append(c["case_id"])
    return c


# --- Fluids & lots ---
class TestLots:
    def test_create_with_lot(self, arterial):
        assert arterial["kind"] == "arterial"
        assert len(arterial["lots"]) == 1 and arterial["lots"][0]["lot"] == "L-A1"
        assert arterial["lots"][0]["stock"] == 5 and arterial["stock_bottles"] == 5

    def test_all_kinds_and_unit(self):
        for kind in ["coinyector", "cavidad", "topico", "putrefacto", "otro"]:
            unit = "g" if kind == "topico" else "ml"
            r = requests.post(f"{API}/fluids", json={"name": f"TEST_{kind}_{TAG}", "kind": kind, "unit": unit,
                                                     "bottle_ml": 100, "stock_bottles": 2, "lot": f"K-{kind}"})
            assert r.status_code == 200, (kind, r.text)
            it = r.json()["item"]
            CREATED["fluids"].append(it["item_id"])
            assert it["kind"] == kind and it["unit"] == unit and it["lots"][0]["lot"] == f"K-{kind}"

    def test_arterial_requires_index(self):
        r = requests.post(f"{API}/fluids", json={"name": f"TEST_noidx_{TAG}", "kind": "arterial", "index_pct": 0})
        assert r.status_code == 400

    def test_add_patch_delete_lot(self, arterial):
        fid = arterial["item_id"]
        r = requests.post(f"{API}/fluids/{fid}/lots", json={"lot": "L-B2", "stock": 3})
        assert r.status_code == 200, r.text
        lid = r.json()["lot_id"]
        assert r.json()["stock_total"] == 8
        f = _fluid(fid)
        assert len(f["lots"]) == 2 and f["stock_bottles"] == 8
        # delta + never below 0
        r = requests.patch(f"{API}/fluids/{fid}/lots/{lid}", json={"delta": 1})
        assert r.json()["stock_lot"] == 4
        r = requests.patch(f"{API}/fluids/{fid}/lots/{lid}", json={"delta": -50})
        assert r.json()["stock_lot"] == 0 and r.json()["stock_total"] == 5
        r = requests.patch(f"{API}/fluids/{fid}/lots/{lid}", json={"set": 2.5})
        assert r.json()["stock_lot"] == 2.5 and _fluid(fid)["stock_bottles"] == 7.5
        assert requests.patch(f"{API}/fluids/{fid}/lots/lot_nope", json={"delta": 1}).status_code == 404
        assert requests.post(f"{API}/fluids/{fid}/lots", json={"lot": "", "stock": 1}).status_code == 400
        assert requests.post(f"{API}/fluids/{fid}/lots", json={"lot": "X", "stock": -1}).status_code == 400
        r = requests.delete(f"{API}/fluids/{fid}/lots/{lid}")
        assert r.status_code == 200 and r.json()["stock_total"] == 5
        assert _fluid(fid)["stock_bottles"] == 5 and len(_fluid(fid)["lots"]) == 1


# --- Logbook categories & lot deduction ---
class TestLogbookLots:
    def test_cavidad_oz_deducts(self, case):
        r = requests.post(f"{API}/fluids", json={"name": f"TEST_cav_{TAG}", "kind": "cavidad", "bottle_ml": 473,
                                                 "stock_bottles": 4, "lot": "CV-1"})
        f = r.json()["item"]
        CREATED["fluids"].append(f["item_id"])
        lid = f["lots"][0]["lot_id"]
        r = requests.post(f"{API}/cases/{case['case_id']}/logbook", json={
            "product": f["name"], "form": "gel", "quantity": 16, "unit": "oz", "category": "cavidad",
            "lot": "CV-1", "fluid_id": f["item_id"], "lot_id": lid})
        assert r.status_code == 200, r.text
        e = r.json()["entry"]
        assert e["category"] == "cavidad" and e["form"] == "liquid" and e["unit"] == "oz" and e["lot"] == "CV-1"
        # 16 oz = 473.18 mL -> 1.0 bottle
        assert abs(e["deducted"] - 1.0) < 0.02
        assert abs(_lot(_fluid(f["item_id"]), lid)["stock"] - 3.0) < 0.02
        # delete returns
        assert requests.delete(f"{API}/cases/{case['case_id']}/logbook/{e['log_id']}").status_code == 200
        assert abs(_lot(_fluid(f["item_id"]), lid)["stock"] - 4.0) < 0.01

    def test_topico_grams(self, case):
        r = requests.post(f"{API}/fluids", json={"name": f"TEST_top_{TAG}", "kind": "topico", "unit": "g",
                                                 "bottle_ml": 500, "stock_bottles": 2, "lot": "TP-1"})
        f = r.json()["item"]
        CREATED["fluids"].append(f["item_id"])
        lid = f["lots"][0]["lot_id"]
        r = requests.post(f"{API}/cases/{case['case_id']}/logbook", json={
            "product": f["name"], "form": "powder", "quantity": 250, "unit": "ml", "category": "topico",
            "lot": "TP-1", "fluid_id": f["item_id"], "lot_id": lid})
        e = r.json()["entry"]
        assert e["form"] == "powder" and e["unit"] == "g" and e["category"] == "topico"
        assert e.get("deducted") == 0.5, e
        assert _lot(_fluid(f["item_id"]), lid)["stock"] == 1.5

    def test_putrefacto_forced_liquid_and_free_lot(self, case):
        r = requests.post(f"{API}/cases/{case['case_id']}/logbook", json={
            "product": "TEST_Putref", "form": "cream", "quantity": 5, "unit": "g", "category": "putrefacto", "lot": "PZ-9"})
        e = r.json()["entry"]
        assert e["form"] == "liquid" and e["unit"] in ("oz", "ml") and e["lot"] == "PZ-9" and "deducted" not in e

    def test_bad_category_defaults(self, case):
        e = requests.post(f"{API}/cases/{case['case_id']}/logbook", json={
            "product": "TEST_x", "form": "liquid", "quantity": 1, "unit": "ml", "category": "zzz"}).json()["entry"]
        assert e["category"] == "bitacora"


# --- Purchases with lot ---
class TestPurchasesLot:
    def test_purchase_new_lot_and_delete(self, arterial):
        fid = arterial["item_id"]
        r = requests.post(f"{API}/purchases", json={"fluid_id": fid, "bottles": 2, "total": 800, "lot": "P-NEW", "supplier": "TEST_sup"})
        assert r.status_code == 200, r.text
        p = r.json()["purchase"]
        CREATED["purchases"].append(p["purchase_id"])
        assert p["lot"] == "P-NEW"
        f = _fluid(fid)
        lot = _lot(f, p["lot_id"])
        assert lot and lot["lot"] == "P-NEW" and lot["stock"] == 2
        # existing lot (case-insensitive) adds to same
        r2 = requests.post(f"{API}/purchases", json={"fluid_id": fid, "bottles": 1, "total": 400, "lot": "p-new"})
        p2 = r2.json()["purchase"]
        CREATED["purchases"].append(p2["purchase_id"])
        assert p2["lot_id"] == p["lot_id"] and _lot(_fluid(fid), p["lot_id"])["stock"] == 3
        assert requests.delete(f"{API}/purchases/{p2['purchase_id']}").status_code == 200
        assert requests.delete(f"{API}/purchases/{p['purchase_id']}").status_code == 200
        CREATED["purchases"].clear()
        assert _lot(_fluid(fid), p["lot_id"])["stock"] == 0


# --- Mix confirm/undo by lot ---
class TestMixLot:
    def test_mix_confirm_lot_and_undo(self, arterial):
        fid = arterial["item_id"]
        lb = requests.post(f"{API}/fluids/{fid}/lots", json={"lot": "MX-2", "stock": 3}).json()["lot_id"]
        c = requests.post(f"{API}/cases", json={"deceased_name": f"TEST_mix24_{TAG}", "sex": "male"}).json()["case"]
        CREATED["cases"].append(c["case_id"])
        cid = c["case_id"]
        requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": {"peso": "80", "altura": "175", "condicion_general": "rutinario", "condiciones": []}})
        requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {
            "weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf", "k_factor": 0.135,
            "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25, "fluid_name": FLUID, "bottle_ml": 473}})
        before_a1 = _lot(_fluid(fid), arterial["lots"][0]["lot_id"])["stock"]
        r = requests.post(f"{API}/cases/{cid}/mix-confirm", json={"lot_id": lb})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["lot"] == "MX-2" and d["bottles"] > 0
        f = _fluid(fid)
        assert abs(_lot(f, lb)["stock"] - round(3 - d["bottles"], 2)) < 0.02
        assert _lot(f, arterial["lots"][0]["lot_id"])["stock"] == before_a1
        case = requests.get(f"{API}/cases/{cid}").json()
        case = case.get("case", case)
        art = [e for e in case["logbook"] if e.get("source") == "mix" and e["product"].startswith("Arterial")]
        assert art and art[0].get("lot") == "MX-2"
        cost = requests.get(f"{API}/cases/{cid}/cost")
        assert cost.status_code == 200
        u = requests.post(f"{API}/cases/{cid}/mix-undo")
        assert u.status_code == 200
        assert abs(_lot(_fluid(fid), lb)["stock"] - 3) < 0.01


# --- Embalming timer ---
class TestEmbalming:
    def test_stop_without_start(self):
        c = requests.post(f"{API}/cases", json={"deceased_name": f"TEST_emb0_{TAG}", "sex": "female"}).json()["case"]
        CREATED["cases"].append(c["case_id"])
        r = requests.post(f"{API}/cases/{c['case_id']}/embalming", json={"action": "stop"})
        assert r.status_code == 400
        assert requests.post(f"{API}/cases/{c['case_id']}/embalming", json={"action": "x"}).status_code == 400

    def test_start_stop(self, case):
        cid = case["case_id"]
        r = requests.post(f"{API}/cases/{cid}/embalming", json={"action": "start"})
        assert r.status_code == 200, r.text
        cs = r.json()["case"]
        assert cs["embalming_start"] and cs["embalming_end"] is None
        assert re.match(r"^\d{2}:\d{2}$", cs["case_sheet"]["inicio_emb"])
        r = requests.post(f"{API}/cases/{cid}/embalming", json={"action": "stop"})
        cs = r.json()["case"]
        assert cs["embalming_end"] and re.match(r"^\d{2}:\d{2}$", cs["case_sheet"]["termino_emb"])
        # sheet fields other than these preserved
        g = requests.get(f"{API}/cases/{cid}").json()
        g = g.get("case", g)
        assert g["case_sheet"]["inicio_emb"] == cs["case_sheet"]["inicio_emb"]


# --- Suppliers ---
class TestSuppliers:
    def test_crud(self):
        r = requests.post(f"{API}/suppliers", json={"name": f"TEST_Sup_{TAG}", "phone": "+52 (55) 1234-5678"})
        assert r.status_code == 200, r.text
        s = r.json()["item"]
        CREATED["suppliers"].append(s["supplier_id"])
        assert s["phone"] == "525512345678" and "_id" not in s and "user_id" not in s
        items = requests.get(f"{API}/suppliers").json()["items"]
        assert any(x["supplier_id"] == s["supplier_id"] for x in items)
        assert requests.post(f"{API}/suppliers", json={"name": "TEST_x", "phone": "12345"}).status_code == 400
        assert requests.post(f"{API}/suppliers", json={"name": "", "phone": "5512345678"}).status_code == 400
        assert requests.delete(f"{API}/suppliers/{s['supplier_id']}").status_code == 200
        CREATED["suppliers"].remove(s["supplier_id"])
        assert requests.delete(f"{API}/suppliers/{s['supplier_id']}").status_code == 404


# --- Report PDF Lote column ---
class TestReportLot:
    def test_pdf_lote(self, case):
        r = requests.get(f"{API}/cases/{case['case_id']}/report")
        assert r.status_code == 200
        pdf = base64.b64decode(r.json()["pdf_base64"])
        text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
        assert "Lote" in text
        assert "PZ-9" in text and "TP-1" in text
        assert "Topico" in text and "Putrefacto" in text
