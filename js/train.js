// tokyo-driver1 v2 — the train. A railway runs the length of the route on the ground to the
// left of the freeway, with a station at every city. Press T (or the TRAIN button) near the
// train to board: the camera follows it, W/S drive it, T again gets off beside the track.
window.Train = (function () {
    const T = { LAT: -64, chunks: {}, riding: false, speed: 0, s: 0, stations: [] };   // between the left collector and the left cities
    let scene, mesh, railTex, railMat;
    const MAX = 55;            // units/s (~120 mph)

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
        mesh = buildTrain(); mesh.visible = false; scene.add(mesh);
        T.s = 300;
    };

    function buildTrain() {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color: 0x1d6fd6, roughness: 0.4, metalness: 0.5 });
        const silver = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.3, metalness: 0.7 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d22 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x5a7a9a, roughness: 0.2, metalness: 0.4 });
        const carLen = 18, gap = 1.2;
        for (let k = 0; k < 4; k++) {
            const z = -k * (carLen + gap);
            const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, carLen), k === 0 ? paint : silver); body.position.set(0, 2.4, z); g.add(body);
            const win = new THREE.Mesh(new THREE.BoxGeometry(3.05, 1, carLen - 2), glass); win.position.set(0, 3.1, z); g.add(win);
            const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, carLen - 1), dark); base.position.set(0, 0.6, z); g.add(base);
            if (k === 0) { const nose = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3, 4), paint); nose.rotation.x = Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.position.set(0, 2.2, carLen / 2 + 1.4); g.add(nose); }
        }
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        return g;
    }

    // one track chunk per freeway chunk key (world.js calls these alongside the freeway)
    T.buildRange = function (fw, s0, s1, key) {
        if (T.chunks[key]) return;
        const fr = fw.frames.filter(f => { const s = f.t * fw.length; return s >= s0 - fw.segLen && s <= s1 + fw.segLen; });
        if (fr.length < 2) return;
        const geom = Road.strip(fr, { x: T.LAT - 2.2, y: 0 }, { x: T.LAT + 2.2, y: 0 }, 6, fw.length, 0, 1, Road.DRAPE + 0.05);
        const m = new THREE.Mesh(geom, railMat); m.receiveShadow = true; scene.add(m);
        T.chunks[key] = m;
    };
    T.dropRange = function (key) { const m = T.chunks[key]; if (!m) return; scene.remove(m); m.geometry.dispose(); delete T.chunks[key]; };

    // station: platform + sign beside the track at a city
    T.station = function (city) {
        const fw = World.freeway, group = [];
        const f = Road.at(fw, city.s, T.LAT - 6);
        const plat = Road.drapedQuad(f.p.x, f.p.z, 10, Road.yawOf(f.tan), new THREE.MeshStandardMaterial({ color: 0xb5b5b0, map: Tex.concrete, roughness: 0.95 }), 0.9, 2);
        plat.scale.z = 6; group.push(plat);
        const sp = Road.at(fw, city.s + 20, T.LAT - 9); sp.p.y = Terrain.height(sp.p.x, sp.p.z) + 0.9;
        group.push(Signs.plain(sp.p, Signs.facingFrom(f.tan) + Math.PI / 2, 'STATION', city.name.toUpperCase(), 5, 2.2));
        T.stations.push({ city, s: city.s, meshes: group });
        return group;
    };

    T.pose = function (s) { return Road.at(World.freeway, s, T.LAT); };
    T.groundAt = function (s) { const f = T.pose(s); f.p.y = Terrain.height(f.p.x, f.p.z) + Road.DRAPE + 0.05; return f; };

    T.toggle = function () {
        if (T.riding) {
            T.riding = false;
            const f = T.groundAt(T.s);
            const side = f.p.clone().addScaledVector(f.right, -8);
            Car.teleport(side.x, Terrain.height(side.x, side.z) + 1.2, side.z, Road.yawOf(f.tan));
            Car.group.visible = true; Car.wheels.forEach(w => w.visible = true);
            Car.frozen = false;
            UI.toast('Off the train');
            return;
        }
        const d = mesh.position.distanceTo(Car.body.position);
        if (!mesh.visible || d > 40) { UI.toast('Walk up to the train first (it stops at every station)'); return; }
        T.riding = true; Car.frozen = true;
        Car.group.visible = false; Car.wheels.forEach(w => w.visible = false);
        UI.toast('All aboard! W/S drive the train, T to get off', 2500);
    };

    T.update = function (dt, playerPos) {
        if (!World.freeway) return;
        const fw = World.freeway;
        // keep the train within range of the player when not ridden: park it at the nearest station behind the player
        if (!T.riding) {
            const ps = Road.nearest(fw, playerPos).s;
            if (Math.abs(T.s - ps) > 2000) {
                const st = T.stations.map(s => s.s).filter(s => s < ps + 300).sort((a, b) => b - a)[0];
                if (st !== undefined) { T.s = st; T.speed = 0; }
            }
            // idle trains crawl between stations slowly
            const next = T.stations.map(s => s.s).filter(s => s > T.s + 5).sort((a, b) => a - b)[0];
            if (next !== undefined && Math.abs(T.s - ps) < 1500) { T.speed = Math.min(12, T.speed + 4 * dt); if (next - T.s < 60) T.speed = Math.max(0, T.speed - 10 * dt); if (next - T.s < 2) T.speed = 0; }
        } else {
            if (Car.keys.fwd) T.speed = Math.min(MAX, T.speed + 8 * dt);
            else if (Car.keys.back) T.speed = Math.max(0, T.speed - 16 * dt);
            else T.speed = Math.max(0, T.speed - 2 * dt);
        }
        T.s = Math.max(50, Math.min(fw.length - 50, T.s + T.speed * dt));
        const f = T.groundAt(T.s);
        mesh.position.copy(f.p);
        mesh.rotation.set(0, Road.yawOf(f.tan), 0);
        mesh.visible = mesh.position.distanceTo(playerPos) < 1500;
        if (T.riding) {
            // park the car body under the train (frozen) so the world streams around it
            Car.body.position.set(f.p.x, f.p.y + 1, f.p.z); Car.body.velocity.set(0, 0, 0); Car.body.angularVelocity.set(0, 0, 0);
            Car.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Road.yawOf(f.tan));
            Car.mph = T.speed * CFG.MPH;
            const cam = game.camera;
            const back = f.p.clone().addScaledVector(f.tan, -28).addScaledVector(f.right, 10); back.y = f.p.y + 12;
            cam.position.lerp(back, 1 - Math.exp(-dt * 4));
            cam.lookAt(f.p.x, f.p.y + 3, f.p.z);
        }
    };

    return T;
})();
