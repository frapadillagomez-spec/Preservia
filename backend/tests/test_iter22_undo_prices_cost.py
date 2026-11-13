# Iteration 22: mix-undo, fluid settings PATCH (min_stock/price_per_bottle), prices CRUD, case cost (MXN)
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = uuid.uuid4().hex[:6]
FLUID = f"TEST_Fl22_{TAG}"
SHEET = {"condicion_general": "rutinario", "condiciones": [], "peso": "80", "altura": "175"}
INP = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
       "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25,
       "fluid_name": FLUID, "bottle_ml": 473}
CREATED_PRICES = []


@pytest.fixture(scope="module")
def fluid():
    r = requests.post(f"{API}/fluids", json={"name": FLUID, "index_pct": 25, "bottle_ml": 473, "stock_bottles": 7.3})
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    yield item
    requests.delete(f"{API}/fluids/{item['item_id']}")


@pytest.fixture(scope="module")
def case(fluid):
    c = requests.post(f"{API}/cases", json={"deceased_name": f"TEST_iter22_{TAG}", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": SHEET})
    sv = requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": INP})
    assert sv.status_code == 200, sv.text
    yield cid
    requests.delete(f"{API}/cases/{cid}")
    for pid in CREATED_PRICES:
        requests.delete(f"{API}/prices/{pid}")


def _fluid(fid):
    return next(i for i in requests.get(f"{API}/fluids").json()["items"] if i["item_id"] == fid)


def _case(cid):
    return requests.get(f"{API}/cases/{cid}").json()["case"]


# --- Fluid settings PATCH ---
def test_fluid_patch_min_price(fluid):
    fid = fluid["item_id"]
    r = requests.patch(f"{API}/fluids/{fid}", json={"min_stock": 3.456, "price_per_bottle": 450.129})
    assert r.status_code == 200, r.text
    it = r.json()["item"]
    assert it["min_stock"] == 3.46 and it["price_per_bottle"] == 450.13 and "_id" not in it
    g = _fluid(fid)
    assert g["min_stock"] == 3.46 and g["price_per_bottle"] == 450.13
    # negative clamps to 0, invalid -> 400, 404
    assert requests.patch(f"{API}/fluids/{fid}", json={"min_stock": -4}).json()["item"]["min_stock"] == 0
    assert requests.patch(f"{API}/fluids/{fid}", json={"price_per_bottle": "abc"}).status_code == 400
    assert requests.patch(f"{API}/fluids/flu_nope000", json={"min_stock": 1}).status_code == 404
    assert requests.patch(f"{API}/fluids/{fid}", json={"min_stock": 2, "price_per_bottle": 400}).status_code == 200


# --- Prices CRUD ---
def test_prices_crud_and_upsert():
    name = f"TEST_Coinj22_{TAG}"
    r = requests.post(f"{API}/prices", json={"name": name, "price": 300, "size": 16, "unit": "oz", "category": "coinyector"})
    assert r.status_code == 200, r.text
    it = r.json()["item"]
    assert it["price"] == 300 and it["size"] == 16 and it["unit"] == "oz" and it["category"] == "coinyector"
    assert "_id" not in it and "user_id" not in it and "name_key" not in it
    CREATED_PRICES.append(it["item_id"])
    lst = requests.get(f"{API}/prices").json()["items"]
    assert any(p["item_id"] == it["item_id"] for p in lst)
    # same name (different case) updates instead of duplicating
    r2 = requests.post(f"{API}/prices", json={"name": name.upper(), "price": 300, "size": 16, "unit": "oz", "category": "coinyector"})
    assert r2.json()["item"]["item_id"] == it["item_id"]
    lst = requests.get(f"{API}/prices").json()["items"]
    assert len([p for p in lst if p["name"].lower() == name.lower()]) == 1
    # validation
    for bad in [{"name": "", "price": 1, "size": 1, "unit": "ml", "category": "otro"},
                {"name": "TEST_x", "price": 1, "size": 0, "unit": "ml", "category": "otro"},
                {"name": "TEST_x", "price": 1, "size": 1, "unit": "l", "category": "otro"},
                {"name": "TEST_x", "price": 1, "size": 1, "unit": "ml", "category": "nope"},
                {"name": "TEST_x", "price": -1, "size": 1, "unit": "ml", "category": "otro"}]:
        assert requests.post(f"{API}/prices", json=bad).status_code == 400, bad


def test_prices_delete():
    r = requests.post(f"{API}/prices", json={"name": f"TEST_Del22_{TAG}", "price": 10, "size": 1, "unit": "g", "category": "otro"})
    pid = r.json()["item"]["item_id"]
    assert requests.delete(f"{API}/prices/{pid}").status_code == 200
    assert not any(p["item_id"] == pid for p in requests.get(f"{API}/prices").json()["items"])
    assert requests.delete(f"{API}/prices/{pid}").status_code == 404


# --- Mix confirm / undo ---
def test_undo_without_confirm_400(case):
    r = requests.post(f"{API}/cases/{case}/mix-undo")
    assert r.status_code == 400


def test_confirm_undo_reconfirm(case, fluid):
    fid = fluid["item_id"]
    s0 = _fluid(fid)["stock_bottles"]
    bottles = round(_case(case)["calculations"][-1]["results"]["bottles"], 2)
    c = requests.post(f"{API}/cases/{case}/mix-confirm")
    assert c.status_code == 200, c.text
    assert len([e for e in _case(case)["logbook"] if e.get("source") == "mix"]) == 2
    u = requests.post(f"{API}/cases/{case}/mix-undo")
    assert u.status_code == 200, u.text
    d = u.json()
    assert d["ok"] and d["bottles"] == bottles and d["stock"] == s0
    assert _fluid(fid)["stock_bottles"] == s0  # exact, no float drift
    cs = _case(case)
    assert not [e for e in cs["logbook"] if e.get("source") == "mix"]
    assert cs["calculations"][-1]["mix_confirmed"] is False
    assert requests.get(f"{API}/cases/{case}/mix-sheet").json()["confirmed"] is False
    assert requests.post(f"{API}/cases/{case}/mix-undo").status_code == 400
    # repeat several cycles to detect drift
    for _ in range(3):
        assert requests.post(f"{API}/cases/{case}/mix-confirm").status_code == 200
        assert requests.post(f"{API}/cases/{case}/mix-undo").status_code == 200
    assert _fluid(fid)["stock_bottles"] == s0
    # confirm again works
    c2 = requests.post(f"{API}/cases/{case}/mix-confirm")
    assert c2.status_code == 200 and c2.json()["stock_left"] == round(s0 - bottles, 2)
    print(f"\ns0={s0} bottles={bottles}")


def test_undo_keeps_manual_entries(case):
    m = requests.post(f"{API}/cases/{case}/logbook", json={"product": "TEST_Manual22", "form": "liquid", "quantity": 5, "unit": "ml"}).json()["entry"]
    assert requests.post(f"{API}/cases/{case}/mix-undo").status_code == 200
    lb = _case(case)["logbook"]
    assert any(e["log_id"] == m["log_id"] for e in lb)
    requests.delete(f"{API}/cases/{case}/logbook/{m['log_id']}")
    assert requests.post(f"{API}/cases/{case}/mix-confirm").status_code == 200


# --- Cost ---
def test_case_cost(case, fluid):
    pc = requests.post(f"{API}/prices", json={"name": f"TEST_CoinjOz_{TAG}", "price": 300, "size": 16, "unit": "oz", "category": "coinyector"}).json()["item"]
    pv = requests.post(f"{API}/prices", json={"name": f"TEST_Cav_{TAG}", "price": 200, "size": 473, "unit": "ml", "category": "cavidad"}).json()["item"]
    pg = requests.post(f"{API}/prices", json={"name": f"TEST_Polvo_{TAG}", "price": 100, "size": 500, "unit": "g", "category": "otro"}).json()["item"]
    pml = requests.post(f"{API}/prices", json={"name": f"TEST_MlOnly_{TAG}", "price": 100, "size": 100, "unit": "ml", "category": "otro"}).json()["item"]
    CREATED_PRICES.extend([pc["item_id"], pv["item_id"], pg["item_id"], pml["item_id"]])
    logs = [(f"TEST_CoinjOz_{TAG}", "liquid", 8, "oz"),
            (f"TEST_Cav_{TAG}", "liquid", 473, "ml"),
            (f"TEST_Polvo_{TAG}", "powder", 250, "g"),
            (f"TEST_MlOnly_{TAG}", "powder", 50, "g"),
            (f"TEST_Unpriced_{TAG}", "liquid", 10, "ml")]
    for p, f, q, u in logs:
        assert requests.post(f"{API}/cases/{case}/logbook", json={"product": p, "form": f, "quantity": q, "unit": u}).status_code == 200
    r = requests.get(f"{API}/cases/{case}/cost")
    assert r.status_code == 200, r.text
    d = r.json()
    print("\n", d)
    assert d["currency"] == "MXN"
    g = {x["key"]: x for x in d["groups"]}
    bottles = _case(case)["calculations"][-1]["results"]["bottles"]
    assert g["arterial"]["total"] == pytest.approx(round(bottles * 400, 2), abs=0.01)
    assert g["coinyector"]["total"] == pytest.approx(150, abs=0.01)
    assert g["cavidad"]["total"] == pytest.approx(200, abs=0.01)
    assert g["otro"]["total"] == pytest.approx(50, abs=0.01)
    assert d["total"] == pytest.approx(sum(x["total"] for x in d["groups"]), abs=0.02)
    assert f"TEST_Unpriced_{TAG}" in d["missing"]
    assert f"TEST_MlOnly_{TAG} (unidad distinta)" in d["missing"]
    # mix entries (Agua / Arterial ...) must not be listed as missing or priced from logbook
    assert not any(m == "Agua" or m.startswith("Arterial ") for m in d["missing"])
    labels = [i["label"] for x in d["groups"] for i in x["items"]]
    assert not any(l.startswith("Agua") for l in labels)


def test_cost_404():
    assert requests.get(f"{API}/cases/case_nope000/cost").status_code == 404


def test_cost_after_undo_drops_arterial(case):
    assert requests.post(f"{API}/cases/{case}/mix-undo").status_code == 200
    d = requests.get(f"{API}/cases/{case}/cost").json()
    assert "arterial" not in [x["key"] for x in d["groups"]]
