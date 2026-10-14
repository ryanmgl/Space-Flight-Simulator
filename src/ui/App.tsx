import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, Crosshair, Eye, EyeOff, Fuel, Gauge, Grid3X3, Info, LocateFixed, Maximize2, MousePointer2, Pause, Play, RotateCcw, Route as RouteIcon, Sparkles, Timer } from 'lucide-react'
import { ARRIVAL_SPEED_LIMIT, BODIES, DEFAULT_SPACECRAFT, ORBIT_GUIDE_RADIUS, PRESET, TARGET_RADIUS, bodyPosition, formatVec, gravitationalContributions, length, makeInitialSample, maximumDeltaV } from '../physics/model'
import type { Route, RouteResult, Sample, SearchParams, Spacecraft, Vec } from '../physics/model'
import Scene3D from '../render/Scene3D'
import type { Progress } from '../search/search'

type Mode = 'pan' | 'A' | 'B'
const fmt = (n: number, digits = 2) => n.toFixed(digits)

function StatusPill({ status }: { status: string }) {
  const cls = status === 'feasible' ? 'good' : status === 'searching' ? 'searching' : status === 'collision' || status === 'out of fuel' ? 'warn' : 'muted'
  return <span className={`status-pill ${cls}`}><span className="status-dot" />{status}</span>
}

function RouteCard({ kind, route, selected, onClick, same, emptyText }: { kind: 'fastest' | 'fuel'; route: Route | null; selected: boolean; onClick: () => void; same?: boolean; emptyText: string }) {
  const isFast = kind === 'fastest'
  return <button className={`route-card ${isFast ? 'fast' : 'economy'} ${selected ? 'selected' : ''}`} onClick={onClick} disabled={!route}>
    <span className="route-card-top"><span className="route-card-title"><span className="route-swatch" />{isFast ? 'Fastest' : 'Lowest Fuel'}</span>{selected && <span className="selected-tag">SELECTED</span>}</span>
    {route ? <>
      <span className="route-metrics"><strong>{fmt(route.travelTime, 2)} <small>yr</small></strong><strong>{fmt(route.fuel, 2)} <small>Δv</small></strong></span>
      <span className="route-explain">{same ? 'Same route satisfies both objectives.' : isFast ? 'Earliest arrival found within the search limits.' : 'Smallest total burn found within the search limits.'} Arrival relative speed {fmt(route.relativeArrivalSpeed, 2)} DU/yr · propellant {fmt(route.propellantUsed, 0)} kg · thrust time {fmt(route.burns.reduce((sum, burn) => sum + burn.duration, 0), 2)} yr.</span>
    </> : <span className="route-explain">{emptyText}</span>}
  </button>
}

