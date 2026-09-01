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
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, PageBreak,
)
from pypdf import PdfReader, PdfWriter

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
    name: Optional[str] = ""
    case_ref: Optional[str] = ""
    deceased_name: Optional[str] = ""
    date: Optional[str] = None
    status: Optional[str] = "active"
    sex: Optional[str] = ""  # male | female | ""
    date_of_death: Optional[str] = None
    embalming_start: Optional[str] = None
    embalming_end: Optional[str] = None


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
    folder: Optional[str] = "general"
    pdf_base64: str


class AttachmentInput(BaseModel):
    label: str
    filename: Optional[str] = "documento"
    kind: Optional[str] = "image"  # image | pdf
    data_base64: str


class LogEntryInput(BaseModel):
    product: str
    form: str  # liquid | powder
    quantity: float
    unit: str  # oz | ml | g


class CatalogInput(BaseModel):
    category: str  # ficha_tecnica | hoja_seguridad
    subcategory: Optional[str] = None  # for ficha_tecnica: arteriales|cavidades|co_pre_inyectores|miscelaneos
    title: str
    filename: str
    pdf_base64: str


# ----------------------------- Helpers -----------------------------
# Horario de México (UTC-6 fijo; México central no usa horario de verano desde 2022).
MX_TZ = timezone(timedelta(hours=-6))


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


async def load_bytes(doc: Dict[str, Any]) -> bytes:
    gid = doc.get("grid_id")
    if not gid:
        return b""
    grid_out = await fs.open_download_stream(ObjectId(gid))
    return await grid_out.read()


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


