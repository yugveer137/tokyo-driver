// tokyo-driver1 v2 — trees. A clump of trees is two InstancedMeshes (all the trunks, all the
// crowns), so a few hundred trees cost two draw calls. They are scenery only: no physics.
// Cities plant their parks and sidewalks (City), the land between plants itself by terrain
// chunk (Trees.wild), kept clear of the freeways, the railway beside them, the bay and the cities.
window.Trees = (function () {
    const T = {};
    let scene, trunkGeo, crownGeo, trunkMat, crownMat;
    const UP = new THREE.Vector3(0, 1, 0);

    T.init = function (sc) {
        scene = sc;
        trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1, 6); trunkGeo.translate(0, 0.5, 0);     // one unit tall, standing on its base
        crownGeo = new THREE.IcosahedronGeometry(1, 1);
        trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3f2a, roughness: 1 });
        crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });   // (each crown brings its own green)
    };

    // A repeatable random number from a seed: the same chunk grows the same trees every time it loads
    function seeded(seed) {
        let a = seed >>> 0;
        return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    }

    // Plant trees at `spots`: [{ x, y, z, size }], y the ground height and size 1 a 7 m tree.
    // Returns what T.remove takes back (or null for no trees).
    T.plant = function (spots) {
        if (!scene || !spots.length) return null;
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
        const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), green = new THREE.Color();
        spots.forEach((t, k) => {
            const rnd = seeded(Math.floor(t.x * 31 + t.z * 17) + k);
            const h = 3.2 * t.size, r = 2.4 * t.size;
            m.compose(p.set(t.x, t.y - 0.2, t.z), q.identity(), s.set(t.size, h + 0.4, t.size)); trunks.setMatrixAt(k, m);
            q.setFromAxisAngle(UP, rnd() * 6.28);
            m.compose(p.set(t.x, t.y + h + r * 0.5, t.z), q, s.set(r, r * (0.85 + rnd() * 0.35), r)); crowns.setMatrixAt(k, m);
            crowns.setColorAt(k, green.setHSL(0.25 + rnd() * 0.08, 0.55 + rnd() * 0.15, 0.13 + rnd() * 0.08));
        });
        crowns.instanceColor.needsUpdate = true;
        crowns.castShadow = true;
        // (three.js culls an InstancedMesh by its one base shape, which sits at the world origin)
        trunks.frustumCulled = crowns.frustumCulled = false;
        const g = new THREE.Group(); g.add(trunks); g.add(crowns);
        scene.add(g);
        return g;
    };
    T.remove = function (g) { if (g) { scene.remove(g); g.children.forEach(c => c.dispose()); } };

    // Is this spot open country? Not the bay or its shores, not within 100 m of a freeway (its
    // U-turn loops reach 51 m out and the railway runs at 60 to 74; a clump spreads up to 23 m
    // from the spot tested, so trees start about 77 m out), not in or beside a city, not in the
    // water of the Golden Gate, not on the Pacific beach or in the sea, and not on a country road.
    function openCountry(x, z) {
        if (!window.World || !World.freeways || !World.freeways.length) return false;
        const w = World.water;
        if (w && Math.abs(x - w.x) < w.w / 2 + 320 && Math.abs(z - w.z) < w.d / 2 + 150) return false;
        if (World.ocean && x > World.ocean.x0 - 60) return false;         // the beach west of Highway 1, and the sea
        // (25 m clear of the country roads between the freeways)
        const roads = World.connectors || [];
        for (let i = 0; i < roads.length; i++) {
            const k = roads[i], pts = k.points;
            for (let j = 0; j < pts.length - 1; j++) {
                const ax = pts[j][0], az = pts[j][2], dx = pts[j + 1][0] - ax, dz = pts[j + 1][2] - az;
                const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
                if (Math.hypot(x - ax - dx * t, z - az - dz * t) < 50) return false;   // (the road's S strays a little from these straight pieces; a clump spreads 23 m)
            }
        }
        const p = new THREE.Vector3(x, 8, z);
        for (let i = 0; i < World.freeways.length; i++) if (Road.nearest(World.freeways[i], p).dist < 100) return false;
        for (let i = 0; i < City.all.length; i++) {
            const c = City.all[i], l = c.toLocal(x, z);
            if (Math.abs(l.lx) < c.W / 2 + 140 && Math.abs(l.lz) < c.D / 2 + 140) return false;
            // (a city with a town across the water: nothing in the strait between them, which
            // in the city's own frame runs out along z, 900 wide to one side as cities.js digs it)
            if (c.satellite) {
                const far = c.toLocal(c.satellite.center.x, c.satellite.center.z);
                const along = l.lz * Math.sign(far.lz);
                if (along > 0 && along < Math.abs(far.lz) + c.satellite.D / 2 + 140 && l.lx > -960 && l.lx < c.W / 2 + 70) return false;
            }
        }
        return true;
    }

    // The wild trees of one terrain chunk (centre x0, z0, `size` across): a few clumps, each a
    // handful of trees round a centre that passes openCountry.
    T.wild = function (x0, z0, size) {
        if (Math.abs(x0) > 20000) return null;                           // (the REAL MAP is built far out at x = 60000)
        const rnd = seeded(Math.round(x0 / size) * 73856093 ^ Math.round(z0 / size) * 19349663);
        const spots = [];
        const clumps = 1 + Math.floor(rnd() * 5);
        for (let c = 0; c < clumps; c++) {
            const cx = x0 + (rnd() - 0.5) * (size - 40), cz = z0 + (rnd() - 0.5) * (size - 40);
            const n = 4 + Math.floor(rnd() * 8);
            if (!openCountry(cx, cz)) continue;
            for (let k = 0; k < n; k++) {
                const a = rnd() * 6.28, d = 3 + rnd() * 20;
                const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
                spots.push({ x, y: Terrain.height(x, z), z, size: 0.8 + rnd() * 0.9 });
            }
        }
        return T.plant(spots);
    };

    return T;
})();
