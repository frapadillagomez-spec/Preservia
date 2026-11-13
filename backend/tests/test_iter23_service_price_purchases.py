# Iteration 23: service price + margin, PDF price row, purchases (stock/price), stats costs
import base64
import io
import os
import uuid

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = uuid.uuid4().hex[:6]
FLUID = f"TEST_Fl23_{TAG}"
SHEET = {"condicion_general": "rutinario", "condiciones": [], "peso": "80", "altura": "175"}
INP = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
       "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25,
       "fluid_name": FLUID, "bottle_ml": 473}
PURCHASES = []


@pytest.fixture(scope="module")
def fluid():
    r = requests.post(f"{API}/fluids", json={"name": FLUID, "index_pct": 25, "bottle_ml": 473, "stock_bottles": 2})
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    requests.patch(f"{API}/fluids/{item['item_id']}", json={"price_per_bottle": 400})
    yield item
    for pid in PURCHASES:
        requests.delete(f"{API}/purchases/{pid}")
    requests.delete(f"{API}/fluids/{item['item_id']}")


@pytest.fixture(scope="module")
def case(fluid):
    c = requests.post(f"{API}/cases", json={"deceased_name": f"TEST_iter23_{TAG}", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": SHEET})
    sv = requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": INP})
    assert sv.status_code == 200, sv.text
    assert requests.post(f"{API}/cases/{cid}/mix-confirm").status_code == 200
    yield cid
    requests.delete(f"{API}/cases/{cid}")


def _fluid(fid):
    return next(i for i in requests.get(f"{API}/fluids").json()["items"] if i["item_id"] == fid)


def _pdf_text(cid):
    r = requests.get(f"{API}/cases/{cid}/report")
    assert r.status_code == 200, r.text[:200]
    raw = base64.b64decode(r.json()["pdf_base64"])
    assert raw[:4] == b"%PDF"
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(raw)).pages)


# --- Service price & margin ---
def test_cost_without_service_price(case):
    d = requests.get(f"{API}/cases/{case}/cost").json()
    assert d["total"] > 0
    assert "service_price" not in d and "margin" not in d


def test_set_service_price_and_margin(case):
    r = requests.put(f"{API}/cases/{case}/service-price", json={"price": 8500.555})
    assert r.status_code == 200 and r.json()["ok"]
    d = requests.get(f"{API}/cases/{case}/cost").json()
    assert d["service_price"] == 8500.56
    assert d["margin"] == pytest.approx(round(8500.56 - d["total"], 2), abs=0.01)
    assert d["margin_pct"] == pytest.approx(round(d["margin"] / 8500.56 * 100, 1), abs=0.1)
    assert requests.get(f"{API}/cases/{case}").json()["case"]["service_price"] == 8500.56


def test_service_price_zero_pct_none(case):
    assert requests.put(f"{API}/cases/{case}/service-price", json={"price": 0}).status_code == 200
    d = requests.get(f"{API}/cases/{case}/cost").json()
    assert d["service_price"] == 0 and d["margin_pct"] is None and d["margin"] == -d["total"]


def test_service_price_invalid(case):
    for bad in ["abc", -5, 1e12, [1], {"a": 1}]:
        r = requests.put(f"{API}/cases/{case}/service-price", json={"price": bad})
        assert r.status_code == 400, (bad, r.status_code)
    assert requests.put(f"{API}/cases/case_nope000/service-price", json={"price": 10}).status_code == 404


def test_pdf_price_row_and_no_breakdown(case):
    requests.put(f"{API}/cases/{case}/service-price", json={"price": 12345.5})
    t = _pdf_text(case)
    assert "Precio del servicio" in t
    assert "12,345.50 MXN" in t
    for word in ["Costo en fluidos", "Margen", "price_per_bottle", "Arterial ·"]:
        assert word not in t, word


def test_clear_service_price(case):
    assert requests.put(f"{API}/cases/{case}/service-price", json={"price": None}).status_code == 200
    d = requests.get(f"{API}/cases/{case}/cost").json()
    assert "service_price" not in d
    assert "service_price" not in requests.get(f"{API}/cases/{case}").json()["case"]
    assert "Precio del servicio" not in _pdf_text(case)
    assert requests.put(f"{API}/cases/{case}/service-price", json={"price": ""}).status_code == 200


