# Injection calculator mode 'kf' (Vtotal = MM x K x F) + legacy mode + case save
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
KF = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
      "k_factor": 0.135, "factor_f": 1.093, "desired_index_pct": 2, "fluid_index_pct": 25}


@pytest.fixture
def s():
    return requests.Session()


def test_kf_values(s):
    r = s.post(f"{BASE_URL}/api/calculate", json={"type": "injection", "inputs": KF})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["total_l"] == 8.93
    assert res["concentrate_ml"] == 714
    assert res["water_ml"] == 8214
    assert res["bottles"] == 1.51
    assert res["k_factor"] == 0.135 and res["factor_f"] == 1.093


@pytest.mark.parametrize("k,f", [(0.09, 1.0), (0.19, 1.0), (0.135, 0.7), (0.135, 1.4)])
def test_kf_out_of_range(s, k, f):
    r = s.post(f"{BASE_URL}/api/calculate", json={"type": "injection", "inputs": {**KF, "k_factor": k, "factor_f": f}})
    assert r.status_code == 400


def test_kf_missing_k(s):
    inp = {k: v for k, v in KF.items() if k != "k_factor"}
    r = s.post(f"{BASE_URL}/api/calculate", json={"type": "injection", "inputs": inp})
    assert r.status_code == 400


def test_legacy_injection(s):
    inp = {k: v for k, v in KF.items() if k not in ("mode", "k_factor", "factor_f")}
    r = s.post(f"{BASE_URL}/api/calculate", json={"type": "injection", "inputs": {**inp, "concentrate_ml": 473}})
    assert r.status_code == 200
    res = r.json()["results"]
    assert res["total_l"] == round(25 * 473 / 2 / 1000, 2)
    assert "recommended_l" in res


def test_save_kf_on_case(s):
    c = s.post(f"{BASE_URL}/api/cases", json={"deceased_name": "TEST_kf", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    try:
        r = s.post(f"{BASE_URL}/api/cases/{cid}/calculations", json={"type": "injection", "inputs": KF})
        assert r.status_code == 200
        assert r.json()["calculation"]["results"]["total_l"] == 8.93
        g = s.get(f"{BASE_URL}/api/cases/{cid}").json()["case"]
        assert g["calculations"][-1]["results"]["concentrate_ml"] == 714
        assert g["kf_summary"]["lbm"]["kg"] > 0
    finally:
        s.delete(f"{BASE_URL}/api/cases/{cid}")
