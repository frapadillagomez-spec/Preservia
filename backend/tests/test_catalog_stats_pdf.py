# Iteration 15: co-injector catalog CRUD, stats factors (K/F averages, top co-injectors), PDF 'Resumen K y F'
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
CI = [{"name": "TEST_Humectante", "reason": "Deshidratacion", "volume_ml": 473}]
SHEET = {"condicion_general": "rutinario", "condiciones": ["obesidad_moderada", "diabetes_vascular"],
         "peso": "80", "altura": "175"}


@pytest.fixture
def s():
    return requests.Session()


def pdf_text(s, cid):
    r = s.get(f"{API}/cases/{cid}/report")
    assert r.status_code == 200, r.text
    data = r.json()
    raw = base64.b64decode(data["pdf_base64"])
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(raw)).pages)


def new_case(s, name, sheet=None):
    c = s.post(f"{API}/cases", json={"deceased_name": name, "sex": "male"}).json()["case"]
    if sheet:
        r = s.put(f"{API}/cases/{c['case_id']}/sheet", json={"sheet": sheet})
        assert r.status_code == 200, r.text
    return c["case_id"]


# ---- Catalog ----
class TestCatalog:
    def test_crud_and_upsert(self, s):
        r = s.post(f"{API}/coinjectors", json={"name": "TEST_Cat A", "reason": "R1", "volume_ml": 250})
        assert r.status_code == 200, r.text
        item = r.json()["item"]
        assert item["name"] == "TEST_Cat A" and item["volume_ml"] == 250 and item["reason"] == "R1"
        assert "_id" not in item
        iid = item["item_id"]
        try:
            # upsert case-insensitive
            r2 = s.post(f"{API}/coinjectors", json={"name": "test_cat a", "reason": "R2", "volume_ml": 300})
            assert r2.status_code == 200
            assert r2.json()["item"]["item_id"] == iid
            items = s.get(f"{API}/coinjectors").json()["items"]
            mine = [i for i in items if i["item_id"] == iid]
            assert len(mine) == 1
            assert mine[0]["volume_ml"] == 300 and mine[0]["reason"] == "R2"
            assert len([i for i in items if i["name"].lower() == "test_cat a"]) == 1
            assert all("_id" not in i for i in items)
        finally:
            d = s.delete(f"{API}/coinjectors/{iid}")
            assert d.status_code == 200 and d.json()["ok"] is True
        assert iid not in [i["item_id"] for i in s.get(f"{API}/coinjectors").json()["items"]]
        assert s.delete(f"{API}/coinjectors/{iid}").status_code == 404

    @pytest.mark.parametrize("p", [
        {"name": "", "reason": "x", "volume_ml": 10},
        {"name": "   ", "reason": "x", "volume_ml": 10},
        {"name": "TEST_x", "reason": "x", "volume_ml": 0},
        {"name": "TEST_x", "reason": "x", "volume_ml": -3},
        {"name": "TEST_x", "reason": "x", "volume_ml": "abc"},
        {"name": "TEST_x", "reason": "x"},
    ])
    def test_invalid(self, s, p):
        r = s.post(f"{API}/coinjectors", json=p)
        assert r.status_code == 400, r.text

    def test_delete_unknown(self, s):
        assert s.delete(f"{API}/coinjectors/coi_doesnotexist").status_code == 404


# ---- PDF Resumen K y F ----
class TestPdfKF:
    def test_with_kf_calc(self, s):
        cid = new_case(s, "TEST_pdf_kf", SHEET)
        try:
            r = s.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {**KF, "coinjectors": CI}})
            assert r.status_code == 200, r.text
            t = pdf_text(s, cid)
            for frag in ["Resumen K y F", "Factor K", "Factor F", "Masa magra", "Vtotal", "Concentrado V1",
                         "Co-inyectores", "TEST_Humectante - Deshidratacion: 473", "Total: 473",
                         "Agua a agregar en la bomba", "7741"]:
                assert frag in t, f"missing {frag!r}"
        finally:
            s.delete(f"{API}/cases/{cid}")

    def test_without_kf(self, s):
        cid = new_case(s, "TEST_pdf_nokf")
        try:
            t = pdf_text(s, cid)
            assert "Resumen K y F" not in t
        finally:
            s.delete(f"{API}/cases/{cid}")

    def test_kf_no_calc(self, s):
        cid = new_case(s, "TEST_pdf_kf_nocalc", SHEET)
        try:
            t = pdf_text(s, cid)
            assert "Resumen K y F" in t
            assert "Volumen recomendado" in t
            assert "Agua a agregar" not in t
        finally:
            s.delete(f"{API}/cases/{cid}")


# ---- Stats factors ----
class TestStats:
    def test_factors(self, s):
        cid = new_case(s, "TEST_stats_kf", SHEET)
        try:
            s.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {**KF, "coinjectors": CI}})
            r = s.get(f"{API}/stats")
            assert r.status_code == 200
            f = r.json()["factors"]
            for k in ["k_avg", "f_avg", "k_cases", "f_cases", "top_general", "top_conditions", "top_coinjectors"]:
                assert k in f
            assert f["k_cases"] >= 1 and f["f_cases"] >= 1
            assert isinstance(f["k_avg"], float) and isinstance(f["f_avg"], float)
            assert any(t["label"] and t["count"] >= 1 for t in f["top_general"])
            assert len(f["top_conditions"]) >= 1
            co = [c for c in f["top_coinjectors"] if c["name"] == "TEST_Humectante"]
            assert co and co[0]["count"] >= 1 and co[0]["avg_ml"] == 473
        finally:
            s.delete(f"{API}/cases/{cid}")
