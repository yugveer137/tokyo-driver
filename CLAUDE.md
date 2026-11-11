# tokyo-driver1

A browser driving game: Three.js r128 + Cannon.js 0.6.2 from CDN, plain `<script>` files on
`window` globals, no build step, no modules. Hosted as static files on GitHub Pages. Tested in
Safari. The title shown to players is **Bay Area Driver** (`CFG.TITLE`, index.html, the login and money screens in save.js); the repo and files keep the tokyo-driver1 name.

`index.html` is the current game (rebuilt from scratch, Oct 2026). `classic.html` is the old
single-file game kept for reference; do not develop it further.

## Run

Serve the repo root (e.g. `python3 -m http.server 8731`, also `.claude/launch.json` name
`tokyo`) and open `/` — or `/#creator` to skip the login and $1 gates while developing.

## Files (`js/`, load order as in index.html)

| File | Owns |
|---|---|
| `config.js` | constants: gravity, day/night lengths, gear table |
| `save.js` | login gate, the money screen (PAY $1 opens the plans: $1 a week / $10 a month / $100 a year, each an email draft to the owner; a 7-day free trial, and under the ▾ a 3-day one, one trial per account via `trialUntil`/`trialUsed`, both buttons greyed once used), unlock code, per-account saves (`td:<acct>:<key>`), `#creator` (localhost only), `#play=<base64url JSON {t:'creator',p:password} or {e,c}, s:{save keys}>` (a QR/link made on the owner's Mac: checks the password hash, signs in, writes the save, and remembers the login on that device in `td_remember`, cleared by `#reset` and SIGN OUT), `#reset` `#wipe`; a player `#play` token must carry a real email that is not 'creator'/'guest' and not another account on the device with a different code, and never writes `paid2`/`trialUntil`/`trialUsed`; a remembered login that is not paid is dropped at boot; URL switches keep `?room=` |
| `textures.js` | procedural canvas textures (`Tex.asphalt/concrete/facade/grain/grass`), `scaleBoxUVs`, `scalePlaneUVs`, `textCanvas` |
| `sky.js` | sky dome shader, sun, stars, day/night cycle (60 s day / 60 s night), all scene lights + fog + exposure, and `scene.environment`: static day and night environment maps swapped at dusk (a live PMREM of the dome was rebuilt every 6 s and then overwritten by that swap, so it was dropped). `Sky.night` 0..1 |
| `terrain.js` | `Terrain.height(x,z)` (base hills + `Terrain.shapers`), streamed 200-unit chunks with Cannon Heightfields (collision group 2) |
| `road.js` | spline roads: `Road.define/buildRange/build`, lane offsets, `Road.at(rec,s,lateral)`, `Road.nearest`, `Road.exit`, `Road.onramp`, `Road.drapedQuad`; the surface strip has a matching bump strip (asphalt grain in relief, paint flat) |
| `signs.js` | exit boards, gore signs, plain signs, street blades (`Signs.facingFrom(tan)`) |
| `city.js` | city generator: draped street grid, intersections + traffic lights, blocks, buildings with window maps, lamps, suburb blocks of small houses (`City.housePlan` gives a house's door + address without loading; `City.houseInterior` builds a room with a sleeper and the loot dresser on entry); `City.define/load/unload/update` |
| `cities.js` | the 7 Bay Area cities (`side` picks the freeway side, `fw: 1` = I-880, `bridge` = the bay crossing to build, `suburb` = columns of small houses on the far side of downtown) + 10 towns between them (`town: true`, two per gap at 3800 and 6000 past a city (3800 keeps the first town's far ramps clear of a bridge interchange), a short exit/on-ramp on their own side plus the far-side pair, no station, no U-turn loops) + Sausalito across the Golden Gate (`satellite`), street names, skylines, landmark builders, the Golden Gate bay shaper and bridge road (`shape`, `extraRoads`) |
| `traffic.js` | AI cars on lanes: following, red lights, turns at road ends, exits/merges via `Traffic.link`, kinematic boxes |
| `world.js` | the Bay Area: US-101 down the peninsula (SF, San Mateo, Palo Alto, San Jose on its west, 8400 apart) and I-880 up the east bay (Oakland, Hayward, Fremont on its east, merging into 101 before San Jose), two towns in every gap (3800 and 6000 past each city); only the freeway within 1600 m streams, so the far shore stays unbuilt until halfway across a bridge, the bay between them (terrain shaper + water sheet), three bridges built with their peninsula city (`loadBridge`: Bay Bridge with towers/cables, San Mateo, Dumbarton; `bridgeHolds` keeps that city loaded while the player is anywhere on the bridge or within 2600 m of it along the bay, else past mid-bay the city and its bridge unloaded from under the car; each bridge has barrier gaps 160..370 m in from both ends for its ground-level ramps, which meet their freeway-side partners between the freeway and the bridge end (x −150 west, xE − 50 east) so no ramp starts past its own climb and doubles back; each ground ramp turns back under its freeway in a half circle (`uTurn`: 46 m radius, the drop from or climb to the viaduct spread along the bend) and meets the bridge's ground road in a 50 m arc, since one sharp corner put cars into the wall; the Dumbarton's I-880 side is still broken: 880 is already curving west there and runs almost alongside the bridge end), freeway chunks streamed in 400-unit chunks, cities with exit + collector + on-ramp + signs + workshop + station road + far-side ramps, a forward U-turn loop 1300 past each city (past its own exit at 1200, short of the bridge ramps), `World.travelTo`, `areaAt`, `speedLimitAt` |
| `carmodels.js` | the 32 cars (`CARS`) and their body/wheel/interior builders (`CarModels`) ported from the old game, plus the Robber's Car (`robber`, a 9.6 m black lorry on the `truck` model, `robberyOnly`: the garage card is locked outside ROBBERY mode and switching the mode off puts you back in the Starter) |
| `audio.js` | engine, screech, wind, horns (`GameAudio`) |
| `models.js` | Kenney CC0 car models (`assets/cars/*.glb`) via GLTFLoader for the player car, traffic and parked cars; each model's paint panels are flagged per vertex once (`markPaint`: hue clusters of the palette swatches under the body's UVs, lights are too small to count) and the shader repaints them in the car colour carried in `material.color`, shading against the main swatch in `material.emissive` (custom uniforms set in `onBeforeCompile` never reach a second material once the program is shared, so built-in slots carry the paint); `wheels: true` adds plain wheels for cars that are not RaycastVehicles (traffic, police, parked, the robber friends); glossy paint (metalness 0.5, roughness 0.3) reflecting `scene.environment`; the shell is measured over its visible parts (the kit's own wheels are hidden) and sits 30 cm over the wheel contact line passed as `lift` (traffic and parked cars use the same builder); until the glb arrives (or if it never does) a plain box body in the car colour stands in, so a car is never just wheels; paint swatches are picked by chroma ((max−min)/max, HSL saturation counted pale window glass), the key colour is rebuilt from `userData` after `clone()` (which turns a Color into a hex number), and `opts.width` keeps the shell within the chassis width (a lorry scaled to its length came out twice as wide) |
| `car.js` | player RaycastVehicle, auto/manual gears, drift, anti-flip, chase + GV60 cockpit (twin screens, HUD, digital mirrors, crystal sphere), BOOST (B), headlights (two spotlights aimed ~7° down, intensity 3.2 × night), dash canvas, `assistReverse` for self-drive's three-point turn |
| `game.js` | coins/cars state through `Save`, coin pickups |
| `features.js` | deliveries, cruise (K), rain (V), drift rewards, crash DAMAGE board (never slows the car) + 200 mph kinematic tow, workshops (FIX CAR), lane lock steers at a look-ahead point in the lane (freeway, ramps, streets; at a junction it ignores the cross street), a car under the bay water is pulled back onto the nearest road after 2.5 s, TA-DA banner |
| `peds.js` | low-poly people on city sidewalks and station platforms; `Peds.person()` is also the walking avatar |
| `walk.js` | on foot (G): walk/run, deck + stairs + platform surfaces, guide text to the nearest train stop |
| `music.js` | MUSIC button: four instrumental rap beats synthesised with WebAudio |
| `robbery.js` | ROBBERY game mode (Settings > Game mode): one level per city/town, glowing doors on suburb houses, E on foot goes inside (first person), someone is asleep: walk, pull the side-table drawers open with E and take the cash; run (or hover by the bed) and they wake and call the police; E at the door leaves (grabbing any money and leaving finishes the house). CALL ROBBER FRIENDS: Albert and Benny, each in his own black car, tail you, drive off through the streets to free houses of the level and rob them (never the house nearest you), fall in behind you when the street is done; a house a friend is still driving to is yours if you reach its door first (he moves on). CHAT: text them orders (a street name, nearest, come, wait, "get the cops" sends them to ram the patrol car); their replies pop up as a chat alert. Wanted on foot: the police car drives up, an officer kicks the door in, "hands up", a warning shot, handcuffs, and the car drives you through the streets (`Robbery.gridRoute`) to the city's police station, into its cell block (`City.cellBlockInterior`: cell, hallway, the night officer dozing at the front desk). SNEAK opens the cell; walk (never run) past the desk to the exit door and press E; get heard and he marches you back. Outside the friends race over; G beside a black car and you drive it (the owner rides along, your own car stays parked as a copy, G beside it takes it back). GET MONEY at or inside a house grabs every drawer at once and texts the crew to grab all the money. Every city and town has a police station in the strip between the frontage road and the freeway, level with the city centre (`World.policeStationAt`, built in `loadCityRoads`; the workshop sits in the same strip, cities only, since the railway runs on the other side of the road): the level's last job is sneaking into its evidence room (`City.stationInterior`, the night officer asleep on the cot, cash in the locker drawers); wake him and he cuffs you on the spot (`Police.standDown` sends any patrol car already coming for you back to its beat), the cell block is in the same building. NEXT CITY button when the level's city is far away takes you there (`World.travelTo`); the side map shows the next address, with directions (`Robbery.wayToCity`: freeway, north/south, distance, exit number) under it while the city is far. The level's last house or the station ends the level on the doorstep (`checkLevel` → `R.levelDone`: the bonus and NEXT CITY come when you step out, never mid-room; a woken house is lost for the level, so getting caught in the last one ends it too). Inside, the HUD warns while the watching patrol car is within `COP_SEES` (45 m) of the door: step out with the money then and it gives chase, so wait for it to pass. `Walk.enterRoom` turns you to face the loot. The friend whose car you are driving (`R.borrowed`, state 'riding') is never sent off by GET MONEY, NEXT CITY, the jail escape or a text; E does nothing while cuffed; a woken house loses its marker and drops off the side map; texting wait/cancel to a friend inside a house walks him back to his car first. Progress in `Save` key `robbery`, mode in `mode` |
| `police.js` | a patrol car shadows you on freeways/avenues; 15+ over the limit starts a chase (siren, lights), never while self-drive is driving; stop = fine, 500 m clear = escape. In robbery mode on foot a car idles along the street watching (city streets are one 44 m segment per block, so at a segment end it carries straight on to the next, `straightOn`, and only turns round where the street ends): run within 70 m of it outdoors and it comes (running inside a house is the sleeper's business); back behind the wheel the watcher turns into an ordinary patrol car (`watch` → `patrol`), so speeding still counts |
| `ui.js` | HUD, start menu, settings, garage, fast travel, keyboard + touch; on phones (≤ 500 px) the button panel folds behind a MENU toggle (`#menu-toggle`, closes again on any button) and the minimap sits bottom-left clear of the drift pad |
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
  units of the player and dropped beyond ~3900 (towns: 2100 / 3300).
- Beside the frontage road only the strip toward the freeway (lateral 20..34 from the centreline) is
  free for buildings, and only between the ramps: the railway (60..74) and the grid are on the other side.

## Also in js/

`races.js` (freeway race vs AI, city checkpoint race), `train.js` (one railway line per freeway on its
cities' side, `Train.lineOf(fw)`, stations + drivable train, T), `selfdrive.js` (route map M with a
street map per city; only the Waymo self-drives, 200 mph on freeways, SELF DRIVE button; on the
destination's freeway with its exit ahead it takes only that exit (`S.wantExit`); any other exit is judged by
where it leads (`leadsTo`/`joinOf`: a ramp onto another freeway, by link, by touching its deck as the bridge
exits do, or through a chain of ramps, counts as the point 1.5 km along that freeway in the merge direction),
an on-ramp by the best exit reachable in the 4 km after it (`viaBest`, so a bridge further along beats a ramp
that merely ends nearer in a straight line), and for a destination off this freeway it turns round when the
best way off behind beats the best ahead; with no U-turn loop within 2.5 km ahead (`nearLoop`) it takes the next exit of any city (`S.anyExit`; the same when the destination is off this freeway and lies behind along it, e.g. Oakland from a northbound start in SF) and finds the
way back through the frontage road: an on-ramp leaving the road ahead counts as "staying on" so side
streets don't tempt it, one leaving the other way means a three-point turn 25 m past it (`S.flipTurn`,
`Car.assistReverse`, at a crawl) and taking it on the way back, entered only from its start while lined
up, the car facing the ramp's way and its own road running straight to the ramp's start (steering for a ramp from inside a bend cut the corner into the barrier); ramps are considered only while the destination is over 800 m away, it never re-snaps onto a
deck at another height, a bridge hands over to its end ramps like any road (and it slows for its end as for an exit), it keeps the lane it arrives in on a new road (`nearestLane`) and holds 45 mph while
more than 4 m off its lane, the stuck timer resets with every new trip, U-turn loops are planned from the loops actually built (`Traffic.links` with `isUturn`), on ramps and streets it brakes for a bend up to 90 m ahead, a map click far from any built road stays the goal until a road is built within 60 m of it (`S.farSnap`), changing to another car in the garage stops it, and a point in an unbuilt city keeps the city as the goal (`S.destCity`) rather
than snapping to whatever road is built nearby), `multiplayer.js` (PeerJS invite
link, 20 Hz sync, `?room=`), `osm.js` (REAL MAP: Overpass streets + extruded buildings of the
current city's real downtown, built at x=60000). `features.js` also holds lane/front lock,
tires + tow truck and turn signals. Everything from classic.html is ported.
