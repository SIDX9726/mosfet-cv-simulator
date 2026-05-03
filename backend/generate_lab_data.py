# backend/generate_lab_data.py
import numpy as np
import pandas as pd

# 1. Sweep from -3V to 3V with 150 data points (high resolution)
voltages = np.linspace(-3.0, 3.0, 150)

# 2. Base parameters for a realistic 30nm Oxide Curve
c_max = 1.15e-7  # Accumulation capacitance
c_min = 1.05e-8  # Inversion minimum capacitance
v_t = -0.1       # Threshold voltage shifted slightly

# 3. Generate a realistic physical curve shape (using a sigmoid curve to mimic Depletion)
steepness = 6.0
base_cap = c_min + (c_max - c_min) / (1 + np.exp(steepness * (voltages - v_t)))

# 4. Add realistic electrical noise (like the jagged lines in your picture!)
noise_amplitude = 0.02 * (c_max - c_min) # 2% noise
noise = np.random.normal(0, noise_amplitude, len(voltages))
measured_cap = base_cap + noise

# 5. Save it to a CSV file!
df = pd.DataFrame({
    "Voltage": np.round(voltages, 3),
    "Capacitance": measured_cap
})
df.to_csv("realistic_lab_data.csv", index=False)

print("✅ Success! 'realistic_lab_data.csv' has been generated with 150 noisy data points.")