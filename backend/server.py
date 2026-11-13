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
    kind: Optional[str] = "image"  # image | pdf | photo
    stage: Optional[str] = None  # antes | despues (solo fotos)
    data_base64: str


class LogEntryInput(BaseModel):
    product: str
    form: str  # liquid | powder | gel | cream
    quantity: float
    unit: str  # oz | ml | g
    category: Optional[str] = "bitacora"  # bitacora | cavidad | topico | putrefacto
    lot: Optional[str] = ""
    fluid_id: Optional[str] = None
    lot_id: Optional[str] = None


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


# ---- Factor de corrección F por condición del cuerpo ----
# key -> (etiqueta, F min, F max, F promedio)
BODY_CONDITIONS: Dict[str, Any] = {
    "rutinario": ("Caso rutinario, vascularización conservada", 1.00, 1.00, 1.000),
    "delgado": ("Adulto delgado, sin deshidratación", 0.95, 1.00, 0.975),
    "obesidad_moderada": ("Obesidad moderada", 0.90, 1.00, 0.950),
    "obesidad_severa": ("Obesidad severa o mórbida", 0.85, 0.95, 0.900),
    "caquexia": ("Caquexia o emaciación", 0.90, 1.00, 0.950),
    "deshidratacion_leve": ("Deshidratación leve", 1.00, 1.10, 1.050),
    "deshidratacion_intensa": ("Deshidratación intensa o momificación parcial", 1.10, 1.20, 1.150),
    "edema_localizado": ("Edema localizado", 0.90, 1.00, 0.950),
    "edema_generalizado": ("Edema generalizado", 0.80, 0.90, 0.850),
    "anasarca": ("Anasarca severa", 0.75, 0.85, 0.800),
    "ascitis": ("Ascitis sin edema generalizado", 0.90, 1.00, 0.950),
    "ictericia": ("Ictericia sin edema", 1.00, 1.10, 1.050),
    "refrigeracion": ("Refrigeración prolongada", 1.05, 1.15, 1.100),
    "intervalo_pm": ("Intervalo post mortem prolongado", 1.10, 1.25, 1.175),
    "putrefaccion_inicial": ("Putrefacción inicial", 1.10, 1.20, 1.150),
    "putrefaccion_avanzada": ("Putrefacción moderada o avanzada", 1.20, 1.35, 1.275),
    "diabetes_vascular": ("Diabetes o enfermedad vascular periférica", 1.10, 1.20, 1.150),
    "aterosclerosis": ("Aterosclerosis severa", 1.10, 1.25, 1.175),
    "insuficiencia_edema": ("Insuficiencia renal o cardiaca con edema", 0.80, 0.95, 0.875),
    "trauma_localizado": ("Trauma localizado", 1.00, 1.15, 1.075),
    "trauma_multiple": ("Trauma múltiple o hemorragia extensa", 1.10, 1.25, 1.175),
    "quemaduras": ("Quemaduras extensas", 1.10, 1.30, 1.200),
    "autopsiado": ("Caso autopsiado", 1.15, 1.30, 1.225),
    "donacion": ("Donación de órganos o tejidos", 1.10, 1.25, 1.175),
}
F_MIN, F_MAX = 0.75, 1.35

# ---- Factor K por condición general (L/kg) ----
GENERAL_CONDITIONS: Dict[str, Any] = {
    "pequeno": ("Cuerpo pequeño, deshidratado o caquéctico", 0.10, 0.12, 0.11),
    "rutinario": ("Caso rutinario", 0.12, 0.15, 0.135),
    "dificil": ("Caso difícil o distribución vascular deficiente", 0.15, 0.18, 0.165),
}
K_MIN, K_MAX = 0.10, 0.18


