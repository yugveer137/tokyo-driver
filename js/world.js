// tokyo-driver1 v2 — the route network.
// Freeway 0 is I-80: one long elevated freeway past seven cities that alternate sides.
// Freeway 1 is the I-15 loop: it leaves I-80 by a right exit before Reno, runs east through
// Salt Lake City, Denver and Chicago, then swings back and merges into I-80 before Las Vegas.
// Right-side cities are reached from the forward carriageway, left-side cities from the other
// one; between cities a U-turn ramp on each side loops under the freeway. Everything streams:
// freeway chunks of 400 units, and each city (streets, buildings, ramps, signs, U-turns).
window.World = (function () {
    const W = { spawn: new THREE.Vector3(0, 2, 0), spawnYaw: 0, freeway: null, freeways: [], cities: [], exits: [] };
    const CHUNK = 400, LOAD_DIST = 1400, DROP_DIST = 2400;
    const COLLECTOR_LAT = 48;         // collector avenue runs this far beside the freeway centreline
    const LANE_R = () => Road.types.freeway.median / 2 + Road.types.freeway.laneW * 2.5;   // rightmost lane
    const UP = new THREE.Vector3(0, 1, 0);

    // Lift a flat centreline above the land (and city plateaus), define the freeway and its
    // cities. `specs` are city specs; `citySAt(k)` gives each city's arc length.
    function defineFreeway(name, pts, specs, citySAt, opts) {
        opts = opts || {};
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[2])), false, 'centripetal', 0.5);
        const probe = (sAt) => { const t = Math.min(1, sAt / curve.getLength()); const p = curve.getPointAt(t), tan = curve.getTangentAt(t).normalize(); return { p, tan, right: new THREE.Vector3().crossVectors(tan, UP).normalize() }; };
        const cities = [];
        specs.forEach((spec, k) => {
            const sC = citySAt(k), f = probe(sC);
            const side = spec.side !== undefined ? spec.side : (k % 2 === 0 ? 1 : -1);
            const cols = spec.cols || 5, pitch = (spec.block || 60) + (spec.street || 18);
            const halfW = cols * pitch / 2;
            const center = f.p.clone().addScaledVector(f.right, side * (COLLECTOR_LAT + halfW + 30));
            const base = Terrain.height(center.x, center.z);
            const heading = Math.atan2(f.tan.x, f.tan.z) + (side < 0 ? Math.PI : 0);
            const city = City.define(Object.assign({}, spec, { center: { x: center.x, z: center.z }, heading, base, s: sC, side }));
            city.freewayFrame = f;
            cities.push(city); W.cities.push(city);
            if (spec.shape) spec.shape(city);                                   // e.g. San Francisco's bay
            if (spec.satellite) {                                               // a town reached only through the city (Sausalito)
                const sat = City.define(spec.satellite(city)); sat.parentCity = city; city.satellite = sat; W.cities.push(sat);
            }
        });
        const lifted = pts.map((p, i) => {
            let g = -1e9;
            for (let dz = -120; dz <= 120; dz += 40) for (let dx = -40; dx <= 40; dx += 40) g = Math.max(g, Terrain.height(p[0] + dx, p[2] + dz));
            let y = g + 7;
            // a branch freeway starts and ends at ground level (it is entered / left by ramps)
            if (opts.groundEnds) { if (i === 0) y = Terrain.height(p[0], p[2]) + Road.DRAPE; if (i === pts.length - 1) y = Terrain.height(p[0], p[2]) + Road.DRAPE; if (i === 1 || i === pts.length - 2) y = Math.min(y, Terrain.height(p[0], p[2]) + 4); }
            return [p[0], y, p[2]];
        });
        const gapsRight = (opts.gapsRight || []).slice(), gapsLeft = (opts.gapsLeft || []).slice();
        cities.forEach((c, k) => {
            if (c.side === 1) { gapsRight.push([c.s - 1250, c.s - 1040]); gapsRight.push([c.s + 910, c.s + 1120]); }
            else { gapsLeft.push([c.s + 1040, c.s + 1250]); gapsLeft.push([c.s - 1120, c.s - 910]); }
            if (k < cities.length - 1) {
                gapsRight.push([c.s + 1450, c.s + 1660]); gapsLeft.push([c.s + 1450, c.s + 1660]);   // northbound U-turn (s+1500)
                gapsLeft.push([c.s + 2240, c.s + 2450]); gapsRight.push([c.s + 2240, c.s + 2450]);   // southbound U-turn (s+2400)
            }
        });
        const fw = Road.define({ type: 'freeway', name, points: lifted, gapsRight, gapsLeft, segLen: 8 });
        fw.cities = cities; fw.chunks = {}; fw.streamChunks = {}; fw.index = W.freeways.length;
        cities.forEach(c => { c.fw = fw; if (c.satellite) c.satellite.fw = fw; });
        W.freeways.push(fw);
        return fw;
    }

    const BAY_W = 2400;               // water between US-101 and I-880
    const BRIDGE_Y = 12;              // bridge decks above the water
    const CROSS_Y = 19;               // where a bridge viaduct passes over a freeway (deck at ~7, walls to ~8.5)

    W.build = function () {
        const peninsula = CITIES.filter(c => !c.fw), eastBay = CITIES.filter(c => c.fw === 1);
        // ---- US-101 down the peninsula: straight past each city, a gentle wiggle in between ----
        const cityS = [1700, 5200, 8700, 12700];
        const pts = [];
        for (let z = -200; z <= 13800; z += 200) {
            const near = cityS.some(c => Math.abs(z + 400 - c) < 1300);
            const x = near ? 0 : 40 * Math.sin(z / 900) * Math.sin(z / 350);
            pts.push([x, 0, z]);
        }
        pts.unshift([0, 0, -400]);
        const sJoin = cityS[3] - 2000;                                      // I-880 merges in before San Jose
        const fw0 = defineFreeway('US-101', pts, peninsula, k => cityS[k], { gapsRight: [[sJoin - 160, sJoin + 50]] });
        W.freeway = fw0;

        // ---- the bay: everything between the two freeways drops to the sea bed ----
        Terrain.shapers.push((x, z, h) => {
            if (x > -120 || x < -BAY_W + 120 || z < -600 || z > 12400) return h;
            const edge = Math.min(-120 - x, x - (-BAY_W + 120), z + 600, 12400 - z);
            const k = Math.max(0, Math.min(1, edge / 120));
            return h * (1 - k) + (-8) * k;
        });
        W.water = { x: -BAY_W / 2, z: 5900, w: BAY_W - 100, d: 13200, y: -2 };

        // ---- I-880 up the east bay, then a long sweep in to join US-101 ----
        const b = Road.at(fw0, sJoin - 500, COLLECTOR_LAT);
        const e = [];
        for (let z = -400; z <= 8800; z += 400) e.push([-BAY_W, 0, z]);
        e.push([-BAY_W + 150, 0, 9150], [-BAY_W + 600, 0, 9450], [-BAY_W + 1200, 0, 9650], [-BAY_W + 1800, 0, 9750], [-250, 0, 9700], [-80, 0, 9780], [b.p.x, 0, b.p.z], [b.p.x, 0, b.p.z + 60]);
        const fw1 = defineFreeway('I-880', e, eastBay, k => [1700, 5200, 8700][k], { groundEnds: true });
        W.junctions = [{ from: fw0, s: sJoin, to: fw1, kind: 'join' }];
        W.junctions.forEach(j => { j.city = fw0.cities.reduce((a, c) => Math.abs(c.s - j.s) < Math.abs(a.s - j.s) ? c : a); j.city.loadPad = 900; });

        // Spawn on US-101 just north of San Francisco, in the right lane
        const sp = Road.at(fw0, 200, LANE_R());
        W.spawn.set(sp.p.x, sp.p.y + 1.2, sp.p.z);
        W.spawnYaw = Road.yawOf(sp.tan);
    };

    // the water sheet (built once the scene exists)
    W.buildWater = function () {
        if (!W.water || W.waterMesh) return;
        const w = W.water;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.d), new THREE.MeshStandardMaterial({ color: 0x2b6f9c, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.92 }));
        m.rotation.x = -Math.PI / 2; m.position.set(w.x, w.y, w.z); m.receiveShadow = true;
        game.scene.add(m); W.waterMesh = m;
    };

    // Where I-880 merges into US-101: the on-ramp is built (and dropped) with San Jose
    function loadJunctions(city) {
        const fw0 = W.freeway, fw1 = W.freeways[1];
        if (!fw1 || city.fw !== fw0) return;
        W.junctions.forEach(j => {
            if (j.city !== city) return;
            const end = Road.at(fw1, fw1.length, LANE_R());
            const ramp = Road.onramp(fw0, j.s, 1, end.p, end.tan, fw0.name + ' South');
            city.roads.push(ramp); Traffic.linkRamp(ramp);
            const hw1 = fw1.width / 2;
            const f = Road.at(fw1, fw1.length - 600, hw1 + 3.2);
            city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan), 'END', [{ text: fw0.name + ' South' }, { text: city.name, size: 42 }], 'MERGE AHEAD'));
        });
    }

    // The bay bridges: from a peninsula city's frontage road, up a viaduct, over US-101, straight
    // across the water, and down onto the east-bay city's frontage road. Built with the peninsula
    // city. `style`: suspension (Bay Bridge towers and cables), trestle (San Mateo: a long low
    // deck with a high-rise hump), low (Dumbarton).
    function loadBridge(city) {
        const spec = city.bridge; if (!spec) return;
        const other = W.cities.find(c => c.id === spec.to); if (!other) return;
        const fwA = city.fw, fwB = other.fw;
        const zc = Road.at(fwA, city.s, 0).p.z;                              // both cities sit at the same s
        const a = Road.at(fwA, city.s - 420, -COLLECTOR_LAT).p;              // on the peninsula frontage road (west side)
        const bEnd = Road.at(fwB, other.s + 520, COLLECTOR_LAT).p;           // on the east-bay frontage road
        const xA = a.x, xB = bEnd.x;
        const hump = spec.style === 'trestle' ? 10 : spec.style === 'low' ? 6 : 0;
        const pts = [];
        const add = (x, y, z) => pts.push([x, y, z]);
        // a long viaduct along the frontage road climbs to CROSS_Y, turns and clears the freeway
        // high above it, then drops to the bridge deck over the water (and the mirror on the east)
        add(xA, Terrain.height(xA, a.z) + Road.DRAPE, a.z); add(xA, 4, a.z + 90); add(xA, 10, a.z + 200); add(xA, 15, a.z + 300); add(xA - 8, CROSS_Y - 1, a.z + 380);
        add(xA - 50, CROSS_Y, zc + 10); add(0, CROSS_Y, zc); add(-150, CROSS_Y, zc); add(-350, BRIDGE_Y + 3, zc);
        for (let x = -550; x >= xB + 550; x -= 200) {
            const t = (x - (-550)) / (xB + 550 - (-550));
            add(x, BRIDGE_Y + hump * Math.sin(Math.PI * t) * (spec.style === 'trestle' ? (t > 0.55 && t < 0.85 ? 1 : 0.25) : 1), zc);
        }
        add(xB + 350, BRIDGE_Y + 3, zc); add(xB + 150, CROSS_Y, zc); add(xB + 48, CROSS_Y, zc); add(xB + 8, CROSS_Y - 1, zc + 60); add(xB, 15, zc + 140); add(xB, 10, zc + 240); add(xB, 4, zc + 350); add(xB, Terrain.height(xB, bEnd.z) + Road.DRAPE, bEnd.z);
        const road = Road.build({ type: 'freeway', name: spec.name, points: pts, segLen: 8, hugTerrain: true, openStart: 60, openEnd: 60 });
        city.roads.push(road); road.isBridge = true;
        // towers and cables for the suspension spans
        if (spec.style === 'suspension') {
            const grey = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.5, metalness: 0.4 });
            const addTower = (x, h) => {
                [-9, 9].forEach(dz => { const t = new THREE.Mesh(new THREE.BoxGeometry(3.5, h, 3.5), grey); t.position.set(x, -8 + h / 2, zc + dz); t.castShadow = true; game.scene.add(t); city.meshes.push(t); });
                [BRIDGE_Y + 10, BRIDGE_Y + 35, BRIDGE_Y + h - 12].forEach(y => { const b = new THREE.Mesh(new THREE.BoxGeometry(3.5, 4, 22), grey); b.position.set(x, y, zc); game.scene.add(b); city.meshes.push(b); });
            };
            const cable = (x0, x1, top, side) => {
                const cp = []; for (let x = x0; x >= x1; x -= 20) { const t = (x - x0) / (x1 - x0); cp.push(new THREE.Vector3(x, top - (1 - Math.pow(2 * t - 1, 2)) * (top - BRIDGE_Y - 3), zc + side)); }
                const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 40, 0.5, 6, false), grey); game.scene.add(m); city.meshes.push(m);
                for (let x = x0 - 40; x > x1 + 20; x -= 40) { const t = (x - x0) / (x1 - x0); const y = top - (1 - Math.pow(2 * t - 1, 2)) * (top - BRIDGE_Y - 3); const hg = new THREE.Mesh(new THREE.BoxGeometry(0.2, Math.max(0.5, y - BRIDGE_Y - 1), 0.2), grey); hg.position.set(x, (y + BRIDGE_Y + 1) / 2, zc + side); game.scene.add(hg); city.meshes.push(hg); }
            };
            // west span: two towers; east span: the single tall tower
            [-600, -1100].forEach(x => addTower(x, 90));
            addTower(-1900, 110);
            [-9, 9].forEach(side => { cable(-250, -600, 70, side); cable(-600, -1100, 70, side); cable(-1100, -1450, 70, side); cable(-1550, -1900, 90, side); cable(-1900, -2250, 90, side); });
        }
        const sg = Road.at(road, 40, road.halfW + 2.5); city.signs.push(Signs.plain(sg.p, Signs.facingFrom(sg.tan), spec.name.split(' ')[0], spec.name.split(' ').slice(1).join(' ').toUpperCase() + ' → ' + other.name.toUpperCase(), 4, 2));
        // on the freeway, both ways: the city's exit is the way onto the bridge
        const hw = fwA.width / 2, d = city.side, sExit = city.s - d * 1200;
        [[sExit - d * 600, d], [city.s + 1300, -d]].forEach(([sAt, dir]) => {
            const f = Road.at(fwA, sAt, dir * (hw + 3.2));
            city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan.clone().multiplyScalar(dir)), 'EXIT ' + city.exitNumber, [{ text: spec.name.replace(/^[A-Z0-9-]+ /, '') }, { text: 'to ' + other.name + ' · via ' + city.name + ' Frontage Rd', size: 40 }], dir === d ? '1 MILE' : 'USE ' + fwA.name + (d === 1 ? ' SOUTH' : ' NORTH')));
        });
    }

    // City-specific roads: collector avenue, exit ramp in, on-ramp out, signs, service station,
    // and the two U-turns on the way to the next city on that freeway.
    function loadCityRoads(city) {
        const fw = city.fw, hw = fw.width / 2, d = city.side;
        const sExit = city.s - d * 1200, sMerge = city.s + d * 1070;
        const pts = [];
        for (let k = -780; k <= 700; k += 60) { const f = Road.at(fw, city.s + d * k, d * COLLECTOR_LAT); pts.push([f.p.x, 0, f.p.z]); }
        const collector = Road.build({ type: 'avenue', name: city.collectorName || (city.name + ' Frontage Rd'), conform: true, points: pts });
        city.roads.push(collector);
        city.collector = collector;
        const land = Road.at(fw, city.s - d * 760, d * COLLECTOR_LAT);
        const exit = Road.exit(fw, sExit, d, land.p, land.tan.clone().multiplyScalar(d), 'Exit ' + city.exitNumber);
        city.roads.push(exit); W.exits.push(exit);
        const leave = Road.at(fw, city.s + d * 620, d * COLLECTOR_LAT);
        const ramp = Road.onramp(fw, sMerge, d, leave.p, leave.tan.clone().multiplyScalar(d), city.name + ' on-ramp');
        city.roads.push(ramp);
        Traffic.linkRamp(exit); Traffic.linkRamp(ramp);
        if (window.Train && !city.station && fw === W.freeway) { city.station = true; Train.station(city).forEach(m => city.meshes.push(m)); }
        if (fw === W.freeway) loadStationRoad(city, collector);
        if (city.extraRoads) city.extraRoads(city).forEach(r => city.roads.push(r));
        // connect the collector to the grid: short stubs from the collector to the nearest street column
        // (the freeway side is local +x: city.toWorld(+W/2, ...) is the column nearest the collector)
        for (let i = 0; i <= city.rows; i += 2) {
            const a = city.toWorld(city.W / 2 + 34, city.streetZ(i)), b = city.toWorld(city.W / 2 + city.street / 2, city.streetZ(i));
            const m = city.toWorld(city.W / 2 + 22, city.streetZ(i));
            city.roads.push(Road.build({ type: 'avenue', name: city.streets.ew[i % city.streets.ew.length], conform: true, points: [[a.x, 0, a.z], [m.x, 0, m.z], [b.x, 0, b.z]] }));
        }
        // signs on the freeway: 1 mile, 1/2 mile, exit-only, gore, city limit, welcome
        const name = city.name.toUpperCase();
        const at = (sAt, lat) => { const f = Road.at(fw, sAt, d * lat); return { p: f.p, facing: Signs.facingFrom(f.tan.clone().multiplyScalar(d)) }; };
        const board = (sAt, sub) => { if (sAt < 60 || sAt > fw.length - 60) return; const a = at(sAt, hw + 3.2); city.signs.push(Signs.exitBoard(a.p, a.facing, 'EXIT ' + city.exitNumber, [{ text: city.name }, { text: city.sub || 'Downtown', size: 48 }], sub)); };
        board(sExit - d * 800, '1 MILE'); board(sExit - d * 400, '1/2 MILE'); board(sExit - d * 100, 'EXIT ONLY');
        const g = at(sExit + d * 210, hw + 1.5); city.signs.push(Signs.goreSign(g.p, g.facing, 'EXIT'));
        const limS = sExit - d * 1000;
        if (limS > 60 && limS < fw.length - 60) { const a = at(limS, hw + 2.6); city.signs.push(Signs.plain(a.p, a.facing, 'ENTERING', name, 5, 2.4)); }
        const wel = Road.at(exit, 300, Road.types.ramp.laneW / 2 + Road.types.ramp.shoulder + 1.5); city.signs.push(Signs.plain(wel.p, Signs.facingFrom(wel.tan), 'WELCOME TO', name, 5, 2.4));

        // workshop beside the collector, just past the exit: pull in, the door comes down and
        // your car gets fixed (Features.updateWorkshop). Also where the tow truck drops you.
        const sv = Road.at(collector, 140, 0), svOff = Road.at(collector, 140, collector.halfW + 14);
        const svY = Terrain.height(svOff.p.x, svOff.p.z);
        const shop = new THREE.Group(); shop.position.set(svOff.p.x, svY, svOff.p.z); shop.rotation.y = Road.yawOf(sv.tan);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, map: Tex.facade, roughness: 0.8 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.7 });
        const add = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || wallMat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; shop.add(m); return m; };
        // local +x faces the road (the door side); z runs along the road
        add(11, 0.2, 16, 0, 0.1, 0, darkMat);                       // floor slab
        add(0.3, 6, 16, -5.5, 3, 0);                                // back wall
        add(11, 6, 0.3, 0, 3, 8); add(11, 6, 0.3, 0, 3, -8);        // side walls
        add(11.6, 0.3, 16.6, 0, 6.1, 0, darkMat);                   // roof
        add(0.3, 2.2, 16, 5.5, 7.1, 0);                             // parapet (hides the raised door)
        add(0.3, 6, 5, 5.5, 3, 5.5); add(0.3, 6, 5, 5.5, 3, -5.5);  // front wall beside the 6-wide door
        add(0.3, 1.2, 6, 5.5, 5.4, 0);                              // header over the door
        const door = add(0.2, 4.8, 5.8, 5.45, 7.3, 0, new THREE.MeshStandardMaterial({ color: 0x8e98a4, roughness: 0.5, metalness: 0.4 }));
        for (let k = 0; k < 4; k++) { const groove = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 5.8), darkMat); groove.position.set(0, -1.8 + k * 1.2, 0); door.add(groove); }
        const lift = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 4.4), darkMat); lift.position.set(-0.5, 0.35, 0); shop.add(lift);   // car lift
        const sparks = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a })); sparks.position.set(-1.5, 1.2, 1.2); sparks.visible = false; shop.add(sparks);
        game.scene.add(shop); city.meshes.push(shop);
        // apron from the road edge to the door
        const ap = Road.at(collector, 140, collector.halfW + 4.2);
        city.meshes.push(Road.drapedQuad(ap.p.x, ap.p.z, 8, Road.yawOf(sv.tan) + Math.PI / 2, new THREE.MeshStandardMaterial({ color: 0x6f6f6c, map: Tex.concrete, roughness: 0.95 }), Road.DRAPE + 0.02, 2));
        const sp = Road.at(collector, 150, collector.halfW + 7.5); sp.p.y = svY + 0.3;
        city.signs.push(Signs.plain(sp.p, Signs.facingFrom(sv.tan) + Math.PI / 2, city.name.toUpperCase(), 'WORKSHOP', 4.5, 2.2));
        const bay = svOff.p.clone(); bay.y = svY;
        city.workshop = { city, center: bay, door, openY: 7.3, closedY: 2.5, sparks, state: 'open', t: 0 };
        city.servicePoint = Road.at(collector, 140, collector.lanes.find(l => l.dir === 1).offset).p.clone();

        // U-turns toward the next city on this freeway: forward one at +1500, the other at +2400
        const k = fw.cities.indexOf(city);
        if (k < fw.cities.length - 1) {
            [[1500, 1], [2400, -1]].forEach(([off, dir]) => {
                const sU = city.s + off;
                const u = Road.uturn(fw, sU, dir, 'U-turn');
                city.roads.push(u); Traffic.linkRamp(u);
                const other = fw.name + (dir === 1 ? ' South' : ' North');
                const atU = (sAt, lat) => { const f = Road.at(fw, sAt, dir * lat); return { p: f.p, facing: Signs.facingFrom(f.tan.clone().multiplyScalar(dir)) }; };
                const b1 = atU(sU - dir * 400, hw + 3.2); city.signs.push(Signs.exitBoard(b1.p, b1.facing, 'U-TURN', [{ text: 'U-Turn' }, { text: other, size: 48 }], '1/4 MILE'));
                const b2 = atU(sU - dir * 100, hw + 3.2); city.signs.push(Signs.exitBoard(b2.p, b2.facing, 'U-TURN', [{ text: 'U-Turn' }, { text: other, size: 48 }], 'EXIT ONLY'));
                const gg = atU(sU + dir * 210, hw + 1.5); city.signs.push(Signs.goreSign(gg.p, gg.facing, 'U-TURN'));
            });
        }
        if (window.Peds) Peds.spawnCity(city);
        if (city.satellite) { City.load(city.satellite); if (window.Peds) Peds.spawnCity(city.satellite); }
        W.buildWater();
        loadBridge(city);
        loadJunctions(city);
    }

    // Station Rd: from the frontage road to a small lot beside the train stop. The stop is on
    // the left of the freeway, so for a right-side city the street passes under the deck.
    function loadStationRoad(city, collector) {
        const fw = city.fw, d = city.side, sR = city.s + 40;
        const lotLat = Train.LAT + 10;                                   // just this side of the rails
        const from = d * COLLECTOR_LAT, to = lotLat, n = Math.max(2, Math.round(Math.abs(to - from) / 12));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const lat = from + (to - from) * i / n;
            const f = Road.at(fw, sR, lat);
            pts.push([f.p.x, 0, f.p.z]);
        }
        const road = Road.build({ type: 'street', name: city.name + ' Station Rd', conform: true, points: pts });
        road.underFreeway = d === 1;
        if (road.underFreeway) Road.removePiersNear(fw, road);
        city.roads.push(road);
        // the station car park: painted bays along the rails side, a P sign, a few cars parked
        const lot = Road.at(fw, sR, lotLat);
        const LOT_L = 30, LOT_W = 16;                                       // along the freeway x across it
        if (!W.lotTex) W.lotTex = Tex.textCanvas(600, 320, (ctx, Wd, H) => {
            ctx.drawImage(Tex.asphalt.image, 0, 0, Wd, H); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, Wd, H);
            ctx.strokeStyle = 'rgba(240,240,235,0.85)'; ctx.lineWidth = 4;
            for (let x = 60; x <= Wd - 60; x += 56) { ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, 110); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, H - 10); ctx.lineTo(x, H - 110); ctx.stroke(); }
            ctx.font = 'bold 54px Helvetica, Arial, sans-serif'; ctx.fillStyle = 'rgba(240,240,235,0.85)'; ctx.textAlign = 'center'; ctx.fillText('P', Wd / 2, H / 2 + 18);
        });
        city.meshes.push(Road.drapedQuad(lot.p.x, lot.p.z, LOT_W, Road.yawOf(lot.tan), new THREE.MeshStandardMaterial({ map: W.lotTex, roughness: 0.95 }), Road.DRAPE + 0.02, 3, LOT_L));
        const ps = Road.at(fw, sR - LOT_L / 2 - 2, lotLat - LOT_W / 2 + 1); ps.p.y = Terrain.height(ps.p.x, ps.p.z) + 0.3;
        city.signs.push(Signs.plain(ps.p, Signs.facingFrom(ps.tan) + Math.PI / 2, 'P', 'STATION PARKING', 3, 2));
        if (window.Models && Models.ready) {
            const kinds = ['sedan', 'suv', 'hatchback-sports', 'van'], tints = [0xc8c8c8, 0x2a2a2e, 0x7a1f1f, 0x1f3f7a, 0xd9c36b];
            [-12, -5, 5, 12].forEach((k, i) => {                            // the middle bay on the rails side stays free for you
                if (Math.random() < 0.3) return;                                // some bays stay free
                const bay = Road.at(fw, sR + k, lotLat + (i % 2 ? 1 : -1) * (LOT_W / 2 - 3.2));
                const car = Models.car(kinds[i % kinds.length], tints[Math.floor(Math.random() * tints.length)], 4.4, {});
                car.position.set(bay.p.x, Terrain.height(bay.p.x, bay.p.z) + Road.DRAPE + 0.02, bay.p.z);
                car.rotation.y = Road.yawOf(bay.tan) + Math.PI / 2;
                game.scene.add(car); city.meshes.push(car);
            });
        }
        const sg = Road.at(fw, sR - 8, d * (COLLECTOR_LAT + 7)); sg.p.y = Terrain.height(sg.p.x, sg.p.z) + 0.3;
        city.signs.push(Signs.plain(sg.p, Signs.facingFrom(sg.tan.clone().multiplyScalar(d)), 'TRAIN', 'STATION ' + (d === 1 ? '\u2190' : '\u2192'), 3.6, 2));
    }

    // The freeway the player is closest to (and the arc length there)
    W.freewayAt = function (pos) {
        let best = null, bn = null;
        W.freeways.forEach(fw => { const n = Road.nearest(fw, pos); if (!bn || n.dist < bn.dist) { best = fw; bn = n; } });
        return { fw: best, n: bn };
    };

    // Stream freeway chunks and cities around the player, on every freeway
    let frame = 0;
    W.update = function (pos, force) {
        frame++;
        W.freeways.forEach(fw => {
            if (force || frame % 10 === 1) { const n = Road.nearest(fw, pos); fw.lastS = n.s; fw.lastDist = n.dist; }
            if (fw.lastS === undefined) return;
            const active = fw.lastDist < 3000;      // only stream a freeway the player is reasonably near
            const c0 = Math.floor((fw.lastS - LOAD_DIST) / CHUNK), c1 = Math.floor((fw.lastS + LOAD_DIST) / CHUNK);
            if (active) for (let c = Math.max(0, c0); c <= c1; c++) {
                const s0 = c * CHUNK, s1 = Math.min(fw.length, (c + 1) * CHUNK);
                if (s0 >= fw.length) break;
                if (!fw.streamChunks[c]) { fw.streamChunks[c] = Road.buildRange(fw, s0, s1, 'c' + c); if (window.Train && fw === W.freeway) Train.buildRange(fw, s0, s1, 'c' + c); }
            }
            Object.keys(fw.streamChunks).forEach(k => {
                const c = +k, mid = (c + 0.5) * CHUNK;
                if (!active || Math.abs(mid - fw.lastS) > DROP_DIST) { Road.dropRange(fw, 'c' + c); if (window.Train && fw === W.freeway) Train.dropRange('c' + c); delete fw.streamChunks[k]; }
            });
            fw.cities.forEach(city => {
                const d = Math.abs(city.s - fw.lastS), pad = city.loadPad || 0;
                if (!city.loaded && active && d < LOAD_DIST + 1500 + pad) { City.load(city); loadCityRoads(city); }
                else if (city.loaded && (!active || d > DROP_DIST + 1700 + pad)) { City.unload(city); if (city.satellite) City.unload(city.satellite); }
            });
        });
    };

    // Fast travel: drop the player on the city's freeway a mile before its exit, on the
    // carriageway the exit is on
    W.travelTo = function (city) {
        const d = city.side, fw = city.fw;
        const s = Math.max(100, Math.min(fw.length - 100, city.s - d * (1200 + 900)));
        const f = Road.at(fw, s, d * LANE_R());
        Terrain.update(f.p);
        W.update(f.p, true);
        Car.teleport(f.p.x, f.p.y + 1.2, f.p.z, Road.yawOf(f.tan.clone().multiplyScalar(d)));
    };

    W.speedLimitAt = function (pos) {
        const city = City.at(pos);
        if (city) return 30;
        // on the freeway deck the limit is 65 even where an exit peels off beside you
        const near = W.freewayAt(pos);
        if (near.fw && near.n.dist < near.fw.width / 2 + 1.5 && Math.abs(pos.y - near.n.frame.p.y) < 4) return 65;
        let best = null, bd = Infinity;
        Road.all.forEach(r => { const n = Road.nearest(r, pos); if (n.dist < bd) { bd = n.dist; best = r; } });
        if (best && bd < best.width) return best.type === 'freeway' ? 65 : best.type === 'ramp' ? 35 : 45;
        return 65;
    };

    W.areaAt = function (pos) {
        const city = City.at(pos);
        if (city) return city.name;
        let best = null, bd = Infinity;
        Road.all.forEach(r => { const n = Road.nearest(r, pos); if (n.dist < bd) { bd = n.dist; best = r; } });
        if (best && bd < best.width) return best.name;
        return 'Open country';
    };

    return W;
})();
