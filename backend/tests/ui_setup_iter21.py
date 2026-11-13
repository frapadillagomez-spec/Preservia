# UI test data setup for iteration 21 (prints ids). Cleanup: python ui_setup_iter21.py cleanup <case_id> <fluid_id>
import os, sys, requests
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
    print(requests.delete(f"{API}/cases/{sys.argv[2]}").status_code, requests.delete(f"{API}/fluids/{sys.argv[3]}").status_code)
    sys.exit()
f = requests.post(f"{API}/fluids", json={"name": "TEST_UIFluid21", "index_pct": 25, "bottle_ml": 473, "stock_bottles": 10}).json()["item"]
c = requests.post(f"{API}/cases", json={"deceased_name": "TEST_iter21_ui", "sex": "male"}).json()["case"]
cid = c["case_id"]
requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": {"peso": "80", "altura": "175", "condicion_general": "rutinario", "condiciones": ["diabetes_vascular"]}})
requests.post(f"{API}/cases/{cid}/logbook", json={"product": "TEST_Coinj21", "form": "liquid", "quantity": 100, "unit": "ml"})
print(cid, f["item_id"])
