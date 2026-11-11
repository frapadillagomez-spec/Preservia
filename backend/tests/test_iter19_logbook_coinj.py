# Iteration 19: co-injectors pre-filled from case logbook (excluding DermaFix/BioFix/OncoShield/LeakFix), shown in L
import base64
import io
import os

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
OZ_ML = 29.5735
EXCLUDED = ["dermafix", "biofix", "oncoshield", "leakfix"]
LOG = [("DermaFix 31", "liquid", 16, "oz"), ("Icteroclean", "liquid", 8, "oz"), ("SilentForm", "liquid", 100, "ml"),
       ("BioFix 31", "liquid", 8, "oz"), ("OncoShield", "liquid", 4, "oz"), ("LeakFix", "liquid", 2, "oz"),
       ("TEST_Polvo", "powder", 50, "g")]
SHEET = {"condicion_general": "rutinario", "condiciones": ["obesidad_moderada", "diabetes_vascular"],
         "peso": "80", "altura": "175"}


def from_logbook(logbook):
    """Python mirror of frontend coinjectorsFromLogbook()."""
    out = []
    for e in logbook:
        key = "".join(ch for ch in e["product"].lower() if ch not in " -_")
        if e["unit"] in ("ml", "oz") and e["quantity"] > 0 and not any(x in key for x in EXCLUDED):
            v = e["quantity"] * OZ_ML if e["unit"] == "oz" else e["quantity"]
            out.append({"name": e["product"], "reason": "Registrado en bitácora", "volume_ml": round(v * 10) / 10})
    return out


@pytest.fixture(scope="module")
def case():
    s = requests.Session()
    c = s.post(f"{API}/cases", json={"deceased_name": "TEST_iter19_coinj", "sex": "male"}).json()["case"]
    cid = c["case_id"]
    assert s.put(f"{API}/cases/{cid}/sheet", json={"sheet": SHEET}).status_code == 200
    for p, f, q, u in LOG:
        r = s.post(f"{API}/cases/{cid}/logbook", json={"product": p, "form": f, "quantity": q, "unit": u})
        assert r.status_code == 200, r.text
    yield cid
    s.delete(f"{API}/cases/{cid}")
    assert s.get(f"{API}/cases/{cid}").status_code == 404


def test_logbook_persisted(case):
    lb = requests.get(f"{API}/cases/{case}").json()["case"]["logbook"]
    assert [(e["product"], e["unit"], e["quantity"]) for e in lb] == [(p, u, q) for p, _, q, u in LOG]
    assert lb[-1]["form"] == "powder"


def test_filter_keeps_only_icteroclean_silentform(case):
    lb = requests.get(f"{API}/cases/{case}").json()["case"]["logbook"]
    co = from_logbook(lb)
    assert [c["name"] for c in co] == ["Icteroclean", "SilentForm"]
    assert co[0]["volume_ml"] == 236.6 and co[1]["volume_ml"] == 100


def test_calc_with_logbook_coinj(case):
    lb = requests.get(f"{API}/cases/{case}").json()["case"]["logbook"]
    inp = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
           "k_factor": 0.135, "factor_f": 1.093, "desired_index_pct": 2, "fluid_index_pct": 25,
           "coinjectors": from_logbook(lb)}
    r = requests.post(f"{API}/calculate", json={"type": "injection", "inputs": inp})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert res["coinjectors_ml"] == 337
    assert len(res["coinjectors"]) == 2
    assert res["water_ml"] == pytest.approx(res["total_ml"] - res["concentrate_ml"] - 336.6, abs=1)
    # save + PDF
    sv = requests.post(f"{API}/cases/{case}/calculations", json={"type": "injection", "inputs": inp})
    assert sv.status_code == 200, sv.text
    pdf = requests.get(f"{API}/cases/{case}/report")
    assert pdf.status_code == 200
    txt = "".join(p.extract_text() for p in PdfReader(io.BytesIO(base64.b64decode(pdf.json()["pdf_base64"]))).pages)
    assert "0.237 L" in txt and "0.100 L" in txt and "Total: 0.337 L" in txt, txt[-1500:]