async def next_case_number() -> str:
    """Unique, non-repeating lot-style case number: PRV{YYMMDD}{LETTER}{NNNN}."""
    from pymongo import ReturnDocument
    now = datetime.now(timezone.utc)
    day = now.strftime("%y%m%d")
    r = await db.counters.find_one_and_update(
        {"_id": f"case_{day}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = r["seq"]
    letter = chr(ord("A") + ((seq - 1) // 9999))
    n = ((seq - 1) % 9999) + 1
    return f"PRV{day}{letter}{n:04d}"


def embalming_duration_text(start: Optional[str], end: Optional[str]) -> Optional[str]:
    if not start or not end:
        return None
    try:
        s = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        e = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
        mins = int((e - s).total_seconds() // 60)
        if mins < 0:
            return None
        h, m = divmod(mins, 60)
        if h and m:
            return f"{h} h {m} min"
        if h:
            return f"{h} h"
        return f"{m} min"
    except Exception:
        return None


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
    created = now_iso()
    case_number = await next_case_number()
    doc = {
        "case_id": case_id,
        "case_number": case_number,
        "user_id": user["user_id"],
        "name": data.name.strip() if (data.name or "").strip() else case_number,
        "case_ref": data.case_ref or "",
        "deceased_name": data.deceased_name or "",
        "sex": data.sex or "",
        "date": data.date or created,
        "date_of_death": data.date_of_death or None,
        "embalming_date": created,  # coincide con la apertura del caso
        "embalming_start": data.embalming_start or None,
        "embalming_end": data.embalming_end or None,
        "status": data.status or "active",
        "calculations": [],
        "created_at": created,
        "updated_at": created,
    }
    await db.cases.insert_one(doc)
    return {"case": case_public(dict(doc))}


@api_router.post("/cases/import")
async def import_case(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    src = payload.get("case") if isinstance(payload.get("case"), dict) else payload
    if not isinstance(src, dict) or not (src.get("name") or src.get("deceased_name")):
        raise HTTPException(status_code=400, detail="Archivo de caso invalido")
    case_id = f"case_{uuid.uuid4().hex[:12]}"
    valid_types = {"volume", "lbm", "concentration", "injection"}
    calculations: List[Dict[str, Any]] = []
    for c in (src.get("calculations") or []):
        if not isinstance(c, dict) or c.get("type") not in valid_types:
            continue
        calculations.append({
            "calc_id": f"calc_{uuid.uuid4().hex[:10]}",
            "type": c.get("type"),
            "label": c.get("label") or CALC_LABELS.get(c.get("type"), c.get("type")),
            "inputs": c.get("inputs", {}),
            "results": c.get("results", {}),
            "summary": c.get("summary", ""),
            "created_at": now_iso(),
        })
    name = str(src.get("name") or "Caso importado")
    doc = {
        "case_id": case_id,
        "user_id": user["user_id"],
        "name": name,
        "case_ref": str(src.get("case_ref") or ""),
        "deceased_name": str(src.get("deceased_name") or ""),
        "date": src.get("date") or now_iso(),
        "status": src.get("status") if src.get("status") in ("active", "archived") else "active",
        "calculations": calculations,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.cases.insert_one(doc)
    for n in (src.get("notes") or []):
        if not isinstance(n, dict) or not (n.get("text") or "").strip():
            continue
        await db.notes.insert_one({
            "note_id": f"note_{uuid.uuid4().hex[:10]}",
            "case_id": case_id,
            "user_id": user["user_id"],
            "text": n.get("text", ""),
            "date": n.get("date") or now_iso(),
            "photos": [],
            "created_at": now_iso(),
        })
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
            "case_ref": data.case_ref or "",
            "deceased_name": data.deceased_name or "",
            "sex": data.sex or "",
            "date_of_death": data.date_of_death or None,
            "embalming_start": data.embalming_start or None,
            "embalming_end": data.embalming_end or None,
            "status": data.status or c.get("status", "active"),
            "updated_at": now_iso(),
        }},
    )
    updated = await db.cases.find_one({"case_id": case_id}, {"_id": 0})
    return {"case": updated}


@api_router.put("/cases/{case_id}/sheet")
async def save_case_sheet(case_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    sheet = payload.get("sheet") if isinstance(payload.get("sheet"), dict) else payload
    await db.cases.update_one(
        {"case_id": case_id},
        {"$set": {"case_sheet": sheet, "updated_at": now_iso()}},
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


# ----------------------------- Logbook (bitácora de productos) -----------------------------
LOG_UNITS = {"liquid": {"oz", "ml"}, "powder": {"g"}}


@api_router.post("/cases/{case_id}/logbook")
async def add_log_entry(case_id: str, data: LogEntryInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    form = data.form if data.form in ("liquid", "powder") else "liquid"
    unit = data.unit if data.unit in LOG_UNITS[form] else next(iter(LOG_UNITS[form]))
    if not data.product.strip():
        raise HTTPException(status_code=400, detail="Producto requerido")
    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor que 0")
    entry = {
        "log_id": f"log_{uuid.uuid4().hex[:10]}",
        "product": data.product.strip(),
        "form": form,
        "quantity": round(data.quantity, 2),
        "unit": unit,
        "created_at": now_iso(),
    }
    await db.cases.update_one(
        {"case_id": case_id},
        {"$push": {"logbook": entry}, "$set": {"updated_at": now_iso()}},
    )
    return {"entry": entry}


@api_router.delete("/cases/{case_id}/logbook/{log_id}")
async def delete_log_entry(case_id: str, log_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.update_one(
        {"case_id": case_id},
        {"$pull": {"logbook": {"log_id": log_id}}, "$set": {"updated_at": now_iso()}},
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

# ---- Hoja del caso (análisis) label maps ----
SHEET_TIPO_CASO = {"necropsiado": "Necropsiado", "normal": "Normal", "estudio_clinico": "Estudio clínico"}
SHEET_COMPLEXION = {
    "normal": "Normal", "emaciada": "Emaciada", "delgada": "Delgada",
    "mediana": "Mediana", "robusta": "Robusta", "obesa": "Obesa",
}
SHEET_SELLO = {"barba": "Barba", "bigote": "Bigote"}
SHEET_SIGNOS = {
    "amoratamiento_rostro": "Amoratamiento en el rostro",
    "amoratamiento_declives": "Amoratamiento en zonas declives",
    "inflamacion_abdominal": "Inflamación abdominal",
    "fluidos_orificios": "Segregación de fluidos por orificios naturales",
    "fluidos_suturas": "Segregación de fluidos por suturas",
    "gases_ofensivos": "Cuadro de gases ofensivos",
    "retencion_liquidos": "Retención de líquidos",
    "gas_tejido": "Gas en tejido",
    "ictericia": "Ictericia",
}
SHEET_CARAC = {
    "amputacion": "Amputación", "cicatriz": "Cicatriz", "traumas": "Traumas",
    "ulceras": "Úlceras de decúbito", "tumor": "Tumor",
    "desprendimiento_piel": "Desprendimiento de piel", "refrigerado": "Refrigerado",
}
SHEET_EQUIPO = {
    "cateter_dialisis": "Catéter de diálisis", "marcapasos": "Marcapasos",
    "grapas": "Grapas quirúrgicas", "osteosintesis": "Material de osteosíntesis",
    "respiratorio": "Material respiratorio", "sonda_urinaria": "Sonda urinaria",
    "traqueotomia": "Traqueotomía",
}
SHEET_SERVICIO = {
    "normal": "Embalsamamiento normal", "especial": "Embalsamamiento especial",
    "largo_plazo": "Embalsamamiento a largo plazo", "reconstruccion": "Reconstrucción",
    "auxilio_estetico": "Auxilio estético", "custodia": "Custodia y refrigeración",
    "ninguno": "Ningún servicio",
}



def build_pdf(case: Dict[str, Any], notes: List[Dict[str, Any]], user: Dict[str, Any],
              attachments: Optional[List[Dict[str, Any]]] = None) -> bytes:
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
            dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(MX_TZ).strftime("%d/%m/%Y %H:%M")
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

    def fmt_dateonly(iso: Optional[str]) -> str:
        if not iso:
            return "-"
        s = str(iso)
        try:
            # Fechas solo-día (AAAA-MM-DD) se muestran tal cual, sin conversión de zona.
            if len(s) == 10 and "T" not in s:
                return datetime.strptime(s, "%Y-%m-%d").strftime("%d/%m/%Y")
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(MX_TZ).strftime("%d/%m/%Y")
        except Exception:
            return s

    sex_lbl = {"male": "Masculino", "female": "Femenino"}
    dur = embalming_duration_text(case.get("embalming_start"), case.get("embalming_end"))
    # La fecha de embalsamamiento refleja el inicio real del procedimiento (o la apertura del caso si no se indicó).
    emb_date_src = case.get("embalming_start") or case.get("embalming_date") or case.get("date")
    info_rows = [
        [Paragraph("N.º de caso", cell_label), Paragraph(esc(case.get("case_number") or "-"), cell_val)],
        [Paragraph("ID / Referencia", cell_label), Paragraph(esc(case.get("case_ref") or "-"), cell_val)],
        [Paragraph("Fallecido", cell_label), Paragraph(esc(case.get("deceased_name") or "-"), cell_val)],
        [Paragraph("Sexo", cell_label), Paragraph(esc(sex_lbl.get(case.get("sex"), "-")), cell_val)],
        [Paragraph("Fecha de fallecimiento", cell_label), Paragraph(esc(fmt_dateonly(case.get("date_of_death"))), cell_val)],
        [Paragraph("Fecha de embalsamamiento", cell_label), Paragraph(esc(fmt_dateonly(emb_date_src)), cell_val)],
        [Paragraph("Inicio de embalsamamiento", cell_label), Paragraph(esc(fmt_date(case.get("embalming_start"))), cell_val)],
        [Paragraph("Termino de embalsamamiento", cell_label), Paragraph(esc(fmt_date(case.get("embalming_end"))), cell_val)],
        [Paragraph("Tiempo consumido", cell_label), Paragraph(esc(dur or "-"), cell_val)],
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

    # ---- Hoja del caso (análisis del caso) ----
    sheet = case.get("case_sheet") or {}
    if isinstance(sheet, dict) and any(bool(v) for v in sheet.values()):
        def sel(vals, mapping, otro=""):
            parts = [mapping.get(v, v) for v in (vals or [])]
            if otro and str(otro).strip():
                parts.append(f"Otro: {otro}")
            return ", ".join([p for p in parts if p])

        elems.append(Paragraph("Analisis del caso - Embalsamamiento", h2))
        srows: List[Any] = []

        def addrow(lbl: str, val: Any):
            if val is not None and str(val).strip():
                srows.append([Paragraph(esc(lbl), cell_label), Paragraph(esc(val).replace("\n", "<br/>"), cell_val)])

        addrow("Fecha de ingreso", sheet.get("fecha_ingreso"))
        addrow("No. de servicio", sheet.get("no_servicio"))
        addrow("Nombre del difunto", sheet.get("nombre_difunto"))
        addrow("Funeraria", sheet.get("funeraria"))
        addrow("Responsable de la funeraria", sheet.get("responsable_funeraria"))
        addrow("Ingreso a sala de emb.", sheet.get("ingreso_sala"))
        addrow("Inicio del emb.", sheet.get("inicio_emb"))
        addrow("Termino del emb.", sheet.get("termino_emb"))
        addrow("Tipo de caso", sel(sheet.get("tipo_caso"), SHEET_TIPO_CASO, sheet.get("tipo_caso_otro", "")))
        addrow("Complexion", SHEET_COMPLEXION.get(sheet.get("complexion"), sheet.get("complexion") or ""))
        addrow("Uso de sello facial", sel(sheet.get("sello_facial"), SHEET_SELLO, sheet.get("sello_facial_otro", "")))
        addrow("Signos de descomposicion", sel(sheet.get("signos"), SHEET_SIGNOS, sheet.get("signos_otros", "")))
        addrow("Caracteristicas", sel(sheet.get("caracteristicas"), SHEET_CARAC))
        addrow("Lesiones", sheet.get("caracteristicas_lesiones"))
        addrow("Otras caracteristicas", sheet.get("caracteristicas_otros"))
        addrow("Equipo medico", sel(sheet.get("equipo_medico"), SHEET_EQUIPO, sheet.get("equipo_medico_otros", "")))
        addrow("Altura", sheet.get("altura"))
        addrow("Ancho", sheet.get("ancho"))
        addrow("Peso", sheet.get("peso"))
        addrow("Tipo de servicio realizado", sel(sheet.get("tipo_servicio"), SHEET_SERVICIO))
        addrow("Posibles reacciones", sheet.get("reacciones"))
        addrow("Sugerencias y comentarios", sheet.get("sugerencias"))
        addrow("Sala de velacion", sheet.get("sala_velacion"))
        addrow("Domicilio", sheet.get("domicilio"))
        addrow("Otro lugar", sheet.get("otro_lugar"))
        addrow("Fecha de egreso", sheet.get("fecha_egreso"))
        addrow("Hora de egreso", sheet.get("hora_egreso"))
        addrow("Responsable de la entrega", sheet.get("responsable_entrega"))
        addrow("Titular o responsable", sheet.get("titular_responsable"))
        addrow("Tecnico responsable del servicio", sheet.get("tecnico_responsable"))
        addrow("Gerente de turno", sheet.get("gerente_turno"))

        if srows:
            st = Table(srows, colWidths=[55 * mm, 110 * mm])
            st.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
            ]))
            elems.append(st)

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

    # Bitácora de productos
    logbook = case.get("logbook") or []
    elems.append(Paragraph("Bitacora de productos", h2))
    if logbook:
        unit_lbl = {"oz": "oz", "ml": "mL", "g": "g"}
        form_lbl = {"liquid": "Liquido", "powder": "Polvo"}
        rows = [[Paragraph("<b>Producto</b>", cell), Paragraph("<b>Tipo</b>", cell),
                 Paragraph("<b>Cantidad</b>", cell), Paragraph("<b>Unidad</b>", cell)]]
        for e in logbook:
            q = e.get("quantity")
            q = int(q) if isinstance(q, (int, float)) and float(q).is_integer() else q
            rows.append([
                Paragraph(esc(e.get("product", "")), cell),
                Paragraph(esc(form_lbl.get(e.get("form"), e.get("form", ""))), cell),
                Paragraph(esc(q), cell),
                Paragraph(esc(unit_lbl.get(e.get("unit"), e.get("unit", ""))), cell),
            ])
        lt = Table(rows, colWidths=[75 * mm, 32 * mm, 30 * mm, 28 * mm])
        lt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), slate),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ]))
        elems.append(lt)
    else:
        elems.append(Paragraph("Sin productos registrados.", body))

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

    for att in (attachments or []):
        raw = att.get("bytes")
        if not raw:
            continue
        try:
            elems.append(PageBreak())
            elems.append(Paragraph(att.get("label") or "Documento adjunto", h2))
            elems.append(Spacer(1, 6))
            elems.append(RLImage(BytesIO(raw), width=170 * mm, height=225 * mm, kind="proportional"))
        except Exception:
            continue

    doc.build(elems)
    return buf.getvalue()


def _label_cover(label: str) -> bytes:
    """A single-page PDF with the attachment label as a heading."""
    buf = BytesIO()
    d = SimpleDocTemplate(buf, pagesize=A4, topMargin=24 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
    styles = getSampleStyleSheet()
    h = ParagraphStyle("cov", parent=styles["Heading2"], fontSize=14, textColor=colors.HexColor("#0F172A"))
    d.build([Paragraph(label or "Documento adjunto", h)])
    return buf.getvalue()


def merge_pdf_attachments(base_pdf: bytes, pdf_atts: List[Dict[str, Any]]) -> bytes:
    writer = PdfWriter()
    for page in PdfReader(BytesIO(base_pdf)).pages:
        writer.add_page(page)
    for a in pdf_atts:
        raw = a.get("bytes")
        if not raw:
            continue
        try:
            for page in PdfReader(BytesIO(_label_cover(a.get("label")))).pages:
                writer.add_page(page)
            for page in PdfReader(BytesIO(raw)).pages:
                writer.add_page(page)
        except Exception:
            continue
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


@api_router.get("/cases/{case_id}/report")
async def generate_report(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    notes = await db.notes.find({"case_id": case_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    atts = await db.attachments.find({"case_id": case_id}, {"_id": 0}).sort("created_at", 1).to_list(50)
    for a in atts:
        a["bytes"] = await load_bytes(a)
    image_atts = [a for a in atts if a.get("kind") != "pdf"]
    pdf_atts = [a for a in atts if a.get("kind") == "pdf"]
    pdf_bytes = build_pdf(c, notes, user, image_atts)
    if pdf_atts:
        pdf_bytes = merge_pdf_attachments(pdf_bytes, pdf_atts)
    b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    safe = (c.get("name") or "caso").replace(" ", "_")[:40]
    return {"filename": f"Preservia_{safe}.pdf", "pdf_base64": b64, "mime": "application/pdf"}


# ----------------------------- Case attachments (scanned documents) -----------------------------
ATTACHMENT_LABELS = ["Certificado de Defunción", "Hoja de Autorización", "Etiquetas de Identificación"]


@api_router.post("/cases/{case_id}/attachments")
async def add_attachment(case_id: str, data: AttachmentInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    label = data.label if data.label in ATTACHMENT_LABELS else (data.label or "Documento adjunto")
    kind = "pdf" if (data.kind or "").lower() == "pdf" else "image"
    raw_b64 = data.data_base64.split(",", 1)[1] if data.data_base64.startswith("data:") else data.data_base64
    default_name = "documento.pdf" if kind == "pdf" else "documento.jpg"
    grid_id, size = await store_pdf(raw_b64, data.filename or default_name)
    att = {
        "att_id": f"att_{uuid.uuid4().hex[:12]}",
        "case_id": case_id,
        "user_id": user["user_id"],
        "label": label,
        "filename": data.filename or default_name,
        "kind": kind,
        "mime": "application/pdf" if kind == "pdf" else "image/jpeg",
        "grid_id": grid_id,
        "size": size,
        "created_at": now_iso(),
    }
    await db.attachments.insert_one(dict(att))
    await db.cases.update_one({"case_id": case_id}, {"$set": {"updated_at": now_iso()}})
    att.pop("grid_id", None)
    return {"attachment": att}


@api_router.get("/cases/{case_id}/attachments")
async def list_attachments(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    atts = await db.attachments.find(
        {"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0, "grid_id": 0}
    ).sort("created_at", 1).to_list(50)
    return {"attachments": atts}


@api_router.get("/attachments/{att_id}")
async def get_attachment(att_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    a = await db.attachments.find_one({"att_id": att_id, "user_id": user["user_id"]}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    a["data_base64"] = await load_pdf_b64(a)
    a.setdefault("kind", "image")
    a.setdefault("mime", "application/pdf" if a["kind"] == "pdf" else "image/jpeg")
    a.pop("grid_id", None)
    return {"attachment": a}


@api_router.delete("/attachments/{att_id}")
async def delete_attachment(att_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    a = await db.attachments.find_one({"att_id": att_id, "user_id": user["user_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    await delete_pdf(a)
    await db.attachments.delete_one({"att_id": att_id})
    return {"ok": True}


# ----------------------------- Library documents -----------------------------
LIBRARY_FOLDERS = {"general", "formacion_continua"}


@api_router.post("/library/documents")
async def add_document(data: DocumentInput, user: Dict[str, Any] = Depends(get_current_user)):
    folder = data.folder if data.folder in LIBRARY_FOLDERS else "general"
    grid_id, size = await store_pdf(data.pdf_base64, data.filename)
    doc = {
        "doc_id": f"doc_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "title": data.title,
        "filename": data.filename,
        "folder": folder,
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