# --- Purchases ---
def test_purchase_add_updates_stock_and_price(fluid):
    fid = fluid["item_id"]
    s0 = _fluid(fid)["stock_bottles"]
    r = requests.post(f"{API}/purchases", json={"fluid_id": fid, "bottles": 4, "total": 1800, "supplier": " TEST_Prov "})
    assert r.status_code == 200, r.text
    d = r.json()
    p = d["purchase"]
    PURCHASES.append(p["purchase_id"])
    assert d["stock"] == round(s0 + 4, 2) and d["price_per_bottle"] == 450
    assert p["unit_price"] == 450 and p["supplier"] == "TEST_Prov" and p["fluid_name"] == FLUID
    assert "_id" not in p and "user_id" not in p
    f = _fluid(fid)
    assert f["stock_bottles"] == round(s0 + 4, 2) and f["price_per_bottle"] == 450


def test_purchase_list_newest_first(fluid):
    fid = fluid["item_id"]
    r = requests.post(f"{API}/purchases", json={"fluid_id": fid, "bottles": 3, "total": 1500})
    assert r.status_code == 200
    PURCHASES.append(r.json()["purchase"]["purchase_id"])
    assert _fluid(fid)["price_per_bottle"] == 500
    items = requests.get(f"{API}/purchases").json()["items"]
    mine = [i for i in items if i["purchase_id"] in PURCHASES]
    assert [i["purchase_id"] for i in mine] == list(reversed(PURCHASES))
    assert all("_id" not in i and "user_id" not in i for i in items)
    dates = [i["date"] for i in items]
    assert dates == sorted(dates, reverse=True)


def test_purchase_invalid(fluid):
    fid = fluid["item_id"]
    for bad in [{"fluid_id": fid, "bottles": 0, "total": 10}, {"fluid_id": fid, "bottles": -1, "total": 10},
                {"fluid_id": fid, "bottles": 2, "total": -1}, {"fluid_id": fid, "bottles": "x", "total": 1},
                {"fluid_id": fid, "bottles": 2, "total": 10, "date": "not-a-date"}]:
        assert requests.post(f"{API}/purchases", json=bad).status_code == 400, bad
    assert requests.post(f"{API}/purchases", json={"fluid_id": "flu_nope", "bottles": 1, "total": 1}).status_code == 404
    assert requests.delete(f"{API}/purchases/pur_nope000").status_code == 404


def test_purchase_delete_reverts_stock(fluid):
    fid = fluid["item_id"]
    pid = PURCHASES.pop()
    s0 = _fluid(fid)["stock_bottles"]
    r = requests.delete(f"{API}/purchases/{pid}")
    assert r.status_code == 200 and r.json()["stock"] == round(s0 - 3, 2)
    assert _fluid(fid)["stock_bottles"] == round(s0 - 3, 2)
    assert not any(i["purchase_id"] == pid for i in requests.get(f"{API}/purchases").json()["items"])


def test_purchase_delete_not_below_zero(fluid):
    fid = fluid["item_id"]
    r = requests.post(f"{API}/purchases", json={"fluid_id": fid, "bottles": 2, "total": 900})
    pid = r.json()["purchase"]["purchase_id"]
    requests.patch(f"{API}/fluids/{fid}/stock", json={"set": 0.5})
    f = _fluid(fid)
    if f["stock_bottles"] != 0.5:
        requests.delete(f"{API}/purchases/{pid}")
        pytest.skip("PATCH stock_bottles not supported")
    d = requests.delete(f"{API}/purchases/{pid}").json()
    assert d["stock"] == 0
    assert _fluid(fid)["stock_bottles"] == 0


# --- Stats costs ---
def test_stats_costs(case, fluid):
    requests.put(f"{API}/cases/{case}/service-price", json={"price": 9000})
    r = requests.post(f"{API}/purchases", json={"fluid_id": fluid["item_id"], "bottles": 1, "total": 777})
    PURCHASES.append(r.json()["purchase"]["purchase_id"])
    s = requests.get(f"{API}/stats")
    assert s.status_code == 200
    c = s.json()["costs"]
    for k in ["avg_cost_per_case", "cases_costed", "avg_service_price", "months"]:
        assert k in c
    assert c["cases_costed"] >= 1 and c["avg_cost_per_case"] > 0 and c["avg_service_price"] > 0
    assert len(c["months"]) >= 1 and len(c["months"]) <= 6
    m = c["months"][0]
    for k in ["key", "label", "used", "purchased", "service", "cases_costed", "avg_per_case"]:
        assert k in m
    assert m["purchased"] >= 777 and m["used"] > 0 and m["service"] >= 9000
    keys = [x["key"] for x in c["months"]]
    assert keys == sorted(keys, reverse=True)
    print("\n", c)
