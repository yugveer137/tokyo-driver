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
    const bridgeTargets = new Set(CITIES.filter(c => c.bridge).map(c => c.bridge.to));   // east-bay cities a bridge lands in

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
            // the other carriageway's exit and on-ramp (loadFarRamps): the same 1000 m before and after the city
            (c.side === 1 ? gapsLeft : gapsRight).push([c.s - 1050, c.s - 840], [c.s + 840, c.s + 1050]);
            if (k < cities.length - 1) {
                gapsRight.push([c.s + 1150, c.s + 1360]); gapsLeft.push([c.s + 1150, c.s + 1360]);   // forward U-turn (s+1200)
                if (!c.bridge && !bridgeTargets.has(c.id)) { gapsLeft.push([c.s + 2240, c.s + 2450]); gapsRight.push([c.s + 2240, c.s + 2450]); }   // return U-turn (s+2400), unless a bridge interchange sits there
            }
        });
        const fw = Road.define({ type: 'freeway', name, points: lifted, gapsRight, gapsLeft, segLen: 8 });
        fw.cities = cities; fw.chunks = {}; fw.streamChunks = {}; fw.index = W.freeways.length;
        cities.forEach(c => { c.fw = fw; if (c.satellite) c.satellite.fw = fw; });
        W.freeways.push(fw);
        return fw;
    }

    const BAY_W = 2400;               // between US-101 and I-880; the water starts 230 m from each
    const SHORE = 230;
    const BRIDGE_Y = 12;              // bridge decks above the water
    // Each bridge interchange, measured from its peninsula city's s (the east-bay city shares
    // it). The bridge is a straight east-west road along s+2200, elevated from end to end:
    //   on the viaduct level: US-101 south exit (s+1760) onto the eastbound lane; the westbound
    //     lane's on-ramp merging onto 101 south (s+2640); and the mirror on I-880 north.
    //   at ground, passing under the freeway and under those ramps: a 101 north exit (s+2100)
    //     that joins the bridge as an on-ramp 320 m out; an exit off the westbound lane 320 m
    //     out that merges onto 101 north (s+2360); and the mirror pair for I-880 south.
    //   (The return U-turn loop that used to sit at s+2400 is left out for these cities.)
    const BR = { exit: 1760, q: 2200, merge: 2640, exitN: 2100, mergeN: 2360, exitE: 2640, mergeE: 1760, exitES: 2300, mergeES: 2040 };
    const DECK_END = 7.5;             // the bridge's height where its ramps meet it

    W.build = function () {
        const peninsula = CITIES.filter(c => !c.fw), eastBay = CITIES.filter(c => c.fw === 1);
        // ---- US-101 down the peninsula: straight past each city, a gentle wiggle in between ----
        const cityS = [1700, 5900, 10100, 15500];
        const pts = [];
        for (let z = -200; z <= 16600; z += 200) {
            const near = cityS.some(c => Math.abs(z + 400 - c) < 1300) || cityS.some(c => z + 400 > c + 1500 && z + 400 < c + 2900);
            const x = near ? 0 : 40 * Math.sin(z / 900) * Math.sin(z / 350);
            pts.push([x, 0, z]);
        }
        pts.unshift([0, 0, -400]);
        const sJoin = cityS[3] - 2000;                                      // I-880 merges in before San Jose
        const gapsRight = [[sJoin - 160, sJoin + 50]], gapsLeftE = [];
        const gapsLeft = [], gapsRightE = [];
        peninsula.forEach((spec, k) => {
            if (!spec.bridge) return; const c = cityS[k];
            gapsRight.push([c + BR.exit - 50, c + BR.exit + 160], [c + BR.merge - 160, c + BR.merge + 50]);     // 101 south pair
            gapsLeft.push([c + BR.exitN - 160, c + BR.exitN + 50], [c + BR.mergeN - 50, c + BR.mergeN + 160]);  // 101 north pair
            gapsLeftE.push([c + BR.exitE - 220, c + BR.exitE + 110], [c + BR.mergeE - 110, c + BR.mergeE + 220]);   // 880 north pair
            gapsRightE.push([c + BR.exitES - 110, c + BR.exitES + 220], [c + BR.mergeES - 220, c + BR.mergeES + 110]);   // 880 south pair
        });
        const fw0 = defineFreeway('US-101', pts, peninsula, k => cityS[k], { gapsRight, gapsLeft });
        W.freeway = fw0;

        // ---- the bay: between the two shores the land drops to the sea bed; the shore strips
        // (freeway to water) are flat so the bridge ramps sit on level ground ----
        Terrain.shapers.push((x, z, h) => {
            if (x > -20 || x < -BAY_W + 20 || z < -600 || z > 15200) return h;
            const inBay = x < -SHORE && x > -BAY_W + SHORE;
            let target = 1.0;                                               // flat shore
            if (inBay) { const edge = Math.min(-SHORE - x, x - (-BAY_W + SHORE)); const k = Math.max(0, Math.min(1, edge / 120)); target = 1.0 * (1 - k) + (-8) * k; }
            const fromFw = Math.min(-x, x + BAY_W) - 20;                    // blend back to the natural land under each freeway
            const kk = Math.max(0, Math.min(1, fromFw / 80));
            const zEdge = Math.max(0, Math.min(1, Math.min(z + 600, 15200 - z) / 200));
            return h * (1 - kk * zEdge) + target * kk * zEdge;
        });
        W.water = { x: -BAY_W / 2, z: 7300, w: BAY_W - 2 * SHORE + 60, d: 15800, y: -2 };

        // ---- I-880 up the east bay, then a long sweep in to join US-101 ----
        const b = Road.at(fw0, sJoin - 500, COLLECTOR_LAT);
        const e = [];
        for (let z = -400; z <= 11200; z += 400) e.push([-BAY_W, 0, z]);
        e.push([-BAY_W + 150, 0, 11650], [-BAY_W + 600, 0, 12050], [-BAY_W + 1200, 0, 12300], [-BAY_W + 1800, 0, 12450], [-250, 0, 12450], [-80, 0, 12550], [b.p.x, 0, b.p.z], [b.p.x, 0, b.p.z + 60]);
        const fw1 = defineFreeway('I-880', e, eastBay, k => [1700, 5900, 10100][k], { groundEnds: true, gapsLeft: gapsLeftE, gapsRight: gapsRightE });
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

    // A bay bridge with its own interchanges at both ends (see BR above). Built with the
    // peninsula city. `style`: suspension (Bay Bridge towers and cables), trestle (San Mateo: a
    // long low deck with a high-rise hump), low (Dumbarton).
    function loadBridge(city) {
        const spec = city.bridge; if (!spec) return;
        const other = W.cities.find(c => c.id === spec.to); if (!other) return;
        const fwA = city.fw, fwB = other.fw, s = city.s;
        const addRoad = (r) => { city.roads.push(r); return r; };
        const link = (r) => { Traffic.linkRamp(r); return r; };

        // ---- the bridge itself: straight along zc, already up at DECK_END where it starts and ends ----
        const zc = Road.at(fwA, s + BR.q, 0).p.z;
        const xW = -200, xE = -BAY_W + 200;
        const hump = spec.style === 'trestle' ? 10 : spec.style === 'low' ? 6 : 0;
        const pts = [[xW, DECK_END, zc], [xW - 80, DECK_END + 1, zc], [xW - 190, BRIDGE_Y, zc]];
        for (let x = -550; x >= -BAY_W + 550; x -= 200) {
            const t = (x + 550) / (-BAY_W + 550 + 550);
            pts.push([x, BRIDGE_Y + hump * Math.sin(Math.PI * t) * (spec.style === 'trestle' ? (t > 0.55 && t < 0.85 ? 1 : 0.25) : 1), zc]);
        }
        pts.push([xE + 190, BRIDGE_Y, zc], [xE + 80, DECK_END + 1, zc], [xE, DECK_END, zc]);
        const bridge = addRoad(Road.build({ type: 'freeway', name: spec.name, points: pts, segLen: 8, openStart: 40, openEnd: 40 }));
        bridge.isBridge = true;
        const lr = LANE_R();
        const inW = Road.at(bridge, 0, lr), outW = Road.at(bridge, 0, -lr), inE = Road.at(bridge, bridge.length, lr), outE = Road.at(bridge, bridge.length, -lr);
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const gnd = (x, z) => Terrain.height(x, z) + Road.DRAPE;
        const under = (r) => { r.underFreeway = true; Road.removePiersNear(fwA, r); Road.removePiersNear(fwB, r); return r; };

        // ---- US-101, on the viaduct level: south exit onto the bridge, on-ramp back onto south ----
        addRoad(link(Road.exit(fwA, s + BR.exit, 1, inW.p.clone(), inW.tan, spec.name, { keepY: true })));
        addRoad(link(Road.onramp(fwA, s + BR.merge, 1, outW.p.clone(), outW.tan.clone().negate(), fwA.name + ' South', { keepY: true })));
        // ---- US-101, at ground: north exit under the freeway, joining the bridge 320 m out; and the way back ----
        const nX = Road.at(fwA, s + BR.exitN - 280, 0).p.z;                            // where the north exit's peel ends (lateral 46 west)
        const joinW = V(-300, gnd(-300, zc - 60), zc - 60);
        addRoad(link(under(Road.exit(fwA, s + BR.exitN, -1, joinW, V(-1, 0, 0), spec.name, { via: [V(10, gnd(10, nX - 60), nX - 60), V(-110, gnd(-110, nX - 100), nX - 100), V(-220, gnd(-220, zc - 80), zc - 80)] }))));
        addRoad(link(Road.onramp(bridge, 320, 1, joinW, V(-1, 0, 0), spec.name)));
        const leaveW = V(-240, gnd(-240, zc + 70), zc + 70);
        addRoad(link(Road.exit(bridge, 320, -1, leaveW, V(1, 0, 0), fwA.name + ' North')));
        const mN = Road.at(fwA, s + BR.mergeN + 280, 0).p.z;                            // where the north on-ramp's peel starts (lateral 46 west)
        addRoad(link(under(Road.onramp(fwA, s + BR.mergeN, -1, leaveW, V(1, 0, 0), fwA.name + ' North', { via: [V(-120, gnd(-120, zc + 110), zc + 110), V(0, gnd(0, mN + 60), mN + 60), V(30, gnd(30, mN + 40), mN + 40)] }))));

        // ---- I-880, on the viaduct level: the eastbound lane merges onto 880 north; 880 north exits onto the westbound lane ----
        const sE = Road.nearest(fwB, new THREE.Vector3(xE, 0, zc)).s;
        addRoad(link(Road.onramp(fwB, sE - 440, -1, inE.p.clone(), inE.tan, fwB.name + ' North', { keepY: true })));
        addRoad(link(Road.exit(fwB, sE + 440, -1, outE.p.clone(), outE.tan.clone().negate(), spec.name, { keepY: true })));
        // ---- I-880, at ground: south exit under the freeway joining the westbound lane 320 m out; eastbound exit merging onto 880 south ----
        const sX = Road.at(fwB, sE + 100 + 280, 0).p.z;                                 // the south exit's peel ends here (lateral 46, city side)
        const joinE = V(xE + 100, gnd(xE + 100, zc + 60), zc + 60);
        addRoad(link(under(Road.exit(fwB, sE + 100, 1, joinE, V(1, 0, 0), spec.name, { via: [V(-BAY_W - 10, gnd(-BAY_W - 10, sX + 60), sX + 60), V(-BAY_W + 110, gnd(-BAY_W + 110, sX + 100), sX + 100), V(xE + 20, gnd(xE + 20, zc + 80), zc + 80)] }))));
        addRoad(link(Road.onramp(bridge, bridge.length - 320, -1, joinE, V(1, 0, 0), spec.name)));
        const leaveE = V(xE + 40, gnd(xE + 40, zc - 70), zc - 70);
        addRoad(link(Road.exit(bridge, bridge.length - 320, 1, leaveE, V(-1, 0, 0), fwB.name + ' South')));
        const mS = Road.at(fwB, sE - 160 - 280, 0).p.z;                                 // the south on-ramp's peel starts here
        addRoad(link(under(Road.onramp(fwB, sE - 160, 1, leaveE, V(-1, 0, 0), fwB.name + ' South', { via: [V(xE - 80, gnd(xE - 80, zc - 110), zc - 110), V(-BAY_W, gnd(-BAY_W, mS - 60), mS - 60), V(-BAY_W - 30, gnd(-BAY_W - 30, mS - 40), mS - 40)] }))));

        // towers and cables for the suspension spans
        if (spec.style === 'suspension') {
            const grey = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.5, metalness: 0.4 });
            const addTower = (x, h) => {
                [-9, 9].forEach(dz => { const t = new THREE.Mesh(new THREE.BoxGeometry(3.5, h, 3.5), grey); t.position.set(x, -8 + h / 2, zc + dz); t.castShadow = true; game.scene.add(t); city.meshes.push(t); });
                [BRIDGE_Y + 10, BRIDGE_Y + 35, BRIDGE_Y + h - 12].forEach(y => { const bx = new THREE.Mesh(new THREE.BoxGeometry(3.5, 4, 22), grey); bx.position.set(x, y, zc); game.scene.add(bx); city.meshes.push(bx); });
            };
            const cable = (x0, x1, top, side) => {
                const cp = []; for (let x = x0; x >= x1; x -= 20) { const t = (x - x0) / (x1 - x0); cp.push(new THREE.Vector3(x, top - (1 - Math.pow(2 * t - 1, 2)) * (top - BRIDGE_Y - 3), zc + side)); }
                const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 40, 0.5, 6, false), grey); game.scene.add(m); city.meshes.push(m);
                for (let x = x0 - 40; x > x1 + 20; x -= 40) { const t = (x - x0) / (x1 - x0); const y = top - (1 - Math.pow(2 * t - 1, 2)) * (top - BRIDGE_Y - 3); const hg = new THREE.Mesh(new THREE.BoxGeometry(0.2, Math.max(0.5, y - BRIDGE_Y - 1), 0.2), grey); hg.position.set(x, (y + BRIDGE_Y + 1) / 2, zc + side); game.scene.add(hg); city.meshes.push(hg); }
            };
            [-700, -1200].forEach(x => addTower(x, 90));
            addTower(-1950, 110);
            [-9, 9].forEach(side => { cable(-380, -700, 70, side); cable(-700, -1200, 70, side); cable(-1200, -1520, 70, side); cable(-1620, -1950, 90, side); cable(-1950, -2280, 90, side); });
        }
        // boards: on 101 before the exit, on 880 before its exit, and a name plate on the deck
        const hwA = fwA.width / 2, hwB = fwB.width / 2;
        [[s + BR.exit - 800, '1 MILE'], [s + BR.exit - 300, 'EXIT ONLY']].forEach(([sAt, sub]) => { const f = Road.at(fwA, sAt, hwA + 3.2); city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan), 'EXIT ' + (city.exitNumber + 1) + 'B', [{ text: spec.name.replace(/^[A-Z0-9-]+ /, '') }, { text: other.name, size: 44 }], sub)); });
        [[s + BR.exitN + 800, '1 MILE'], [s + BR.exitN + 300, 'EXIT ONLY']].forEach(([sAt, sub]) => { const f = Road.at(fwA, sAt, -(hwA + 3.2)); city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan.clone().negate()), 'EXIT ' + (city.exitNumber + 1) + 'A', [{ text: spec.name.replace(/^[A-Z0-9-]+ /, '') }, { text: other.name, size: 44 }], sub)); });
        [[sE + 100 - 800, '1 MILE'], [sE + 100 - 300, 'EXIT ONLY']].forEach(([sAt, sub]) => { const f = Road.at(fwB, sAt, hwB + 3.2); city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan), 'EXIT ' + (other.exitNumber + 1) + 'A', [{ text: spec.name.replace(/^[A-Z0-9-]+ /, '') }, { text: city.name, size: 44 }], sub)); });
        [[sE + 440 + 800, '1 MILE'], [sE + 440 + 300, 'EXIT ONLY']].forEach(([sAt, sub]) => { const f = Road.at(fwB, sAt, -(hwB + 3.2)); city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan.clone().negate()), 'EXIT ' + (other.exitNumber + 1) + 'B', [{ text: spec.name.replace(/^[A-Z0-9-]+ /, '') }, { text: city.name, size: 44 }], sub)); });
        const sg = Road.at(bridge, 420, bridge.halfW + 2.5); city.signs.push(Signs.plain(sg.p, Signs.facingFrom(sg.tan), spec.name.split(' ')[0], spec.name.split(' ').slice(1).join(' ').toUpperCase(), 4, 2));
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
            const loops = (city.bridge || bridgeTargets.has(city.id)) ? [[1200, 1]] : [[1200, 1], [2400, -1]];
            loops.forEach(([off, dir]) => {
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
        loadFarRamps(city);
        if (window.Peds) Peds.spawnCity(city);
        if (city.satellite) { City.load(city.satellite); if (window.Peds) Peds.spawnCity(city.satellite); }
        W.buildWater();
        loadBridge(city);
        loadJunctions(city);
    }

    // The other carriageway's way in and out, so a city can be reached from both directions
    // (the U-turn loops used to be the only way). Its exit peels off 1000 m before the city
    // on the bay side, drops to the shore, swings under the deck and lands on the frontage
    // road heading the same way; the on-ramp leaves the frontage road past the city centre,
    // goes back under and climbs onto the carriageway 1000 m on. Both carry the city's exit
    // number, like a real freeway.
    function loadFarRamps(city) {
        const fw = city.fw, hw = fw.width / 2, d = city.side, e = -d, s = city.s;
        const V = (x, y, z) => new THREE.Vector3(x, y, z);
        const gnd = (sAt, lat) => { const f = Road.at(fw, sAt, lat); return V(f.p.x, Terrain.height(f.p.x, f.p.z) + Road.DRAPE, f.p.z); };
        const under = (r) => { r.underFreeway = true; Road.removePiersNear(fw, r); Traffic.linkRamp(r); city.roads.push(r); return r; };
        // in: after the peel (lateral 46 at s-720) the ramp runs along the shore at 60, then
        // crosses under the deck to the frontage road at 48 on the city side
        const land = Road.at(fw, s - e * 60, d * COLLECTOR_LAT);
        const exit = under(Road.exit(fw, s - e * 1000, e, land.p, land.tan.clone().multiplyScalar(e), 'Exit ' + city.exitNumber,
            { via: [gnd(s - e * 580, e * 62), gnd(s - e * 430, e * 58), gnd(s - e * 320, e * 34), gnd(s - e * 255, 0), gnd(s - e * 195, d * 32)] }));
        W.exits.push(exit);
        // out: the mirror image on the far side of the city centre
        const leave = Road.at(fw, s + e * 100, d * COLLECTOR_LAT);
        under(Road.onramp(fw, s + e * 1000, e, leave.p, leave.tan.clone().multiplyScalar(e), city.name + ' on-ramp',
            { via: [gnd(s + e * 195, d * 32), gnd(s + e * 255, 0), gnd(s + e * 320, e * 34), gnd(s + e * 430, e * 58), gnd(s + e * 580, e * 62)] }));
        // the same boards the main exit has: 1 mile, 1/2 mile, exit only, gore, city limit
        const sExit = s - e * 1000;
        const at = (sAt, lat) => { const f = Road.at(fw, sAt, e * lat); return { p: f.p, facing: Signs.facingFrom(f.tan.clone().multiplyScalar(e)) }; };
        const board = (sAt, sub) => { if (sAt < 60 || sAt > fw.length - 60) return; const a = at(sAt, hw + 3.2); city.signs.push(Signs.exitBoard(a.p, a.facing, 'EXIT ' + city.exitNumber, [{ text: city.name }, { text: city.sub || 'Downtown', size: 48 }], sub)); };
        board(sExit - e * 800, '1 MILE'); board(sExit - e * 400, '1/2 MILE'); board(sExit - e * 100, 'EXIT ONLY');
        const g = at(sExit + e * 210, hw + 1.5); city.signs.push(Signs.goreSign(g.p, g.facing, 'EXIT'));
        const limS = sExit - e * 1000;
        if (limS > 60 && limS < fw.length - 60) { const a = at(limS, hw + 2.6); city.signs.push(Signs.plain(a.p, a.facing, 'ENTERING', city.name.toUpperCase(), 5, 2.4)); }
        const wel = Road.at(exit, 300, Road.types.ramp.laneW / 2 + Road.types.ramp.shoulder + 1.5); city.signs.push(Signs.plain(wel.p, Signs.facingFrom(wel.tan), 'WELCOME TO', city.name.toUpperCase(), 5, 2.4));
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