export default function App() {
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const lastFrame = useRef<number | null>(null)
  const [start, setStart] = useState<Vec | null>(PRESET.start)
  const [target, setTarget] = useState<Vec | null>(PRESET.target)
  const [targetBody, setTargetBody] = useState<string | null>(PRESET.targetBody ?? null)
  const [launchTime, setLaunchTime] = useState(0)
  const [budget, setBudget] = useState(PRESET.budget)
  const [spacecraft, setSpacecraft] = useState<Spacecraft>({ ...DEFAULT_SPACECRAFT })
  const [arrivalSpeedLimit, setArrivalSpeedLimit] = useState(ARRIVAL_SPEED_LIMIT)
  const [mode, setMode] = useState<Mode>('pan')
  const [resetView, setResetView] = useState(0)
  const [cameraPose, setCameraPose] = useState<'angled' | 'top'>('angled')
  const [showGrid, setShowGrid] = useState(false)
  const [placementZ, setPlacementZ] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [result, setResult] = useState<RouteResult | null>(null)
  const [selected, setSelected] = useState<'fastest' | 'fuel'>('fastest')
  const [status, setStatus] = useState('ready')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [simTime, setSimTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [visible, setVisible] = useState(true)
  const [howOpen, setHowOpen] = useState(false)

  const route = selected === 'fastest' ? result?.fastest ?? null : result?.lowestFuel ?? null
  const destination = targetBody ? bodyPosition(BODIES.find(body => body.name === targetBody)!, launchTime) : target
  const params: SearchParams = { start: start ?? PRESET.start, target: destination ?? PRESET.target, targetBody, launchTime, budget, targetRadius: TARGET_RADIUS, arrivalSpeedLimit, spacecraft }
  const physicalBudget = maximumDeltaV(spacecraft)
  const startDistance = start ? length(start) : 0
  const targetDistance = destination ? length(destination) : 0
  const beyondOrbitsPoint = startDistance > ORBIT_GUIDE_RADIUS ? 'A' : targetDistance > ORBIT_GUIDE_RADIUS ? 'B' : null
  const beyondOrbitsDistance = beyondOrbitsPoint === 'A' ? startDistance : targetDistance
  const emptyRouteText = result?.status === 'no-route' ? 'No route found within extended search limits.' : 'Run a search to see this route.'
  const currentSample: Sample = route ? route.samples[Math.min(route.samples.length - 1, Math.max(0, Math.round(simTime / .0125)))] : makeInitialSample(params.start, launchTime)
  const thrustTime = route ? route.burns.reduce((sum, burn) => sum + Math.max(0, Math.min(burn.duration, simTime - burn.t)), 0) : 0
  const contributions = useMemo(() => gravitationalContributions(currentSample.pos, launchTime + currentSample.t).sort((a, b) => length(b.acc) - length(a.acc)).slice(0, 4), [currentSample.pos.x, currentSample.pos.y, currentSample.pos.z, currentSample.t, launchTime])

  useEffect(() => {
    if (!playing || !route) return
    let raf = 0
    const tick = (now: number) => {
      if (lastFrame.current !== null) {
        const delta = Math.min(.05, (now - lastFrame.current) / 1000)
        setSimTime(t => {
          const next = Math.min(route.travelTime, t + delta * .13 * speed)
          if (next >= route.travelTime) setPlaying(false)
          return next
        })
      }
      lastFrame.current = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); lastFrame.current = null }
  }, [playing, route, speed])

  useEffect(() => () => workerRef.current?.terminate(), [])

  function invalidate() { workerRef.current?.terminate(); workerRef.current = null; requestId.current++; setResult(null); setProgress(null); setPlaying(false); setSimTime(0); setStatus('ready') }
  function findRoutes() {
    if (!start || !destination) return
    workerRef.current?.terminate()
    const id = ++requestId.current
    const worker = new Worker(new URL('../search/worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    setStatus('searching'); setProgress(null); setResult(null); setPlaying(false); setSimTime(0)
    worker.onmessage = (event: MessageEvent<{ type: string; id: number; progress?: Progress; result?: RouteResult }>) => {
      if (event.data.id !== requestId.current) return
      if (event.data.type === 'progress' && event.data.progress) setProgress(event.data.progress)
      if (event.data.type === 'result' && event.data.result) {
        const r = event.data.result
        setResult(r); setSelected('fastest')
        setStatus(r.status === 'no-route' ? 'no route found' : r.status === 'out-of-fuel' ? 'out of fuel' : r.status)
        worker.terminate(); workerRef.current = null
      }
    }
    worker.onerror = () => { if (id === requestId.current) { setStatus('search error'); worker.terminate(); workerRef.current = null } }
    worker.postMessage({ id, params: { start, target: destination, targetBody, launchTime, budget, targetRadius: TARGET_RADIUS, arrivalSpeedLimit, spacecraft } })
  }
  function preset() { invalidate(); setStart(PRESET.start); setTarget(PRESET.target); setTargetBody(PRESET.targetBody ?? null); setLaunchTime(0); setBudget(PRESET.budget); setSpacecraft({ ...DEFAULT_SPACECRAFT }); setArrivalSpeedLimit(ARRIVAL_SPEED_LIMIT); setCameraPose('angled'); setResetView(n => n + 1); setMode('pan') }
  function clearPoints() { invalidate(); setStart(null); setTarget(null); setTargetBody(null); setMode('A') }
  function changeSpacecraft(key: keyof Spacecraft, value: number) {
    if (!Number.isFinite(value)) return
    invalidate()
    const next = { ...spacecraft, [key]: Math.max(key === 'exhaustVelocity' ? .5 : 100, value) }
    setSpacecraft(next)
    setBudget(current => Math.min(current, maximumDeltaV(next)))
  }
  function selectRoute(which: 'fastest' | 'fuel') { if (!result) return; setSelected(which); setPlaying(false); setSimTime(0) }
  function placePoint(point: Vec) {
    invalidate()
    if (mode === 'A') { setStart(point); setMode('B') } else { setTarget(point); setTargetBody(null); setMode('pan') }
  }
  const same = !!result?.fastest && result.fastest === result.lowestFuel

  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark"><span className="brand-orbit" /><span className="brand-core" /></div><div className="brand-copy"><strong>GRAVITY<span>ROUTE</span></strong><small>MISSION DESIGN STUDIO</small></div><span className="top-divider" /><span className="top-caption">Multiobjective Pathfinding for Spacecraft Trajectories</span><div className="top-right"><span className="model-chip"><span /> EDUCATIONAL MODEL</span><span className="version">v0.1 MVP</span></div></header>
    <div className="main-grid">
      <aside className="sidebar">
        <div className="sidebar-scroll">
          <section className="side-section intro"><div className="eyebrow">MISSION CONTROL <span>01 / 04</span></div><h1>Plan your<br /><em>trajectory.</em></h1><p>Place a probe, choose a target, and compare simulated routes through a three-dimensional solar system.</p></section>
          <section className="side-section mission"><div className="section-heading"><span>MISSION SETUP</span><Crosshair size={15} /></div>
            <div className="coord-row"><div className="coord-icon a">A</div><div><small>START POSITION</small><strong>{start ? `${formatVec(start)} DU` : 'Choose Set A below'}</strong></div></div>
            <div className="coord-row"><div className="coord-icon b">B</div><div><small>{targetBody ? `${targetBody.toUpperCase()} · MOVING TARGET` : 'FIXED TARGET ZONE'}</small><strong>{destination ? `${formatVec(destination)} DU at launch` : 'Choose Set B below'}</strong></div></div>
            <div className="point-controls" aria-label="Point selection"><button className={mode === 'A' ? 'active' : ''} aria-pressed={mode === 'A'} onClick={() => setMode(mode === 'A' ? 'pan' : 'A')}><MousePointer2 size={15} /> Set A</button><button className={mode === 'B' ? 'active' : ''} aria-pressed={mode === 'B'} onClick={() => setMode(mode === 'B' ? 'pan' : 'B')}><LocateFixed size={15} /> Set B</button></div>
            <div className="preset-row"><button onClick={preset}><Sparkles size={14} /> Load preset</button><button onClick={clearPoints}><RotateCcw size={14} /> Reset A/B</button></div>
            <div className="form-row"><label htmlFor="destination">Destination</label><select id="destination" value={targetBody ?? ''} onChange={e => { invalidate(); setTargetBody(e.target.value || null); setMode('pan') }}><option value="">Fixed point B</option>{BODIES.map(body => <option key={body.name} value={body.name}>{body.name} · moving planet</option>)}</select><small className="field-help">A planet target follows its orbit; clicking Set B switches back to a fixed point.</small></div>
            <div className="form-row"><label htmlFor="launch">Launch time <span>{fmt(launchTime, 2)} yr</span></label><input id="launch" type="range" min="0" max="2" step="0.05" value={launchTime} onChange={e => { invalidate(); setLaunchTime(Number(e.target.value)) }} /></div>
            <div className="form-row"><label htmlFor="placement-z">Point placement Z <span>{fmt(placementZ, 2)} DU</span></label><input id="placement-z" type="range" min="-2" max="2" step="0.05" value={placementZ} onChange={e => setPlacementZ(Number(e.target.value))} /><small className="field-help">Set A and fixed B on this 3D height plane. Click a planet while setting B to choose a moving target.</small></div>
            <div className="form-row"><label htmlFor="budget">Δv budget <span>{fmt(budget, 2)} DU/yr</span></label><input id="budget" type="range" min="0" max={Math.max(.05, physicalBudget)} step="0.05" value={budget} onChange={e => { invalidate(); setBudget(Number(e.target.value)) }} /></div>
            <div className="form-row"><label htmlFor="arrival-speed">Maximum arrival speed <span>{fmt(arrivalSpeedLimit, 2)} DU/yr</span></label><input id="arrival-speed" type="range" min="0.1" max="2" step="0.05" value={arrivalSpeedLimit} onChange={e => { invalidate(); setArrivalSpeedLimit(Number(e.target.value)) }} /><small className="field-help">Relative to the destination; the probe must brake before arrival.</small></div>
            <div className="search-limits">Standard horizon: 1.7 yr <span>·</span> Dashed orbit guide: {fmt(ORBIT_GUIDE_RADIUS, 1)} DU. Extended search may use more time, within the selected Δv budget.</div>
            {beyondOrbitsPoint && <div className="mission-warning" role="status"><strong>Point {beyondOrbitsPoint} is beyond the outer orbits.</strong><span>It is {fmt(beyondOrbitsDistance, 2)} DU from the Sun. Extended search can still try this destination and will report the required time and Δv.</span></div>}
            <button className="find-button" onClick={findRoutes} disabled={!start || !destination || status === 'searching'}><RouteIcon size={17} /> {status === 'searching' ? 'SEARCHING ROUTES…' : 'FIND ROUTES'} <ArrowUpRight size={17} /></button>
            {status === 'searching' && <div className="progress"><div><span>{progress?.phase === 'extended' ? 'Extending time and Δv' : 'Exploring state space'}</span><strong>{progress ? `${Math.round(progress.layer / progress.total * 100)}%` : 'Starting'}</strong></div><div className="progress-track"><span style={{ width: `${progress ? progress.layer / progress.total * 100 : 3}%` }} /></div><small>{progress ? `${progress.expanded.toLocaleString()} actions · ${progress.candidates} arrivals` : 'Initializing worker…'}</small></div>}
          </section>
          <section className="side-section spacecraft"><div className="section-heading"><span>SPACECRAFT SPECS</span><span className="mini-number">02 / 04</span></div>
            <p className="spec-intro">Finite thrust and the rocket equation limit every planned burn. Mass and thrust use educational model units.</p>
            <div className="spec-grid">
              <label>Dry mass <input aria-label="Dry mass in kilograms" type="number" min="100" step="100" value={spacecraft.dryMass} onChange={e => changeSpacecraft('dryMass', Number(e.target.value))} /><span>kg</span></label>
              <label>Propellant <input aria-label="Propellant mass in kilograms" type="number" min="100" step="100" value={spacecraft.propellantMass} onChange={e => changeSpacecraft('propellantMass', Number(e.target.value))} /><span>kg</span></label>
              <label>Exhaust speed <input aria-label="Exhaust speed in distance units per model year" type="number" min="1" step="0.5" value={spacecraft.exhaustVelocity} onChange={e => changeSpacecraft('exhaustVelocity', Number(e.target.value))} /><span>DU/yr</span></label>
              <label>Maximum thrust <input aria-label="Maximum thrust in model units" type="number" min="100" step="1000" value={spacecraft.maxThrust} onChange={e => changeSpacecraft('maxThrust', Number(e.target.value))} /><span>kg·DU/yr²</span></label>
            </div>
            <p className="spec-capacity">Physical Δv capacity: <strong>{fmt(physicalBudget, 2)} DU/yr</strong> · Selected limit: <strong>{fmt(budget, 2)}</strong></p>
          </section>
          <section className="side-section routes"><div className="section-heading"><span>ROUTE COMPARISON</span><span className="mini-number">03 / 04</span></div><div className="route-cards"><RouteCard kind="fastest" route={result?.fastest ?? null} selected={selected === 'fastest' && !!result?.fastest} onClick={() => selectRoute('fastest')} emptyText={emptyRouteText} />{!same && <RouteCard kind="fuel" route={result?.lowestFuel ?? null} selected={selected === 'fuel' && !!result?.lowestFuel} onClick={() => selectRoute('fuel')} emptyText={emptyRouteText} />}</div>{same && <p className="same-note">Fastest is also the lowest fuel route found.</p>}{result?.extended && result.lowestFuel && <p className="extended-note">Extended search used a longer horizon and tried guided speed and detour variants. Every displayed route stays within the selected Δv budget and propellant capacity.</p>}{status === 'no route found' || status === 'out of fuel' || status === 'collision' ? <p className="no-route">{status === 'collision' ? 'The probe starts inside a celestial body. Move point A.' : `No collision-free arrival below ${fmt(arrivalSpeedLimit, 2)} DU/yr was found within ${fmt(result?.searchTimeLimit ?? 1.7, 1)} model years and the selected fuel limits.`}</p> : null}<div className="tradeoff"><Info size={15} /><span>Faster routes often need more Δv. Fuel saving routes can take longer.</span></div></section>
          <section className="side-section telemetry"><div className="section-heading"><span>FLIGHT TELEMETRY</span><span className="mini-number">04 / 04</span></div><div className="telemetry-status"><span>ROUTE STATUS</span><StatusPill status={status} /></div><div className="telemetry-grid"><div><small>FLIGHT TIME</small><strong>{fmt(currentSample.t, 2)} <span>yr</span></strong></div><div><small>Δv USED</small><strong>{fmt(currentSample.fuel, 2)} <span>DU/yr</span></strong></div><div><small>POSITION</small><strong>{formatVec(currentSample.pos)}</strong></div><div><small>VELOCITY</small><strong>{formatVec(currentSample.vel)}</strong></div><div><small>PROPELLANT USED</small><strong>{fmt(currentSample.propellantUsed, 0)} <span>kg</span></strong></div><div><small>THRUST TIME</small><strong>{fmt(thrustTime, 2)} <span>yr</span></strong></div><div><small>GRAVITY ACCELERATION</small><strong>{formatVec(currentSample.acc)}</strong></div><div><small>ARRIVAL RELATIVE SPEED</small><strong>{route ? fmt(route.relativeArrivalSpeed, 2) : '—'} <span>DU/yr</span></strong></div></div><div className="nearby"><small>GRAVITY CONTRIBUTIONS · DU/YR²</small>{contributions.map(c => <div key={c.name}><span>{c.name}</span><strong>{length(c.acc).toExponential(2)}</strong></div>)}</div><div className="budget-bar"><span>Selected Δv budget</span><strong>{fmt(currentSample.fuel, 2)} / {fmt(budget, 2)}</strong><div><span style={{ width: `${Math.min(100, budget ? currentSample.fuel / budget * 100 : 0)}%` }} /></div></div></section>
          <section className="how"><button onClick={() => setHowOpen(v => !v)}><span><Info size={15} /> How routing works</span><ChevronDown size={16} className={howOpen ? 'up' : ''} /></button>{howOpen && <p>A worker explores finite-thrust burns and coasts with moving planets. Planet B follows its orbit. Arrival requires entering B’s ring with relative speed below the selected limit, including braking before arrival. Propellant follows the rocket equation and every route respects the selected Δv budget. The extended search tries more time and guided detours. Routes are the best candidates found, not proven global optima.</p>}</section>
        </div>
      </aside>
      <main className="workspace"><div className="canvas-toolbar"><div className="toolbar-left"><span className="live-dot" /> CURRENT POSITIONS <span className="toolbar-divider" /><span className="coordinate-system">3D · EDUCATIONAL DU</span></div><div className="toolbar-right"><button className={showGrid ? 'tool-active' : ''} aria-pressed={showGrid} onClick={() => setShowGrid(value => !value)} title="Toggle XY grid"><Grid3X3 size={15} /> Grid</button><button onClick={() => { setCameraPose('top'); setResetView(n => n + 1) }} title="Top down view"><Maximize2 size={15} /> Top down</button><button onClick={() => { setCameraPose('angled'); setResetView(n => n + 1) }} title="Angled view">Angled view</button></div></div>
        <div className="canvas-wrap"><Scene3D launchTime={launchTime} simTime={simTime} start={start} target={destination} targetBody={targetBody} route={route} fastest={result?.fastest ?? null} lowestFuel={result?.lowestFuel ?? null} visible={visible} showGrid={showGrid} mode={mode} placementZ={placementZ} resetView={resetView} cameraPose={cameraPose} onPlace={placePoint} onBodyTarget={name => { invalidate(); setTargetBody(name); setMode('pan') }} onHover={setHover} /><div className="canvas-top-left"><div className="scene-label"><span>SIMULATED POSITIONS</span><strong>Current solar system</strong><small>Drag to orbit · Right drag to pan · Scroll to zoom · Select A or B in Mission Setup</small></div></div>{hover && <div className="planet-hover"><strong>{hover}</strong><small>{BODIES.find(b => b.name === hover) ? `${formatVec(bodyPosition(BODIES.find(b => b.name === hover)!, launchTime + simTime), 2)} DU` : ''}</small></div>}<div className="canvas-scale"><span>—</span> INCLINED ORBITS · EDUCATIONAL MODEL</div></div>
        <div className="playback-bar"><div className="playback-left"><button className="play-button" onClick={() => { if (route) { if (simTime >= route.travelTime) setSimTime(0); setPlaying(v => !v) } }} disabled={!route} title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button className="icon-button" onClick={() => { setPlaying(false); setSimTime(0) }} title="Reset animation"><RotateCcw size={16} /></button><span className="playback-time">T+ {fmt(simTime, 2)} <small>YR</small></span><div className="timeline"><span style={{ width: `${route ? simTime / route.travelTime * 100 : 0}%` }} /></div><span className="duration">{route ? fmt(route.travelTime, 2) : '0.00'} YR</span></div><div className="playback-right"><label><Gauge size={15} /> Speed <select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><button className={visible ? 'active-toggle' : ''} onClick={() => setVisible(v => !v)} title="Toggle trajectory">{visible ? <Eye size={16} /> : <EyeOff size={16} />} Trajectories</button></div></div>
        <div className="bottom-strip"><div><Timer size={14} /><span>Fixed step: 0.0125 yr</span></div><div><Fuel size={14} /><span>Finite thrust + propellant</span></div><div><ArrowDownRight size={14} /><span>Arrival = radius + relative speed</span></div><span className="strip-right">SIMULATED, NOT MISSION GRADE</span></div>
      </main>
    </div>
  </div>
}
