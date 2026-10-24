// tokyo-driver1 v2 — rolling terrain in streamed chunks: a visual mesh plus a Cannon
// Heightfield per chunk, built around the player and dropped when far away.
// Terrain.height(x, z) is THE ground height everywhere; roads and cities read it so they
// sit on (and slant with) the land. Regions can override it by pushing into Terrain.shapers.
window.Terrain = (function () {
    const T = { CHUNK: 200, SEG: 40, RADIUS: 2, shapers: [] };
    const chunks = new Map();
    let scene, world, material;

    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    // Base land: gentle rolling hills, flat around the spawn so the first drive is easy.
    function baseHeight(x, z) {
        const d = Math.hypot(x, z);
        const open = smooth(160, 420, d);
        return open * (3.0 * Math.sin(x * 0.011) * Math.cos(z * 0.009)
            + 2.0 * Math.sin(x * 0.027 + z * 0.019)
            + 1.0 * Math.sin(z * 0.05 + x * 0.013));
    }

    // Shapers: { apply(x, z, h) -> h } for cities (flatten a plateau), hills, etc.
    T.height = function (x, z) {
        let h = baseHeight(x, z);
        for (let i = 0; i < T.shapers.length; i++) h = T.shapers[i](x, z, h);
        return h;
    };

    T.init = function (sc, w) {
        scene = sc; world = w;
        material = new THREE.MeshStandardMaterial({ color: 0x5f8c3c, map: Tex.grass, roughness: 0.95, metalness: 0 });
    };

    function key(i, j) { return i + ',' + j; }

    function buildChunk(i, j) {
        const C = T.CHUNK, N = T.SEG, es = C / N;
        const x0 = i * C, z0 = j * C;              // chunk centre
        const geom = new THREE.PlaneGeometry(C, C, N, N);
        geom.rotateX(-Math.PI / 2);                // now x/z in plane, y up; rows run along z
        Tex.scalePlaneUVs(geom, C, C, 5);
        const p = geom.attributes.position;
        for (let k = 0; k < p.count; k++) {
            const x = x0 + p.getX(k), z = z0 + p.getZ(k);
            p.setY(k, T.height(x, z));
        }
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(geom, material);
        mesh.position.set(x0, 0, z0);
        mesh.receiveShadow = true;
        scene.add(mesh);

        // Physics: Heightfield data[ix][iz] with ix along +x and, after the -90deg X rotation,
        // iz along -z. So the body sits at the chunk's max-z corner and iz counts toward -z.
        // (Cannon 0.6.2's Trimesh does not return wheel raycast hits, so Heightfield it is;
        // its harmless "faceNormals" console spam is filtered in main.js.)
        // One extra cell of overlap on every side: Cannon's heightfield ray test misses right on
        // a chunk edge, and a car parked on a seam would sink through the ground.
        const PAD = 1;
        const data = [];
        for (let ix = -PAD; ix <= N + PAD; ix++) {
            const col = [];
            for (let iz = -PAD; iz <= N + PAD; iz++) {
                col.push(T.height(x0 - C / 2 + ix * es, z0 + C / 2 - iz * es));
            }
            data.push(col);
        }
        const shape = new CANNON.Heightfield(data, { elementSize: es });
        // Group 2 = terrain. Wheel raycasts hit it; car chassis boxes ignore it (cannon's
        // box-vs-heightfield contact gives phantom side-wall hits that stop cars dead).
        const body = new CANNON.Body({ mass: 0, material: world.groundMaterial, collisionFilterGroup: 2 });
        body.isTerrain = true;                                             // main.js's broadphase leaves these out of pair searches
        body.addShape(shape);
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        body.position.set(x0 - C / 2 - PAD * es, 0, z0 + C / 2 + PAD * es);
        world.addBody(body);

        return { mesh, body, geom };
    }

    T.update = function (focus) {
        const C = T.CHUNK;
        const ci = Math.round(focus.x / C), cj = Math.round(focus.z / C);
        for (let i = ci - T.RADIUS; i <= ci + T.RADIUS; i++) {
            for (let j = cj - T.RADIUS; j <= cj + T.RADIUS; j++) {
                const k = key(i, j);
                if (!chunks.has(k)) chunks.set(k, buildChunk(i, j));
            }
        }
        chunks.forEach((ch, k) => {
            const [i, j] = k.split(',').map(Number);
            if (Math.abs(i - ci) > T.RADIUS + 1 || Math.abs(j - cj) > T.RADIUS + 1) {
                scene.remove(ch.mesh); ch.geom.dispose(); world.removeBody(ch.body);
                chunks.delete(k);
            }
        });
    };

    // Rebuild everything (after shapers change, e.g. a city registers its plateau)
    T.rebuild = function (focus) {
        chunks.forEach(ch => { scene.remove(ch.mesh); ch.geom.dispose(); world.removeBody(ch.body); });
        chunks.clear();
        T.update(focus);
    };

    return T;
})();
