import { useState, useEffect, useCallback, useMemo } from 'react';
import { generateCVCurve, uploadDataFile, analyzeMeasurement } from './api/api';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';
import { ReactFlow, Background, Controls, addEdge, applyNodeChanges, applyEdgeChanges, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';

const METALS = { "Aluminum (Al)": 4.1, "Titanium Nitride (TiN)": 4.5, "Gold (Au)": 5.1, "Platinum (Pt)": 5.65, "p+ Polysilicon": 5.2 };
const INSULATORS = { "Silicon Dioxide (SiO2)": 3.9, "Aluminum Oxide (Al2O3)": 9.0, "Hafnium Oxide (HfO2)": 25.0 };
const SUBSTRATES =["p-type Silicon", "n-type Silicon"];

// ==========================================
// REACT FLOW CUSTOM DRAGGABLE NODES (FIXED TERMINALS)
// ==========================================
const GateNode = ({ data }) => (
  <div className="layer-3d gate-layer" style={{ height: '40px', width: '220px', borderRadius: '4px', cursor: 'grab' }}>
    <Handle type="source" position={Position.Top} id="top" style={{ width: '12px', height: '12px', background: '#334155' }} />
    <span className="layer-text">{data.label}</span>
    <Handle type="target" position={Position.Bottom} id="bot" style={{ opacity: 0 }} />
  </div>
);

const OxideNode = ({ data }) => (
  <div className="layer-3d oxide-layer" style={{ height: '35px', width: '220px', borderRadius: '4px', cursor: 'grab' }}>
    <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />
    <span className="layer-text">{data.label}</span>
    <Handle type="source" position={Position.Bottom} id="bot" style={{ opacity: 0 }} />
  </div>
);

const SubstrateNode = ({ data }) => (
  <div className={`layer-3d bulk-layer ${data.isPType ? 'p-type-bulk' : 'n-type-bulk'}`} style={{ height: '80px', width: '220px', borderRadius: '4px', cursor: 'grab' }}>
    <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />
    <span className="layer-text">{data.label}</span>
    <Handle type="source" position={Position.Bottom} id="bot" style={{ opacity: 0 }} />
  </div>
);

const ContactNode = ({ data }) => (
  <div className="layer-3d back-contact-layer" style={{ height: '25px', width: '220px', borderRadius: '4px', cursor: 'grab' }}>
    <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />
    <span className="layer-text">{data.label}</span>
    <Handle type="source" position={Position.Bottom} id="bot" style={{ width: '12px', height: '12px', background: '#334155' }} />
  </div>
);

const VgbNode = () => (
  <div className="vgb-source" style={{ position: 'relative', top: 0, left: 0, transform: 'none', cursor: 'grab' }}>
    <Handle type="target" position={Position.Top} id="top" style={{ width: '12px', height: '12px', background: '#ef4444', top: '-6px' }} />
    <span style={{ color: '#ef4444', fontSize: '1.2em', fontWeight: '900', lineHeight: 1 }}>+</span>
    <span style={{ color: '#3b82f6', fontSize: '1.4em', fontWeight: '900', lineHeight: 1 }}>−</span>
    <Handle type="target" position={Position.Bottom} id="bot" style={{ width: '12px', height: '12px', background: '#3b82f6', bottom: '-6px' }} />
    <div className="vgb-label" style={{ right: '-35px' }}>V<sub>GB</sub></div>
  </div>
);

// INITIAL CANVAS SETUP
const initialNodes =[
  { id: 'gate', type: 'gate', position: { x: 150, y: 30 }, data: { label: 'Gate' } },
  { id: 'oxide', type: 'oxide', position: { x: 150, y: 80 }, data: { label: 'Oxide' } },
  { id: 'substrate', type: 'substrate', position: { x: 150, y: 130 }, data: { label: 'Substrate', isPType: true } },
  { id: 'contact', type: 'contact', position: { x: 150, y: 220 }, data: { label: 'Back Contact' } },
  { id: 'vgb', type: 'vgb', position: { x: 450, y: 120 }, data: { label: 'VGB' } },
];

const initialEdges =[
  { id: 'e1', source: 'gate', target: 'vgb', targetHandle: 'top', animated: true, style: { stroke: '#ef4444', strokeWidth: 3 } },
  { id: 'e2', source: 'contact', target: 'vgb', targetHandle: 'bot', animated: true, style: { stroke: '#3b82f6', strokeWidth: 3 } }
];

// --- REMOVED THE DUPLICATE EXPORT DEFAULT HERE ---
function App() {
  const [materials, setMaterials] = useState({ gate: "p+ Polysilicon", insulator: "Silicon Dioxide (SiO2)", substrate: "p-type Silicon" });
  
  const [params, setParams] = useState({ 
    t_ox_nm: 30.0, 
    n_a: 1e15, 
    area_cm2: 1.0, 
    t_gate_nm: 150.0,
    depth_sub_um: 500.0,
    smearing_factor: 2.5,
    v_start: -3.0, 
    v_end: 3.0, 
    v_step: 0.02 
  });
  
  const [chartData, setChartData] = useState([]);
  const [physicsParams, setPhysicsParams] = useState({ v_fb: -0.8, v_t: 0.5, c_ox: 0, c_min: 0 });
  const [experimentalData, setExperimentalData] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [analytics, setAnalytics] = useState(null);

  // --- REACT FLOW CANVAS STATE ---
  const nodeTypes = useMemo(() => ({ gate: GateNode, oxide: OxideNode, substrate: SubstrateNode, contact: ContactNode, vgb: VgbNode }),[]);
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)),[]);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),[]);
  
  const onConnect = useCallback((connection) => {
    const isPositive = connection.targetHandle === 'top';
    const edgeColor = isPositive ? '#ef4444' : '#3b82f6';
    const edge = { ...connection, animated: true, style: { stroke: edgeColor, strokeWidth: 3 } };
    setEdges((eds) => addEdge(edge, eds));
  },[]);

  useEffect(() => {
    setNodes(nds => nds.map(node => {
      if (node.id === 'gate') return { ...node, data: { label: `${materials.gate.split(' ')[0]} Gate (${params.t_gate_nm}nm)` } };
      if (node.id === 'oxide') return { ...node, data: { label: `${materials.insulator.split(' ')[0]} (εr = ${INSULATORS[materials.insulator]})` } };
      if (node.id === 'substrate') return { ...node, data: { label: `${materials.substrate} (${params.depth_sub_um}µm)`, isPType: materials.substrate.includes("p-type") } };
      return node;
    }));
  },[materials, params]);

  // --- PHYSICS ENGINE ---
  const getApiPayload = () => ({
    ...params,
    gate_work_function: METALS[materials.gate],
    eps_ox_relative: INSULATORS[materials.insulator],
    substrate_type: materials.substrate
  });

  const updateGraph = async () => {
    try {
      const data = await generateCVCurve(getApiPayload());
      if (data && data.voltage) {
        setPhysicsParams({ v_fb: data.v_fb, v_t: data.v_t, c_ox: data.c_ox, c_min: data.c_min });
        setChartData(data.voltage.map((v, i) => ({ 
          voltage: Number(v), 
          SimHigh: (Number(data.high_freq_cap[i]) * params.area_cm2) * 1e9, 
          SimLow: (Number(data.low_freq_cap[i]) * params.area_cm2) * 1e9 
        })));
      }
    } catch (err) { console.error("Simulation failed:", err); }
  };

  useEffect(() => { updateGraph(); }, [materials]);

  const handleMaterialChange = (e) => setMaterials({ ...materials,[e.target.name]: e.target.value });
  const handleParamChange = (e) => setParams({ ...params,[e.target.name]: parseFloat(e.target.value) });
  const handleFileSelect = (e) => setSelectedFile(e.target.files[0]);

  const handleFileSubmit = async () => {
    if (!selectedFile) return alert("Please select a CSV file first!");
    try {
      const data = await uploadDataFile(selectedFile);
      if (data && data.voltage) {
        const validExpVolts = [];
        const validExpCaps = [];
        const cleanExpData =[];

        for (let i = 0; i < data.voltage.length; i++) {
          const v = Number(data.voltage[i]);
          const c = Number(data.measured_cap[i]);
          if (!isNaN(v) && !isNaN(c)) {
            validExpVolts.push(v);
            validExpCaps.push(c);
            cleanExpData.push({ voltage: v, Measured: c * 1e9 });
          }
        }
        setExperimentalData(cleanExpData);

        if (validExpVolts.length > 0) {
          const analysisPayload = { ...getApiPayload(), exp_voltage: validExpVolts, exp_cap: validExpCaps };
          const results = await analyzeMeasurement(analysisPayload);
          if (results && results.v_shift_V !== undefined) setAnalytics(results);
        }
      }
    } catch (err) {
      console.error("Upload failed:", err);
      alert(`Error parsing ${selectedFile.name}.`);
    }
  };

  let dataMap = new Map();
  chartData.forEach(d => { dataMap.set(d.voltage.toFixed(2), { voltage: d.voltage, SimHigh: d.SimHigh, SimLow: d.SimLow }); });
  experimentalData.forEach(d => {
    let existing = dataMap.get(d.voltage.toFixed(2)) || { voltage: d.voltage };
    existing.Measured = d.Measured;
    dataMap.set(d.voltage.toFixed(2), existing);
  });
  let mergedData = Array.from(dataMap.values()).sort((a, b) => a.voltage - b.voltage);

  const isPType = materials.substrate.includes("p-type");
  const c_ox_nF = (physicsParams.c_ox * params.area_cm2) * 1e9 || 0;
  const c_min_nF = (physicsParams.c_min * params.area_cm2) * 1e9 || 0;
  const currentEpsR = INSULATORS[materials.insulator];

  const accStart = params.v_start;
  const accEnd = isPType ? physicsParams.v_fb : physicsParams.v_t;
  const depEnd = isPType ? physicsParams.v_t : physicsParams.v_fb;
  const invEnd = params.v_end;
  const eot_nm = params.t_ox_nm * (3.9 / currentEpsR);

  const xTicks =[];
  for (let v = params.v_start; v <= params.v_end + 0.01; v += 0.2) xTicks.push(Number(v.toFixed(1)));

  let t_ox_exp_nm = 0, v_fb_exp = 0, v_th_exp = 0, oxideFormula = "Oxide", subName = "Si", interfaceName = "Si-Oxide";
  if (analytics) {
    t_ox_exp_nm = ((currentEpsR * 8.854e-14) / (analytics.c_ox_exp / params.area_cm2)) * 1e7;
    v_fb_exp = physicsParams.v_fb + analytics.v_shift_V;
    v_th_exp = physicsParams.v_t + analytics.v_shift_V;
    oxideFormula = materials.insulator.includes('(') ? materials.insulator.match(/\(([^)]+)\)/)[1] : materials.insulator;
    subName = materials.substrate.includes('n-type') ? 'n-Si' : 'p-Si';
    interfaceName = `${subName}/${oxideFormula}`;
  }

  return (
    <div className="container">
      <div className="header-section">
        <h1 className="app-title">MOS Capacitor Analyzer</h1>
        <p className="app-subtitle">Precision Characterization of Simulated vs. Practical C-V Curves</p>
      </div>
      
      <div className="top-row">
        <div className="panel controls">
          <h3>1. Material & Device Configuration</h3>
          <div className="input-grid">
            <div className="form-group"><label>Gate Material</label><select name="gate" value={materials.gate} onChange={handleMaterialChange}>{Object.keys(METALS).map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            <div className="form-group"><label>Insulator (Oxide)</label><select name="insulator" value={materials.insulator} onChange={handleMaterialChange}>{Object.keys(INSULATORS).map(i => <option key={i} value={i}>{i}</option>)}</select></div>
            <div className="form-group"><label>Dielectric Const. (εr)</label><input type="text" value={currentEpsR.toFixed(1)} disabled style={{backgroundColor: '#e2e8f0', color: '#64748b', cursor: 'not-allowed', fontWeight: 'bold'}} /></div>
            <div className="form-group"><label>Substrate</label><select name="substrate" value={materials.substrate} onChange={handleMaterialChange}>{SUBSTRATES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="form-group"><label>Device Area (cm²)</label><input type="number" step="0.001" name="area_cm2" value={params.area_cm2} onChange={handleParamChange} /></div>
            <div className="form-group"><label>Gate Thickness (nm)</label><input type="number" name="t_gate_nm" value={params.t_gate_nm} onChange={handleParamChange} /></div>
            <div className="form-group"><label>Oxide Thickness (nm)</label><input type="number" name="t_ox_nm" value={params.t_ox_nm} onChange={handleParamChange} /></div>
            <div className="form-group"><label>Doping Conc. (cm⁻³)</label><input type="number" name="n_a" value={params.n_a} onChange={handleParamChange} /></div>
            <div className="form-group"><label>Sat. Depth (Bulk) (µm)</label><input type="number" name="depth_sub_um" value={params.depth_sub_um} onChange={handleParamChange} /></div>
            <div className="form-group"><label>Debye Smearing</label><input type="number" step="0.5" min="0" max="10" name="smearing_factor" value={params.smearing_factor} onChange={handleParamChange} /></div>
            <div className="form-group action-group" style={{ gridColumn: 'span 2' }}><button onClick={updateGraph} className="run-btn primary-btn">Update Simulation</button></div>
          </div>
          <hr className="divider" />
          <h3>2. Upload Experimental Data</h3>
          <div className="upload-section">
            <input type="file" accept=".csv" onChange={(e) => setSelectedFile(e.target.files[0])} className="file-input"/>
            <button onClick={handleFileSubmit} className="run-btn success-btn">Plot Measured Data</button>
          </div>
        </div>

        <div className="panel visualizer" style={{ height: '620px', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 20px 5px 20px', width: '100%', boxSizing: 'border-box' }}>
            <h3 style={{ margin: 0, borderBottom: 'none' }}>Interactive Device Assembly</h3>
            <p style={{ fontSize: '0.85em', color: '#64748b', margin: '5px 0 10px 0' }}>
              Drag the dark nodes to connect wires! Gate → (+), Back Contact → (−)
            </p>
          </div>
          
          <div style={{ flex: 1, width: '100%', height: '100%', position: 'relative' }}>
            <ReactFlow 
              nodes={nodes} 
              edges={edges} 
              onNodesChange={onNodesChange} 
              onEdgesChange={onEdgesChange} 
              onConnect={onConnect} 
              nodeTypes={nodeTypes}
              fitView
              snapToGrid
              snapGrid={[10, 10]}
            >
              <Background color="#cbd5e1" gap={16} />
              <Controls />
            </ReactFlow>
          </div>
        </div>
      </div>

      <div className="panel graph-container">
        <div className="graph-header"><h3>MOSCAP Characteristics (Regions & Frequency Response)</h3></div>
        <ResponsiveContainer width="100%" height={550}>
          <ComposedChart data={mergedData} margin={{ top: 30, right: 30, left: 60, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={true} stroke="#e2e8f0" />
            <XAxis type="number" dataKey="voltage" domain={['dataMin', 'dataMax']} ticks={xTicks} label={{ value: 'Gate Voltage (V)', position: 'insideBottom', offset: -15 }} />
            <YAxis type="number" domain={[0, 'auto']} label={{ value: 'Capacitance (nF)', angle: -90, position: 'insideLeft', offset: -40 }} tickFormatter={(tick) => tick.toFixed(1)} />
            <Tooltip cursor={{ stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '4 4' }} formatter={(value, name) => value !== undefined ?[`${Number(value).toFixed(3)} nF`, name] :["-", name]} labelFormatter={(label) => `Voltage: ${Number(label).toFixed(2)} V`} contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}/>
            <Legend verticalAlign="top" height={40} iconType="circle"/>
            <ReferenceLine x={0} stroke="#cbd5e1" strokeWidth={2} />
            <ReferenceArea x1={accStart} x2={accEnd} fill="#3b82f6" fillOpacity={0.05} />
            <ReferenceArea x1={accEnd} x2={depEnd} fill="#f59e0b" fillOpacity={0.05} />
            <ReferenceArea x1={depEnd} x2={invEnd} fill="#10b981" fillOpacity={0.05} />
            <ReferenceLine x={(accStart + accEnd)/2} stroke="none" label={{ position: 'insideTop', value: isPType ? 'Accumulation' : 'Inversion', fill: '#64748b', fontWeight: 'bold' }} />
            <ReferenceLine x={(accEnd + depEnd)/2} stroke="none" label={{ position: 'insideTop', value: 'Depletion', fill: '#64748b', fontWeight: 'bold' }} />
            <ReferenceLine x={(depEnd + invEnd)/2} stroke="none" label={{ position: 'insideTop', value: isPType ? 'Inversion' : 'Accumulation', fill: '#64748b', fontWeight: 'bold' }} />
            <ReferenceLine y={c_ox_nF} stroke="#94a3b8" strokeDasharray="5 5" label={{ position: 'left', value: 'Cox', fill: '#64748b', fontWeight: 'bold' }} />
            <ReferenceLine y={c_min_nF} stroke="#94a3b8" strokeDasharray="5 5" label={{ position: 'left', value: 'Cmin', fill: '#64748b', fontWeight: 'bold' }} />
            <Line type="linear" dataKey="SimLow" name="Simulated (LF)" stroke="#10b981" strokeWidth={3} dot={{ r: 1.5, fill: '#10b981', stroke: 'none' }} isAnimationActive={true} connectNulls={true} />
            <Line type="linear" dataKey="SimHigh" name="Simulated (HF)" stroke="#3b82f6" strokeWidth={3} dot={{ r: 1.5, fill: '#3b82f6', stroke: 'none' }} isAnimationActive={true} connectNulls={true} />
            <Line type="linear" dataKey="Measured" name={selectedFile ? `Practical: ${selectedFile.name}` : "Practical Data"} stroke="#475569" strokeWidth={2.5} dot={{ r: 3.5, fill: '#000000', stroke: 'none' }} isAnimationActive={true} connectNulls={true} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {analytics && analytics?.v_shift_V !== undefined && (
        <div className="panel report-container">
          <div className="report-header-large"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg><h2>Diagnostic C-V Analysis Report</h2></div>
          <div className="report-content-centered">
            <h4 className="column-title">Extracted Device Parameters</h4>
            <div className="comparison-table">
              <div className="c-row c-header"><div className="c-cell">Parameter</div><div className="c-cell">Simulated Target</div><div className="c-cell">Experimental Data</div><div className="c-cell">Shift (Δ)</div></div>
              <div className="c-row"><div className="c-cell">Oxide Thickness (t<sub>ox</sub>)</div><div className="c-cell"><strong>{params.t_ox_nm.toFixed(2)} nm</strong></div><div className="c-cell"><strong>{t_ox_exp_nm.toFixed(2)} nm</strong></div><div className="c-cell">{(t_ox_exp_nm - params.t_ox_nm).toFixed(2)} nm</div></div>
              <div className="c-row"><div className="c-cell">Flatband Voltage (V<sub>fb</sub>)</div><div className="c-cell"><strong>{physicsParams.v_fb.toFixed(3)} V</strong></div><div className="c-cell"><strong>{v_fb_exp.toFixed(3)} V</strong></div><div className={`c-cell highlight-cell ${analytics.v_shift_V > 0 ? 'text-red' : 'text-green'}`}>{analytics.v_shift_V > 0 ? '+' : ''}{analytics.v_shift_V.toFixed(3)} V</div></div>
              <div className="c-row"><div className="c-cell">Threshold Voltage (V<sub>th</sub>)</div><div className="c-cell"><strong>{physicsParams.v_t.toFixed(3)} V</strong></div><div className="c-cell"><strong>{v_th_exp.toFixed(3)} V</strong></div><div className="c-cell">{analytics.v_shift_V > 0 ? '+' : ''}{analytics.v_shift_V.toFixed(3)} V</div></div>
            </div>
            <div className="trap-density-block"><div className="trap-row">Interface Trap Density (D<sub>it</sub>): <strong>{analytics.d_it_cm2_eV.toExponential(2)} eV⁻¹cm⁻²</strong> at the <strong>{interfaceName}</strong> interface.</div><div className="trap-row">Fixed Oxide Charge (Q<sub>ox</sub>): <strong>{analytics.n_ox_cm2.toExponential(2)} cm⁻²</strong> embedded in the <strong>{oxideFormula}</strong> layer.</div></div>
            <div className="report-interpretation">
              <h4 className="column-title">Phenomenological Interpretation</h4>
              <p className="interpretation-text">{analytics.v_shift_V > 0 ? `A positive flatband voltage shift of ${analytics.v_shift_V.toFixed(2)}V indicates a net NEGATIVE charge in the system. This is likely due to acceptor-like interface traps (D_it) or negative fixed charges trapped within the ${oxideFormula} bulk, which alters the effective work function difference between the ${materials.gate.split(' ')[0]} gate and the ${subName} substrate.` : `A negative flatband voltage shift of ${Math.abs(analytics.v_shift_V).toFixed(2)}V indicates a net POSITIVE charge in the system. This is highly characteristic of positive fixed oxide charges (e.g., trapped holes or mobile alkali ions like Na⁺/K⁺) drifting near the ${interfaceName} boundary.`}</p>
              <div style={{display: 'flex', gap: '40px', marginTop: '15px'}}><div className="data-row"><span>Equivalent Oxide Thickness (EOT):</span> &nbsp;<strong>{eot_nm.toFixed(2)} nm</strong></div><div className="data-row"><span>Capacitor Physical Area:</span> &nbsp;<strong>{params.area_cm2} cm²</strong></div></div>
              {analytics.d_it_cm2_eV > 5e10 && (<div className="warning-box"><strong>⚠️ Defect Warning:</strong> High trap density observed causing measurable C-V curve stretch-out. Consider Forming Gas Annealing (FGA) to passivate dangling bonds at the {interfaceName} interface.</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;