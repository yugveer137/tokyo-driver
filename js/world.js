// tokyo-driver1 v2 — the route: one long elevated freeway (I-80) past seven cities, each
// with a signed exit onto a collector avenue and an on-ramp back. The freeway is streamed
// in 400-unit chunks and each city (streets, buildings, ramps, signs) loads when near.
window.World = (function () {
    const W = { spawn: new THREE.Vector3(0, 2, 0), spawnYaw: 0, freeway: null, cities: [], exits: [] };
    const CHUNK = 400, LOAD_DIST = 1400, DROP_DIST = 2400;
    const CITY_GAP = 2600;            // freeway distance between city centres
    const COLLECTOR_LAT = 48;         // collector avenue runs this far right of the freeway centreline

    W.build = function () {
        // Place cities along +z. The freeway centreline weaves gently; each city's grid is
        // aligned with the freeway's heading where it passes.
        const pts = [];
        const cityS = [];
        let s = 0;
        pts.push([0, 0, -400]);
        CITIES.forEach((spec, k) => {
            const sC = 1700 + k * CITY_GAP;        // freeway arc length at the city's middle
            cityS.push(sC);
        });
        // waypoints every 200 units; x wanders a little between cities, straight through them
        const total = 1700 + CITIES.length * CITY_GAP;
        for (let z = -200; z <= total; z += 200) {
            const near = cityS.some(c => Math.abs(z + 400 - c) < 1300);
            const x = near ? 0 : 60 * Math.sin(z / 900) * Math.sin(z / 350);
            pts.push([x, 0, z]);
        }
        // first pass: a flat curve to know where cities land, define them (registers plateaus)
        let curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[2])), false, 'centripetal', 0.5);
        const UP = new THREE.Vector3(0, 1, 0);
        const probe = (sAt) => { const t = Math.min(1, sAt / curve.getLength()); const p = curve.getPointAt(t), tan = curve.getTangentAt(t).normalize(); return { p, tan, right: new THREE.Vector3().crossVectors(tan, UP).normalize() }; };
        CITIES.forEach((spec, k) => {
            const f = probe(cityS[k]);
            const cols = spec.cols || 5, pitch = (spec.block || 60) + (spec.street || 18);
            const halfW = cols * pitch / 2;
            const center = f.p.clone().addScaledVector(f.right, COLLECTOR_LAT + halfW + 30);
            const base = Terrain.height(center.x, center.z);     // before the plateau is registered
            const heading = Math.atan2(f.tan.x, f.tan.z);
            const city = City.define(Object.assign({}, spec, { center: { x: center.x, z: center.z }, heading, base, s: cityS[k] }));
            city.freewayFrame = f;
            W.cities.push(city);
        });
        // second pass: lift the freeway above the land (and above city plateaus) and define it
        const lifted = pts.map(p => {
            let g = -1e9;
            for (let dz = -120; dz <= 120; dz += 40) for (let dx = -40; dx <= 40; dx += 40) g = Math.max(g, Terrain.height(p[0] + dx, p[2] + dz));
            return [p[0], g + 7, p[2]];
        });
        const gapsRight = [];
        W.cities.forEach(c => { gapsRight.push([c.s - 1250, c.s - 1020]); gapsRight.push([c.s + 840, c.s + 1120]); });
        W.freeway = Road.define({ type: 'freeway', name: 'I-80', points: lifted, gapsRight, segLen: 8 });
        W.freewayChunks = {};
        W.total = W.freeway.length;

        // Spawn on the freeway shortly before Tokyo, in the right lane
        const sp = Road.at(W.freeway, 200, Road.types.freeway.median / 2 + Road.types.freeway.laneW * 2.5);
        W.spawn.set(sp.p.x, sp.p.y + 1.2, sp.p.z);
        W.spawnYaw = Road.yawOf(sp.tan);
    };

    // City-specific road: collector avenue, exit ramp in, on-ramp out, signs
    function loadCityRoads(city) {
        const fw = W.freeway, hw = fw.width / 2;
        const sExit = city.s - 1200, sMerge = city.s + 1070;
        const pts = [];
        for (let s2 = city.s - 900; s2 <= city.s + 780; s2 += 60) { const f = Road.at(fw, s2, COLLECTOR_LAT); pts.push([f.p.x, 0, f.p.z]); }
        const collector = Road.build({ type: 'avenue', name: city.collectorName || (city.name + ' Frontage Rd'), conform: true, points: pts });
        city.roads.push(collector);
        city.collector = collector;
        const land = Road.at(fw, city.s - 900, COLLECTOR_LAT);
        const exit = Road.exit(fw, sExit, 1, land.p, land.tan, 'Exit ' + city.exitNumber);
        city.roads.push(exit); W.exits.push(exit);
        const leave = Road.at(fw, city.s + 780, COLLECTOR_LAT);
        const ramp = Road.onramp(fw, sMerge, 1, leave.p, leave.tan, city.name + ' on-ramp');
        city.roads.push(ramp);
        Traffic.linkRamp(exit); Traffic.linkRamp(ramp);
        if (window.Train && !city.station) { city.station = true; Train.station(city).forEach(m => city.meshes.push(m)); }
        // connect the collector to the grid: short EW stubs from the collector to street column 0
        for (let i = 0; i <= city.rows; i += 2) {
            const a = city.toWorld(-city.W / 2 - 34, city.streetZ(i)), b = city.toWorld(-city.W / 2 - city.street / 2, city.streetZ(i));
            const m = city.toWorld(-city.W / 2 - 22, city.streetZ(i));
            city.roads.push(Road.build({ type: 'avenue', name: city.streets.ew[i % city.streets.ew.length], conform: true, points: [[a.x, 0, a.z], [m.x, 0, m.z], [b.x, 0, b.z]] }));
        }
        // signs on the freeway: 1 mile, 1/2 mile, exit-only, gore, city limit
        const name = city.name.toUpperCase();
        const board = (sAt, sub) => { if (sAt < 60) return; const f = Road.at(fw, sAt, hw + 3.2); city.signs.push(Signs.exitBoard(f.p, Signs.facingFrom(f.tan), 'EXIT ' + city.exitNumber, [{ text: city.name }, { text: city.sub || 'Downtown', size: 48 }], sub)); };
        board(sExit - 800, '1 MILE'); board(sExit - 400, '1/2 MILE'); board(sExit - 100, 'EXIT ONLY');
        const g = Road.at(fw, sExit + 170, hw + 1.0); city.signs.push(Signs.goreSign(g.p, Signs.facingFrom(g.tan), 'EXIT'));
        if (sExit - 1000 > 60) { const lim = Road.at(fw, sExit - 1000, hw + 2.6); city.signs.push(Signs.plain(lim.p, Signs.facingFrom(lim.tan), 'ENTERING', name, 5, 2.4)); }
        const wel = Road.at(exit, 300, 3.5 + 1.5); city.signs.push(Signs.plain(wel.p, Signs.facingFrom(wel.tan), 'WELCOME TO', name, 5, 2.4));
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
            if (!city.loaded && d < LOAD_DIST + 1300) { City.load(city); loadCityRoads(city); }
            else if (city.loaded && d > DROP_DIST + 1500) City.unload(city);
        });
    };

    // Fast travel: drop the player on the freeway a mile before the city's exit
    W.travelTo = function (city) {
        const s = Math.max(100, city.s - 1200 - 900);
        const f = Road.at(W.freeway, s, Road.types.freeway.median / 2 + Road.types.freeway.laneW * 2.5);
        Terrain.update(f.p);
        W.update(f.p);
        Car.teleport(f.p.x, f.p.y + 1.2, f.p.z, Road.yawOf(f.tan));
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
