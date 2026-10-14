# Gravity Route Planner

Interactive 3D educational solar system and route planner built with React, TypeScript, Vite, Three.js, and React Three Fiber. Route search runs in a Web Worker.

## Run

```bash
npm install
npm run dev
npm test
npm run build
```

## Current positions

The single Current Positions scene shows the Sun, eight planets, mission points, and routes in one educational coordinate system. Distances use compressed distance units (DU), with Earth at 1 DU. Each planet has its own orbit radius, inclination, node, phase, and period. Its XYZ marker position and colored orbit path use the same function; launch time and route playback advance those positions. These are invented positions rather than live ephemerides.

## Controls

The camera opens at an angle to show depth. Left drag orbits; right drag pans; scroll zooms. **Top down** resets to a Sun-centered XY view; **Angled view** restores depth. **Grid** toggles the XY reference grid; the star field remains visible. Hover over a planet for its XYZ position.

In Mission Setup, choose **Set A** or **Set B**, select **Point placement Z**, and click the scene to place a 3D point at that height. Choose a planet in **Destination**, or click a planet while setting B, to make B follow its orbit. **Reset A/B** clears both points. **Load preset** restores the example mission. Launch time changes the planets' initial positions; it does not search launch windows.

Set dry mass, propellant, exhaust speed, maximum thrust, total Δv budget, and maximum arrival relative speed, then press **Find Routes**. Compare the fastest and lowest-fuel routes found. Select a route and use Play, speed, and trajectory controls. Telemetry shows XYZ position, velocity, acceleration, propellant, and gravity contributions. The dashed 5.4 DU circle is a guide, not a routing boundary.

## Model and search

- Time is in model years (yr), velocity and Δv in DU/yr, acceleration in DU/yr², and gravitational parameters in DU³/yr². The model Sun has μ = 1.7. Planet periods follow its Kepler law at compressed radii. These are not real ephemerides.
- The probe feels inverse-square gravity from the Sun and eight moving planets in XYZ. A fixed 0.0125 yr step uses Velocity Verlet. Finite thrust and propellant use a per-step thrust cap and the ideal rocket equation.
- Swept 3D collision checks reject steps intersecting the Sun or moving planets, whose motion is approximated linearly during each short step. Arrival requires entering the 0.115 DU target sphere with relative speed below the chosen limit. A moving target contributes its 3D orbital velocity. This is rendezvous, not insertion or capture.
- A bounded beam search quantizes XYZ position, XYZ velocity, and fuel. It tries coasts and burns toward the target, along or against velocity, laterally, and out of plane. Its standard horizon is 1.7 model years and 18,000 expanded actions.
- An extended guided search tries longer flight times, cruise speeds, and planar or vertical detours using the same 3D gravity, thrust, arrival, and collision functions. Both searches enforce the chosen Δv budget and physical propellant capacity. The extended time cap depends on A–B distance and can reach 120 model years for distant fixed targets.
- Feasible candidates are filtered to a nondominated travel-time/Δv set. These finite searches cannot guarantee a globally optimal route or find every feasible one.

The simulation omits real ephemerides, launch from a planetary surface, attitude, detailed engine throttling, gravitational capture, and optimal-control refinement. Its compressed distances, circular inclined orbits, ideal rocket equation, and fixed-step thrust are teaching simplifications.