def compute_factor_f(keys: List[str]) -> Optional[Dict[str, Any]]:
    """Condición dominante (mayor efecto |F-1|) + ajuste de ±5% / ±10% por la segunda.
    Resultado acotado a 0.75 <= F <= 1.35."""
    order = list(BODY_CONDITIONS.keys())
    sel = [k for k in (keys or []) if k in BODY_CONDITIONS]
    if not sel:
        return None
    sel.sort(key=lambda k: (-abs(BODY_CONDITIONS[k][3] - 1.0), order.index(k)))
    dom = sel[0]
    f = BODY_CONDITIONS[dom][3]
    adj_pct = 0
    sec = sel[1] if len(sel) > 1 else None
    if sec:
        dev2 = BODY_CONDITIONS[sec][3] - 1.0
        if abs(dev2) > 1e-9:
            adj_pct = (5 if abs(dev2) <= 0.10 + 1e-9 else 10) * (1 if dev2 > 0 else -1)
            f = f * (1 + adj_pct / 100.0)
    f = round(min(max(f, F_MIN), F_MAX) + 1e-9, 3)
    return {
        "f": f,
        "dominant": dom,
        "dominant_label": BODY_CONDITIONS[dom][0],
        "secondary": sec,
        "secondary_label": BODY_CONDITIONS[sec][0] if sec else None,
        "adjustment_pct": adj_pct,
    }


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
            labels = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema", "sheet": "Factor F (hoja del caso)"}
            if case_type == "sheet":
                factor = round(min(max(float(inputs.get("factor_f", 1.0)), F_MIN), F_MAX), 3)
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
            if str(inputs.get("mode", "")).lower() == "kf":
                # Vtotal = masa magra x K x F (K y F de la hoja del caso); la mezcla sale de C1·V1 = C2·Vtotal
                k_val = float(inputs["k_factor"])
                if not (K_MIN <= k_val <= K_MAX):
                    raise ValueError(f"El Factor K debe estar entre {K_MIN} y {K_MAX} L/kg")
                f_val = float(inputs["factor_f"])
                if not (F_MIN <= f_val <= F_MAX):
                    raise ValueError(f"El Factor F debe estar entre {F_MIN} y {F_MAX}")
                total_ml = max(lbm, 0.0) * k_val * f_val * 1000.0
                conc_ml = c2 * total_ml / c1
                coinj = []
                for item in inputs.get("coinjectors") or []:
                    if not isinstance(item, dict):
                        continue
                    v = float(item.get("volume_ml") or 0)
                    if v <= 0 or not str(item.get("name") or "").strip():
                        raise ValueError("Cada co-inyector necesita nombre y un volumen mayor que 0")
                    coinj.append({"name": str(item["name"]).strip()[:80],
                                  "reason": str(item.get("reason") or "").strip()[:160],
                                  "volume_ml": round(v, 1)})
                coinj_ml = sum(c["volume_ml"] for c in coinj)
                if conc_ml + coinj_ml > total_ml:
                    raise ValueError("El concentrado y los co-inyectores superan el volumen total de inyección")
                water_ml = total_ml - conc_ml - coinj_ml
                formaldehyde_ml = (c2 / 100.0) * total_ml
                v1_l = round(conc_ml / 1000.0, 2)
                fluid_name = str(inputs.get("fluid_name") or "").strip()[:80]
                try:
                    bottle_ml = float(inputs.get("bottle_ml") or 473.0)
                except (TypeError, ValueError):
                    bottle_ml = 473.0
                if not (0 < bottle_ml <= 20000):
                    bottle_ml = 473.0
                instruction = (f"Agregar {v1_l:.2f} L de Arterial {fluid_name + ' ' if fluid_name else ''}"
                               f"Index {c1:g}% a la bomba de inyección")
                results = {
                    "v1_l": v1_l,
                    "fluid_name": fluid_name,
                    "instruction": instruction,
                    "lbm_kg": round(lbm, 1),
                    "lbm_method": lbm_method_label,
                    "k_factor": round(k_val, 3),
                    "factor_f": round(f_val, 3),
                    "total_l": round(total_ml / 1000.0, 2),
                    "total_ml": round(total_ml, 0),
                    "concentrate_ml": round(conc_ml, 0),
                    "water_ml": round(water_ml, 0),
                    "coinjectors_ml": round(coinj_ml, 0),
                    "coinjectors": coinj,
                    "formaldehyde_ml": round(formaldehyde_ml, 0),
                    "water_injection_ml": round(max(total_ml - formaldehyde_ml, 0), 0),
                    "bottles": round(conc_ml / bottle_ml, 2),
                    "bottle_ml": round(bottle_ml, 1),
                    "desired_index_pct": c2,
                    "fluid_index_pct": c1,
                    "case_type": "Factor K y F (hoja del caso)",
                    "adjustment": f"K {k_val:.3f} x F {f_val:.3f}",
                }
                summary = (
                    f"{instruction}. Vtotal = {results['total_l']} L (MM {lbm:.1f} kg x K {k_val:.3f} x F {f_val:.3f}); "
                    f"V1 = Vtotal x Cpi / C1 = {results['total_l']} L x {c2:g}% / {c1:g}% = {v1_l:.2f} L"
                    + (f" + co-inyectores {results['coinjectors_ml'] / 1000.0:.3f} L" if coinj else "")
                    + f" + agua {results['water_ml'] / 1000.0:.2f} L"
                )
                return {"results": results, "summary": summary}
            factors = {"normal": 1.0, "jaundice": 1.15, "edema": 0.85}
            factor = factors.get(case_type, 1.0)
            labels = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema", "sheet": "Factor F (hoja del caso)"}
            if case_type == "sheet":
                factor = round(min(max(float(inputs.get("factor_f", 1.0)), F_MIN), F_MAX), 3)
            # C1·V1 = C2·V2  ->  V2 = C1·V1 / C2, adjusted by case-type factor
            base_total_ml = (c1 * concentrate_ml) / c2
            total_ml = base_total_ml * factor
            water_ml = max(total_ml - concentrate_ml, 0)
            # Case-type factor adjusts the volume the body needs (lean-mass reference)
            recommended_ml = (lbm * 2.20462 / 50.0) * 3785.41 * factor
            k_in = inputs.get("k_factor")
            if k_in not in (None, ""):
                k_val = float(k_in)
                if not (K_MIN <= k_val <= K_MAX):
                    raise ValueError(f"El Factor K debe estar entre {K_MIN} y {K_MAX} L/kg")
                # Volumen recomendado = K x masa magra x F
                recommended_ml = k_val * lbm * factor * 1000.0
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
            if k_in not in (None, ""):
                results["k_factor"] = round(float(k_in), 3)
            summary = (
                f"V2 = {results['total_l']} L: formaldehido {results['formaldehyde_ml']:.0f} mL + "
                f"agua {results['water_injection_ml']:.0f} mL - {results['case_type']} (x{factor})"
            )
            return {"results": results, "summary": summary}

        if calc_type == "kvolume":
            # V = K (L/kg) x masa magra (kg) x F
            weight_kg = float(inputs["weight_kg"])
            height_cm = float(inputs["height_cm"])
            sex = str(inputs.get("sex", "male")).lower()
            method = str(inputs.get("lbm_method", "average")).lower()
            k = float(inputs["k_factor"])
            if not (K_MIN <= k <= K_MAX):
                raise ValueError(f"El Factor K debe estar entre {K_MIN} y {K_MAX} L/kg")
            case_type = str(inputs.get("case_type", "normal")).lower()
            factors = {"normal": 1.0, "jaundice": 1.15, "edema": 0.85}
            labels = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema", "sheet": "Factor F (hoja del caso)"}
            f = factors.get(case_type, 1.0)
            if case_type == "sheet":
                f = round(min(max(float(inputs.get("factor_f", 1.0)), F_MIN), F_MAX), 3)
            lbm_info = compute_lbm(sex, weight_kg, height_cm, method)
            lbm = max(lbm_info["lbm"], 0.0)
            liters = k * lbm * f
            results = {
                "volume_l": round(liters, 2),
                "gallons": round(liters / 3.78541, 2),
                "k_factor": round(k, 3),
                "factor_f": f,
                "lbm_kg": round(lbm, 1),
                "lbm_method": LBM_METHOD_LABELS[lbm_info["method"]],
                "case_type": labels.get(case_type, "Normal"),
            }
            summary = f"V = K x MM x F = {k:.3f} L/kg x {lbm:.1f} kg x {f:.3f} = {results['volume_l']} L"
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
    "kvolume": "Volumen por Factor K",
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
    valid_types = {"volume", "lbm", "concentration", "injection", "kvolume"}
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
    num_in = str(src.get("case_number") or "").strip()
    if not num_in or await db.cases.find_one({"case_number": num_in, "user_id": user["user_id"]}):
        num_in = await next_case_number()
    doc = {
        "case_id": case_id,
        "case_number": num_in,
        "user_id": user["user_id"],
        "name": name,
        "case_ref": str(src.get("case_ref") or ""),
        "deceased_name": str(src.get("deceased_name") or ""),
        "date": src.get("date") or now_iso(),
        "status": src.get("status") if src.get("status") in ("active", "archived") else "active",
        "calculations": calculations,
        "sex": src.get("sex") if src.get("sex") in ("male", "female") else "",
        "date_of_death": src.get("date_of_death"),
        "embalming_date": src.get("embalming_date"),
        "embalming_start": src.get("embalming_start"),
        "embalming_end": src.get("embalming_end"),
        "case_sheet": src.get("case_sheet") if isinstance(src.get("case_sheet"), dict) else None,
        "logbook": [e for e in (src.get("logbook") or []) if isinstance(e, dict)][:500],
        **({"service_price": round(float(src["service_price"]), 2)}
           if isinstance(src.get("service_price"), (int, float)) and src["service_price"] >= 0 else {}),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    if doc["case_sheet"]:
        doc["case_sheet"]["firma_tecnico"] = clean_signature(doc["case_sheet"].get("firma_tecnico"))
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
    c["kf_summary"] = case_kf_summary(c)
    return {"case": c}


def case_kf_summary(c: Dict[str, Any]) -> Dict[str, Any]:
    """Resumen K, F, masa magra y volumen recomendado (V = K x MM x F)."""
    sheet = c.get("case_sheet") or {}
    gc_key = sheet.get("condicion_general") or ""
    gc = GENERAL_CONDITIONS.get(gc_key)
    k = {"value": gc[3], "label": gc[0], "min": gc[1], "max": gc[2]} if gc else None
    ff = compute_factor_f(sheet.get("condiciones") or [])
    f = ({"value": ff["f"], "dominant_label": ff["dominant_label"],
          "secondary_label": ff["secondary_label"], "adjustment_pct": ff["adjustment_pct"]} if ff else None)
    lbm = None
    # Prioridad: último cálculo guardado con masa magra; si no, peso/estatura de la hoja.
    for calc in reversed(c.get("calculations") or []):
        r = calc.get("results") or {}
        if isinstance(r.get("lbm_kg"), (int, float)) and r["lbm_kg"] > 0:
            lbm = {"kg": round(float(r["lbm_kg"]), 1), "method": r.get("lbm_method") or r.get("method") or "",
                   "source": "Último cálculo guardado"}
            break
    if lbm is None:
        try:
            w = float(str(sheet.get("peso") or "").replace(",", "."))
            h = float(str(sheet.get("altura") or "").replace(",", "."))
            sex = c.get("sex")
            if w > 0 and h > 0 and sex in ("male", "female"):
                info = compute_lbm(sex, w, h, "average")
                lbm = {"kg": round(info["lbm"], 1), "method": LBM_METHOD_LABELS[info["method"]],
                       "source": "Peso y altura de la hoja"}
        except (ValueError, TypeError, KeyError):
            lbm = None
    f_val = f["value"] if f else 1.0
    volume_l = round(k["value"] * lbm["kg"] * f_val, 2) if (k and lbm) else None
    missing = []
    if not k:
        missing.append("condición general (Factor K)")
    if not lbm:
        missing.append("masa magra (peso, altura y sexo, o un cálculo guardado)")
    return {"k": k, "f": f, "f_applied": f_val, "lbm": lbm, "volume_l": volume_l, "missing": missing}


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
    sheet = dict(sheet)
    sheet["firma_tecnico"] = clean_signature(sheet.get("firma_tecnico"))
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
    for a in await db.attachments.find({"case_id": case_id, "user_id": user["user_id"]}).to_list(1000):
        try:
            await delete_pdf(a)
        except Exception:
            pass
    await db.attachments.delete_many({"case_id": case_id, "user_id": user["user_id"]})
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
LOG_UNITS = {"liquid": {"oz", "ml"}, "powder": {"g"}, "gel": {"g"}, "cream": {"g"}}
LOG_CATEGORIES = {"bitacora", "cavidad", "topico", "putrefacto"}


@api_router.post("/cases/{case_id}/logbook")
async def add_log_entry(case_id: str, data: LogEntryInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    category = data.category if data.category in LOG_CATEGORIES else "bitacora"
    form = data.form if data.form in LOG_UNITS else "liquid"
    if category in ("cavidad", "putrefacto"):
        form = "liquid"
    unit = data.unit if data.unit in LOG_UNITS[form] else next(iter(LOG_UNITS[form]))
    if not data.product.strip():
        raise HTTPException(status_code=400, detail="Producto requerido")
    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor que 0")
    if not (data.lot or "").strip() and not data.lot_id:
        raise HTTPException(status_code=400, detail="Ingresa el número de lote")
    entry = {
        "log_id": f"log_{uuid.uuid4().hex[:10]}",
        "product": data.product.strip(),
        "form": form,
        "quantity": round(data.quantity, 2),
        "unit": unit,
        "category": category,
        "lot": (data.lot or "").strip()[:40],
        "created_at": now_iso(),
    }
    # Descuenta del lote elegido del inventario: cantidad / tamaño del envase.
    if data.fluid_id:
        f = await db.fluid_templates.find_one({"item_id": data.fluid_id, "user_id": user["user_id"]}, {"_id": 0})
        if f:
            size = float(f.get("bottle_ml") or 473.0)
            q = _to_unit(entry["quantity"], unit, f.get("unit") or "ml")
            if q is not None and size > 0:
                if not data.lot_id and entry["lot"] and not any(
                        x["lot"].strip().lower() == entry["lot"].lower() for x in _lots_of(f)):
                    raise HTTPException(status_code=400, detail=f"El lote {entry['lot']} no existe en el inventario de {f['name']}")
                adj = await _adjust_lot(user["user_id"], f["item_id"], -round(q / size, 4), lot_id=data.lot_id,
                                        lot_name=None if data.lot_id else (entry["lot"] or None))
                entry.update({"fluid_id": f["item_id"], "lot_id": adj["lot_id"], "lot": adj["lot"],
                              "deducted": round(-adj["applied"], 2)})
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
    e = next((x for x in c.get("logbook") or [] if x.get("log_id") == log_id), None)
    await db.cases.update_one(
        {"case_id": case_id},
        {"$pull": {"logbook": {"log_id": log_id}}, "$set": {"updated_at": now_iso()}},
    )
    if e and e.get("fluid_id") and float(e.get("deducted") or 0) > 0:
        await _adjust_lot(user["user_id"], e["fluid_id"], float(e["deducted"]), lot_id=e.get("lot_id"))
    return {"ok": True}


@api_router.post("/cases/{case_id}/embalming")
async def embalming_timer(case_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    """Iniciar / Terminar el embalsamamiento: guarda la hora actual y la duración."""
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    action = payload.get("action")
    ts = now_iso()
    hhmm = datetime.now(timezone.utc).astimezone(MX_TZ).strftime("%H:%M")
    if action == "start":
        upd = {"embalming_start": ts, "embalming_end": None, "case_sheet.inicio_emb": hhmm, "case_sheet.termino_emb": ""}
    elif action == "stop":
        if not c.get("embalming_start"):
            raise HTTPException(status_code=400, detail="Primero toca Iniciar")
        upd = {"embalming_end": ts, "case_sheet.termino_emb": hhmm}
    else:
        raise HTTPException(status_code=400, detail="Acción no válida")
    if not isinstance(c.get("case_sheet"), dict):
        await db.cases.update_one({"case_id": case_id}, {"$set": {"case_sheet": {}}})
    await db.cases.update_one({"case_id": case_id}, {"$set": {**upd, "updated_at": ts}})
    updated = await db.cases.find_one({"case_id": case_id}, {"_id": 0})
    return {"case": updated}


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
    "kvolume": "Volumen por Factor K",
    "injection": "Volumen de inyección (asistente)",
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
    calc_by_type: Dict[str, int] = {"volume": 0, "lbm": 0, "concentration": 0, "kvolume": 0, "injection": 0}
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
        for t in ["volume", "kvolume", "lbm", "concentration", "injection"]
    ]

    # ---- Factores K / F y co-inyectores ----
    k_vals: List[float] = []
    f_vals: List[float] = []
    cond_count: Dict[str, int] = {}
    gen_count: Dict[str, int] = {}
    co_stats: Dict[str, Dict[str, Any]] = {}
    for c in cases:
        sh = c.get("case_sheet") or {}
        g = GENERAL_CONDITIONS.get(sh.get("condicion_general") or "")
        if g:
            k_vals.append(g[3])
            gen_count[g[0]] = gen_count.get(g[0], 0) + 1
        ff = compute_factor_f(sh.get("condiciones") or [])
        if ff:
            f_vals.append(ff["f"])
        for k in sh.get("condiciones") or []:
            if k in BODY_CONDITIONS:
                lbl = BODY_CONDITIONS[k][0]
                cond_count[lbl] = cond_count.get(lbl, 0) + 1
        for calc in c.get("calculations", []):
            for co in (calc.get("results") or {}).get("coinjectors") or []:
                if not isinstance(co, dict) or not co.get("name"):
                    continue
                key = str(co["name"]).strip().lower()
                s = co_stats.setdefault(key, {"name": str(co["name"]).strip(), "count": 0, "total_ml": 0.0})
                s["count"] += 1
                s["total_ml"] += float(co.get("volume_ml") or 0)

    def top(d: Dict[str, int], n: int = 5):
        return [{"label": k, "count": v} for k, v in sorted(d.items(), key=lambda x: -x[1])[:n]]

    factors = {
        "k_avg": round(sum(k_vals) / len(k_vals), 3) if k_vals else None,
        "f_avg": round(sum(f_vals) / len(f_vals), 3) if f_vals else None,
        "k_cases": len(k_vals),
        "f_cases": len(f_vals),
        "top_general": top(gen_count, 3),
        "top_conditions": top(cond_count),
        "top_coinjectors": [
            {"name": s["name"], "count": s["count"], "avg_ml": round(s["total_ml"] / s["count"], 0)}
            for s in sorted(co_stats.values(), key=lambda x: -x["count"])[:5]
        ],
    }

    # ---- Historial de mezclas confirmadas: arteriales y botellas por mes ----
    mix_months: Dict[str, Dict[str, Any]] = {}
    for c in cases:
        for calc in c.get("calculations", []):
            if not calc.get("mix_confirmed"):
                continue
            dt = _parse_dt(calc.get("mix_confirmed_at"))
            if not dt:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt = dt.astimezone(MX_TZ)
            key = f"{dt.year}-{dt.month:02d}"
            r = calc.get("results") or {}
            name = str(r.get("fluid_name") or "").strip() or f"Index {float(r.get('fluid_index_pct') or 0):g}%"
            mo = mix_months.setdefault(key, {"key": key, "label": f"{month_labels[dt.month - 1]} {dt.year}",
                                              "mixes": 0, "total_bottles": 0.0, "fluids": {}})
            mo["mixes"] += 1
            b = float(r.get("bottles") or 0)
            mo["total_bottles"] += b
            fl = mo["fluids"].setdefault(name.lower(), {"name": name, "mixes": 0, "bottles": 0.0, "liters": 0.0})
            fl["mixes"] += 1
            fl["bottles"] += b
            fl["liters"] += float(r.get("concentrate_ml") or 0) / 1000.0
    mixes_by_month = []
    for key in sorted(mix_months.keys(), reverse=True)[:6]:
        mo = mix_months[key]
        mixes_by_month.append({
            "key": key, "label": mo["label"], "mixes": mo["mixes"], "total_bottles": round(mo["total_bottles"], 2),
            "fluids": [{"name": f["name"], "mixes": f["mixes"], "bottles": round(f["bottles"], 2), "liters": round(f["liters"], 2)}
                       for f in sorted(mo["fluids"].values(), key=lambda x: -x["bottles"])[:5]],
        })

    # ---- Costos: gasto usado en casos vs. compras, por mes; costo promedio por caso ----
    fluids_map = {f["name_key"]: f for f in await db.fluid_templates.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)}
    price_list = await db.product_prices.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    purchases = await db.fluid_purchases.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(5000)
    cmonths: Dict[str, Dict[str, Any]] = {}

    def _cm(dt: datetime) -> Dict[str, Any]:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(MX_TZ)
        key = f"{dt.year}-{dt.month:02d}"
        return cmonths.setdefault(key, {"key": key, "label": f"{month_labels[dt.month - 1]} {dt.year}",
                                        "used": 0.0, "purchased": 0.0, "cases_costed": 0, "service": 0.0})
    costed_total, costed_n, service_total, service_n = 0.0, 0, 0.0, 0
    for c in cases:
        cc = _case_cost(c, fluids_map, price_list)
        dt = _parse_dt(c.get("created_at")) or _parse_dt(c.get("date"))
        if cc["total"] > 0:
            costed_total += cc["total"]
            costed_n += 1
            if dt:
                mo = _cm(dt)
                mo["used"] += cc["total"]
                mo["cases_costed"] += 1
        if c.get("service_price") is not None:
            service_total += float(c["service_price"])
            service_n += 1
            if dt:
                _cm(dt)["service"] += float(c["service_price"])
    for p in purchases:
        dt = _parse_dt(p.get("date"))
        if dt:
            _cm(dt)["purchased"] += float(p.get("total") or 0)
    costs = {
        "avg_cost_per_case": round(costed_total / costed_n, 2) if costed_n else None,
        "cases_costed": costed_n,
        "avg_service_price": round(service_total / service_n, 2) if service_n else None,
        "months": [
            {**m, "used": round(m["used"], 2), "purchased": round(m["purchased"], 2), "service": round(m["service"], 2),
             "avg_per_case": round(m["used"] / m["cases_costed"], 2) if m["cases_costed"] else None}
            for m in (cmonths[k] for k in sorted(cmonths.keys(), reverse=True)[:6])
        ],
    }

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
        "factors": factors,
        "mixes_by_month": mixes_by_month,
        "costs": costs,
    }


