// tokyo-driver1 v2 — pedestrians: low-poly people who walk the sidewalks of every loaded city
// and wait on the train platforms. Peds.person() is also the player's walking avatar (walk.js).
// Who they are and where they walk comes from the city's name and the clock, not from chance:
// each walks up and down its street as a fixed function of the time, so every player in a
// multiplayer room (whose clocks Multiplayer.now keeps together) sees the same person in the
// same place.
window.Peds = (function () {
    const P = { walkers: [] };
    let scene;
    const SHIRTS = [0xe2493b, 0x3b7fe2, 0xf2d33b, 0x3bb37a, 0xf4f4f4, 0x222222, 0xd56be0, 0xff8c3b, 0x8ad0ff];
    const PANTS = [0x2b3a55, 0x1d1d1d, 0x6b5a4a, 0x8a8a8a, 0x3a5f3a, 0x2f2f6b];
    const SKINS = [0xf1c9a5, 0xd9a877, 0x9c6b43, 0x5a3b26, 0xf7dcc1, 0xc68642];
    const HAIR = [0x1a1a1a, 0x4a2a10, 0xc9a35a, 0x6b4a3a, 0x8a8a8a];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    function seeded(a) {
        return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    const hashOf = (text) => { let h = 9; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
    // somebody's looks, drawn from a seeded generator
    const lookFrom = (r) => ({ skin: SKINS[Math.floor(r() * SKINS.length)], shirt: SHIRTS[Math.floor(r() * SHIRTS.length)], pants: PANTS[Math.floor(r() * PANTS.length)], hair: HAIR[Math.floor(r() * HAIR.length)] });
    P.lookFor = (text) => lookFrom(seeded(hashOf(text)));
    // seconds on the clock every player shares (counted from late 2025, to keep the number small)
    const clock = () => ((window.Multiplayer && Multiplayer.now ? Multiplayer.now() : Date.now()) - 1.76e12) / 1000;
    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });

    P.person = function (o) {
        o = o || {};
        const g = new THREE.Group();
        const skin = mat(o.skin || pick(SKINS)), shirt = mat(o.shirt !== undefined ? o.shirt : pick(SHIRTS)), pants = mat(o.pants !== undefined ? o.pants : pick(PANTS));
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.22), shirt); torso.position.y = 1.07; g.add(torso);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), skin); neck.position.y = 1.37; g.add(neck);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 9), skin); head.position.y = 1.5; g.add(head);
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.137, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(o.hair || pick(HAIR))); hair.position.y = 1.51; g.add(hair);
        const legs = [-0.1, 0.1].map(x => { const piv = new THREE.Group(); piv.position.set(x, 0.8, 0); const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.8, 0.17), pants); leg.position.y = -0.4; piv.add(leg); const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.26), mat(0x222222)); shoe.position.set(0, -0.78, 0.04); piv.add(shoe); g.add(piv); return piv; });
        const arms = [-0.26, 0.26].map(x => { const piv = new THREE.Group(); piv.position.set(x, 1.3, 0); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), shirt); arm.position.y = -0.28; piv.add(arm); const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), skin); hand.position.y = -0.58; piv.add(hand); g.add(piv); return piv; });
        g.userData = { legs, arms, phase: Math.random() * 6 };
        g.traverse(m => { if (m.isMesh) m.castShadow = true; });
        return g;
    };
    P.animate = function (g, dt, moving, fast) {
        const u = g.userData; if (!u || !u.legs) return;
        if (moving) {
            u.phase += dt * (fast ? 11 : 7);
            const a = Math.sin(u.phase) * (fast ? 0.8 : 0.55);
            u.legs[0].rotation.x = a; u.legs[1].rotation.x = -a; u.arms[0].rotation.x = -a * 0.7; u.arms[1].rotation.x = a * 0.7;
        } else {
            u.legs[0].rotation.x *= 0.8; u.legs[1].rotation.x *= 0.8; u.arms[0].rotation.x *= 0.8; u.arms[1].rotation.x *= 0.8;
        }
    };

    function place(w) {
        const c = w.city, off = w.side * (c.street / 2 + 1.6);
        const lx = w.ns ? c.streetX(w.idx) + off : w.s, lz = w.ns ? w.s : c.streetZ(w.idx) + off;
        const p = c.toWorld(lx, lz); p.y = Terrain.height(p.x, p.z) + 0.22;
        w.mesh.position.copy(p);
        const f = c.toWorld(w.ns ? lx : lx + w.dir, w.ns ? lz + w.dir : lz);
        w.mesh.rotation.y = Math.atan2(f.x - p.x, f.z - p.z);
    }
    // sidewalk walkers for a city (called when the city loads)
    P.spawnCity = function (city) {
        if (!scene) return;
        const n = Math.min(44, Math.round(8 + city.rows * city.cols * 0.6));   // each person is a dozen draw calls: keep it modest
        city.peds = city.peds || [];
        const r = seeded(hashOf('walkers:' + city.id));
        for (let k = 0; k < n; k++) {
            const ns = r() < 0.5, side = r() < 0.5 ? -1 : 1;
            const idx = Math.floor(r() * ((ns ? city.cols : city.rows) + 1));
            const len = ns ? city.D : city.W, reach = len / 2 - 4;         // they walk from -reach to +reach and back
            // `lap` is where they start on that round trip (0..4 x reach), `speed` how fast they go round it
            const w = { mesh: P.person(lookFrom(r)), city, ns, idx, side, s: 0, dir: 1, speed: 1.1 + r() * 0.8, len, reach, lap: r() * 4 * reach };
            scene.add(w.mesh); city.peds.push(w); P.walkers.push(w); stride(w, clock()); place(w);
        }
    };
    // a few people waiting on a train platform
    P.spawnPlatform = function (city, point, tan) {
        if (!scene) return;
        city.peds = city.peds || [];
        const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
        const r = seeded(hashOf('platform:' + city.id));
        for (let k = 0; k < 4; k++) {
            const m = P.person(lookFrom(r));
            m.position.copy(point).addScaledVector(tan, -18 + k * 12 + r() * 4).addScaledVector(right, -1 + r() * 2);
            m.position.y = Terrain.height(m.position.x, m.position.z) + 0.95;
            m.rotation.y = Math.atan2(right.x, right.z) + (r() - 0.5);
            scene.add(m);
            const w = { mesh: m, city, idle: true, t: Math.random() * 5 };
            city.peds.push(w); P.walkers.push(w);
        }
    };
    P.unloadCity = function (city) {
        (city.peds || []).forEach(w => scene.remove(w.mesh));
        city.peds = [];
        P.walkers = P.walkers.filter(w => w.city !== city);
    };
    // where a walker is on its round trip at time t: out along the street, then back
    function stride(w, t) {
        const round = 4 * w.reach, at = (w.lap + w.speed * t) % round;
        w.dir = at < round / 2 ? 1 : -1;
        w.s = (at < round / 2 ? at : round - at) - w.reach;
    }
    P.update = function (dt, playerPos) {
        const t = clock();
        for (let i = 0; i < P.walkers.length; i++) {
            const w = P.walkers[i];
            const dx = w.mesh.position.x - playerPos.x, dz = w.mesh.position.z - playerPos.z;
            const d2 = dx * dx + dz * dz;
            const show = d2 < 220 * 220;                                        // too small to see further out, so don't draw them
            if (w.mesh.visible !== show) w.mesh.visible = show;
            if (!show) continue;
            if (w.idle) { w.t += dt; w.mesh.position.y += Math.sin(w.t * 2) * 0.0005; continue; }
            stride(w, t);
            place(w);
            P.animate(w.mesh, dt, true);
        }
    };
    P.init = function (sc) { scene = sc; };
    return P;
})();
