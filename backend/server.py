import os
import uuid
import logging
import base64
from io import BytesIO
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict

import jwt
import httpx
import bcrypt
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field, EmailStr

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
fs = AsyncIOMotorGridFSBucket(db, bucket_name="pdfs")

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"
JWT_EXPIRE_DAYS = 30
EMERGENT_SESSION_API = os.environ["EMERGENT_SESSION_API"]
ADMIN_EMAILS = {
    e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("preservia")

app = FastAPI(title="Preservia API")
api_router = APIRouter(prefix="/api")


# ----------------------------- Models -----------------------------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class GoogleInput(BaseModel):
    session_id: str


class CaseInput(BaseModel):
    name: str
    case_ref: Optional[str] = ""
    deceased_name: Optional[str] = ""
    date: Optional[str] = None
    status: Optional[str] = "active"


class StatusInput(BaseModel):
    status: str  # active | archived


class CalcRequest(BaseModel):
    type: str  # volume | lbm | concentration
    inputs: Dict[str, Any]


class NoteInput(BaseModel):
    text: str
    date: Optional[str] = None
    photos: List[str] = Field(default_factory=list)  # base64 data


class DocumentInput(BaseModel):
    title: str
    filename: str
    pdf_base64: str


class CatalogInput(BaseModel):
    category: str  # ficha_tecnica | hoja_seguridad
    subcategory: Optional[str] = None  # for ficha_tecnica: arteriales|cavidades|co_pre_inyectores|miscelaneos
    title: str
    filename: str
    pdf_base64: str


# ----------------------------- Helpers -----------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def public_user(u: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "name": u.get("name", ""),
        "picture": u.get("picture", ""),
        "provider": u.get("provider", "email"),
        "is_admin": u.get("email", "").lower() in ADMIN_EMAILS,
    }


LOCAL_USER = {
    "user_id": "local_user",
    "email": "local@preservia.mx",
    "name": "Profesional",
    "picture": "",
    "provider": "local",
    "is_admin": True,
}


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    # No-account mode: the app runs without authentication. All data is stored
    # under a single shared local user.
    return LOCAL_USER


async def get_current_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return user


# --------------- PDF storage helpers (GridFS, supports large files) ---------------
async def store_pdf(pdf_base64: str, filename: str) -> tuple[str, int]:
    try:
        raw = base64.b64decode(pdf_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="PDF invalido")
    if not raw:
        raise HTTPException(status_code=400, detail="El archivo esta vacio")
    grid_id = await fs.upload_from_stream(filename, raw)
    return str(grid_id), len(raw)


async def load_pdf_b64(doc: Dict[str, Any]) -> str:
    if doc.get("pdf_base64"):
        return doc["pdf_base64"]
    gid = doc.get("grid_id")
    if not gid:
        return ""
    grid_out = await fs.open_download_stream(ObjectId(gid))
    data = await grid_out.read()
    return base64.b64encode(data).decode("utf-8")


async def delete_pdf(doc: Dict[str, Any]) -> None:
    gid = doc.get("grid_id")
    if gid:
        try:
            await fs.delete(ObjectId(gid))
        except Exception:
            pass


# ----------------------------- Calculations -----------------------------
LBM_METHODS = {"janmahasatian", "boer", "james", "average"}
LBM_METHOD_LABELS = {
    "janmahasatian": "Janmahasatian",
    "boer": "Boer",
    "james": "James",
    "average": "Promedio (3 metodos)",
}


