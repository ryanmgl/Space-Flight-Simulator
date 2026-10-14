import { Canvas, ThreeEvent, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { BODIES, ORBIT_GUIDE_RADIUS, SUN_RADIUS, bodyDisplayRadius, bodyPosition } from '../physics/model'
import type { Route, Sample, Vec } from '../physics/model'

type Props = {
  launchTime: number; simTime: number
  start: Vec | null; target: Vec | null; targetBody: string | null; route: Route | null
  fastest: Route | null; lowestFuel: Route | null; visible: boolean; showGrid: boolean
  mode: 'pan' | 'A' | 'B'; placementZ: number; resetView: number; cameraPose: 'angled' | 'top'
  onPlace: (point: Vec) => void; onBodyTarget: (name: string) => void; onHover: (name: string | null) => void
}
const xyz = (v: Vec): [number, number, number] => [v.x, v.y, v.z]
function ring(radius: number, z = 0): [number, number, number][] {
  return Array.from({ length: 129 }, (_, i) => [radius * Math.cos(i * 2 * Math.PI / 128), radius * Math.sin(i * 2 * Math.PI / 128), z])
}
function CameraControls({ resetView, cameraPose }: { resetView: number; cameraPose: Props['cameraPose'] }) {
  const { camera } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  useEffect(() => {
    const distance = 14
    camera.up.set(0, 0, 1)
    camera.position.set(cameraPose === 'top' ? 0 : distance * .46, cameraPose === 'top' ? 0 : -distance * .5, cameraPose === 'top' ? distance : distance * .85)
    controls.current?.target.set(0, 0, 0)
    camera.lookAt(0, 0, 0)
    controls.current?.update()
  }, [camera, resetView, cameraPose])
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={.12} maxDistance={50} mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }} />
}
function starHash(value: number): number {
  const n = Math.sin(value * 78.233 + 12.34) * 43758.5453
  return n - Math.floor(n)
}
function Starfield() {
  const layers = useMemo(() => [
    { count: 2400, size: 1, opacity: .34 },
    { count: 500, size: 1.7, opacity: .52 },
    { count: 80, size: 2.4, opacity: .7 },
  ].map((layer, index) => {
    const positions: number[] = []
    for (let i = 0; i < layer.count; i++) {
      const seed = i + index * 10000
      const z = starHash(seed * 3 + 1) * 2 - 1
      const angle = starHash(seed * 3 + 2) * Math.PI * 2
      const radius = 450 + 30 * starHash(seed * 3 + 3)
      const radial = Math.sqrt(1 - z * z) * radius
      positions.push(radial * Math.cos(angle), radial * Math.sin(angle), radius * z)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return { ...layer, geometry }
  }), [])
  useEffect(() => () => layers.forEach(layer => layer.geometry.dispose()), [layers])
  return <>{layers.map((layer, index) => <points key={index} geometry={layer.geometry} frustumCulled={false}>
    <pointsMaterial color="#c6dded" size={layer.size} sizeAttenuation={false} transparent opacity={layer.opacity} depthWrite={false} />
  </points>)}</>
}
function BodyMarker({ name, point, color, radius, onHover, onClick }: { name: string; point: Vec; color: string; radius: number; onHover: Props['onHover']; onClick?: () => void }) {
  return <group position={xyz(point)}>
    <mesh userData={{ bodyName: name }} onPointerOver={e => { e.stopPropagation(); onHover(name) }} onPointerOut={() => onHover(null)} onClick={e => { e.stopPropagation(); onClick?.() }}>
      <sphereGeometry args={[radius, 24, 16]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.22} roughness={.85} />
    </mesh>
    <mesh userData={{ bodyName: name }} onPointerOver={e => { e.stopPropagation(); onHover(name) }} onPointerOut={() => onHover(null)} onClick={e => { e.stopPropagation(); onClick?.() }}>
      <sphereGeometry args={[Math.max(radius * 2.3, .12), 10, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <Html position={[radius + .06, radius + .06, radius + .06]} center={false} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', color: '#d8e8f3', font: '11px Inter, system-ui', textShadow: '0 1px 4px #00131d' }}>{name}</Html>
  </group>
}
function Path({ route, color, opacity, width = 2 }: { route: Route; color: string; opacity: number; width?: number }) {
  const points = useMemo(() => {
    const stride = Math.max(1, Math.ceil(route.samples.length / 1500))
    const samples = route.samples.filter((_, i) => i % stride === 0)
    if (samples.at(-1) !== route.samples.at(-1)) samples.push(route.samples.at(-1)!)
    return samples.map(s => xyz(s.pos))
  }, [route])
  return points.length > 1 ? <Line points={points} color={color} transparent opacity={opacity} lineWidth={width} /> : null
}
function SceneContent(props: Props) {
  const current: Sample | null = props.route?.samples[Math.min(props.route.samples.length - 1, Math.max(0, Math.round(props.simTime / .0125)))] ?? null
  const planetTime = props.launchTime + props.simTime
  const movingTarget = BODIES.find(body => body.name === props.targetBody)
  const targetPoint = movingTarget ? bodyPosition(movingTarget, planetTime) : props.target
  const arrivalPoint = movingTarget && props.route ? bodyPosition(movingTarget, props.launchTime + props.route.travelTime) : null
  const clickPlane = (event: ThreeEvent<MouseEvent>) => {
    if (props.mode === 'pan') return
    if (event.delta > 5) return
    event.stopPropagation()
    const planet = event.intersections.find(hit => typeof hit.object.userData.bodyName === 'string')?.object.userData.bodyName as string | undefined
    if (props.mode === 'B' && BODIES.some(body => body.name === planet)) { props.onBodyTarget(planet!); return }
    props.onPlace({ x: event.point.x, y: event.point.y, z: props.placementZ })
  }
  return <>
    <color attach="background" args={['#06131e']} />
    <ambientLight intensity={1.35} />
    <pointLight position={[0, 0, 0]} intensity={65} decay={2} color="#ffd2a0" />
    <CameraControls resetView={props.resetView} cameraPose={props.cameraPose} />
    <Starfield />
    {props.showGrid && <gridHelper args={[12, 48, '#1c465c', '#173147']} rotation={[Math.PI / 2, 0, 0]} />}
    {BODIES.map(body => <Line key={body.name} points={Array.from({ length: 129 }, (_, i) => xyz(bodyPosition(body, body.period * i / 128)))} color={body.color} transparent opacity={.65} lineWidth={1.35} />)}
    <Line points={ring(ORBIT_GUIDE_RADIUS)} color="#946f4b" transparent opacity={.38} lineWidth={1} dashed dashSize={.05} gapSize={.06} />
    <BodyMarker name="Sun" point={{ x: 0, y: 0, z: 0 }} color="#ffd391" radius={SUN_RADIUS} onHover={props.onHover} />
    {BODIES.map(body => <BodyMarker key={body.name} name={body.name} point={bodyPosition(body, planetTime)} color={body.color} radius={bodyDisplayRadius(body)} onHover={props.onHover} onClick={() => { if (props.mode === 'B') props.onBodyTarget(body.name) }} />)}
      <mesh position={[0, 0, props.placementZ]} onClick={clickPlane} visible={props.mode !== 'pan'}>
        <planeGeometry args={[200, 200]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {props.mode !== 'pan' && <Line points={ring(ORBIT_GUIDE_RADIUS, props.placementZ)} color="#5b9cb7" transparent opacity={.45} dashed dashSize={.08} gapSize={.06} />}
      {props.visible && props.fastest && <Path route={props.fastest} color="#f5b45f" opacity={props.route === props.fastest ? 1 : .42} width={props.route === props.fastest ? 3 : 2} />}
      {props.visible && props.lowestFuel && props.lowestFuel !== props.fastest && <Path route={props.lowestFuel} color="#5fd8cc" opacity={props.route === props.lowestFuel ? 1 : .42} width={props.route === props.lowestFuel ? 3 : 2} />}
      {props.visible && props.route && props.route.burns.filter((burn, i) => i === 0 || burn.t - props.route!.burns[i - 1].t > .12).map((burn, i) => <mesh key={`${burn.t}:${i}`} position={xyz(burn.pos)}><sphereGeometry args={[.025, 12, 8]} /><meshBasicMaterial color="#ffe0a0" /></mesh>)}
      {props.start && <BodyMarker name="A" point={props.start} color="#f5b45f" radius={.045} onHover={props.onHover} />}
      {targetPoint && <BodyMarker name="B" point={targetPoint} color="#5fd8cc" radius={.045} onHover={props.onHover} />}
      {targetPoint && <mesh position={xyz(targetPoint)}><sphereGeometry args={[.115, 16, 12]} /><meshBasicMaterial color="#5fd8cc" wireframe transparent opacity={.28} depthWrite={false} /></mesh>}
      {arrivalPoint && <mesh position={xyz(arrivalPoint)}><sphereGeometry args={[.115, 16, 12]} /><meshBasicMaterial color="#5fd8cc" wireframe transparent opacity={.12} depthWrite={false} /></mesh>}
      {current && <BodyMarker name="Probe" point={current.pos} color="#ffffff" radius={.04} onHover={props.onHover} />}
  </>
}
export default function Scene3D(props: Props) {
  return <Canvas camera={{ position: [0, 0, 14], fov: 45, near: .001, far: 1000, up: [0, 0, 1] }} gl={{ antialias: true }}>
    <SceneContent {...props} />
  </Canvas>
}