# ---------- Catálogo de co-inyectores ----------
@api_router.get("/coinjectors")
async def list_coinjectors(user: Dict[str, Any] = Depends(get_current_user)):
    items = await db.coinjector_catalog.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name", 1).to_list(200)
    return {"items": items}


@api_router.post("/coinjectors")
async def add_coinjector(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    name = str(payload.get("name") or "").strip()[:80]
    reason = str(payload.get("reason") or "").strip()[:160]
    try:
        vol = float(payload.get("volume_ml") or 0)
    except (TypeError, ValueError):
        vol = 0
    if not name or vol <= 0 or vol > 20000:
        raise HTTPException(status_code=400, detail="El co-inyector necesita nombre y un volumen entre 0 y 20000 mL")
    existing = await db.coinjector_catalog.find_one(
        {"user_id": user["user_id"], "name_key": name.lower()}, {"_id": 0})
    doc = {"name": name, "name_key": name.lower(), "reason": reason, "volume_ml": round(vol, 1),
           "updated_at": datetime.now(timezone.utc).isoformat()}
    if existing:
        await db.coinjector_catalog.update_one({"item_id": existing["item_id"]}, {"$set": doc})
        item = {**existing, **doc}
    else:
        item = {"item_id": f"coi_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], **doc}
        await db.coinjector_catalog.insert_one(dict(item))
    item.pop("_id", None)
    return {"item": item}


@api_router.delete("/coinjectors/{item_id}")
async def delete_coinjector(item_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    res = await db.coinjector_catalog.delete_one({"item_id": item_id, "user_id": user["user_id"]})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Co-inyector no encontrado")
    return {"ok": True}


# ---------- Plantillas de fluidos arteriales ----------
@api_router.get("/fluids")
async def list_fluids(user: Dict[str, Any] = Depends(get_current_user)):
    items = await db.fluid_templates.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0, "name_key": 0}).sort("name", 1).to_list(500)
    for f in items:
        f["lots"] = _lots_of(f)
        f.setdefault("kind", "arterial")
    return {"items": items}


# ---------- Lotes por producto (existencia separada por lote) ----------
PRODUCT_KINDS = {"arterial", "coinyector", "cavidad", "topico", "putrefacto", "otro"}


def _lots_of(f: Dict[str, Any]) -> List[Dict[str, Any]]:
    lots = f.get("lots")
    if isinstance(lots, list):
        return lots
    if f.get("stock_bottles") is not None:  # inventario anterior a los lotes
        return [{"lot_id": "lot_legacy", "lot": "Sin lote", "stock": round(float(f.get("stock_bottles") or 0), 2)}]
    return []


async def _adjust_lot(user_id: str, item_id: str, delta: float, lot_id: Optional[str] = None,
                      lot_name: Optional[str] = None, set_to: Optional[float] = None) -> Dict[str, Any]:
    """Suma/resta (o fija) envases en un lote; crea el lote si se da un número nuevo. Nunca baja de 0.
    Devuelve {lot_id, lot, applied, stock_lot, stock_total} o {} si el producto no existe."""
    f = await db.fluid_templates.find_one({"item_id": item_id, "user_id": user_id}, {"_id": 0})
    if not f:
        return {}
    lots = [dict(x) for x in _lots_of(f)]
    lot = None
    if lot_id:
        lot = next((x for x in lots if x["lot_id"] == lot_id), None)
    if lot is None and lot_name:
        lot = next((x for x in lots if x["lot"].strip().lower() == lot_name.strip().lower()), None)
        if lot is None:
            lot = {"lot_id": f"lot_{uuid.uuid4().hex[:10]}", "lot": lot_name.strip()[:40], "stock": 0.0}
            lots.append(lot)
    if lot is None:
        lot = next((x for x in lots if float(x.get("stock") or 0) > 0), None) or (lots[0] if lots else None)
    if lot is None:
        lot = {"lot_id": f"lot_{uuid.uuid4().hex[:10]}", "lot": "Sin lote", "stock": 0.0}
        lots.append(lot)
    before = float(lot.get("stock") or 0)
    after = set_to if set_to is not None else before + delta
    after = round(min(max(after, 0.0), 100000.0), 2)
    lot["stock"] = after
    total = round(sum(float(x.get("stock") or 0) for x in lots), 2)
    await db.fluid_templates.update_one({"item_id": item_id}, {"$set": {"lots": lots, "stock_bottles": total, "updated_at": now_iso()}})
    return {"lot_id": lot["lot_id"], "lot": lot["lot"], "applied": round(after - before, 2), "stock_lot": after,
            "stock_total": total, "name": f["name"]}


@api_router.post("/fluids/{item_id}/lots")
async def add_lot(item_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    name = str(payload.get("lot") or "").strip()
    try:
        stock = float(payload.get("stock") or 0)
    except (TypeError, ValueError):
        stock = -1
    if not name or stock < 0:
        raise HTTPException(status_code=400, detail="Escribe el número de lote y su existencia")
    r = await _adjust_lot(user["user_id"], item_id, stock, lot_name=name)
    if not r:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return r


@api_router.patch("/fluids/{item_id}/lots/{lot_id}")
async def update_lot(item_id: str, lot_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    try:
        set_to = float(payload["set"]) if payload.get("set") is not None else None
        delta = float(payload.get("delta") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Cantidad no válida")
    f = await db.fluid_templates.find_one({"item_id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not f or not any(x["lot_id"] == lot_id for x in _lots_of(f)):
        raise HTTPException(status_code=404, detail="Lote no encontrado")
    return await _adjust_lot(user["user_id"], item_id, delta, lot_id=lot_id, set_to=set_to)


@api_router.delete("/fluids/{item_id}/lots/{lot_id}")
async def delete_lot(item_id: str, lot_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    f = await db.fluid_templates.find_one({"item_id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    lots = [x for x in _lots_of(f) if x["lot_id"] != lot_id]
    if len(lots) == len(_lots_of(f)):
        raise HTTPException(status_code=404, detail="Lote no encontrado")
    total = round(sum(float(x.get("stock") or 0) for x in lots), 2)
    await db.fluid_templates.update_one({"item_id": item_id}, {"$set": {"lots": lots, "stock_bottles": total, "updated_at": now_iso()}})
    return {"ok": True, "stock_total": total}


# ---------- Trazabilidad por lote ----------
@api_router.get("/lots/trace")
async def trace_lots(q: str = "", product: str = "", user: Dict[str, Any] = Depends(get_current_user)):
    """Casos en que se usó cada lote (búsqueda por número de lote y/o producto)."""
    ql, pl = q.strip().lower(), product.strip().lower()
    cases = await db.cases.find({"user_id": user["user_id"], "logbook.0": {"$exists": True}},
                                {"_id": 0, "case_id": 1, "case_number": 1, "deceased_name": 1, "name": 1, "date": 1,
                                 "created_at": 1, "logbook": 1}).to_list(5000)
    groups: Dict[str, Dict[str, Any]] = {}
    for c in cases:
        for e in c.get("logbook") or []:
            lot = str(e.get("lot") or "").strip()
            prod = str(e.get("product") or "").strip()
            if not lot:
                continue
            if ql and ql not in lot.lower():
                continue
            if pl and pl not in prod.lower():
                continue
            key = f"{prod.lower()}|{lot.lower()}"
            g = groups.setdefault(key, {"product": prod, "lot": lot, "uses": []})
            g["uses"].append({
                "case_id": c["case_id"], "case_number": c.get("case_number") or "",
                "deceased_name": c.get("deceased_name") or c.get("name") or "",
                "date": c.get("date") or c.get("created_at") or "",
                "quantity": e.get("quantity"), "unit": e.get("unit"), "category": e.get("category") or "bitacora",
                "used_at": e.get("created_at") or "",
            })
    out = sorted(groups.values(), key=lambda g: (g["product"].lower(), g["lot"].lower()))
    for g in out:
        g["uses"].sort(key=lambda u: u["used_at"], reverse=True)
        g["cases"] = len({u["case_id"] for u in g["uses"]})
    return {"items": out[:300]}


# ---------- Proveedores ----------
@api_router.get("/suppliers")
async def list_suppliers(user: Dict[str, Any] = Depends(get_current_user)):
    return {"items": await db.suppliers.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("name", 1).to_list(200)}


@api_router.post("/suppliers")
async def add_supplier(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    name = str(payload.get("name") or "").strip()[:80]
    phone = "".join(ch for ch in str(payload.get("phone") or "") if ch.isdigit())[:15]
    if not name or len(phone) < 10:
        raise HTTPException(status_code=400, detail="Escribe el nombre y un teléfono de al menos 10 dígitos (con lada del país, ej. 52…)")
    doc = {"supplier_id": f"sup_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "name": name, "phone": phone,
           "notes": str(payload.get("notes") or "").strip()[:200], "created_at": now_iso()}
    await db.suppliers.insert_one(dict(doc))
    doc.pop("user_id", None)
    return {"item": doc}


@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    res = await db.suppliers.delete_one({"supplier_id": supplier_id, "user_id": user["user_id"]})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return {"ok": True}


@api_router.post("/fluids")
async def add_fluid(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    name = str(payload.get("name") or "").strip()[:80]
    kind = str(payload.get("kind") or "arterial").lower()
    if kind not in PRODUCT_KINDS:
        kind = "arterial"
    unit = "g" if str(payload.get("unit") or "ml").lower() == "g" else "ml"
    try:
        idx = float(payload.get("index_pct") or 0)
    except (TypeError, ValueError):
        idx = 0
    if not name or (kind == "arterial" and not (0 < idx <= 100)) or not (0 <= idx <= 100):
        raise HTTPException(status_code=400, detail="El producto necesita nombre (y, si es arterial, un índice entre 0 y 100 %)")
    try:
        bottle_ml = float(payload.get("bottle_ml") or 473.0)
    except (TypeError, ValueError):
        bottle_ml = 473.0
    if not (0 < bottle_ml <= 20000):
        raise HTTPException(status_code=400, detail="El tamaño de botella debe estar entre 1 y 20000 mL")
    doc = {"name": name, "name_key": name.lower(), "index_pct": round(idx, 2), "bottle_ml": round(bottle_ml, 1),
           "kind": kind, "unit": unit,
           "brand": str(payload.get("brand") or "").strip()[:80], "updated_at": now_iso()}
    init_stock = None
    if payload.get("stock_bottles") not in (None, ""):
        try:
            init_stock = round(max(float(payload["stock_bottles"]), 0.0), 2)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Existencia de botellas no válida")
    existing = await db.fluid_templates.find_one({"user_id": user["user_id"], "name_key": doc["name_key"]}, {"_id": 0})
    if existing:
        await db.fluid_templates.update_one({"item_id": existing["item_id"]}, {"$set": doc})
        item = {**existing, **doc}
    else:
        item = {"item_id": f"flu_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], **doc}
        await db.fluid_templates.insert_one(dict(item))
    if init_stock is not None:
        r = await _adjust_lot(user["user_id"], item["item_id"], 0, lot_name=str(payload.get("lot") or "Sin lote"), set_to=init_stock)
        item["stock_bottles"] = r["stock_total"]
    item.pop("_id", None)
    item["lots"] = _lots_of((await db.fluid_templates.find_one({"item_id": item["item_id"]}, {"_id": 0})) or {})
    return {"item": item}


@api_router.patch("/fluids/{item_id}")
async def update_fluid_settings(item_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    """Mínimo de existencia (alerta) y precio por botella (MXN) de un fluido."""
    f = await db.fluid_templates.find_one({"item_id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Fluido no encontrado")
    upd: Dict[str, Any] = {}
    try:
        if payload.get("min_stock") not in (None, ""):
            upd["min_stock"] = round(min(max(float(payload["min_stock"]), 0.0), 10000.0), 2)
        if payload.get("price_per_bottle") not in (None, ""):
            upd["price_per_bottle"] = round(min(max(float(payload["price_per_bottle"]), 0.0), 1000000.0), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Valor no válido")
    if upd:
        upd["updated_at"] = now_iso()
        await db.fluid_templates.update_one({"item_id": item_id}, {"$set": upd})
    return {"item": {**f, **upd}}


# ---------- Precios de productos (co-inyectores, cavidades, otros) ----------
PRICE_UNITS = {"ml", "oz", "g"}
PRICE_CATS = {"coinyector": "Co-inyectores", "cavidad": "Cavidades", "topico": "Tópicos", "putrefacto": "Putrefacto / gas", "otro": "Otros"}


@api_router.get("/prices")
async def list_prices(user: Dict[str, Any] = Depends(get_current_user)):
    items = await db.product_prices.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0, "name_key": 0}).sort("name", 1).to_list(500)
    return {"items": items}


@api_router.post("/prices")
async def add_price(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    name = str(payload.get("name") or "").strip()[:80]
    unit = str(payload.get("unit") or "ml").lower()
    cat = str(payload.get("category") or "otro").lower()
    try:
        price = float(payload.get("price") or 0)
        size = float(payload.get("size") or 0)
    except (TypeError, ValueError):
        price, size = -1, 0
    if not name or price < 0 or size <= 0 or unit not in PRICE_UNITS or cat not in PRICE_CATS:
        raise HTTPException(status_code=400, detail="Escribe nombre, precio, presentación (mayor que 0) y unidad válidos")
    doc = {"name": name, "name_key": name.lower(), "price": round(price, 2), "size": round(size, 2), "unit": unit,
           "category": cat, "updated_at": now_iso()}
    existing = await db.product_prices.find_one({"user_id": user["user_id"], "name_key": doc["name_key"]}, {"_id": 0})
    if existing:
        await db.product_prices.update_one({"item_id": existing["item_id"]}, {"$set": doc})
        item = {**existing, **doc}
    else:
        item = {"item_id": f"prc_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], **doc}
        await db.product_prices.insert_one(dict(item))
    item.pop("_id", None)
    item.pop("user_id", None)
    item.pop("name_key", None)
    return {"item": item}


@api_router.delete("/prices/{item_id}")
async def delete_price(item_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    res = await db.product_prices.delete_one({"item_id": item_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Precio no encontrado")
    return {"ok": True}


@api_router.patch("/fluids/{item_id}/stock")
async def update_fluid_stock(item_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    """Inventario (compatibilidad): suma/resta (delta) o fija (set) en el primer lote con existencia."""
    f = await db.fluid_templates.find_one({"item_id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Fluido no encontrado")
    try:
        set_to = float(payload["set"]) if payload.get("set") is not None else None
        delta = float(payload.get("delta") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Cantidad de botellas no válida")
    r = await _adjust_lot(user["user_id"], item_id, delta, set_to=set_to)
    f = await db.fluid_templates.find_one({"item_id": item_id}, {"_id": 0, "user_id": 0})
    return {"item": {**f, "lots": _lots_of(f), "stock_bottles": r["stock_total"]}}


@api_router.delete("/fluids/{item_id}")
async def delete_fluid(item_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    res = await db.fluid_templates.delete_one({"item_id": item_id, "user_id": user["user_id"]})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Fluido no encontrado")
    return {"ok": True}


# ---------- Respaldo completo ----------
@api_router.get("/backup")
async def export_backup(user: Dict[str, Any] = Depends(get_current_user)):
    uid = user["user_id"]
    cases = await db.cases.find({"user_id": uid}, {"_id": 0}).to_list(5000)
    for c in cases:
        c["notes"] = await db.notes.find({"case_id": c["case_id"]}, {"_id": 0, "photos": 0}).to_list(1000)
    strip = {"_id": 0, "user_id": 0, "name_key": 0}
    return {
        "app": "Preservia",
        "backup_version": 1,
        "exported_at": now_iso(),
        "cases": cases,
        "coinjectors": await db.coinjector_catalog.find({"user_id": uid}, strip).to_list(500),
        "fluids": await db.fluid_templates.find({"user_id": uid}, strip).to_list(500),
    }


@api_router.post("/backup/restore")
async def restore_backup(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    if payload.get("app") != "Preservia" or not isinstance(payload.get("cases"), list):
        raise HTTPException(status_code=400, detail="Archivo de respaldo inválido")
    existing_refs = {
        (c.get("case_number"), c.get("deceased_name"))
        for c in await db.cases.find({"user_id": user["user_id"]}, {"case_number": 1, "deceased_name": 1}).to_list(5000)
    }
    restored = skipped = 0
    for c in payload["cases"]:
        if not isinstance(c, dict):
            continue
        if (c.get("case_number"), c.get("deceased_name")) in existing_refs:
            skipped += 1  # ya existe: no se duplica
            continue
        existing_refs.add((c.get("case_number"), c.get("deceased_name")))
        try:
            await import_case({"case": {**c, "name": c.get("name") or c.get("deceased_name") or "Caso restaurado"}}, user)
            restored += 1
        except HTTPException:
            skipped += 1
    cat = 0
    for item in payload.get("coinjectors") or []:
        try:
            await add_coinjector(item, user)
            cat += 1
        except HTTPException:
            pass
    for item in payload.get("fluids") or []:
        try:
            await add_fluid(item, user)
            cat += 1
        except HTTPException:
            pass
    return {"restored": restored, "skipped": skipped, "catalog_items": cat}


# ----------------------------- PDF Report -----------------------------
INPUT_LABELS = {
    "desired_index_pct": "Concentracion en el punto de inyeccion (%)",
    "fluid_index_pct": "Index del Arterial (C1 %)",
    "concentrate_ml": "Volumen Botella Concentrado (V1 mL)",
    "weight_kg": "Peso (kg)",
    "height_cm": "Estatura (cm)",
    "sex": "Sexo",
    "case_type": "Tipo de caso",
    "total_solution_l": "Solucion total (L)",
    "method": "Metodo masa magra",
    "lbm_method": "Metodo masa magra",
    "factor_f": "Factor de correccion F",
    "k_factor": "Factor K (L/kg)",
    "coinjectors": "Co-inyectores",
    "fluid_name": "Fluido arterial",
}

SEX_LABELS = {"male": "Masculino", "female": "Femenino"}
CASE_TYPE_LABELS = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema", "sheet": "Factor F (hoja del caso)"}
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



def clean_signature(sig: Any) -> Optional[Dict[str, Any]]:
    """Valida la firma: solo trazos con puntos numéricos finitos [x, y]."""
    import math
    if not isinstance(sig, dict) or not isinstance(sig.get("strokes"), list):
        return None

    def num(v: Any) -> Optional[float]:
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None

    strokes = []
    for s in sig["strokes"]:
        if not isinstance(s, list):
            continue
        pts = []
        for p in s:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                x, y = num(p[0]), num(p[1])
                if x is not None and y is not None:
                    pts.append([x, y])
        if pts:
            strokes.append(pts)
    if not strokes:
        return None
    return {
        "strokes": strokes,
        "w": num(sig.get("w")) or 0,
        "h": num(sig.get("h")) or 0,
        "signed_at": str(sig.get("signed_at") or "")[:32],
    }


def signature_drawing(sig: Any, max_w: float = 75 * mm, max_h: float = 28 * mm):
    """Convierte la firma capturada (trazos de puntos en px) en un dibujo vectorial."""
    from reportlab.graphics.shapes import Drawing, PolyLine
    sig = clean_signature(sig)
    if not sig:
        return None
    try:
        w = float(sig.get("w") or 0)
        h = float(sig.get("h") or 0)
        pts = [p for s in sig["strokes"] for p in s]
        if not pts:
            return None
        if w <= 0 or h <= 0:
            w = max(p[0] for p in pts) + 1
            h = max(p[1] for p in pts) + 1
        # Recorta al área realmente firmada para aprovechar el espacio.
        minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
        miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)
        bw, bh = max(maxx - minx, 1), max(maxy - miny, 1)
        scale = min(max_w / bw, max_h / bh)
        d = Drawing(bw * scale, bh * scale)
        for s in sig["strokes"]:
            flat: List[float] = []
            for x, y in s:
                flat += [(x - minx) * scale, (maxy - y) * scale]
            if len(flat) == 2:
                flat += [flat[0] + 0.5, flat[1]]
            d.add(PolyLine(flat, strokeColor=colors.HexColor("#0F172A"), strokeWidth=1.4,
                           strokeLineCap=1, strokeLineJoin=1))
        return d
    except Exception:
        return None


def build_pdf(case: Dict[str, Any], notes: List[Dict[str, Any]], user: Dict[str, Any],
              attachments: Optional[List[Dict[str, Any]]] = None,
              photos: Optional[List[Dict[str, Any]]] = None) -> bytes:
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
        *([[Paragraph("Precio del servicio", cell_label),
            Paragraph(esc(f"${float(case['service_price']):,.2f} MXN"), cell_val)]] if case.get("service_price") is not None else []),
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
        addrow("Vello Facial", sel(sheet.get("sello_facial"), SHEET_SELLO, sheet.get("sello_facial_otro", "")))
        addrow("Signos de descomposicion", sel(sheet.get("signos"), SHEET_SIGNOS, sheet.get("signos_otros", "")))
        addrow("Caracteristicas", sel(sheet.get("caracteristicas"), SHEET_CARAC))
        addrow("Lesiones", sheet.get("caracteristicas_lesiones"))
        addrow("Otras caracteristicas", sheet.get("caracteristicas_otros"))
        addrow("Equipo medico", sel(sheet.get("equipo_medico"), SHEET_EQUIPO, sheet.get("equipo_medico_otros", "")))
        gc = GENERAL_CONDITIONS.get(sheet.get("condicion_general") or "")
        if gc:
            addrow("Condicion general (Factor K)",
                   f"{gc[0]} - K {gc[1]:.2f}-{gc[2]:.2f} L/kg (prom. {gc[3]:.3f} L/kg)")
        conds = [k for k in (sheet.get("condiciones") or []) if k in BODY_CONDITIONS]
        if conds:
            addrow("Condicion del cuerpo", "\n".join(
                f"{BODY_CONDITIONS[k][0]} (F {BODY_CONDITIONS[k][1]:.2f}-{BODY_CONDITIONS[k][2]:.2f}, prom. {BODY_CONDITIONS[k][3]:.3f})"
                for k in conds))
            ff = compute_factor_f(conds)
            if ff:
                txt = f"F = {ff['f']:.3f} - dominante: {ff['dominant_label']}"
                if ff["secondary"]:
                    txt += f"; ajuste {ff['adjustment_pct']:+d}% por: {ff['secondary_label']}"
                addrow("Factor de correccion F sugerido", txt)
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

        sig_draw = signature_drawing(sheet.get("firma_tecnico"))
        if sig_draw is not None:
            elems.append(Spacer(1, 6 * mm))
            sig_tbl = Table([
                [sig_draw],
                [Paragraph(esc(sheet.get("tecnico_responsable") or "Tecnico responsable del servicio"), cell_val)],
                [Paragraph(esc(f"Firma del tecnico responsable - {(clean_signature(sheet.get('firma_tecnico')) or {}).get('signed_at', '')}"), cell_label)],
            ], colWidths=[80 * mm], hAlign="LEFT")
            sig_tbl.setStyle(TableStyle([
                ("LINEBELOW", (0, 0), (0, 0), 0.6, colors.HexColor("#0F172A")),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]))
            elems.append(sig_tbl)

    # ---- Resumen K y F ----
    kf = case_kf_summary(case)
    inj = next((c for c in reversed(case.get("calculations") or [])
                if c.get("type") == "injection" and (c.get("inputs") or {}).get("mode") == "kf"), None)
    if kf.get("k") or kf.get("f") or inj:
        elems.append(Paragraph("Resumen K y F", h2))
        krows = []

        def kadd(label: str, val: str):
            krows.append([Paragraph(esc(label), cell_label), Paragraph(esc(val), cell_val)])

        if kf.get("k"):
            kadd("Factor K", f"{kf['k']['value']:.3f} L/kg - {kf['k']['label']}")
        f_txt = f"{kf['f_applied']:.3f}"
        if kf.get("f"):
            f_txt += f" - {kf['f']['dominant_label']}"
            if kf["f"].get("secondary_label"):
                f_txt += f" ({kf['f']['adjustment_pct']:+d}% {kf['f']['secondary_label']})"
        kadd("Factor F", f_txt)
        if kf.get("lbm"):
            kadd("Masa magra", f"{kf['lbm']['kg']:.1f} kg ({kf['lbm']['method']}; {kf['lbm']['source']})")
        if inj:
            r = inj.get("results") or {}
            kadd("Volumen total (Vtotal = MM x K x F)",
                 f"{r.get('total_l')} L = {r.get('lbm_kg')} kg x {r.get('k_factor')} L/kg x {r.get('factor_f')}")
            v1_l = r.get("v1_l")
            if v1_l is None and r.get("concentrate_ml") is not None:
                v1_l = round(float(r["concentrate_ml"]) / 1000.0, 2)
            kadd("Arterial V1 (V1 x C1 = Vtotal x C punto de inyeccion)",
                 f"{v1_l} L (C1 {float(r.get('fluid_index_pct') or 0):g}% -> C punto de inyeccion {float(r.get('desired_index_pct') or 0):g}%)"
                 + (f"\n{r['instruction']}" if r.get("instruction") else ""))
            co = r.get("coinjectors") or []
            kadd("Co-inyectores", "\n".join(
                f"{c.get('name')} - {c.get('reason')}: {float(c.get('volume_ml') or 0) / 1000.0:.3f} L" for c in co
            ) + f"\nTotal: {float(r.get('coinjectors_ml') or 0) / 1000.0:.3f} L" if co else "Ninguno")
            kadd("Agua a agregar en la bomba", f"{float(r.get('water_ml') or 0) / 1000.0:.2f} L (Vtotal - V1 - co-inyectores)")
        elif kf.get("volume_l") is not None:
            kadd("Volumen recomendado (MM x K x F)", f"{kf['volume_l']:.2f} L")
        kt = Table(krows, colWidths=[55 * mm, 110 * mm])
        kt.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
        ]))
        elems.append(kt)

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
                elif k == "coinjectors":
                    if not v:
                        continue
                    v = "; ".join(
                        f"{c.get('name', '')} ({c.get('reason', '')}) {float(c.get('volume_ml') or 0) / 1000.0:.3f} L"
                        for c in v if isinstance(c, dict))
                elif k == "mode":
                    continue
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
        form_lbl = {"liquid": "Liquido", "powder": "Polvo", "gel": "Gel", "cream": "Crema"}
        cat_lbl = {"bitacora": "Arterial / co-iny.", "cavidad": "Cavidad", "topico": "Topico", "putrefacto": "Putrefacto / gas"}
        rows = [[Paragraph("<b>Producto</b>", cell), Paragraph("<b>Tipo</b>", cell),
                 Paragraph("<b>Cantidad</b>", cell), Paragraph("<b>Lote</b>", cell)]]
        order = {"bitacora": 0, "cavidad": 1, "topico": 2, "putrefacto": 3}
        for e in sorted(logbook, key=lambda x: order.get(x.get("category") or "bitacora", 0)):
            q = e.get("quantity")
            q = int(q) if isinstance(q, (int, float)) and float(q).is_integer() else q
            rows.append([
                Paragraph(esc(e.get("product", "")), cell),
                Paragraph(esc(f"{cat_lbl.get(e.get('category') or 'bitacora', '')} · {form_lbl.get(e.get('form'), e.get('form', ''))}"), cell),
                Paragraph(esc(f"{q} {unit_lbl.get(e.get('unit'), e.get('unit', ''))}"), cell),
                Paragraph(esc(e.get("lot") or "-"), cell),
            ])
        lt = Table(rows, colWidths=[62 * mm, 45 * mm, 28 * mm, 30 * mm])
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

    # ---- Fotografías antes / después (2 por fila, en orden de captura) ----
    if photos:
        elems.append(PageBreak())
        elems.append(Paragraph("Fotografias del caso", h2))
        for stage, title_txt in (("antes", "Antes del tratamiento"), ("despues", "Despues del tratamiento")):
            group = [p for p in photos if p.get("stage") == stage and p.get("bytes")]
            if not group:
                continue
            elems.append(Paragraph(title_txt, ParagraphStyle("PStage", parent=body, fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=4)))
            cells = []
            for i, p in enumerate(group, start=1):
                try:
                    img = RLImage(BytesIO(p["bytes"]), width=80 * mm, height=80 * mm, kind="proportional")
                except Exception:
                    continue
                cap = Paragraph(esc(f"{i}. {fmt_date(p.get('created_at'))}"), small)
                cells.append([img, cap])
            rows = []
            for j in range(0, len(cells), 2):
                pair = cells[j:j + 2]
                rows.append([Table([[c[0]], [c[1]]]) for c in pair] + ([""] if len(pair) == 1 else []))
            if rows:
                pt = Table(rows, colWidths=[85 * mm, 85 * mm], hAlign="LEFT")
                pt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
                elems.append(pt)

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
    atts = await db.attachments.find({"case_id": case_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    for a in atts:
        a["bytes"] = await load_bytes(a)
    image_atts = [a for a in atts if a.get("kind") not in ("pdf", "photo")]
    pdf_atts = [a for a in atts if a.get("kind") == "pdf"]
    photos = [a for a in atts if a.get("kind") == "photo"]
    pdf_bytes = build_pdf(c, notes, user, image_atts, photos)
    if pdf_atts:
        pdf_bytes = merge_pdf_attachments(pdf_bytes, pdf_atts)
    b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    safe = (c.get("name") or "caso").replace(" ", "_")[:40]
    return {"filename": f"Preservia_{safe}.pdf", "pdf_base64": b64, "mime": "application/pdf"}


def _mix_rows(r: Dict[str, Any]) -> List[List[str]]:
    bottle_ml = float(r.get("bottle_ml") or 473.0)
    rows = [
        ["Arterial", f"{r.get('fluid_name') or 'Sin nombre'} · Index {float(r.get('fluid_index_pct') or 0):g}%"],
        ["Concentración en el punto de inyección", f"{float(r.get('desired_index_pct') or 0):g}%"],
        ["Volumen total (Vtotal)", f"{float(r.get('total_l') or 0):.2f} L"],
        ["Arterial a agregar (V1)", f"{float(r.get('v1_l') or 0):.2f} L"],
        ["Botellas de arterial", f"{float(r.get('bottles') or 0):.2f} (de {bottle_ml:g} mL)"],
    ]
    for c in r.get("coinjectors") or []:
        rows.append([f"Co-inyector: {c.get('name', '')}", f"{float(c.get('volume_ml') or 0) / 1000.0:.3f} L"])
    rows.append(["Agua a agregar", f"{float(r.get('water_ml') or 0) / 1000.0:.2f} L"])
    return rows


@api_router.get("/cases/{case_id}/mix-sheet")
async def mix_sheet(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Hoja de mezcla de una página (PDF) + texto corto para WhatsApp, del último cálculo de inyección guardado."""
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    calc = next((x for x in reversed(c.get("calculations") or []) if (x.get("results") or {}).get("v1_l") is not None), None)
    if not calc:
        raise HTTPException(status_code=404, detail="Guarda primero un Cálculo de inyección en este caso")
    r = calc["results"]
    rows = _mix_rows(r)
    who = c.get("deceased_name") or c.get("name") or "Caso"
    lot = c.get("case_number") or ""
    try:
        when = datetime.fromisoformat(str(calc.get("created_at")).replace("Z", "+00:00")).astimezone(MX_TZ).strftime("%d/%m/%Y %H:%M")
    except Exception:
        when = "-"

    buf = BytesIO()
    d = SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, leftMargin=18 * mm, rightMargin=18 * mm, bottomMargin=18 * mm)
    st = getSampleStyleSheet()
    ink = colors.HexColor("#0F172A")
    title = ParagraphStyle("MTitle", parent=st["Title"], textColor=ink, fontSize=20, spaceAfter=4)
    sub = ParagraphStyle("MSub", parent=st["Normal"], textColor=colors.HexColor("#64748B"), fontSize=10, spaceAfter=12)
    big = ParagraphStyle("MBig", parent=st["Normal"], textColor=ink, fontSize=13, leading=18, spaceAfter=12, fontName="Helvetica-Bold")
    cell = ParagraphStyle("MCell", parent=st["Normal"], textColor=ink, fontSize=11, leading=15)

    def esc(v: str) -> str:
        return str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    tbl = Table([[Paragraph(esc(a), cell), Paragraph(f"<b>{esc(b)}</b>", cell)] for a, b in rows], colWidths=[90 * mm, 84 * mm])
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    sheet = c.get("case_sheet") or {}
    sig_elems: List[Any] = []
    sig_draw = signature_drawing(sheet.get("firma_tecnico"))
    if sig_draw is not None:
        sig_tbl = Table([
            [sig_draw],
            [Paragraph(esc(sheet.get("tecnico_responsable") or "Técnico responsable del servicio"), cell)],
            [Paragraph(esc(f"Firma del técnico responsable - {(clean_signature(sheet.get('firma_tecnico')) or {}).get('signed_at', '')}"), sub)],
        ], colWidths=[80 * mm], hAlign="LEFT")
        sig_tbl.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (0, 0), 0.6, ink),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ]))
        sig_elems = [Spacer(1, 14 * mm), sig_tbl]
    else:
        sig_elems = [Spacer(1, 18 * mm), Paragraph("______________________________", cell),
                     Paragraph("Firma del técnico responsable", sub)]
    d.build([
        Paragraph("Hoja de mezcla", title),
        Paragraph(esc(f"{who}{' · Lote ' + lot if lot else ''} · Cálculo del {when}"), sub),
        Paragraph(esc(r.get("instruction") or ""), big),
        tbl,
        Spacer(1, 10),
        Paragraph(esc(f"V1 × C1 = Vtotal × C punto de inyección · Agua = Vtotal − V1 − co-inyectores"), sub),
        *sig_elems,
    ])
    text = "\n".join(
        [f"*Hoja de mezcla* · {who}{' · Lote ' + lot if lot else ''}", r.get("instruction") or ""]
        + [f"• {a}: {b}" for a, b in rows]
    )
    safe = who.replace(" ", "_")[:40]
    return {"filename": f"Mezcla_{safe}.pdf", "pdf_base64": base64.b64encode(buf.getvalue()).decode("utf-8"), "text": text,
            "confirmed": bool(calc.get("mix_confirmed")), "confirmed_at": calc.get("mix_confirmed_at")}


@api_router.post("/cases/{case_id}/mix-confirm")
async def confirm_mix(case_id: str, payload: Optional[Dict[str, Any]] = None, user: Dict[str, Any] = Depends(get_current_user)):
    """Confirma la mezcla del último Cálculo de inyección: registra arterial y agua en la Bitácora
    y descuenta del inventario la fracción exacta de botellas usadas."""
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    calc = next((x for x in reversed(c.get("calculations") or []) if (x.get("results") or {}).get("v1_l") is not None), None)
    if not calc:
        raise HTTPException(status_code=404, detail="Guarda primero un Cálculo de inyección en este caso")
    if calc.get("mix_confirmed"):
        raise HTTPException(status_code=400, detail="Esta mezcla ya fue confirmada")
    r = calc["results"]
    ts = now_iso()
    fluid_name = str(r.get("fluid_name") or "").strip()
    art_label = f"Arterial {fluid_name + ' ' if fluid_name else ''}Index {float(r.get('fluid_index_pct') or 0):g}%"
    entries = []
    for product, qty in ((art_label, float(r.get("concentrate_ml") or 0)), ("Agua", float(r.get("water_ml") or 0))):
        if qty > 0:
            entries.append({"log_id": f"log_{uuid.uuid4().hex[:10]}", "product": product, "form": "liquid",
                            "quantity": round(qty, 2), "unit": "ml", "source": "mix", "mix_calc_id": calc["calc_id"], "created_at": ts})
    bottles = round(float(r.get("bottles") or 0), 2)
    res = await db.cases.update_one(
        {"case_id": case_id, "calculations": {"$elemMatch": {"calc_id": calc["calc_id"], "mix_confirmed": {"$ne": True}}}},
        {"$push": {"logbook": {"$each": entries}},
         "$set": {"calculations.$.mix_confirmed": True, "calculations.$.mix_confirmed_at": ts, "updated_at": ts}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Esta mezcla ya fue confirmada")
    stock_left = None
    fluid = None
    lot_txt = ""
    if fluid_name:
        fluid = await db.fluid_templates.find_one({"user_id": user["user_id"], "name_key": fluid_name.lower()}, {"_id": 0})
    if fluid:
        adj = await _adjust_lot(user["user_id"], fluid["item_id"], -bottles, lot_id=(payload or {}).get("lot_id"))
        deducted = round(-adj["applied"], 2)
        stock_left = adj["stock_total"]
        lot_txt = adj["lot"]
        await db.cases.update_one(
            {"case_id": case_id, "calculations.calc_id": calc["calc_id"]},
            {"$set": {"calculations.$.mix_deducted": deducted, "calculations.$.mix_lot_id": adj["lot_id"],
                      "calculations.$.mix_lot": lot_txt, "calculations.$.mix_fluid_id": fluid["item_id"]}},
        )
        await db.cases.update_one(
            {"case_id": case_id},
            {"$set": {"logbook.$[e].lot": lot_txt}},
            array_filters=[{"e.mix_calc_id": calc["calc_id"], "e.product": art_label}],
        )
    return {"entries": entries, "bottles": bottles, "fluid": fluid["name"] if fluid else None, "stock_left": stock_left, "lot": lot_txt}


@api_router.post("/cases/{case_id}/mix-undo")
async def undo_mix(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Anula la última mezcla confirmada: devuelve las botellas al inventario y quita sus registros de la Bitácora."""
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    calc = next((x for x in reversed(c.get("calculations") or []) if x.get("mix_confirmed")), None)
    if not calc:
        raise HTTPException(status_code=400, detail="No hay una mezcla confirmada para anular")
    ts = now_iso()
    confirmed_at = calc.get("mix_confirmed_at")
    res = await db.cases.update_one(
        {"case_id": case_id, "calculations": {"$elemMatch": {"calc_id": calc["calc_id"], "mix_confirmed": True}}},
        {"$set": {"calculations.$.mix_confirmed": False, "updated_at": ts},
         "$unset": {"calculations.$.mix_confirmed_at": ""}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Esta mezcla ya fue anulada")
    await db.cases.update_one(
        {"case_id": case_id},
        {"$pull": {"logbook": {"source": "mix", "$or": [{"mix_calc_id": calc["calc_id"]},
                                                        {"mix_calc_id": {"$exists": False}, "created_at": confirmed_at}]}}},
    )
    r = calc.get("results") or {}
    bottles = round(float(calc.get("mix_deducted", r.get("bottles") or 0)), 2)
    await db.cases.update_one(
        {"case_id": case_id, "calculations.calc_id": calc["calc_id"]},
        {"$unset": {"calculations.$.mix_deducted": "", "calculations.$.mix_lot_id": "", "calculations.$.mix_lot": ""}},
    )
    fluid_name = str(r.get("fluid_name") or "").strip()
    stock = None
    f = None
    if calc.get("mix_fluid_id"):
        f = await db.fluid_templates.find_one({"item_id": calc["mix_fluid_id"], "user_id": user["user_id"]}, {"_id": 0})
    if not f and fluid_name:
        f = await db.fluid_templates.find_one({"user_id": user["user_id"], "name_key": fluid_name.lower()}, {"_id": 0})
    if f:
        adj = await _adjust_lot(user["user_id"], f["item_id"], bottles, lot_id=calc.get("mix_lot_id"))
        stock = adj["stock_total"]
    return {"ok": True, "bottles": bottles, "fluid": fluid_name or None, "stock": stock}


def _to_unit(qty: float, unit: str, target: str) -> Optional[float]:
    oz = 29.5735295625
    if unit == target:
        return qty
    if unit == "oz" and target == "ml":
        return qty * oz
    if unit == "ml" and target == "oz":
        return qty / oz
    return None


@api_router.get("/cases/{case_id}/cost")
async def case_cost(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Costo en fluidos (MXN) + precio del servicio y margen."""
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    fluids = {f["name_key"]: f for f in await db.fluid_templates.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)}
    prices = await db.product_prices.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(500)
    out = _case_cost(c, fluids, prices)
    sp = c.get("service_price")
    if sp is not None:
        out["service_price"] = sp
        out["margin"] = round(float(sp) - out["total"], 2)
        out["margin_pct"] = round(out["margin"] / float(sp) * 100, 1) if float(sp) > 0 else None
    return out


@api_router.put("/cases/{case_id}/service-price")
async def set_service_price(case_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    """Precio al que se cobra el servicio (MXN). null/'' lo borra."""
    raw = payload.get("price")
    if isinstance(raw, bool):
        raise HTTPException(status_code=400, detail="Precio no válido")
    if raw in (None, ""):
        upd: Dict[str, Any] = {"$unset": {"service_price": ""}, "$set": {"updated_at": now_iso()}}
    else:
        try:
            price = float(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Precio no válido")
        if not (0 <= price <= 100000000):
            raise HTTPException(status_code=400, detail="Precio no válido")
        upd = {"$set": {"service_price": round(price, 2), "updated_at": now_iso()}}
    res = await db.cases.update_one({"case_id": case_id, "user_id": user["user_id"]}, upd)
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    return {"ok": True}


# ---------- Historial de compras de fluidos ----------
@api_router.get("/purchases")
async def list_purchases(user: Dict[str, Any] = Depends(get_current_user)):
    items = await db.fluid_purchases.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("date", -1).to_list(500)
    return {"items": items}


@api_router.post("/purchases")
async def add_purchase(payload: Dict[str, Any], user: Dict[str, Any] = Depends(get_current_user)):
    """Registra una compra: suma botellas al inventario y actualiza el precio por botella."""
    f = await db.fluid_templates.find_one({"item_id": payload.get("fluid_id"), "user_id": user["user_id"]}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Fluido no encontrado")
    try:
        bottles = float(payload.get("bottles") or 0)
        total = float(payload.get("total") or 0)
    except (TypeError, ValueError):
        bottles, total = 0, -1
    if not (0 < bottles <= 10000) or not (0 <= total <= 100000000):
        raise HTTPException(status_code=400, detail="Escribe botellas (mayor que 0) y el total pagado")
    date = str(payload.get("date") or now_iso())[:40]
    if not _parse_dt(date):
        raise HTTPException(status_code=400, detail="Fecha no válida")
    unit_price = round(total / bottles, 2)
    lot_name = str(payload.get("lot") or "").strip()[:40] or "Sin lote"
    doc = {"purchase_id": f"pur_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "fluid_id": f["item_id"],
           "fluid_name": f["name"], "bottles": round(bottles, 2), "total": round(total, 2), "unit_price": unit_price,
           "supplier": str(payload.get("supplier") or "").strip()[:80], "lot": lot_name, "date": date, "created_at": now_iso()}
    adj = await _adjust_lot(user["user_id"], f["item_id"], round(bottles, 2), lot_name=lot_name)
    doc["lot_id"] = adj["lot_id"]
    await db.fluid_purchases.insert_one(dict(doc))
    await db.fluid_templates.update_one({"item_id": f["item_id"]}, {"$set": {"price_per_bottle": unit_price}})
    stock = adj["stock_total"]
    doc.pop("_id", None)
    doc.pop("user_id", None)
    return {"purchase": doc, "stock": stock, "price_per_bottle": unit_price}


@api_router.delete("/purchases/{purchase_id}")
async def delete_purchase(purchase_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Elimina una compra y resta sus botellas del inventario (sin bajar de 0)."""
    p = await db.fluid_purchases.find_one_and_delete({"purchase_id": purchase_id, "user_id": user["user_id"]})
    if not p:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    adj = await _adjust_lot(user["user_id"], p["fluid_id"], -float(p.get("bottles") or 0), lot_id=p.get("lot_id"))
    stock = adj.get("stock_total") if adj else None
    return {"ok": True, "stock": stock}


def _case_cost(c: Dict[str, Any], fluids: Dict[str, Any], prices: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Costo en fluidos (MXN): arterial de mezclas confirmadas + co-inyectores, cavidades y otros de la Bitácora."""
    by_key = {p["name_key"]: p for p in prices}
    fluids_by_key = fluids
    groups: Dict[str, Dict[str, Any]] = {k: {"key": k, "label": "Arterial" if k == "arterial" else PRICE_CATS[k], "total": 0.0, "items": []}
                                         for k in ["arterial", "coinyector", "cavidad", "topico", "putrefacto", "otro"]}
    missing: List[str] = []
    for calc in c.get("calculations") or []:
        if not calc.get("mix_confirmed"):
            continue
        r = calc.get("results") or {}
        name = str(r.get("fluid_name") or "").strip()
        f = fluids.get(name.lower()) if name else None
        bottles = float(r.get("bottles") or 0)
        label = f"{name or 'Arterial'} · {bottles:.2f} botellas"
        if f and f.get("price_per_bottle") is not None:
            cost = round(bottles * float(f["price_per_bottle"]), 2)
            groups["arterial"]["items"].append({"label": label, "cost": cost})
            groups["arterial"]["total"] += cost
        else:
            missing.append(name or "Arterial sin nombre")
    for e in c.get("logbook") or []:
        if e.get("source") == "mix":
            continue
        pname = str(e.get("product") or "").strip()
        key = pname.lower()
        p = by_key.get(key) if key else None
        if not p and key in fluids_by_key and fluids_by_key[key].get("price_per_bottle") is not None:
            fx = fluids_by_key[key]
            p = {"price": fx["price_per_bottle"], "size": fx.get("bottle_ml") or 473.0, "unit": fx.get("unit") or "ml",
                 "category": fx.get("kind") if fx.get("kind") in PRICE_CATS else "otro"}
        if p and e.get("category") in ("cavidad", "topico", "putrefacto"):
            p = {**p, "category": e["category"]}
        if not p:
            missing.append(pname)
            continue
        q = _to_unit(float(e.get("quantity") or 0), str(e.get("unit") or ""), p["unit"])
        if q is None:
            missing.append(f"{pname} (unidad distinta)")
            continue
        cost = round(q / float(p["size"]) * float(p["price"]), 2)
        g = groups[p.get("category") if p.get("category") in groups else "otro"]
        g["items"].append({"label": f"{pname} · {e.get('quantity')} {'mL' if e.get('unit') == 'ml' else e.get('unit')}", "cost": cost})
        g["total"] += cost
    out = [{**g, "total": round(g["total"], 2)} for g in groups.values() if g["items"]]
    return {"currency": "MXN", "groups": out, "total": round(sum(g["total"] for g in out), 2),
            "missing": sorted(set(missing))}


# ----------------------------- Case attachments (scanned documents) -----------------------------
ATTACHMENT_LABELS = ["Certificado de Defunción", "Hoja de Autorización", "Etiquetas de Identificación"]


@api_router.post("/cases/{case_id}/attachments")
async def add_attachment(case_id: str, data: AttachmentInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    label = data.label if data.label in ATTACHMENT_LABELS else (data.label or "Documento adjunto")
    kind_in = (data.kind or "").lower()
    kind = "pdf" if kind_in == "pdf" else ("photo" if kind_in == "photo" else "image")
    stage = (data.stage or "").lower() if kind == "photo" else None
    if kind == "photo" and stage not in ("antes", "despues"):
        raise HTTPException(status_code=400, detail="La foto debe ser 'antes' o 'despues'")
    if kind == "photo":
        label = "Foto antes" if stage == "antes" else "Foto después"
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
        "stage": stage,
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
    ).sort("created_at", 1).to_list(500)
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
