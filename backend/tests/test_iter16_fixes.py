# Iteration 16: co-injector volume upper bound (FIX6) and stats calc_breakdown incl. kvolume/injection (FIX7)
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
KF = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
      "k_factor": 0.135, "factor_f": 1.093, "desired_index_pct": 2, "fluid_index_pct": 25}


@pytest.fixture
def s():
    return requests.Session()


# ---- FIX6: co-injector volume bounds ----
class TestCoinjectorBounds:
    @pytest.mark.parametrize("vol", [20000.1, 20001, 1e9])
    def test_over_limit_rejected(self, s, vol):
        r = s.post(f"{API}/coinjectors", json={"name": "TEST_big", "reason": "x", "volume_ml": vol})
        assert r.status_code == 400, r.text
        assert "20000" in r.json()["detail"]
        names = [i["name"] for i in s.get(f"{API}/coinjectors").json()["items"]]
        assert "TEST_big" not in names

    def test_exact_limit_accepted_and_cleanup(self, s):
        r = s.post(f"{API}/coinjectors", json={"name": "TEST_edge", "reason": "x", "volume_ml": 20000})
        assert r.status_code == 200, r.text
        item = r.json().get("item") or r.json()
        iid = item["item_id"]
        assert item["volume_ml"] == 20000
        assert s.delete(f"{API}/coinjectors/{iid}").status_code == 200
        assert iid not in [i["item_id"] for i in s.get(f"{API}/coinjectors").json()["items"]]


# ---- FIX7: calc_breakdown types ----
class TestStatsBreakdown:
    def test_breakdown_has_all_types(self, s):
        r = s.get(f"{API}/stats")
        assert r.status_code == 200, r.text
        br = {c["type"]: c for c in r.json()["calc_breakdown"]}
        assert list(br) == ["volume", "kvolume", "lbm", "concentration", "injection"]
        assert br["injection"]["label"] == "Volumen de inyección (asistente)"
        assert br["kvolume"]["label"] == "Volumen por Factor K"

    def test_injection_and_kvolume_counted(self, s):
        before = {c["type"]: c["count"] for c in s.get(f"{API}/stats").json()["calc_breakdown"]}
        total_before = s.get(f"{API}/stats").json()["totals"]
        c = s.post(f"{API}/cases", json={"deceased_name": "TEST_iter16_stats", "sex": "male"}).json()["case"]
        cid = c["case_id"]
        try:
            inj = s.post(f"{API}/calculate", json={"type": "injection", "inputs": KF}).json()
            r1 = s.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": KF,
                                                                 "results": inj["results"], "summary": inj["summary"]})
            assert r1.status_code in (200, 201), r1.text
            kin = {"weight_kg": 80, "height_cm": 175, "sex": "male", "k_factor": 0.135}
            kv = s.post(f"{API}/calculate", json={"type": "kvolume", "inputs": kin})
            assert kv.status_code == 200, kv.text
            if True:
                r2 = s.post(f"{API}/cases/{cid}/calculations", json={"type": "kvolume", "inputs": kin,
                                                                     "results": kv.json()["results"], "summary": kv.json()["summary"]})
                assert r2.status_code in (200, 201), r2.text
            after = {c["type"]: c["count"] for c in s.get(f"{API}/stats").json()["calc_breakdown"]}
            assert after["injection"] == before["injection"] + 1
            if kv.status_code == 200:
                assert after["kvolume"] == before["kvolume"] + 1
            print("totals before", total_before)
        finally:
            s.delete(f"{API}/cases/{cid}")
