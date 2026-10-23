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
    const CITY_GAP = 4200;            // freeway distance between city centres
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
            const side = k % 2 === 0 ? 1 : -1;
            const cols = spec.cols || 5, pitch = (spec.block || 60) + (spec.street || 18);
            const halfW = cols * pitch / 2;
            const center = f.p.clone().addScaledVector(f.right, side * (COLLECTOR_LAT + halfW + 30));
            const base = Terrain.height(center.x, center.z);
            const heading = Math.atan2(f.tan.x, f.tan.z) + (side < 0 ? Math.PI : 0);
            const city = City.define(Object.assign({}, spec, { center: { x: center.x, z: center.z }, heading, base, s: sC, side }));
            city.freewayFrame = f;
            cities.push(city); W.cities.push(city);
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
            if (c.side === 1) { gapsRight.push([c.s - 1250, c.s - 1020]); gapsRight.push([c.s + 890, c.s + 1120]); }
            else { gapsLeft.push([c.s + 1020, c.s + 1250]); gapsLeft.push([c.s - 1120, c.s - 890]); }
            if (k < cities.length - 1) {
                gapsRight.push([c.s + 1450, c.s + 1680]); gapsLeft.push([c.s + 1450, c.s + 1680]);   // northbound U-turn (s+1500)
                gapsLeft.push([c.s + 2220, c.s + 2450]); gapsRight.push([c.s + 2220, c.s + 2450]);   // southbound U-turn (s+2400)
            }
        });
        const fw = Road.define({ type: 'freeway', name, points: lifted, gapsRight, gapsLeft, segLen: 8 });
        fw.cities = cities; fw.chunks = {}; fw.streamChunks = {}; fw.index = W.freeways.length;
        cities.forEach(c => c.fw = fw);
        W.freeways.push(fw);
        return fw;
    }

    W.build = function () {
        // ---- I-80 ----
        const i80specs = CITIES.filter(c => !c.fw);
        const pts = [], cityS = [];
        i80specs.forEach((spec, k) => cityS.push(1700 + k * CITY_GAP));
        const total = 1700 + i80specs.length * CITY_GAP;
        for (let z = -200; z <= total; z += 200) {
            const near = cityS.some(c => Math.abs(z + 400 - c) < 1300);
            const x = near ? 0 : 60 * Math.sin(z / 900) * Math.sin(z / 350);
            pts.push([x, 0, z]);
        }
        pts.unshift([0, 0, -400]);
        // the I-15 loop leaves I-80 just before Reno (city 4) and rejoins before Las Vegas (city 5)
        const sLeave = cityS[4] - 1500, sJoin = cityS[5] - 2000;
        const fw0 = defineFreeway('I-80', pts, i80specs, k => cityS[k], { gapsRight: [[sLeave - 50, sLeave + 180], [sJoin - 180, sJoin + 50]] });
        W.freeway = fw0;

        // ---- I-15 loop: leaves eastward, runs through three cities, comes back ----
        const a = Road.at(fw0, sLeave + 500, COLLECTOR_LAT), b = Road.at(fw0, sJoin - 500, COLLECTOR_LAT);
        const east = a.right.clone(), north = a.tan.clone();
        const P = (p, e, n) => { const q = p.clone().addScaledVector(east, e).addScaledVector(north, n); return [q.x, 0, q.z]; };
        const loop = [P(a.p, 0, -60), P(a.p, 0, 0), P(a.p, 60, 260), P(a.p, 300, 520), P(a.p, 700, 700)];
        for (let e = 1100; e <= 9500; e += 400) loop.push(P(a.p, e, 760 + 120 * Math.sin(e / 1500)));
        loop.push(P(a.p, 9900, 1000), P(a.p, 10100, 1400), P(a.p, 10100, 2000));
        for (let e = 9500; e >= 1100; e -= 400) loop.push(P(b.p, e, -760 - 120 * Math.sin(e / 1500)));
        loop.push(P(b.p, 700, -700), P(b.p, 300, -520), P(b.p, 60, -260), P(b.p, 0, 0), P(b.p, 0, 60));
        const i15specs = CITIES.filter(c => c.fw === 1);
        const fw1 = defineFreeway('I-15', loop, i15specs, k => 3800 + k * 5600, { groundEnds: true });
        W.junctions = [{ from: fw0, s: sLeave, to: fw1, kind: 'leave' }, { from: fw0, s: sJoin, to: fw1, kind: 'join' }];
        // each connector ramp is built (and dropped) with the I-80 city nearest to it, which
        // therefore loads a little earlier so the ramp is there when you arrive from I-15
        W.junctions.forEach(j => { j.city = fw0.cities.reduce((a, c) => Math.abs(c.s - j.s) < Math.abs(a.s - j.s) ? c : a); j.city.loadPad = 900; });

        // Spawn on I-80 shortly before Tokyo, in the right lane
        const sp = Road.at(fw0, 200, LANE_R());
        W.spawn.set(sp.p.x, sp.p.y + 1.2, sp.p.z);
        W.spawnYaw = Road.yawOf(sp.tan);
    };

    // The branch connectors are built with Reno / Las Vegas (the I-80 cities nearest them)
    function loadJunctions(city) {
        const fw0 = W.freeway, fw1 = W.freeways[1];
        if (!fw1 || city.fw !== fw0) return;
        W.junctions.forEach(j => {
            if (j.city !== city) return;      // built and dropped with its nearest city
            if (j.kind === 'leave') {
                const start = Road.at(fw1, 0, LANE_R());
                const exit = Road.exit(fw0, j.s, 1, start.p, start.tan, 'I-15 East');
                exit.name = 'I-15 East'; city.roads.push(exit); Traffic.linkRamp(exit);
                const hw = fw0.width / 2;
                [[800, '1 MILE'], [400, '1/2 MILE'], [100, 'EXIT ONLY']].forEach(([back, sub]) => { const f = Road.at(fw0, j.s - back, hw + 3.2); city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan), 'EXIT 300', [{ text: 'I-15 East' }, { text: 'Salt Lake City · Denver', size: 42 }], sub)); });
                const g = Road.at(fw0, j.s + 210, hw + 1.5); city.signs.push(Signs.goreSign(g.p, Signs.facingFrom(g.tan), 'I-15'));
            } else {
                const end = Road.at(fw1, fw1.length, LANE_R());
                const ramp = Road.onramp(fw0, j.s, 1, end.p, end.tan, 'I-80 North');
                city.roads.push(ramp); Traffic.linkRamp(ramp);
                const hw1 = fw1.width / 2;
                const f = Road.at(fw1, fw1.length - 600, hw1 + 3.2); city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan), 'END', [{ text: 'I-80 North' }, { text: 'Las Vegas · New York', size: 42 }], 'MERGE AHEAD'));
            }
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

        // service station beside the collector, just past the exit: where the tow truck takes you
        const sv = Road.at(collector, 140, 0), svOff = Road.at(collector, 140, collector.halfW + 9);
        const svY = Terrain.height(svOff.p.x, svOff.p.z);
        const garage = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 9), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, map: Tex.facade, roughness: 0.8 }));
        garage.position.set(svOff.p.x, svY + 2.5, svOff.p.z); garage.rotation.y = Road.yawOf(sv.tan); garage.castShadow = true; garage.receiveShadow = true;
        game.scene.add(garage); city.meshes.push(garage);
        const door = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.6), new THREE.MeshStandardMaterial({ color: 0x3a4650, roughness: 0.6 }));
        door.position.copy(garage.position).addScaledVector(sv.right, -4.6); door.position.y = svY + 1.8; door.rotation.y = Road.yawOf(sv.tan) + Math.PI / 2;
        game.scene.add(door); city.meshes.push(door);
        const sp = Road.at(collector, 128, collector.halfW + 2.5); sp.p.y = Terrain.height(sp.p.x, sp.p.z) + 0.3;
        city.signs.push(Signs.plain(sp.p, Signs.facingFrom(sv.tan) + Math.PI / 2, 'SERVICE', 'STATION', 4, 2.2));
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
        loadJunctions(city);
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
                else if (city.loaded && (!active || d > DROP_DIST + 1700 + pad)) City.unload(city);
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
