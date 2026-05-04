# backend/main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from simulation.cv_physics import MoscapEngine
import pandas as pd
import io

app = FastAPI(title="MOSFET C-V Simulation API")

# IMPROVED CORS: Explicitly allowing your Vercel domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits all domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MoscapInput(BaseModel):
    t_ox_nm: float = 30.0
    n_a: float = 1e15
    gate_work_function: float = 4.5
    eps_ox_relative: float = 3.9
    substrate_type: str = "p-type Silicon"
    smearing_factor: float = 2.5
    v_start: float = -3.0
    v_end: float = 3.0
    v_step: float = 0.05

class AnalysisInput(BaseModel):
    t_ox_nm: float
    n_a: float
    gate_work_function: float
    eps_ox_relative: float
    substrate_type: str
    exp_voltage: list[float]
    exp_cap: list[float]

@app.get("/")
def read_root(): 
    return {"message": "Backend Ready!"}

@app.post("/calculate-parameters")
def calculate_params(params: MoscapInput):
    engine = MoscapEngine(params.t_ox_nm, params.n_a, params.gate_work_function, params.eps_ox_relative, params.substrate_type)
    return {"status": "success", "data": engine.calculate_ideal_parameters()}

@app.post("/generate-cv")
def generate_cv(params: MoscapInput):
    engine = MoscapEngine(params.t_ox_nm, params.n_a, params.gate_work_function, params.eps_ox_relative, params.substrate_type)
    # Merged logic: Uses smearing_factor correctly
    curve_data = engine.generate_cv_curve(params.v_start, params.v_end, params.v_step, params.smearing_factor)
    return {"status": "success", "data": curve_data}

@app.post("/analyze-data")
def analyze_data(payload: AnalysisInput):
    engine = MoscapEngine(payload.t_ox_nm, payload.n_a, payload.gate_work_function, payload.eps_ox_relative, payload.substrate_type)
    results = engine.analyze_measurement(payload.exp_voltage, payload.exp_cap)
    return {"status": "success", "data": results}

@app.post("/upload-data")
async def upload_experimental_data(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
        
        # Standardize column names
        df.columns = [col.strip().lower() for col in df.columns]
        
        v_col = next(col for col in df.columns if 'v' in col)
        c_col = next(col for col in df.columns if 'c' in col)
        
        return {
            "status": "success",
            "data": {
                "voltage": df[v_col].tolist(),
                "measured_cap": df[c_col].tolist()
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    import os
    # Use the PORT environment variable provided by Railway
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)