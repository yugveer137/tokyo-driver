# tokyo-driver1

A browser driving game: Three.js r128 + Cannon.js 0.6.2 from CDN, plain `<script>` files on
`window` globals, no build step, no modules. Hosted as static files on GitHub Pages. Tested in
Safari. The title shown to players is **tokyo-driver1**.

`index.html` is the current game (rebuilt from scratch, Oct 2026). `classic.html` is the old
single-file game kept for reference; do not develop it further.

## Run

Serve the repo root (e.g. `python3 -m http.server 8731`, also `.claude/launch.json` name
`tokyo`) and open `/` — or `/#creator` to skip the login and $1 gates while developing.

## Files (`js/`, load order as in index.html)

| File | Owns |
|---|---|
| `config.js` | constants: gravity, day/night lengths, gear table |
| `save.js` | login gate, $1 pay gate + unlock code, per-account saves (`td:<acct>:<key>`), `#creator` `#reset` `#wipe` |
| `textures.js` | procedural canvas textures (`Tex.asphalt/concrete/facade/grain/grass`), `scaleBoxUVs`, `scalePlaneUVs`, `textCanvas` |
| `sky.js` | sky dome shader, sun, stars, day/night cycle (60 s day / 60 s night), all scene lights + fog + exposure. `Sky.night` 0..1 |
| `terrain.js` | `Terrain.height(x,z)` (base hills + `Terrain.shapers`), streamed 200-unit chunks with Cannon Heightfields (collision group 2) |
| `road.js` | spline roads: `Road.define/buildRange/build`, lane offsets, `Road.at(rec,s,lateral)`, `Road.nearest`, `Road.exit`, `Road.onramp`, `Road.drapedQuad` |
| `signs.js` | exit boards, gore signs, plain signs, street blades (`Signs.facingFrom(tan)`) |
| `city.js` | city generator: draped street grid, intersections + traffic lights, blocks, buildings with window maps, lamps; `City.define/load/unload/update` |
| `cities.js` | the 10 cities (7 on I-80, 3 on the I-15 loop) + Sausalito across San Francisco's bay (`satellite`), street names, skylines, landmark builders, the bay shaper and the US-101 Golden Gate Bridge road (`shape`, `extraRoads`) |
| `traffic.js` | AI cars on lanes: following, red lights, turns at road ends, exits/merges via `Traffic.link`, kinematic boxes |
| `world.js` | the route: one elevated freeway (I-80) streamed in 400-unit chunks, cities every 2600 units with exit + collector + on-ramp + signs, `World.travelTo`, `areaAt`, `speedLimitAt` |
| `carmodels.js` | the 32 cars (`CARS`) and their body/wheel/interior builders (`CarModels`) ported from the old game |
| `audio.js` | engine, screech, wind, horns (`GameAudio`) |
| `models.js` | Kenney CC0 car models (`assets/cars/*.glb`) via GLTFLoader for the player car, traffic and parked cars; shader swaps the kit's palette paint for the car colour |
| `car.js` | player RaycastVehicle, auto/manual gears, drift, anti-flip, chase + GV60 cockpit (twin screens, HUD, digital mirrors, crystal sphere), BOOST (B), headlights, dash canvas |
| `game.js` | coins/cars state through `Save`, coin pickups |
| `features.js` | deliveries, cruise (K), rain (V), drift rewards, tires + 200 mph kinematic tow, workshops (FIX CAR), TA-DA banner |
| `peds.js` | low-poly people on city sidewalks and station platforms; `Peds.person()` is also the walking avatar |
| `walk.js` | on foot (G): walk/run, deck + stairs + platform surfaces, guide text to the nearest train stop |
| `music.js` | MUSIC button: four instrumental rap beats synthesised with WebAudio |
| `robbery.js` | ROBBERY game mode (Settings > Game mode): one level per city, glowing house markers, hold E on foot to rob, police alert via `Police.alert()`, loot kept on escape; progress in `Save` key `robbery`, mode in `mode` |
| `police.js` | a patrol car shadows you on freeways/avenues; 15+ over the limit starts a chase (siren, lights); stop = fine, 500 m clear = escape |
| `ui.js` | HUD, start menu, settings, garage, fast travel, keyboard + touch |
| `minimap.js` | heading-up minimap canvas |
| `debug.js` | `Debug.goto(road, s, lateral)`, `Debug.drive(roads, ticks, mph)` test driver |
| `main.js` | boot (`Save.boot().then(init)`), physics world, `game.tick(dt)` / `game.render()` for console tests |

`assets/` holds the only downloaded files: Kenney Car Kit models + `textures/asphalt.png`
(both CC0, see `assets/LICENSES.txt`). `Tex.loadPhotos()` runs before `init`; everything else
is procedural.

## Conventions that bite

- **Cannon perf**: `main.js` swaps in `ObjectCollisionMatrix` and a patched SAP `collisionPairs`;
  without them a step costs 170 ms once a few thousand road boxes are streamed in.
- **Draped quads bake world positions** (`Road.drapedQuad`): never scale them, pass `sizeZ`.
- **Cockpit draw order**: interior meshes have `depthTest: false`; three.js sorts by the nearest
  Group's `renderOrder` first, so every sub-group must carry 999 and meshes 999 + tier.

- **Driver's right**: `frame.right = tan x up` (negative x when heading +z). Rotations built from a
  frame must use `makeBasis(-right, up, tan)`. Lane offsets > 0 are the forward (dir +1) side.
- Roads are either **deck** roads (freeway, ramps: own box physics, skirts, piers, barriers) or
  **conform** streets (draped on the terrain, no physics; cars ride the heightfield).
- The car chassis ignores terrain collisions (`collisionFilterMask: ~2`); wheels still raycast it.
  Cannon's box-vs-heightfield contact gives phantom walls otherwise.
- The preview pane freezes `requestAnimationFrame` when hidden: test with `game.tick()` loops and
  `game.render()` from the console, never by waiting.
- Fast steering at speed is tamed by a turning-radius formula + a yaw-rate cap in `car.js`.
- Cities register terrain plateaus at define time; streets/buildings are built lazily within ~2700
  units of the player and dropped beyond ~3900.

## Also in js/

`races.js` (freeway race vs AI, city checkpoint race), `train.js` (railway + stations + drivable
train, T), `selfdrive.js` (route map M + click-to-self-drive), `multiplayer.js` (PeerJS invite
link, 20 Hz sync, `?room=`), `osm.js` (REAL MAP: Overpass streets + extruded buildings of the
current city's real downtown, built at x=60000). `features.js` also holds lane/front lock,
tires + tow truck and turn signals. Everything from classic.html is ported.
