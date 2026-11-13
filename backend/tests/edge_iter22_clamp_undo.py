# Edge: confirm when stock < bottles (clamped to 0) then undo -> does stock inflate above original?
import os, requests
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
NAME = "TEST_Clamp22"
f = requests.post(f"{API}/fluids", json={"name": NAME, "index_pct": 25, "bottle_ml": 473, "stock_bottles": 0.5}).json()["item"]
c = requests.post(f"{API}/cases", json={"deceased_name": "TEST_iter22_clamp", "sex": "male"}).json()["case"]
cid = c["case_id"]
try:
    requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": {"condicion_general": "rutinario", "condiciones": [], "peso": "80", "altura": "175"}})
    requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf", "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25, "fluid_name": NAME, "bottle_ml": 473}})
    print("confirm", requests.post(f"{API}/cases/{cid}/mix-confirm").json().get("stock_left"))
    print("undo", requests.post(f"{API}/cases/{cid}/mix-undo").json())
    # empty-product fuzzy match check: price with name, logbook with product containing it
    p = requests.post(f"{API}/prices", json={"name": "TEST_Sal", "price": 100, "size": 100, "unit": "ml", "category": "otro"}).json()["item"]
    requests.post(f"{API}/cases/{cid}/logbook", json={"product": "TEST_Salicilato X", "form": "liquid", "quantity": 10, "unit": "ml"})
    print("fuzzy cost", requests.get(f"{API}/cases/{cid}/cost").json())
    requests.delete(f"{API}/prices/{p['item_id']}")
finally:
    print(requests.delete(f"{API}/cases/{cid}").status_code, requests.delete(f"{API}/fluids/{f['item_id']}").status_code)
