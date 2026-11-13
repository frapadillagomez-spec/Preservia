# Race check: two concurrent mix-confirm calls must deduct stock only once
import os, sys, uuid, concurrent.futures as cf
import requests

API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
name = f"TEST_Race_{uuid.uuid4().hex[:6]}"
f = requests.post(f"{API}/fluids", json={"name": name, "index_pct": 25, "bottle_ml": 473, "stock_bottles": 10}).json()["item"]
c = requests.post(f"{API}/cases", json={"deceased_name": "TEST_race", "sex": "male"}).json()["case"]
cid = c["case_id"]
try:
    requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": {"peso": "80", "altura": "175", "condicion_general": "rutinario"}})
    requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf", "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25, "fluid_name": name, "bottle_ml": 473}})
    with cf.ThreadPoolExecutor(4) as ex:
        codes = list(ex.map(lambda _: requests.post(f"{API}/cases/{cid}/mix-confirm").status_code, range(4)))
    stock = next(i for i in requests.get(f"{API}/fluids").json()["items"] if i["item_id"] == f["item_id"])["stock_bottles"]
    lb = [e for e in requests.get(f"{API}/cases/{cid}").json()["case"]["logbook"] if e.get("source") == "mix"]
    print("codes", codes, "stock", stock, "mix entries", len(lb))
finally:
    requests.delete(f"{API}/cases/{cid}")
    requests.delete(f"{API}/fluids/{f['item_id']}")
