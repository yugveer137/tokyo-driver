// tokyo-driver1 v2 — the train. A railway runs the length of the route on the ground to the
// left of the freeway, with a station at every city. Press T (or the TRAIN button) near the
// train (stopped at a station) to board: it runs to a timetable, T again gets off beside the track.
window.Train = (function () {
    // Two tracks on the left of the freeway with an island platform between them: forward (dir +1)
    // trains run on LAT, the ones coming back on LAT2; the platform centre is PLAT.
    const T = { LAT: -60, LAT2: -74, PLAT: -67, chunks: {}, riding: false, speed: 0, s: 0, stations: [] };
    let scene, railTex, railMat;

    T.init = function (sc) {
        scene = sc;
        railTex = Tex.textCanvas(128, 256, (ctx, W, H) => {
            ctx.fillStyle = '#6b6257'; ctx.fillRect(0, 0, W, H);                     // ballast
            for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
            ctx.fillStyle = '#4a3b2a'; for (let y = 8; y < H; y += 32) ctx.fillRect(10, y, W - 20, 12);   // sleepers
            ctx.fillStyle = '#9aa0a6'; ctx.fillRect(34, 0, 6, H); ctx.fillRect(W - 40, 0, 6, H);        // rails
        });
        railTex.wrapS = THREE.ClampToEdgeWrapping; railTex.wrapT = THREE.RepeatWrapping;
        railMat = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    };

    function buildTrain() {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color: 0x1d6fd6, roughness: 0.4, metalness: 0.5 });
        const silver = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.35, metalness: 0.6 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.8 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x3a5e86, roughness: 0.15, metalness: 0.5 });
        const stripe = new THREE.MeshStandardMaterial({ color: 0x1d6fd6, roughness: 0.4, metalness: 0.4 });
        const carLen = 18, gap = 1.0;
        const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
        for (let k = 0; k < 4; k++) {
            const z = -k * (carLen + gap);
            // running gear: an underframe and two bogies with four wheels each, sitting on the rails
            box(2.6, 0.3, carLen - 0.6, dark, 0, 0.9, z);
            [carLen / 2 - 3, -carLen / 2 + 3].forEach(bz => {
                box(2.2, 0.35, 2.6, dark, 0, 0.55, z + bz);
                [-1.0, 1.0].forEach(bx => [-0.9, 0.9].forEach(wz => { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.25, 14), silver); wh.rotation.z = Math.PI / 2; wh.position.set(bx, 0.42, z + bz + wz); g.add(wh); }));
            });
            // body: silver shell, blue stripe under the windows, a row of window panes, two doors a side
            box(3, 2.8, carLen, silver, 0, 2.45, z);
            box(3.04, 0.12, carLen, dark, 0, 1.1, z);                           // sill
            box(3.04, 0.35, carLen, stripe, 0, 1.75, z);                        // stripe
            box(2.6, 0.2, carLen - 0.4, silver, 0, 3.95, z);                     // roof crown
            [-1, 1].forEach(sd => {
                for (let wz = -carLen / 2 + 2.4; wz <= carLen / 2 - 2.4; wz += 1.6) {
                    if (Math.abs(Math.abs(wz) - 5.2) < 0.9) continue;            // door bays
                    box(0.05, 1.0, 1.2, glass, sd * 1.52, 2.95, z + wz);
                }
                [-5.2, 5.2].forEach(dz => { box(0.05, 2.15, 1.3, dark, sd * 1.52, 2.1, z + dz); box(0.06, 0.8, 0.5, glass, sd * 1.53, 2.9, z + dz); box(0.07, 2.1, 0.03, silver, sd * 1.53, 2.1, z + dz); });
            });
            box(1.2, 0.35, 2.0, dark, 0, 4.2, z + 3);                             // roof air-con
            if (k > 0) box(0.3, 0.3, gap + 0.4, dark, 0, 1.0, z + carLen / 2 + gap / 2);   // coupler
        }
        // the front end: a sloped blue nose with a wraparound cab window, headlights and a pantograph
        const nose = box(3, 2.4, 2.2, paint, 0, 2.2, carLen / 2 + 0.9); nose.rotation.x = -0.35;
        box(2.4, 0.9, 0.08, glass, 0, 3.05, carLen / 2 + 1.9);
        [-0.9, 0.9].forEach(x => box(0.4, 0.25, 0.1, new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.8 }), x, 1.7, carLen / 2 + 2.0));
        const pan = box(1.4, 0.06, 0.08, dark, 0, 5.1, -3); [-0.5, 0.5].forEach(x => { const arm = box(0.06, 1.2, 0.06, dark, x, 4.5, -3); arm.rotation.x = 0.4; });
        // the back end
        const tailZ = -3 * (carLen + gap) - carLen / 2;
        [-0.9, 0.9].forEach(x => box(0.4, 0.25, 0.1, new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2020, emissiveIntensity: 0.6 }), x, 1.7, tailZ - 0.05));
        g.traverse(o => { if (o.isMesh && o.geometry.parameters && (o.geometry.parameters.width > 2 || o.geometry.parameters.radiusTop)) o.castShadow = true; });
        // inside the first car: floor, seats, poles, the window band is the gap between wall strips
        const inside = new THREE.Group();
        // unlit materials (the sun does not reach inside). Unlit colours display lighter than
        // written in r128 (hex is taken as linear), so these are picked darker on purpose.
        const floorMat = new THREE.MeshBasicMaterial({ color: 0x0b0d10 }), seatMat = new THREE.MeshBasicMaterial({ color: 0x06173c }), wallMat = new THREE.MeshBasicMaterial({ color: 0x24272c }), poleMat = new THREE.MeshBasicMaterial({ color: 0x4a4e55 });
        const fl = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.06, carLen - 0.2), floorMat); fl.position.y = 1.0; inside.add(fl);
        const ceil = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.06, carLen - 0.2), wallMat); ceil.position.y = 3.95; inside.add(ceil);
        [-1, 1].forEach(sd => {
            const low = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, carLen - 0.2), wallMat); low.position.set(sd * 1.46, 1.5, 0); inside.add(low);
            const high = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, carLen - 0.2), wallMat); high.position.set(sd * 1.46, 3.75, 0); inside.add(high);
            for (let z = -carLen / 2 + 2; z < carLen / 2 - 2; z += 1.7) {
                const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.5), seatMat); seat.position.set(sd * 0.95, 1.5, z); inside.add(seat);
                const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.1), seatMat); back.position.set(sd * 0.95, 1.82, z - 0.25); inside.add(back);
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.1), poleMat); leg.position.set(sd * 0.95, 1.25, z); inside.add(leg);
            }
            for (let z = -carLen / 2 + 3; z < carLen / 2 - 3; z += 4) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.9, 8), poleMat); pole.position.set(sd * 0.45, 2.5, z); inside.add(pole); }
        });
        const front = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3, 0.06), wallMat); front.position.set(0, 2.5, carLen / 2 - 0.3); inside.add(front);
        const cabWin = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.25 })); cabWin.position.set(0, 2.9, carLen / 2 - 0.36); cabWin.rotation.y = Math.PI; inside.add(cabWin);
        inside.visible = false; g.add(inside); g.userData.inside = inside;
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        return g;
    }

    // one track chunk per freeway chunk key (world.js calls these alongside the freeway)
    T.buildRange = function (fw, s0, s1, key) {
        if (T.chunks[key]) return;
        const fr = fw.frames.filter(f => { const s = f.t * fw.length; return s >= s0 - fw.segLen && s <= s1 + fw.segLen; });
        if (fr.length < 2) return;
        const g = new THREE.Group();
        [T.LAT, T.LAT2].forEach(lat => { const m = new THREE.Mesh(Road.strip(fr, { x: lat - 2.2, y: 0 }, { x: lat + 2.2, y: 0 }, 6, fw.length, 0, 1, Road.DRAPE + 0.05), railMat); m.receiveShadow = true; g.add(m); });
        scene.add(g); T.chunks[key] = g;
    };
    T.dropRange = function (key) { const g = T.chunks[key]; if (!g) return; scene.remove(g); g.children.forEach(m => m.geometry.dispose()); delete T.chunks[key]; };

    // station: platform + sign beside the track at a city
    T.station = function (city) {
        const fw = World.freeway, group = [];
        const f = Road.at(fw, city.s, T.PLAT);
        const g0 = Terrain.height(f.p.x, f.p.z), yaw = Road.yawOf(f.tan);
        const add = (m) => { m.castShadow = m.receiveShadow = true; group.push(m); return m; };
        const stn = new THREE.Group(); stn.position.set(f.p.x, g0, f.p.z); stn.rotation.y = yaw; group.push(stn);
        const place = (geom, mat, x, y, z, ry) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; m.castShadow = m.receiveShadow = true; stn.add(m); return m; };
        // local frame: z along the tracks; rails on both sides (x = -5 and x = +5), so edges on both
        const concrete = new THREE.MeshStandardMaterial({ color: 0xbdbdb6, map: Tex.concrete, roughness: 0.95 });
        const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, map: Tex.steel, metalness: 0.75, roughness: 0.35 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.7, metalness: 0.3 });
        const LEN = 64;
        // platform slab with a white safety line and the yellow tactile strip along the edge
        place(Tex.scaleBoxUVs(new THREE.BoxGeometry(10, 0.9, LEN), 10, 0.9, LEN, 4), concrete, 0, 0.45, 0);
        const tactMat = new THREE.MeshStandardMaterial({ map: Tex.tactile, roughness: 0.9 }), lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee });
        [-1, 1].forEach(sd => {
            place(new THREE.BoxGeometry(0.12, 0.02, LEN), lineMat, sd * 4.3, 0.91, 0);
            const tactile = place(Tex.scalePlaneUVs(new THREE.PlaneGeometry(0.6, LEN), 0.6, LEN, 0.6), tactMat, sd * 3.6, 0.915, 0); tactile.rotation.x = -Math.PI / 2;
        });
        // canopy on steel columns, with lamps underneath that glow at night
        place(new THREE.BoxGeometry(8, 0.22, LEN - 8), roofMat, 0, 4.3, 0);
        place(new THREE.BoxGeometry(8.4, 0.5, LEN - 7.6), new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.8 }), 0, 4.55, 0);
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffe6b0, emissiveIntensity: 0 }); City.nightMats.push(lampMat); city.mats.push(lampMat);
        for (let z = -LEN / 2 + 6; z <= LEN / 2 - 6; z += 8) {
            place(new THREE.CylinderGeometry(0.16, 0.18, 3.4, 10), steel, 0, 2.6, z);
            [-2.2, 2.2].forEach(x => place(new THREE.BoxGeometry(0.1, 0.1, 2.4), lampMat, x, 4.15, z + 4));
        }
        // benches, bins, a vending machine, and a fence along the back edge
        const benchMat = new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 0.8 });
        for (let z = -20; z <= 20; z += 20) {
            [-1, 1].forEach(sd => {
                place(new THREE.BoxGeometry(0.5, 0.06, 2.2), benchMat, sd * 0.45, 1.35, z);
                place(new THREE.BoxGeometry(0.06, 0.5, 2.2), benchMat, sd * 0.12, 1.65, z);
                [-0.9, 0.9].forEach(dz => place(new THREE.BoxGeometry(0.4, 0.45, 0.06), steel, sd * 0.45, 1.12, z + dz));
            });
        }
        place(new THREE.CylinderGeometry(0.28, 0.25, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x2d6e3a, roughness: 0.6 }), 0, 1.35, 10);
        const vend = place(new THREE.BoxGeometry(1.0, 1.9, 0.8), new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.5 }), 0, 1.85, -10);
        const vendFront = place(new THREE.BoxGeometry(0.02, 1.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x1b3e8a, emissive: 0x2a60d0, emissiveIntensity: 0.5 }), -0.52, 2.1, -10);
        // hanging name boards (city name, with the stops either side) — the real-station look
        const idx = fw.cities.indexOf(city), prev = fw.cities[idx - 1], next = fw.cities[idx + 1];
        const boardTex = Tex.textCanvas(1024, 256, (ctx, W, H) => {
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#17336b'; ctx.fillRect(0, 0, W, 26); ctx.fillRect(0, H - 26, W, 26);
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#111'; ctx.font = 'bold 110px Helvetica, Arial, sans-serif'; ctx.fillText(city.name, W / 2, H * 0.44);
            ctx.font = '600 34px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#444';
            ctx.textAlign = 'left'; ctx.fillText(prev ? '◀ ' + prev.name : '', 40, H * 0.8);
            ctx.textAlign = 'right'; ctx.fillText(next ? next.name + ' ▶' : '', W - 40, H * 0.8);
            ctx.textAlign = 'center'; ctx.fillStyle = '#17336b'; ctx.font = 'bold 30px Helvetica, Arial, sans-serif'; ctx.fillText('I-80 LINE  ·  TRAINS EVERY MINUTE', W / 2, H * 0.95);
        });
        const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6, side: THREE.DoubleSide });
        [-16, 16].forEach(z => {
            place(new THREE.PlaneGeometry(4, 1), boardMat, 0, 3.5, z, Math.PI / 2);
            [-1.6, 1.6].forEach(dz => place(new THREE.BoxGeometry(0.04, 0.6, 0.04), steel, 0, 4.0, z + dz));
        });
        // ticket office at the far end
        place(new THREE.BoxGeometry(6, 3.2, 5), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, map: Tex.facade, roughness: 0.8 }), 0, 2.5, LEN / 2 - 3);
        place(new THREE.BoxGeometry(6.4, 0.3, 5.4), roofMat, 0, 4.2, LEN / 2 - 3);
        place(new THREE.BoxGeometry(1.4, 2.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a3a4a }), 0, 2.0, LEN / 2 - 5.56);
        const sp = Road.at(fw, city.s + 20, T.PLAT); sp.p.y = g0 + 0.9;
        group.push(Signs.plain(sp.p, Signs.facingFrom(f.tan) + Math.PI / 2, 'STATION', city.name.toUpperCase(), 5, 2.2));
        // stairs down from the freeway's left shoulder, then a footpath over to the platform
        const hw = fw.width / 2;
        const top = Road.at(fw, city.s - 30, -(hw + 1.0)).p.clone();
        const bot = Road.at(fw, city.s - 30, -(hw + 24)).p.clone(); bot.y = Terrain.height(bot.x, bot.z) + 0.1;
        const stairMat = new THREE.MeshStandardMaterial({ color: 0xa9adb3, map: Tex.concrete, roughness: 0.9 });
        const len = top.distanceTo(bot);
        const stair = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, len), stairMat);
        stair.position.copy(top).add(bot).multiplyScalar(0.5); stair.position.y -= 0.12; stair.lookAt(bot.x, bot.y - 0.12, bot.z); stair.castShadow = stair.receiveShadow = true;
        group.push(stair);
        [-1.4, 1.4].forEach(x => { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, len), new THREE.MeshStandardMaterial({ color: 0x6f7780, metalness: 0.6 })); rail.position.copy(stair.position); rail.position.y += 0.6; rail.lookAt(bot.x, bot.y + 0.6 - 0.12, bot.z); rail.translateX(x); group.push(rail); });
        const pathLen = Math.abs(T.PLAT - (-(hw + 24)));
        const pathMid = Road.at(fw, city.s - 30, (-(hw + 24) + T.PLAT) / 2);
        group.push(Road.drapedQuad(pathMid.p.x, pathMid.p.z, pathLen, Road.yawOf(pathMid.tan), stairMat, Road.DRAPE + 0.03, 2, 2.4));
        if (window.Walk) { Walk.addSurface(top, bot, 1.5, city); Walk.addSurface(bot, Road.at(fw, city.s - 30, T.PLAT).p, 1.5, city); }
        if (window.Peds) Peds.spawnPlatform(city, f.p, f.tan);
        // a tall blue beacon so the stop can be seen from the freeway when you are on foot
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 8), new THREE.MeshBasicMaterial({ color: 0x3fa9ff, transparent: true, opacity: 0.55 }));
        beacon.position.copy(f.p); beacon.position.y = Terrain.height(f.p.x, f.p.z) + 20; group.push(beacon);
        const platform = f.p.clone(); platform.y = Terrain.height(f.p.x, f.p.z) + 0.9;
        // you can stand on the platform slab
        if (window.Walk) Walk.addSurface(f.p.clone().addScaledVector(f.tan, -LEN / 2).setY(platform.y), f.p.clone().addScaledVector(f.tan, LEN / 2).setY(platform.y), 5, city);
        group.forEach(m => { if (!m.parent) scene.add(m); });            // signs and draped quads add themselves; the rest go in here
        T.stations.push({ city, s: city.s, meshes: group, platform });
        return group;
    };

    T.pose = function (s, lat) { return Road.at(World.freeway, s, lat === undefined ? T.LAT : lat); };
    T.groundAt = function (s, lat) { const f = T.pose(s, lat); f.p.y = Terrain.height(f.p.x, f.p.z) + Road.DRAPE + 0.05; return f; };

    // ---- timetable ----
    // Stations are the I-80 cities. Trains run out and back along the line as one big loop of
    // "nodes" (0,1,...,last,...,1): every minute each train moves one node on; it waits DWELL
    // seconds at the station, then takes the rest of the minute to reach the next one. One train
    // per node means every stop sees a train each minute (the middle stops: one each way).
    const SLOT = 60, DWELL = 15;
    T.clock = 0; T.trains = [];
    function stationS() { return World.freeway.cities.map(c => c.s).sort((a, b) => a - b); }
    function nodes() { const st = stationS(); const out = st.slice(); for (let i = st.length - 2; i >= 1; i--) out.push(st[i]); return out; }
    function ensureTrains(n) {
        while (T.trains.length < n) { const m = buildTrain(); m.visible = false; scene.add(m); T.trains.push({ mesh: m, s: 0, speed: 0, dir: 1, atStation: false, node: -1 }); }
    }
    // where train p is right now
    function placeTrain(p, tr, nd, playerPos) {
        const N = nd.length, slot = Math.floor(T.clock / SLOT), phase = T.clock - slot * SLOT;
        const node = (p + slot) % N, next = (node + 1) % N;
        const s0 = nd[node], s1 = nd[next];
        tr.dir = s1 >= s0 ? 1 : -1; tr.node = node; tr.nextS = s1;
        if (phase < DWELL) { tr.s = s0; tr.speed = 0; tr.atStation = true; tr.leavesIn = DWELL - phase; }
        else {
            const f = (phase - DWELL) / (SLOT - DWELL), ease = f * f * (3 - 2 * f);          // smooth start and stop
            tr.s = s0 + (s1 - s0) * ease; tr.speed = Math.abs(s1 - s0) * 6 * f * (1 - f) / (SLOT - DWELL); tr.atStation = false; tr.arrivesIn = (1 - f) * (SLOT - DWELL);
        }
        const fr = T.groundAt(tr.s, tr.dir === 1 ? T.LAT : T.LAT2);    // each direction on its own track
        tr.mesh.position.copy(fr.p);
        tr.mesh.rotation.set(0, Road.yawOf(fr.tan) + (tr.dir === 1 ? 0 : Math.PI), 0);
        tr.mesh.visible = tr.mesh.position.distanceTo(playerPos) < 1500;
        tr.frame = fr;
    }
    // seconds until the next train stops at the station at arc length sSt (and whether one is there now)
    T.nextAt = function (sSt) {
        const slot = Math.floor(T.clock / SLOT), phase = T.clock - slot * SLOT;
        const here = T.trains.find(tr => tr.atStation && Math.abs(tr.s - sSt) < 1);
        return here ? { here: true, leavesIn: Math.ceil(here.leavesIn) } : { here: false, inSeconds: Math.ceil(SLOT - phase) };
    };
    // the train you can board: stopped at a station within 40 m of you
    T.near = function (pos) { return T.trains.find(tr => tr.mesh.visible && tr.atStation && tr.mesh.position.distanceTo(pos) < 40) || null; };
    T.toggleView = function () { T.inside = !T.inside; UI.toast(T.inside ? 'Inside the train' : 'Outside view'); };
    T.toggle = function () {
        if (T.riding) {
            const tr = T.ride; T.riding = false; T.ride = null;
            tr.mesh.userData.inside.visible = false;
            const f = tr.frame || T.groundAt(tr.s);
            const station = tr.atStation ? T.stations.find(st => Math.abs(st.s - tr.s) < 1) : null;
            if (station) {
                // at a stop: the car goes in the station car park, you step onto the platform
                const bay = Road.at(World.freeway, station.s + 40, T.LAT + 10 - 4.8);     // the rails-side row, middle bay (kept free)
                Car.teleport(bay.p.x, Terrain.height(bay.p.x, bay.p.z) + 1.2, bay.p.z, Road.yawOf(bay.tan) + Math.PI / 2);
            } else {
                const side = f.p.clone().addScaledVector(f.right, -8);
                Car.teleport(side.x, Terrain.height(side.x, side.z) + 1.2, side.z, Road.yawOf(f.tan));
            }
            Car.group.visible = true; Car.wheels.forEach(w => w.visible = true);
            Car.frozen = false;
            if (T.onFoot && window.Walk) {
                T.onFoot = false; Walk.getOut();
                if (station) {
                    Walk.pos.copy(station.platform).addScaledVector(f.tan, 6); Walk.pos.y = station.platform.y;
                    Walk.yaw = Road.yawOf(f.tan) + Math.PI / 2; Walk.vy = 0;
                    UI.toast('Off the train at ' + station.city.name + '. Your car is in the station car park.', 3500);
                } else UI.toast('Off the train — your car is right here. G gets in.', 3000);
            } else UI.toast(station ? 'Off the train — your car is parked in the station car park' : 'Off the train');
            return;
        }
        const onFoot = window.Walk && Walk.active;
        const who = onFoot ? Walk.pos : Car.body.position;
        const tr = T.near(who);
        if (!tr) {
            const st = T.stations.filter(x => x.city.loaded).sort((a, b) => a.platform.distanceTo(who) - b.platform.distanceTo(who))[0];
            const when = st ? T.nextAt(st.s) : null;
            UI.toast(when ? 'No train here yet — next one stops at ' + st.city.name + ' in ' + when.inSeconds + ' s. Wait on the platform.' : 'Walk up to a train stopped at a station (stops are beside the freeway at every city)', 3500);
            return;
        }
        if (onFoot) { Walk.leaveForTrain(); T.onFoot = true; }
        T.riding = true; T.ride = tr; T.inside = true; Car.frozen = true;
        Car.group.visible = false; Car.wheels.forEach(w => w.visible = false);
        UI.toast('All aboard! Trains run to a timetable — C inside/outside, T to get off at a stop', 3000);
    };

    T.update = function (dt, playerPos) {
        if (!World.freeway) return;
        T.clock += dt;
        const nd = nodes(); ensureTrains(nd.length);
        for (let p = 0; p < nd.length; p++) placeTrain(p, T.trains[p], nd, playerPos);
        if (!T.riding) return;
        const tr = T.ride, f = tr.frame;
        T.s = tr.s; T.speed = tr.speed;
        // park the car body under the train (frozen) so the world streams around it
        Car.body.position.set(f.p.x, f.p.y + 1, f.p.z); Car.body.velocity.set(0, 0, 0); Car.body.angularVelocity.set(0, 0, 0);
        Car.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Road.yawOf(f.tan));
        Car.mph = tr.speed * CFG.MPH;
        // announce stops
        if (tr.atStation && !T.announced) { T.announced = true; const city = World.freeway.cities.find(c => Math.abs(c.s - tr.s) < 1); if (city) UI.toast('This stop: ' + city.name + '. Doors open for ' + DWELL + ' s — press T to get off.', 4000); }
        if (!tr.atStation) T.announced = false;
        const cam = game.camera;
        tr.mesh.userData.inside.visible = !!T.inside;
        if (T.inside) {
            tr.mesh.updateMatrixWorld();
            const eye = tr.mesh.localToWorld(new THREE.Vector3(-0.9, 3.0, 2.0)), look = tr.mesh.localToWorld(new THREE.Vector3(-0.9, 2.85, 40));
            cam.position.copy(eye); cam.lookAt(look);
        } else {
            const back = f.p.clone().addScaledVector(f.tan, -28 * tr.dir).addScaledVector(f.right, 10); back.y = f.p.y + 12;
            cam.position.lerp(back, 1 - Math.exp(-dt * 4));
            cam.lookAt(f.p.x, f.p.y + 3, f.p.z);
        }
    };

    return T;
})();
