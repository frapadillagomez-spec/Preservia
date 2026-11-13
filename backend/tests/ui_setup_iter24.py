# UI test data setup for iteration 24 (prints ids as JSON). Cleanup: python ui_setup_iter24.py cleanup '<json>'
import json, os, sys, requests
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
    d = json.loads(sys.argv[2])
    for c in d.get("cases", []):
        print("case", requests.delete(f"{API}/cases/{c}").status_code)
    for f in d.get("fluids", []):
        print("fluid", requests.delete(f"{API}/fluids/{f}").status_code)
    for s in d.get("suppliers", []):
        print("sup", requests.delete(f"{API}/suppliers/{s}").status_code)
    sys.exit()
NAME = "TEST_UIArt24"
art = requests.post(f"{API}/fluids", json={"name": NAME, "kind": "arterial", "index_pct": 25, "bottle_ml": 473, "stock_bottles": 5, "lot": "ART-A"}).json()["item"]
lb = requests.post(f"{API}/fluids/{art['item_id']}/lots", json={"lot": "ART-B", "stock": 2}).json()["lot_id"]
requests.patch(f"{API}/fluids/{art['item_id']}", json={"min_stock": 10, "price_per_bottle": 400})
cav = requests.post(f"{API}/fluids", json={"name": "TEST_UICav24", "kind": "cavidad", "bottle_ml": 473, "stock_bottles": 3, "lot": "CAV-1"}).json()["item"]
top = requests.post(f"{API}/fluids", json={"name": "TEST_UITop24", "kind": "topico", "unit": "g", "bottle_ml": 100, "stock_bottles": 2, "lot": "TOP-1"}).json()["item"]
sup = requests.post(f"{API}/suppliers", json={"name": "TEST_UISup24", "phone": "5215512345678"}).json()["item"]
c = requests.post(f"{API}/cases", json={"deceased_name": "TEST_iter24_ui", "sex": "male"}).json()["case"]
cid = c["case_id"]
requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": {"peso": "80", "altura": "175", "condicion_general": "rutinario", "condiciones": []}})
requests.post(f"{API}/cases/{cid}/calculations", json={"type": "injection", "inputs": {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf", "k_factor": 0.135, "factor_f": 1.0, "desired_index_pct": 2, "fluid_index_pct": 25, "fluid_name": NAME, "bottle_ml": 473}})
print(json.dumps({"case": cid, "art": art["item_id"], "art_lot_a": art["lots"][0]["lot_id"], "art_lot_b": lb,
                  "cav": cav["item_id"], "cav_lot": cav["lots"][0]["lot_id"], "top": top["item_id"], "top_lot": top["lots"][0]["lot_id"],
                  "sup": sup["supplier_id"], "cases": [cid], "fluids": [art["item_id"], cav["item_id"], top["item_id"]], "suppliers": [sup["supplier_id"]]}))
