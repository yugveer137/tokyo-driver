// tokyo-driver1 v2 — races carried over from the old game.
//   Freeway race: two AI cars race you 1500 units up I-80 from where you are. Win 100, lose 20.
//   Street race: six checkpoints through the current city's intersections against the clock;
//   beat par and earn 25 coins per checkpoint.
window.Races = (function () {
    const R = { active: null };
    let scene;
    const rnd = (a, b) => a + Math.random() * (b - a);

    function carMesh(color) {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.6 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x15181c });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.4), paint); body.position.y = 0.65; g.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2), dark); cabin.position.set(0, 1.2, -0.3); g.add(cabin);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), dark); wing.position.set(0, 1.3, -2); g.add(wing);
        const wheelGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10); wheelGeom.rotateZ(Math.PI / 2);
        [[0.85, 1.4], [-0.85, 1.4], [0.85, -1.4], [-0.85, -1.4]].forEach(([x, z]) => { const w = new THREE.Mesh(wheelGeom, dark); w.position.set(x, 0.36, z); g.add(w); });
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        return g;
    }
    function hud(text) { const el = document.getElementById('race-hud'); if (el) el.textContent = text || ''; }

    // ---------- freeway race ----------
    R.startFreeway = function () {
        if (R.active) { UI.toast('A race is already on'); return; }
        const fw = World.freeway, pos = Car.body.position;
        const n = Road.nearest(fw, pos);
        if (n.dist > fw.width) { UI.toast('Get on the freeway first'); return; }
        const lanes = fw.lanes.filter(l => l.dir === 1);
        const opp = [0xe0202a, 0x1f6fe0].map((col, k) => {
            const lane = lanes[k];
            const m = carMesh(col); scene.add(m);
            return { mesh: m, lane, s: n.s - 6, speed: 0, top: rnd(27, 31) + k * 1.5 };
        });
        R.active = { kind: 'freeway', start: n.s, finish: n.s + 1500, opp, countdown: 3, done: false, t: 0 };
        UI.toast('Freeway race! 1500 m to the finish. 3…', 1200);
        placeFinish(Road.at(fw, n.s + 1500, 0).p, Road.at(fw, n.s + 1500, 0).tan, fw.width);
    };
    let finishMesh = null;
    function placeFinish(p, tan, width) {
        if (finishMesh) scene.remove(finishMesh);
        const tex = Tex.textCanvas(512, 64, (ctx, W, H) => { for (let x = 0; x < W; x += 32) for (let y = 0; y < H; y += 32) { ctx.fillStyle = ((x + y) / 32) % 2 ? '#fff' : '#111'; ctx.fillRect(x, y, 32, 32); } });
        finishMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 3), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        finishMesh.position.set(p.x, p.y + 5, p.z);
        finishMesh.rotation.y = Math.atan2(tan.x, tan.z);
        scene.add(finishMesh);
    }

    // ---------- street race ----------
    R.startStreet = function () {
        if (R.active) { UI.toast('A race is already on'); return; }
        const city = City.at(Car.body.position);
        if (!city || !city.loaded) { UI.toast('Street races start inside a city'); return; }
        const cps = [];
        for (let k = 0; k < 6; k++) {
            const i = 1 + Math.floor(Math.random() * (city.rows - 1)), j = 1 + Math.floor(Math.random() * (city.cols - 1));
            const p = city.toWorld(city.streetX(j), city.streetZ(i)); p.y = Terrain.height(p.x, p.z);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.5, 8, 32), new THREE.MeshBasicMaterial({ color: k === 0 ? 0x38d66b : 0xffd21e }));
            ring.rotation.x = Math.PI / 2; ring.position.set(p.x, p.y + 0.8, p.z); ring.visible = k === 0; scene.add(ring);
            cps.push({ p, ring });
        }
        let par = 0;
        for (let k = 0; k < cps.length; k++) par += (k === 0 ? Car.body.position : cps[k - 1].p).distanceTo(cps[k].p);
        par = par / 14 + 12;                                             // seconds at ~30 mph plus turning slack
        R.active = { kind: 'street', cps, idx: 0, t: 0, par, done: false, countdown: 3 };
        UI.toast('Street race! 6 checkpoints, beat ' + Math.round(par) + ' s. 3…', 1500);
    };

    function endRace(won, msg, coins) {
        const A = R.active; if (!A) return;
        if (A.opp) A.opp.forEach(o => scene.remove(o.mesh));
        if (A.cps) A.cps.forEach(c => scene.remove(c.ring));
        if (finishMesh) { scene.remove(finishMesh); finishMesh = null; }
        if (coins) Game.addCoins(coins);
        UI.toast(msg + (coins ? ' +' + coins + ' coins' : ''), 4000);
        hud('');
        R.active = null;
    }
    R.cancel = function () { if (R.active) endRace(false, 'Race cancelled', 0); };

    R.update = function (dt) {
        const A = R.active; if (!A || !Car.body) return;
        A.t += dt;
        if (A.countdown > 0) {
            const before = Math.ceil(A.countdown); A.countdown -= dt;
            const after = Math.ceil(A.countdown);
            if (after < before && after > 0) UI.toast(after + '…', 900);
            if (A.countdown <= 0) UI.toast('GO!', 900);
            hud(A.kind === 'freeway' ? 'FREEWAY RACE — get ready' : 'STREET RACE — get ready');
            return;
        }
        const pos = Car.body.position;
        if (A.kind === 'freeway') {
            const fw = World.freeway;
            const me = Road.nearest(fw, pos).s;
            let ahead = 0;
            A.opp.forEach(o => {
                o.speed += (o.top - o.speed) * Math.min(1, dt * 0.5);
                o.s += o.speed * dt;
                const f = Road.at(fw, o.s, o.lane.offset);
                o.mesh.position.copy(f.p); o.mesh.rotation.set(0, Math.atan2(f.tan.x, f.tan.z), 0);
                if (o.s > me) ahead++;
                if (o.s >= A.finish && !A.done) { A.done = true; endRace(false, 'You lost the freeway race.', 20); }
            });
            if (!R.active) return;
            hud(`FREEWAY RACE — position ${ahead + 1}/3 — ${Math.max(0, Math.round(A.finish - me))} m to go`);
            if (me >= A.finish) endRace(true, 'You won the freeway race!', 100);
        } else {
            const cp = A.cps[A.idx];
            const d = pos.distanceTo(cp.p);
            hud(`STREET RACE — checkpoint ${A.idx + 1}/6 — ${Math.round(d)} m — ${A.t.toFixed(1)} s / par ${Math.round(A.par)} s`);
            cp.ring.rotation.z += dt * 2;
            if (d < 7) {
                cp.ring.visible = false; A.idx++;
                if (A.idx >= A.cps.length) {
                    const won = A.t <= A.par;
                    endRace(won, won ? 'Street race won in ' + A.t.toFixed(1) + ' s!' : 'Finished in ' + A.t.toFixed(1) + ' s, over par.', won ? 150 : 25);
                } else { A.cps[A.idx].ring.visible = true; UI.toast('Checkpoint ' + A.idx + '/6', 900); }
            }
        }
    };

    R.init = function (sc) { scene = sc; };
    return R;
})();
