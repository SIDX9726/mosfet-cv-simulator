# backend/main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from simulation.cv_physics import MoscapEngine
import pandas as pd
import io

app = FastAPI(title="MOSFET C-V Simulation API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class MoscapInput(BaseModel):
    t_ox_nm: float = 30.0
    n_a: float = 1e15
    gate_work_function: float = 4.5
    eps_ox_relative: float = 3.9
    substrate_type: str = "p-type Silicon"
    smearing_factor: float = 2.5   # <--- NEW
    v_start: float = -3.0
    v_end: float = 3.0
    v_step: float = 0.05

class AnalysisInput(BaseModel):
    t_ox_nm: float
    n_a: float
    gate_work_function: float
    eps_ox_relative: float
    substrate_type: str                  # <--- ADDED SUBSTRATE TYPE
    exp_voltage: list[float]
    exp_cap: list[float]

@app.get("/")
def read_root(): return {"message": "Backend Ready!"}

@app.post("/calculate-parameters")
def calculate_params(params: MoscapInput):
    engine = MoscapEngine(params.t_ox_nm, params.n_a, params.gate_work_function, params.eps_ox_relative, params.substrate_type)
    return {"status": "success", "data": engine.calculate_ideal_parameters()}

@app.post("/generate-cv")
def generate_cv(params: MoscapInput):
    engine = MoscapEngine(params.t_ox_nm, params.n_a, params.gate_work_function, params.eps_ox_relative, params.substrate_type)
    return {"status": "success", "data": engine.generate_cv_curve(params.v_start, params.v_end, params.v_step)}

@app.post("/analyze-data")
def analyze_data(payload: AnalysisInput):
    engine = MoscapEngine(payload.t_ox_nm, payload.n_a, payload.gate_work_function, payload.eps_ox_relative, payload.substrate_type)
    return {"status": "success", "data": engine.analyze_measurement(payload.exp_voltage, payload.exp_cap)}

# KEEP YOUR UPLOAD ENDPOINT AT THE BOTTOM!
# ... (Keep your existing @app.post("/upload-data") exactly as it is at the bottom)

# NEW ENDPOINT: Generates the full curve arrays
@app.post("/generate-cv")
def generate_cv(params: MoscapInput):
    engine = MoscapEngine(params.t_ox_nm, params.n_a, params.gate_work_function, params.eps_ox_relative, params.substrate_type)
    
    # NEW: Pass the smearing factor to the generator
    curve_data = engine.generate_cv_curve(params.v_start, params.v_end, params.v_step, params.smearing_factor)
    return {"status": "success", "data": curve_data}

# NEW ENDPOINT: Parse uploaded experimental CSV data
@app.post("/upload-data")
async def upload_experimental_data(file: UploadFile = File(...)):
    try:
        # Read the file content
        contents = await file.read()
        
        # Read CSV using pandas (assuming columns are like "Voltage", "Capacitance")
        # We decode it to string so pandas can read it from memory
        df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
        
        # Standardize column names (lowercase them to be safe)
        df.columns =[col.strip().lower() for col in df.columns]
        
        # Look for columns that contain 'v' (voltage) and 'c' (capacitance)
        v_col = next(col for col in df.columns if 'v' in col)
        c_col = next(col for col in df.columns if 'c' in col)
        
        # Extract as lists
        voltages = df[v_col].tolist()
        capacitances = df[c_col].tolist()
        
        return {
            "status": "success",
            "data": {
                "voltage": voltages,
                "measured_cap": capacitances
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
    
@app.post("/analyze-data")
def analyze_data(payload: AnalysisInput):
    engine = MoscapEngine(payload.t_ox_nm, payload.n_a, payload.gate_work_function)
    results = engine.analyze_measurement(payload.exp_voltage, payload.exp_cap)
    return {"status": "success", "data": results}