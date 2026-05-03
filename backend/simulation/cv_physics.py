# backend/simulation/cv_physics.py
import numpy as np
from scipy.ndimage import gaussian_filter1d # NEW: For Debye Smearing

class MoscapEngine:
    def __init__(self, t_ox_nm=30, n_a=1e15, gate_work_function=4.5, eps_ox_relative=3.9, substrate_type="p-type Silicon"):
        self.q = 1.602e-19               
        self.eps_0 = 8.854e-14           
        self.eps_si = 11.7 * self.eps_0  
        self.eps_ox = eps_ox_relative * self.eps_0   
        self.ni = 1.0e10                 
        self.kT_q = 0.0259               
        
        self.t_ox = t_ox_nm * 1e-7       
        self.n_doping = n_a                   
        self.phi_m = gate_work_function  
        self.sub_type = substrate_type 

    def calculate_ideal_parameters(self):
        C_ox = self.eps_ox / self.t_ox
        phi_f = self.kT_q * np.log(self.n_doping / self.ni)
        
        if "p-type" in self.sub_type:
            phi_s = 4.05 + (1.12 / 2) + phi_f
        else:
            phi_s = 4.05 + (1.12 / 2) - phi_f
            
        v_fb = self.phi_m - phi_s
        w_max = np.sqrt((4 * self.eps_si * phi_f) / (self.q * self.n_doping))
        q_dep_max = np.sqrt(2 * self.q * self.eps_si * self.n_doping * 2 * phi_f)
        
        if "p-type" in self.sub_type:
            v_t = v_fb + 2 * phi_f + (q_dep_max / C_ox)
        else:
            v_t = v_fb - 2 * phi_f - (q_dep_max / C_ox)
            
        return {
            "Cox_F_per_cm2": float(C_ox),
            "Flatband_Voltage_V": float(v_fb),
            "Threshold_Voltage_V": float(v_t),
            "Max_Depletion_Width_cm": float(w_max)
        }

    # NEW: Added smearing_factor parameter
    def generate_cv_curve(self, v_start=-5.0, v_end=5.0, v_step=0.1, smearing_factor=2.5):
        params = self.calculate_ideal_parameters()
        v_fb = params["Flatband_Voltage_V"]
        v_t = params["Threshold_Voltage_V"]
        c_ox = params["Cox_F_per_cm2"]
        w_max = params["Max_Depletion_Width_cm"]
        
        c_min_dep = self.eps_si / w_max
        c_hf_inv = (c_ox * c_min_dep) / (c_ox + c_min_dep)

        voltages = np.arange(v_start, v_end + v_step, v_step)
        c_lf, c_hf = [],[]
        
        # Standard Piecewise Depletion Approximation
        for vg in voltages:
            if "p-type" in self.sub_type:
                if vg < v_fb:
                    c_lf.append(c_ox); c_hf.append(c_ox)
                elif v_fb <= vg <= v_t:
                    den = np.sqrt(1 + (2 * (c_ox**2) * (vg - v_fb)) / (self.q * self.eps_si * self.n_doping))
                    c_dep_total = c_ox / den
                    c_lf.append(c_dep_total); c_hf.append(c_dep_total)
                else:
                    c_lf.append(c_ox); c_hf.append(c_hf_inv)
            else: 
                if vg > v_fb:
                    c_lf.append(c_ox); c_hf.append(c_ox)
                elif v_t <= vg <= v_fb:
                    den = np.sqrt(1 + (2 * (c_ox**2) * (v_fb - vg)) / (self.q * self.eps_si * self.n_doping))
                    c_dep_total = c_ox / den
                    c_lf.append(c_dep_total); c_hf.append(c_dep_total)
                else:
                    c_lf.append(c_ox); c_hf.append(c_hf_inv)
                    
        # === DEBYE SMEARING FILTER ===
        # Smooths out the sharp piecewise kinks to mimic realistic thermal carrier distribution!
        if smearing_factor > 0:
            c_lf = gaussian_filter1d(c_lf, sigma=smearing_factor).tolist()
            c_hf = gaussian_filter1d(c_hf, sigma=smearing_factor).tolist()
                    
        return {
            "voltage": np.round(voltages, 2).tolist(), 
            "low_freq_cap": c_lf, 
            "high_freq_cap": c_hf,
            "v_fb": float(v_fb),      
            "v_t": float(v_t),        
            "c_ox": float(c_ox),      
            "c_min": float(c_hf_inv)  
        }

    def analyze_measurement(self, exp_voltage, exp_cap):
        c_ox_exp = max(exp_cap)
        c_min_exp = min(exp_cap)
        c_mid = (c_ox_exp + c_min_exp) / 2.0
        
        exp_v_arr = np.array(exp_voltage)
        exp_c_arr = np.array(exp_cap)
        idx_mid_exp = np.argmin(np.abs(exp_c_arr - c_mid))
        v_mid_exp = exp_v_arr[idx_mid_exp]
        
        ideal = self.generate_cv_curve(min(exp_voltage), max(exp_voltage), 0.1, smearing_factor=2.0)
        ideal_c_arr = np.array(ideal["low_freq_cap"])
        idx_mid_ideal = np.argmin(np.abs(ideal_c_arr - c_mid))
        v_mid_ideal = ideal["voltage"][idx_mid_ideal]
        
        v_shift = v_mid_exp - v_mid_ideal
        n_ox = - (v_shift * c_ox_exp) / self.q
        
        c_80 = c_min_exp + 0.8 * (c_ox_exp - c_min_exp)
        c_20 = c_min_exp + 0.2 * (c_ox_exp - c_min_exp)
        v_80_exp = exp_v_arr[np.argmin(np.abs(exp_c_arr - c_80))]
        v_20_exp = exp_v_arr[np.argmin(np.abs(exp_c_arr - c_20))]
        slope_exp = abs((c_80 - c_20) / (v_80_exp - v_20_exp)) if v_80_exp != v_20_exp else 1e-12
        
        v_80_ideal = ideal["voltage"][np.argmin(np.abs(ideal_c_arr - c_80))]
        v_20_ideal = ideal["voltage"][np.argmin(np.abs(ideal_c_arr - c_20))]
        slope_ideal = abs((c_80 - c_20) / (v_80_ideal - v_20_ideal)) if v_80_ideal != v_20_ideal else 1e-12

        slope_ratio = slope_ideal / slope_exp
        if slope_ratio > 1:
            c_it = c_ox_exp * (slope_ratio - 1)
            d_it = c_it / (self.q * self.q * 1e12) 
        else:
            d_it = 1e10

        return {
            "v_shift_V": float(v_shift),
            "n_ox_cm2": float(n_ox),
            "d_it_cm2_eV": float(abs(d_it)),
            "c_ox_exp": float(c_ox_exp)
        }