def compute_lbm(sex: str, weight_kg: float, height_cm: float, method: str = "average") -> Dict[str, Any]:
    """Lean body mass by Boer, James or Janmahasatian, or the average of the three.
    W in kg, H in cm. Returns the selected value plus each component."""
    method = (method or "average").lower()
    if method not in LBM_METHODS:
        method = "average"
    is_female = str(sex).lower().startswith("f")
    height_m = height_cm / 100.0
    bmi = weight_kg / (height_m ** 2) if height_m > 0 else 0.0
    if is_female:
        boer = 0.252 * weight_kg + 0.473 * height_cm - 48.3
        james = 1.07 * weight_kg - 148 * (weight_kg / height_cm) ** 2 if height_cm > 0 else 0.0
        janma = (9270 * weight_kg) / (8780 + 244 * bmi) if bmi > 0 else 0.0
    else:
        boer = 0.407 * weight_kg + 0.267 * height_cm - 19.2
        james = 1.10 * weight_kg - 128 * (weight_kg / height_cm) ** 2 if height_cm > 0 else 0.0
        janma = (9270 * weight_kg) / (6680 + 216 * bmi) if bmi > 0 else 0.0
    components = {
        "boer": max(boer, 0.0),
        "james": max(james, 0.0),
        "janmahasatian": max(janma, 0.0),
    }
    if method == "average":
        selected = sum(components.values()) / 3.0
    else:
        selected = components[method]
    return {"lbm": max(selected, 0.0), "method": method, "components": components}


