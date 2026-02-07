# Tokyo Night Driver

A single-file 3D driving game built with Three.js (r128) and Cannon.js (0.6.2). Everything lives in `index.html` (~4400 lines).

## Architecture

- **Single HTML file** — all CSS, HTML, and JS inline. No build system, no modules.
- **Three.js** for rendering (CDN r128)
- **Cannon.js** for physics (CDN 0.6.2, `RaycastVehicle` for car physics)
- **Web Audio API** for procedural engine sounds (3 oscillators + distortion + filter)
- **localStorage** for persistence (coins, owned cars, selected car)

## Game Structure

### World Layout (Z-axis is north)
```
Tokyo City (grid) → Freeway I-80 → San Francisco → Sacramento → Truckee
                                     ↘ Exit ramp → Connecting road → Golden Gate Bridge
```
Portal system teleports to themed cities: New York, London, Paris.

### Key Globals
- `scene, camera, renderer` — Three.js basics
- `world` — Cannon.js physics world
- `carBody, vehicle` — Player physics (RaycastVehicle)
- `car, carGroup` — Player visual mesh
- `carWheelMeshes, wheelBodies` — Wheel visuals + physics (separate from carGroup!)
- `gameState` — coins, ownedCars, selectedCar, gameStarted, wanted state
- `freewayData` — freeway geometry positions (rampX, sfStartZ, totalEndZ, etc.)
- `keys` — keyboard input state

### Car System (`cars` object, ~line 553)
Each car has: `name, price, maxSpeed, acceleration, handling, color, bodyColor`
Optional flags: `isElectric`, `isTruck`, `isDrift`, `heavyCar`

| Car | Price | Notes |
|-----|-------|-------|
| Starter | 0 | Default car |
| Sport GT | 150 | |
| Muscle King | 150 | |
| Supercar | 150 | |
| Hyperion | 150 | |
| Legend X | 150 | |
| Tokyo EV | 150 | `isElectric: true` |
| Trailer Truck | 150 | `isTruck: true` — custom truck model, heavy physics, 60mph cap |
| Supra MK4 | 150 | `isDrift: true, heavyCar: true` — low rear friction for drifting |
| Ferrari SF90 | 50 | `heavyCar: true` — 1000mph max |
| McLaren P1 | 50 | `heavyCar: true` — 1000mph max |

### Physics Flags in `createCar()` (~line 3507)
- `isTruck` — larger chassis (1.3x0.7x4.5), mass 250, custom visual model with cab+trailer
- `isDrift` — front wheels frictionSlip=4, rear=1.2 (oversteer/drift)
- `heavyCar` — mass 400, angular damping 0.95, roll influence 0.001, stiffer suspension
- Speed cap: engine force cuts off at `carData.maxSpeed` for all cars

### Important Patterns

**Car switching (`selectCar`, ~line 4333):** Must clean up:
1. `scene.remove(car)` — car body group
2. `carWheelMeshes.forEach(w => scene.remove(w))` — wheel meshes (added to scene, NOT carGroup)
3. `vehicle.removeFromWorld(world)` — RaycastVehicle
4. `world.removeBody(carBody)` — chassis physics
5. `wheelBodies.forEach(wb => world.removeBody(wb))` — wheel physics

**Freeway barrier gaps:** SF freeway is split into 2 segments (before/after z 700-900) with right-side barrier removed to allow exit ramp to Golden Gate Bridge.

**Golden Gate Bridge:** At `(freewayX + 180, y=15, sfStartZ + 1200)`. South ramp is 150 units long, reaches ground level. Connected to freeway exit via diagonal road.

### Key Function Map

| Function | Line | Purpose |
|----------|------|---------|
| `init()` | 736 | Setup scene, physics, city, freeway, cars |
| `createCar()` | 3507 | Build car visual + physics (handles truck/drift/heavy) |
| `updateCar()` | 3937 | Physics controls, speed cap, camera follow |
| `createFreeway()` | 1042 | I-80 freeway from city to SF |
| `createSanFrancisco()` | 1340 | SF section with exit gap + bridge road |
| `createGoldenGateBridge()` | 2314 | Bridge with ground-reaching ramps |
| `selectCar()` | 4333 | Switch car (cleans up old meshes + physics) |
| `renderShop()` | 4278 | Garage UI |
| `initEngineSound()` | 4387 | Web Audio engine sound setup |
| `updateEngineSound()` | 4441 | Pitch/volume tied to speed + throttle |
| `animate()` | 4248 | Main game loop |

### UI Elements
- `#shop-btn` — GARAGE button (top: 340px, right: 20px — below mini-map)
- `#mini-map` — Map display (top: 20px, right: 20px, 200x300px)
- `#shop-modal` — Car purchase/select modal
- `#hud` — Speed, speed limit, area, wanted status
- `#controls-hint` — Keyboard controls display

## Common Pitfalls
- Wheel meshes are scene children, NOT carGroup children — must remove separately
- Freeway barriers are created inside `createFreewaySegment` — to add gaps, split into multiple segments
- Bridge ramps need to be long enough (150 units) to span ground (y=0) to deck (y=15) at 0.1 rad pitch
- Cars with extreme acceleration flip over — use `heavyCar` flag (mass 400, low roll influence)
- `maxSpeed` is enforced by cutting engine force in `updateCar()`, not by clamping velocity
- Audio requires user gesture — initialized on START button click
