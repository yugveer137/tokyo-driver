// tokyo-driver1 v2 — pedestrians: low-poly people who walk the sidewalks of every loaded city
// and wait on the train platforms. Peds.person() is also the player's walking avatar (walk.js).
window.Peds = (function () {
    const P = { walkers: [] };
    let scene;
    const SHIRTS = [0xe2493b, 0x3b7fe2, 0xf2d33b, 0x3bb37a, 0xf4f4f4, 0x222222, 0xd56be0, 0xff8c3b, 0x8ad0ff];
    const PANTS = [0x2b3a55, 0x1d1d1d, 0x6b5a4a, 0x8a8a8a, 0x3a5f3a, 0x2f2f6b];
    const SKINS = [0xf1c9a5, 0xd9a877, 0x9c6b43, 0x5a3b26, 0xf7dcc1, 0xc68642];
    const HAIR = [0x1a1a1a, 0x4a2a10, 0xc9a35a, 0x6b4a3a, 0x8a8a8a];
    const pick = a => a[Math.floor(Math.random() * a.length)];
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
        const n = Math.round(12 + city.rows * city.cols);
        city.peds = city.peds || [];
        for (let k = 0; k < n; k++) {
            const ns = Math.random() < 0.5, side = Math.random() < 0.5 ? -1 : 1;
            const idx = Math.floor(Math.random() * ((ns ? city.cols : city.rows) + 1));
            const len = ns ? city.D : city.W;
            const w = { mesh: P.person(), city, ns, idx, side, s: (Math.random() - 0.5) * (len - 8), dir: Math.random() < 0.5 ? -1 : 1, speed: 1.1 + Math.random() * 0.8, len };
            scene.add(w.mesh); city.peds.push(w); P.walkers.push(w); place(w);
        }
    };
    // a few people waiting on a train platform
    P.spawnPlatform = function (city, point, tan) {
        if (!scene) return;
        city.peds = city.peds || [];
        const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
        for (let k = 0; k < 4; k++) {
            const m = P.person();
            m.position.copy(point).addScaledVector(tan, -18 + k * 12 + Math.random() * 4).addScaledVector(right, -1 + Math.random() * 2);
            m.position.y = Terrain.height(m.position.x, m.position.z) + 0.95;
            m.rotation.y = Math.atan2(right.x, right.z) + (Math.random() - 0.5);
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
    P.update = function (dt, playerPos) {
        for (let i = 0; i < P.walkers.length; i++) {
            const w = P.walkers[i];
            const dx = w.mesh.position.x - playerPos.x, dz = w.mesh.position.z - playerPos.z;
            if (dx * dx + dz * dz > 350 * 350) continue;
            if (w.idle) { w.t += dt; w.mesh.position.y += Math.sin(w.t * 2) * 0.0005; continue; }
            w.s += w.dir * w.speed * dt;
            if (Math.abs(w.s) > w.len / 2 - 4) { w.dir *= -1; w.s = Math.sign(w.s) * (w.len / 2 - 4); }
            place(w);
            P.animate(w.mesh, dt, true);
        }
    };
    P.init = function (sc) { scene = sc; };
    return P;
})();
