// tokyo-driver1 v2 — the route: one long elevated freeway (I-80) past seven cities that
// alternate sides. Right-side cities are reached from the northbound carriageway, left-side
// cities from the southbound one; between cities a U-turn ramp on each side loops under the
// freeway so you can switch direction. The freeway streams in 400-unit chunks and each city
// (streets, buildings, ramps, signs, U-turns) loads when near.
window.World = (function () {
    const W = { spawn: new THREE.Vector3(0, 2, 0), spawnYaw: 0, freeway: null, cities: [], exits: [] };
    const CHUNK = 400, LOAD_DIST = 1400, DROP_DIST = 2400;
    const CITY_GAP = 4200;            // freeway distance between city centres (room for two U-turns between)
    const COLLECTOR_LAT = 48;         // collector avenue runs this far beside the freeway centreline
    const LANE_R = () => Road.types.freeway.median / 2 + Road.types.freeway.laneW * 2.5;   // rightmost lane

    W.build = function () {
        const pts = [], cityS = [];
        CITIES.forEach((spec, k) => cityS.push(1700 + k * CITY_GAP));
        const total = 1700 + CITIES.length * CITY_GAP;
        for (let z = -200; z <= total; z += 200) {
            const near = cityS.some(c => Math.abs(z + 400 - c) < 1300);
            const x = near ? 0 : 60 * Math.sin(z / 900) * Math.sin(z / 350);
            pts.push([x, 0, z]);
        }
        pts.unshift([0, 0, -400]);
        // first pass: a flat curve to know where cities land, define them (registers plateaus)
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[2])), false, 'centripetal', 0.5);
        const UP = new THREE.Vector3(0, 1, 0);
        const probe = (sAt) => { const t = Math.min(1, sAt / curve.getLength()); const p = curve.getPointAt(t), tan = curve.getTangentAt(t).normalize(); return { p, tan, right: new THREE.Vector3().crossVectors(tan, UP).normalize() }; };
        CITIES.forEach((spec, k) => {
            const f = probe(cityS[k]);
            const side = k % 2 === 0 ? 1 : -1;                    // alternate sides of the freeway
            const cols = spec.cols || 5, pitch = (spec.block || 60) + (spec.street || 18);
            const halfW = cols * pitch / 2;
            const center = f.p.clone().addScaledVector(f.right, side * (COLLECTOR_LAT + halfW + 30));
            const base = Terrain.height(center.x, center.z);     // before the plateau is registered
            const heading = Math.atan2(f.tan.x, f.tan.z) + (side < 0 ? Math.PI : 0);   // local +x faces the freeway
            const city = City.define(Object.assign({}, spec, { center: { x: center.x, z: center.z }, heading, base, s: cityS[k], side }));
            city.freewayFrame = f;
            W.cities.push(city);
        });
        // second pass: lift the freeway above the land (and above city plateaus) and define it
        const lifted = pts.map(p => {
            let g = -1e9;
            for (let dz = -120; dz <= 120; dz += 40) for (let dx = -40; dx <= 40; dx += 40) g = Math.max(g, Terrain.height(p[0] + dx, p[2] + dz));
            return [p[0], g + 7, p[2]];
        });
        // barrier gaps where ramps leave and join each carriageway
        const gapsRight = [], gapsLeft = [];
        W.cities.forEach((c, k) => {
            if (c.side === 1) { gapsRight.push([c.s - 1250, c.s - 900]); gapsRight.push([c.s + 770, c.s + 1120]); }
            else { gapsLeft.push([c.s + 900, c.s + 1250]); gapsLeft.push([c.s - 1120, c.s - 770]); }
            if (k < W.cities.length - 1) {
                gapsRight.push([c.s + 1450, c.s + 1950]); gapsLeft.push([c.s + 1450, c.s + 1950]);   // northbound U-turn (s+1500)
                gapsLeft.push([c.s + 1960, c.s + 2450]); gapsRight.push([c.s + 1960, c.s + 2450]);   // southbound U-turn (s+2400)
            }
        });
        W.freeway = Road.define({ type: 'freeway', name: 'I-80', points: lifted, gapsRight, gapsLeft, segLen: 8 });
        W.freewayChunks = {};
        W.total = W.freeway.length;

        // Spawn on the freeway shortly before Tokyo, in the right lane
        const sp = Road.at(W.freeway, 200, LANE_R());
        W.spawn.set(sp.p.x, sp.p.y + 1.2, sp.p.z);
        W.spawnYaw = Road.yawOf(sp.tan);
    };

    // City-specific roads: collector avenue, exit ramp in, on-ramp out, signs, and the two
    // U-turns on the way to the next city.
    function loadCityRoads(city) {
        const fw = W.freeway, hw = fw.width / 2, d = city.side;
        const sExit = city.s - d * 1200, sMerge = city.s + d * 1070;
        const pts = [];
        for (let k = -900; k <= 780; k += 60) { const f = Road.at(fw, city.s + d * k, d * COLLECTOR_LAT); pts.push([f.p.x, 0, f.p.z]); }
        const collector = Road.build({ type: 'avenue', name: city.collectorName || (city.name + ' Frontage Rd'), conform: true, points: pts });
        city.roads.push(collector);
        city.collector = collector;
        const land = Road.at(fw, city.s - d * 900, d * COLLECTOR_LAT);
        const exit = Road.exit(fw, sExit, d, land.p, land.tan.clone().multiplyScalar(d), 'Exit ' + city.exitNumber);
        city.roads.push(exit); W.exits.push(exit);
        const leave = Road.at(fw, city.s + d * 780, d * COLLECTOR_LAT);
        const ramp = Road.onramp(fw, sMerge, d, leave.p, leave.tan.clone().multiplyScalar(d), city.name + ' on-ramp');
        city.roads.push(ramp);
        Traffic.linkRamp(exit); Traffic.linkRamp(ramp);
        if (window.Train && !city.station) { city.station = true; Train.station(city).forEach(m => city.meshes.push(m)); }
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

        // U-turns toward the next city: northbound one at +1500, southbound one at +2400
        // (each loop spans about 470 units of freeway on both sides; they must not overlap)
        const k = W.cities.indexOf(city);
        if (k < W.cities.length - 1) {
            [[1500, 1], [2400, -1]].forEach(([off, dir]) => {
                const sU = city.s + off;
                const u = Road.uturn(fw, sU, dir, 'U-turn');
                city.roads.push(u); Traffic.linkRamp(u);
                const other = dir === 1 ? 'I-80 South' : 'I-80 North';
                const atU = (sAt, lat) => { const f = Road.at(fw, sAt, dir * lat); return { p: f.p, facing: Signs.facingFrom(f.tan.clone().multiplyScalar(dir)) }; };
                const b1 = atU(sU - dir * 400, hw + 3.2); city.signs.push(Signs.exitBoard(b1.p, b1.facing, 'U-TURN', [{ text: 'U-Turn' }, { text: other, size: 48 }], '1/4 MILE'));
                const b2 = atU(sU - dir * 100, hw + 3.2); city.signs.push(Signs.exitBoard(b2.p, b2.facing, 'U-TURN', [{ text: 'U-Turn' }, { text: other, size: 48 }], 'EXIT ONLY'));
                const gg = atU(sU + dir * 210, hw + 1.5); city.signs.push(Signs.goreSign(gg.p, gg.facing, 'U-TURN'));
            });
        }
    }

    // Stream freeway chunks and cities around the player
    let lastS = 0, frame = 0;
    W.update = function (pos) {
        frame++;
        if (frame % 10 === 1) lastS = Road.nearest(W.freeway, pos).s;
        const fw = W.freeway;
        const c0 = Math.floor((lastS - LOAD_DIST) / CHUNK), c1 = Math.floor((lastS + LOAD_DIST) / CHUNK);
        for (let c = Math.max(0, c0); c <= c1; c++) {
            const s0 = c * CHUNK, s1 = Math.min(fw.length, (c + 1) * CHUNK);
            if (s0 >= fw.length) break;
            if (!W.freewayChunks[c]) { W.freewayChunks[c] = Road.buildRange(fw, s0, s1, 'c' + c); if (window.Train) Train.buildRange(fw, s0, s1, 'c' + c); }
        }
        Object.keys(W.freewayChunks).forEach(k => {
            const c = +k, mid = (c + 0.5) * CHUNK;
            if (Math.abs(mid - lastS) > DROP_DIST) { Road.dropRange(fw, 'c' + c); if (window.Train) Train.dropRange('c' + c); delete W.freewayChunks[k]; }
        });
        W.cities.forEach(city => {
            const d = Math.abs(city.s - lastS);
            if (!city.loaded && d < LOAD_DIST + 1500) { City.load(city); loadCityRoads(city); }
            else if (city.loaded && d > DROP_DIST + 1700) City.unload(city);
        });
    };

    // Fast travel: drop the player on the freeway a mile before the city's exit, on the
    // carriageway the exit is on
    W.travelTo = function (city) {
        const d = city.side;
        const s = Math.max(100, Math.min(W.freeway.length - 100, city.s - d * (1200 + 900)));
        const f = Road.at(W.freeway, s, d * LANE_R());
        Terrain.update(f.p);
        W.update(f.p);
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
