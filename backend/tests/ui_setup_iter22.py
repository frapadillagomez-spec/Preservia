# UI test data setup for iteration 22 (prints ids). Cleanup: python ui_setup_iter22.py cleanup <case_id> <fluid_id> [price_ids...]
import os, sys, requests
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
    print(requests.delete(f"{API}/cases/{sys.argv[2]}").status_code, requests.delete(f"{API}/fluids/{sys.argv[3]}").status_code)
    for pid in sys.argv[4:]:
        print(pid, requests.delete(f"{API}/prices/{pid}").status_code)
    sys.exit()
NAME = "TEST_UIFluid22"
f = requests.post(f"{API}/fluids", json={"name": NAME, "index_pct": 25, "bottle_ml": 473, "stock_bottles": 5}).json()["item"]
requests.patch(f"{API}/fluids/{f['item_id']}", json={"price_per_bottle": 400})
p = requests.post(f"{API}/prices", json={"name": "TEST_UICoinj22", "price": 300, "size": 16, "unit": "oz", "category": "coinyector"}).json()["item"]
c = requests.post(f"{API}/cases", json={"deceased_name": "TEST_iter22_ui", "sex": "male"}).json()["case"]
cid = c["case_id"]
requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": {"peso": "80", "altura": "175", "condicion_general": "rutinario", "condiciones": []}})
requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf", "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25, "fluid_name": NAME, "bottle_ml": 473}})
requests.post(f"{API}/cases/{cid}/logbook", json={"product": "TEST_UICoinj22", "form": "liquid", "quantity": 8, "unit": "oz"})
print(cid, f["item_id"], p["item_id"])
print("other low fluids:", [(x["name"], x.get("stock_bottles"), x.get("min_stock")) for x in requests.get(f"{API}/fluids").json()["items"] if x.get("stock_bottles") is not None])