def compute(calc_type: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Standard thanatopraxy formulas. Returns {results, summary}."""
    try:
        if calc_type == "volume":
            weight_kg = float(inputs["weight_kg"])
            case_type = str(inputs.get("case_type", "normal")).lower()
            basis = str(inputs.get("basis", "total")).lower()
            # Effective weight used for the solution estimate. Lean body mass
            # gives a more accurate requirement since fat tissue is less vascular.
            lbm_kg = None
            lbm_method_label = None
            if basis == "lean":
                sex = str(inputs.get("sex", "male")).lower()
                height_cm = float(inputs["height_cm"])
                method = str(inputs.get("lbm_method", "average")).lower()
                lbm_info = compute_lbm(sex, weight_kg, height_cm, method)
                lbm_kg = lbm_info["lbm"]
                lbm_method_label = LBM_METHOD_LABELS[lbm_info["method"]]
                effective_kg = max(lbm_kg, 0)
            else:
                effective_kg = weight_kg
            factors = {"normal": 1.0, "jaundice": 1.15, "edema": 0.85}
            factor = factors.get(case_type, 1.0)
            labels = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema"}
            effective_lb = effective_kg * 2.20462
            gallons = (effective_lb / 50.0) * factor
            liters = gallons * 3.78541
            results = {
                "liters": round(liters, 2),
                "gallons": round(gallons, 2),
                "weight_kg": round(weight_kg, 1),
                "case_type": labels.get(case_type, "Normal"),
                "adjustment": f"x{factor}",
                "basis": "Masa magra" if basis == "lean" else "Peso total",
            }
            if lbm_kg is not None:
                results["lbm_kg"] = round(lbm_kg, 1)
                results["lbm_method"] = lbm_method_label
            basis_txt = f" (masa magra {results.get('lbm_kg')} kg)" if lbm_kg is not None else ""
            summary = (
                f"{results['liters']} L de solucion arterial (~{results['gallons']} gal) "
                f"- {results['case_type']}{basis_txt}"
            )
            return {"results": results, "summary": summary}

        if calc_type == "lbm":
            sex = str(inputs.get("sex", "male")).lower()
            weight_kg = float(inputs["weight_kg"])
            height_cm = float(inputs["height_cm"])
            method = str(inputs.get("method", "average")).lower()
            info = compute_lbm(sex, weight_kg, height_cm, method)
            lbm = info["lbm"]
            comp = info["components"]
            fat_kg = max(weight_kg - lbm, 0)
            results = {
                "lbm_kg": round(lbm, 1),
                "method": LBM_METHOD_LABELS[info["method"]],
                "boer_kg": round(comp["boer"], 1),
                "james_kg": round(comp["james"], 1),
                "janmahasatian_kg": round(comp["janmahasatian"], 1),
                "fat_kg": round(fat_kg, 1),
                "fat_pct": round((fat_kg / weight_kg) * 100, 1) if weight_kg else 0,
            }
            summary = f"Masa magra: {results['lbm_kg']} kg ({results['method']})"
            return {"results": results, "summary": summary}

        if calc_type == "injection":
            # Injection-volume calc based on C1·V1 = C2·V2.
            # V1 = concentrate volume (default 473 mL = 16 fl oz commercial bottle, editable),
            # C1 = stock fluid index, C2 = desired index -> V2 = C1·V1 / C2 (total solution).
            # Lean body mass provides a recommended reference volume (~1 gal / 50 lb).
            weight_kg = float(inputs["weight_kg"])
            height_cm = float(inputs["height_cm"])
            sex = str(inputs.get("sex", "male")).lower()
            case_type = str(inputs.get("case_type", "normal")).lower()
            c1 = float(inputs["fluid_index_pct"])
            c2 = float(inputs["desired_index_pct"])
            concentrate_ml = float(inputs.get("concentrate_ml", 473.0))
            if c1 <= 0:
                raise ValueError("El indice del fluido debe ser mayor que 0")
            if c2 <= 0:
                raise ValueError("El indice deseado debe ser mayor que 0")
            if c2 > c1:
                raise ValueError("El indice deseado no puede superar el indice del fluido")
            if concentrate_ml <= 0:
                raise ValueError("El volumen de concentrado (V1) debe ser mayor que 0")
            method = str(inputs.get("lbm_method", "average")).lower()
            lbm_info = compute_lbm(sex, weight_kg, height_cm, method)
            lbm = lbm_info["lbm"]
            lbm_method_label = LBM_METHOD_LABELS[lbm_info["method"]]
            factors = {"normal": 1.0, "jaundice": 1.15, "edema": 0.85}
            factor = factors.get(case_type, 1.0)
            labels = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema"}
            # C1·V1 = C2·V2  ->  V2 = C1·V1 / C2, adjusted by case-type factor
            base_total_ml = (c1 * concentrate_ml) / c2
            total_ml = base_total_ml * factor
            water_ml = max(total_ml - concentrate_ml, 0)
            # Case-type factor adjusts the volume the body needs (lean-mass reference)
            recommended_ml = (lbm * 2.20462 / 50.0) * 3785.41 * factor
            v2_per_bottle_ml = (c1 * 473.0) / c2
            recommended_bottles = recommended_ml / v2_per_bottle_ml if v2_per_bottle_ml > 0 else 0
            bottles = concentrate_ml / 473.0
            # Composition of the injected solution: the formaldehyde comes from the
            # concentrate (C1% of V1); the rest of V2 is water.
            formaldehyde_ml = (c1 / 100.0) * concentrate_ml
            water_injection_ml = max(total_ml - formaldehyde_ml, 0)
            results = {
                "lbm_kg": round(lbm, 1),
                "lbm_method": lbm_method_label,
                "total_l": round(total_ml / 1000.0, 2),
                "total_ml": round(total_ml, 0),
                "concentrate_ml": round(concentrate_ml, 0),
                "water_ml": round(water_ml, 0),
                "formaldehyde_ml": round(formaldehyde_ml, 0),
                "water_injection_ml": round(water_injection_ml, 0),
                "bottles": round(bottles, 2),
                "recommended_l": round(recommended_ml / 1000.0, 2),
                "recommended_bottles": round(recommended_bottles, 1),
                "desired_index_pct": c2,
                "fluid_index_pct": c1,
                "case_type": labels.get(case_type, "Normal"),
                "adjustment": f"x{factor}",
            }
            summary = (
                f"V2 = {results['total_l']} L: formaldehido {results['formaldehyde_ml']:.0f} mL + "
                f"agua {results['water_injection_ml']:.0f} mL - {results['case_type']} (x{factor})"
            )
            return {"results": results, "summary": summary}

        if calc_type == "concentration":
            total_l = float(inputs["total_solution_l"])
            desired = float(inputs["desired_index_pct"])
            fluid_index = float(inputs["fluid_index_pct"])
            if fluid_index <= 0:
                raise ValueError("El indice del fluido debe ser mayor que 0")
            concentrate_ml = (desired / fluid_index) * total_l * 1000.0
            total_ml = total_l * 1000.0
            water_ml = max(total_ml - concentrate_ml, 0)
            results = {
                "concentrate_ml": round(concentrate_ml, 0),
                "water_ml": round(water_ml, 0),
                "total_ml": round(total_ml, 0),
            }
            summary = f"{results['concentrate_ml']:.0f} mL concentrado + {results['water_ml']:.0f} mL agua"
            return {"results": results, "summary": summary}
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Datos de calculo invalidos: {e}")

    raise HTTPException(status_code=400, detail="Tipo de calculo desconocido")


CALC_LABELS = {
    "volume": "Volumen de solucion",
    "lbm": "Masa magra corporal",
    "concentration": "Concentracion / Dilucion",
    "injection": "Volumen de inyeccion",
}


# ----------------------------- Auth routes -----------------------------
@api_router.post("/auth/register")
async def register(data: RegisterInput):
    existing = await db.users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="El correo ya esta registrado")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": data.email.lower(),
        "name": data.name,
        "password_hash": hash_password(data.password),
        "provider": "email",
        "picture": "",
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    return {"access_token": create_token(user_id), "user": public_user(user)}


@api_router.post("/auth/login")
async def login(data: LoginInput):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales invalidas")
    return {"access_token": create_token(user["user_id"]), "user": public_user(user)}


@api_router.post("/auth/google")
async def google_auth(data: GoogleInput):
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(EMERGENT_SESSION_API, headers={"X-Session-ID": data.session_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Sesion de Google invalida")
    info = resp.json()
    email = info["email"].lower()
    user = await db.users.find_one({"email": email})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": info.get("name", ""),
            "picture": info.get("picture", ""),
            "provider": "google",
            "password_hash": None,
            "created_at": now_iso(),
        }
        await db.users.insert_one(user)
    else:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"picture": info.get("picture", user.get("picture", ""))}},
        )
    return {"access_token": create_token(user["user_id"]), "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)):
    return {"user": public_user(user)}


# ----------------------------- Calculate (stateless) -----------------------------
@api_router.post("/calculate")
async def calculate(req: CalcRequest, user: Dict[str, Any] = Depends(get_current_user)):
    return compute(req.type, req.inputs)


# ----------------------------- Cases -----------------------------
def case_public(c: Dict[str, Any]) -> Dict[str, Any]:
    c.pop("_id", None)
    return c


@api_router.get("/cases")
async def list_cases(user: Dict[str, Any] = Depends(get_current_user)):
    cases = await db.cases.find({"user_id": user["user_id"]}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    for c in cases:
        c["calc_count"] = len(c.get("calculations", []))
        c["note_count"] = await db.notes.count_documents({"case_id": c["case_id"]})
        c.pop("calculations", None)
    return {"cases": cases}


@api_router.post("/cases")
async def create_case(data: CaseInput, user: Dict[str, Any] = Depends(get_current_user)):
    case_id = f"case_{uuid.uuid4().hex[:12]}"
    doc = {
        "case_id": case_id,
        "user_id": user["user_id"],
        "name": data.name,
        "case_ref": data.case_ref or "",
        "deceased_name": data.deceased_name or "",
        "date": data.date or now_iso(),
        "status": data.status or "active",
        "calculations": [],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.cases.insert_one(doc)
    return {"case": case_public(dict(doc))}


@api_router.get("/cases/{case_id}")
async def get_case(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    notes = await db.notes.find({"case_id": case_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    c["notes"] = notes
    return {"case": c}


@api_router.put("/cases/{case_id}")
async def update_case(case_id: str, data: CaseInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.update_one(
        {"case_id": case_id},
        {"$set": {
            "name": data.name,
            "case_ref": data.case_ref or "",
            "deceased_name": data.deceased_name or "",
            "status": data.status or c.get("status", "active"),
            "updated_at": now_iso(),
        }},
    )
    updated = await db.cases.find_one({"case_id": case_id}, {"_id": 0})
    return {"case": updated}


@api_router.patch("/cases/{case_id}/status")
async def set_case_status(case_id: str, data: StatusInput, user: Dict[str, Any] = Depends(get_current_user)):
    if data.status not in ("active", "archived"):
        raise HTTPException(status_code=400, detail="Estado inválido")
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.update_one(
        {"case_id": case_id},
        {"$set": {"status": data.status, "updated_at": now_iso()}},
    )
    updated = await db.cases.find_one({"case_id": case_id}, {"_id": 0})
    return {"case": updated}


@api_router.delete("/cases/{case_id}")
async def delete_case(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.delete_one({"case_id": case_id})
    await db.notes.delete_many({"case_id": case_id})
    return {"ok": True}


# ----------------------------- Calculations on a case -----------------------------
@api_router.post("/cases/{case_id}/calculations")
async def add_calculation(case_id: str, req: CalcRequest, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    computed = compute(req.type, req.inputs)
    calc = {
        "calc_id": f"calc_{uuid.uuid4().hex[:10]}",
        "type": req.type,
        "label": CALC_LABELS.get(req.type, req.type),
        "inputs": req.inputs,
        "results": computed["results"],
        "summary": computed["summary"],
        "created_at": now_iso(),
    }
    await db.cases.update_one(
        {"case_id": case_id},
        {"$push": {"calculations": calc}, "$set": {"updated_at": now_iso()}},
    )
    return {"calculation": calc}


@api_router.delete("/cases/{case_id}/calculations/{calc_id}")
async def delete_calculation(case_id: str, calc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.update_one(
        {"case_id": case_id},
        {"$pull": {"calculations": {"calc_id": calc_id}}, "$set": {"updated_at": now_iso()}},
    )
    return {"ok": True}


# ----------------------------- Notes -----------------------------
@api_router.post("/cases/{case_id}/notes")
async def add_note(case_id: str, data: NoteInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    note = {
        "note_id": f"note_{uuid.uuid4().hex[:10]}",
        "case_id": case_id,
        "user_id": user["user_id"],
        "text": data.text,
        "date": data.date or now_iso(),
        "photos": data.photos,
        "created_at": now_iso(),
    }
    await db.notes.insert_one(dict(note))
    await db.cases.update_one({"case_id": case_id}, {"$set": {"updated_at": now_iso()}})
    return {"note": note}


@api_router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    n = await db.notes.find_one({"note_id": note_id, "user_id": user["user_id"]})
    if not n:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    await db.notes.delete_one({"note_id": note_id})
    return {"ok": True}


# ----------------------------- Stats / History -----------------------------
CALC_TYPE_LABELS = {
    "volume": "Volumen de solución",
    "lbm": "Masa magra corporal",
    "concentration": "Concentración / Dilución",
}


def _parse_dt(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return None


@api_router.get("/stats")
async def get_stats(user: Dict[str, Any] = Depends(get_current_user)):
    cases = await db.cases.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    total_notes = await db.notes.count_documents({"user_id": user["user_id"]})

    now = datetime.now(timezone.utc)
    total_cases = len(cases)
    active_cases = 0
    archived_cases = 0
    total_calcs = 0
    calc_by_type: Dict[str, int] = {"volume": 0, "lbm": 0, "concentration": 0}
    cases_last_30 = 0

    # Last 6 months buckets (oldest -> newest)
    month_labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    months: List[Dict[str, Any]] = []
    for i in range(5, -1, -1):
        y = now.year
        m = now.month - i
        while m <= 0:
            m += 12
            y -= 1
        months.append({"key": f"{y}-{m:02d}", "label": month_labels[m - 1], "count": 0})
    month_index = {mm["key"]: mm for mm in months}

    for c in cases:
        status = c.get("status", "active")
        if status == "archived":
            archived_cases += 1
        else:
            active_cases += 1
        calcs = c.get("calculations", [])
        total_calcs += len(calcs)
        for calc in calcs:
            t = calc.get("type")
            if t in calc_by_type:
                calc_by_type[t] += 1
        created = _parse_dt(c.get("created_at")) or _parse_dt(c.get("date"))
        if created:
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if (now - created).days < 30:
                cases_last_30 += 1
            key = f"{created.year}-{created.month:02d}"
            if key in month_index:
                month_index[key]["count"] += 1

    # Recent cases (by updated_at desc)
    recent = sorted(cases, key=lambda x: x.get("updated_at") or "", reverse=True)[:5]
    recent_out = [
        {
            "case_id": c["case_id"],
            "name": c.get("name", ""),
            "case_ref": c.get("case_ref", ""),
            "status": c.get("status", "active"),
            "calc_count": len(c.get("calculations", [])),
            "updated_at": c.get("updated_at"),
            "date": c.get("date"),
        }
        for c in recent
    ]

    calc_breakdown = [
        {"type": t, "label": CALC_TYPE_LABELS[t], "count": calc_by_type[t]}
        for t in ["volume", "lbm", "concentration"]
    ]

    return {
        "totals": {
            "cases": total_cases,
            "calculations": total_calcs,
            "notes": total_notes,
            "active_cases": active_cases,
            "archived_cases": archived_cases,
            "cases_last_30_days": cases_last_30,
        },
        "monthly": months,
        "calc_breakdown": calc_breakdown,
        "recent_cases": recent_out,
    }


# ----------------------------- PDF Report -----------------------------
INPUT_LABELS = {
    "desired_index_pct": "Concentracion de formaldehido inyectado (C2 %)",
    "fluid_index_pct": "Index de Fluido Concentrado (C1 %)",
    "concentrate_ml": "Volumen Botella Concentrado (V1 mL)",
    "weight_kg": "Peso (kg)",
    "height_cm": "Estatura (cm)",
    "sex": "Sexo",
    "case_type": "Tipo de caso",
    "total_solution_l": "Solucion total (L)",
    "method": "Metodo masa magra",
    "lbm_method": "Metodo masa magra",
}

SEX_LABELS = {"male": "Masculino", "female": "Femenino"}
CASE_TYPE_LABELS = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema"}
METHOD_LABELS = {
    "janmahasatian": "Janmahasatian",
    "boer": "Boer",
    "james": "James",
    "average": "Promedio (3 metodos)",
}


def build_pdf(case: Dict[str, Any], notes: List[Dict[str, Any]], user: Dict[str, Any]) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    slate = colors.HexColor("#334155")
    slate_light = colors.HexColor("#64748B")
    ink = colors.HexColor("#0F172A")

    title = ParagraphStyle("PTitle", parent=styles["Title"], textColor=ink, fontSize=22, spaceAfter=2)
    subtitle = ParagraphStyle("PSub", parent=styles["Normal"], textColor=slate_light, fontSize=10, spaceAfter=14)
    h2 = ParagraphStyle("PH2", parent=styles["Heading2"], textColor=slate, fontSize=13, spaceBefore=14, spaceAfter=6)
    body = ParagraphStyle("PBody", parent=styles["Normal"], textColor=ink, fontSize=10, leading=15)
    small = ParagraphStyle("PSmall", parent=styles["Normal"], textColor=slate_light, fontSize=8.5)
    cell_label = ParagraphStyle("PCellLabel", parent=styles["Normal"], textColor=slate_light, fontSize=9.5, leading=13)
    cell_val = ParagraphStyle("PCellVal", parent=styles["Normal"], textColor=ink, fontSize=9.5, leading=13)
    cell = ParagraphStyle("PCell", parent=styles["Normal"], textColor=ink, fontSize=8.5, leading=11)
    cell_head = ParagraphStyle(
        "PCellHead", parent=styles["Normal"], textColor=colors.white, fontSize=8.5, leading=11, fontName="Helvetica-Bold"
    )

    def esc(v: Any) -> str:
        s = str(v) if v is not None else ""
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def fmt_date(iso: Optional[str]) -> str:
        if not iso:
            return "-"
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
        except Exception:
            return iso

    elems: List[Any] = []
    logo_path = ROOT_DIR / "assets" / "preservia-logo.png"
    if logo_path.exists():
        elems.append(RLImage(str(logo_path), width=55 * mm, height=(55.0 / 6.0) * mm))
        elems.append(Spacer(1, 4))
    else:
        elems.append(Paragraph("PRESERVIA", title))
    elems.append(Paragraph("Reporte profesional de caso - Tanatopraxia", subtitle))

    info_rows = [
        [Paragraph("Caso", cell_label), Paragraph(esc(case.get("name", "-")), cell_val)],
        [Paragraph("ID / Referencia", cell_label), Paragraph(esc(case.get("case_ref") or "-"), cell_val)],
        [Paragraph("Fallecido", cell_label), Paragraph(esc(case.get("deceased_name") or "-"), cell_val)],
        [Paragraph("Fecha del caso", cell_label), Paragraph(esc(fmt_date(case.get("date"))), cell_val)],
        [Paragraph("Profesional", cell_label), Paragraph(esc(f"{user.get('name','')} ({user.get('email','')})"), cell_val)],
        [Paragraph("Generado", cell_label), Paragraph(esc(fmt_date(now_iso())), cell_val)],
    ]
    t = Table(info_rows, colWidths=[45 * mm, 120 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
    ]))
    elems.append(t)

    elems.append(Paragraph("Calculos tecnicos", h2))
    calcs = case.get("calculations", [])
    if calcs:
        data_rows = [[Paragraph("Tipo", cell_head), Paragraph("Datos", cell_head), Paragraph("Resultado", cell_head)]]
        def fmt_inputs(inputs: Dict[str, Any]) -> str:
            order = [
                "desired_index_pct", "fluid_index_pct", "concentrate_ml",
                "weight_kg", "height_cm", "sex", "case_type", "total_solution_l",
            ]
            keys = [k for k in order if k in inputs] + [k for k in inputs if k not in order]
            lines = []
            for k in keys:
                v = inputs[k]
                if k == "sex":
                    v = SEX_LABELS.get(str(v).lower(), v)
                elif k == "case_type":
                    v = CASE_TYPE_LABELS.get(str(v).lower(), v)
                elif k in ("method", "lbm_method"):
                    v = METHOD_LABELS.get(str(v).lower(), v)
                lines.append(f"{esc(INPUT_LABELS.get(k, k))}: {esc(v)}")
            return "<br/>".join(lines)

        for c in calcs:
            data_rows.append([
                Paragraph(esc(c.get("label", c.get("type"))), cell),
                Paragraph(fmt_inputs(c.get("inputs", {})), cell),
                Paragraph(esc(c.get("summary", "")), cell),
            ])
        ct = Table(data_rows, colWidths=[40 * mm, 60 * mm, 65 * mm])
        ct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), slate),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ]))
        elems.append(ct)
    else:
        elems.append(Paragraph("Sin calculos registrados.", body))

    elems.append(Paragraph("Notas del caso", h2))
    if notes:
        for n in notes:
            elems.append(Paragraph(f"<b>{fmt_date(n.get('date'))}</b>", small))
            elems.append(Paragraph((n.get("text") or "").replace("\n", "<br/>"), body))
            for ph in n.get("photos", [])[:4]:
                try:
                    raw = ph.split(",", 1)[1] if ph.startswith("data:") else ph
                    img_data = BytesIO(base64.b64decode(raw))
                    elems.append(Spacer(1, 4))
                    elems.append(RLImage(img_data, width=70 * mm, height=52 * mm, kind="proportional"))
                except Exception:
                    continue
            elems.append(Spacer(1, 10))
    else:
        elems.append(Paragraph("Sin notas registradas.", body))

    elems.append(Spacer(1, 16))
    elems.append(Paragraph("Documento generado por Preservia. Uso profesional.", small))

    doc.build(elems)
    return buf.getvalue()


@api_router.get("/cases/{case_id}/report")
async def generate_report(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    notes = await db.notes.find({"case_id": case_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    pdf_bytes = build_pdf(c, notes, user)
    b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    safe = (c.get("name") or "caso").replace(" ", "_")[:40]
    return {"filename": f"Preservia_{safe}.pdf", "pdf_base64": b64, "mime": "application/pdf"}


# ----------------------------- Library documents -----------------------------
@api_router.post("/library/documents")
async def add_document(data: DocumentInput, user: Dict[str, Any] = Depends(get_current_user)):
    grid_id, size = await store_pdf(data.pdf_base64, data.filename)
    doc = {
        "doc_id": f"doc_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "title": data.title,
        "filename": data.filename,
        "grid_id": grid_id,
        "size": size,
        "created_at": now_iso(),
    }
    await db.documents.insert_one(dict(doc))
    doc.pop("grid_id", None)
    return {"document": doc}


@api_router.get("/library/documents")
async def list_documents(user: Dict[str, Any] = Depends(get_current_user)):
    docs = await db.documents.find(
        {"user_id": user["user_id"]}, {"_id": 0, "pdf_base64": 0, "grid_id": 0}
    ).sort("created_at", -1).to_list(500)
    return {"documents": docs}


@api_router.get("/library/documents/{doc_id}")
async def get_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    d = await db.documents.find_one(
        {"doc_id": doc_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    d["pdf_base64"] = await load_pdf_b64(d)
    d.pop("grid_id", None)
    return {"document": d}


@api_router.delete("/library/documents/{doc_id}")
async def delete_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    d = await db.documents.find_one({"doc_id": doc_id, "user_id": user["user_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    await delete_pdf(d)
    await db.documents.delete_one({"doc_id": doc_id})
    return {"ok": True}


# ----------------------------- Shared catalog (admin-managed) -----------------------------
CATALOG_CATEGORIES = {"ficha_tecnica", "hoja_seguridad"}
CATALOG_SUBCATEGORIES = {"arteriales", "cavidades", "co_pre_inyectores", "miscelaneos"}


@api_router.post("/catalog/documents")
async def add_catalog_document(data: CatalogInput, user: Dict[str, Any] = Depends(get_current_admin)):
    if data.category not in CATALOG_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoria invalida")
    if data.subcategory not in CATALOG_SUBCATEGORIES:
        raise HTTPException(status_code=400, detail="Subcategoria invalida")
    subcategory = data.subcategory
    grid_id, size = await store_pdf(data.pdf_base64, data.filename)
    doc = {
        "doc_id": f"cat_{uuid.uuid4().hex[:12]}",
        "category": data.category,
        "subcategory": subcategory,
        "title": data.title,
        "filename": data.filename,
        "grid_id": grid_id,
        "size": size,
        "uploaded_by": user["email"],
        "created_at": now_iso(),
    }
    await db.catalog.insert_one(dict(doc))
    doc.pop("grid_id", None)
    return {"document": doc}


@api_router.get("/catalog/documents")
async def list_catalog_documents(category: Optional[str] = None, user: Dict[str, Any] = Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if category:
        if category not in CATALOG_CATEGORIES:
            raise HTTPException(status_code=400, detail="Categoria invalida")
        query["category"] = category
    docs = await db.catalog.find(query, {"_id": 0, "pdf_base64": 0, "grid_id": 0}).sort("created_at", -1).to_list(1000)
    return {"documents": docs}


@api_router.get("/catalog/documents/{doc_id}")
async def get_catalog_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    d = await db.catalog.find_one({"doc_id": doc_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    d["pdf_base64"] = await load_pdf_b64(d)
    d.pop("grid_id", None)
    return {"document": d}


@api_router.delete("/catalog/documents/{doc_id}")
async def delete_catalog_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_admin)):
    d = await db.catalog.find_one({"doc_id": doc_id})
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    await delete_pdf(d)
    await db.catalog.delete_one({"doc_id": doc_id})
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "Preservia API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.cases.create_index("user_id")
    await db.cases.create_index("case_id", unique=True)
    await db.notes.create_index("case_id")
    await db.documents.create_index("user_id")
    await db.catalog.create_index("category")
    logger.info("Preservia API ready")


@app.on_event("shutdown")
async def shutdown():
    client.close()
