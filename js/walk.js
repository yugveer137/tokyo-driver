// tokyo-driver1 v2 — on foot. G gets you out of the (stopped) car: W/A/S/D walk, Space runs,
// G by the car gets back in, T by a train boards it. You can walk on the freeway deck, down the
// station stairs beside it, along the streets. Falling off an edge just drops you to the ground.
window.Walk = (function () {
    const W = { active: false, avatar: null, pos: new THREE.Vector3(), yaw: 0, vy: 0, surfaces: [] };
    let scene, camera, prevView = 'chase', frame = 0, lastHint = 0;
    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();

    W.init = function (sc, cam) { scene = sc; camera = cam; };

    // sloped walkways (station stairs): a segment a->b with a half width; height interpolates
    W.addSurface = function (a, b, halfW, city) { const s = { a: a.clone(), b: b.clone(), halfW, city }; W.surfaces.push(s); return s; };

    // where your feet go at (x, z), given where you are now (so a deck 7 m above you is not "ground")
    W.groundY = function (x, z, curY) {
        let y = Terrain.height(x, z) + 0.05;
        tmp.set(x, curY, z);
        for (let i = 0; i < Road.all.length; i++) {
            const r = Road.all[i]; if (r.conform || !r.frames) continue;
            const n = Road.nearest(r, tmp);
            if (n.dist < r.halfW + 1.0 && Math.abs(n.frame.p.y - curY) < 1.6) y = Math.max(y, n.frame.p.y + 0.05);
        }
        for (let i = 0; i < W.surfaces.length; i++) {
            const s = W.surfaces[i]; if (s.city && !s.city.loaded) continue;
            const abx = s.b.x - s.a.x, abz = s.b.z - s.a.z, L2 = abx * abx + abz * abz;
            const t = Math.max(0, Math.min(1, ((x - s.a.x) * abx + (z - s.a.z) * abz) / L2));
            const px = s.a.x + abx * t, pz = s.a.z + abz * t;
            if (Math.hypot(x - px, z - pz) < s.halfW) { const sy = s.a.y + (s.b.y - s.a.y) * t; if (Math.abs(sy - curY) < 2.5) y = Math.max(y, sy + 0.05); }
        }
        return y;
    };

    W.toggle = function () {
        if (!Car.body || !Game.started) return;
        if (window.Train && Train.riding) { UI.toast('Press T to get off the train first'); return; }
        if (W.active) {
            if (W.pos.distanceTo(Car.body.position) < 5) W.getIn();
            else UI.toast('Walk back to your car to get in (G)');
            return;
        }
        if (Car.mph > 3) { UI.toast('Stop the car first, then press G'); return; }
        W.getOut();
    };
    W.getOut = function () {
        prevView = Car.view; if (Car.view === 'cockpit') Car.view = 'chase';
        Car.parked = true; Car.cruise = null; Car.autoBrake = false; Car.assistSteer = null;
        if (window.SelfDrive && SelfDrive.active) SelfDrive.cancel(true);
        Object.assign(Car.keys, { fwd: false, back: false, left: false, right: false, drift: false });
        const q = Car.body.quaternion;
        tmp.set(-1.6, 0, 0.2).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(Car.body.position);   // driver's door (right-hand drive)
        W.pos.set(tmp.x, Car.body.position.y - 0.6, tmp.z);
        W.pos.y = W.groundY(W.pos.x, W.pos.z, Car.body.position.y);
        W.yaw = Car.yaw(); W.vy = 0;
        W.avatar = Peds.person({ shirt: 0x1d6fd6, pants: 0x1d1d1d, hair: 0x1a1a1a });
        W.avatar.position.copy(W.pos); W.avatar.rotation.y = W.yaw;
        scene.add(W.avatar); W.active = true;
        camPos.copy(camera.position);
        UI.toast('On foot. W/A/S/D walk, Space run, G get back in, T boards a train', 3500);
    };
    W.getIn = function () {
        if (W.avatar) scene.remove(W.avatar); W.avatar = null;
        W.active = false; Car.parked = false; Car.view = prevView; W.hideGuide();
        UI.toast('Back in the car');
    };
    W.leaveForTrain = function () {           // the train takes over from here
        if (W.avatar) scene.remove(W.avatar); W.avatar = null;
        W.active = false; Car.parked = false; Car.view = prevView; W.hideGuide();
    };

    W.update = function (dt) {
        if (!W.active || !W.avatar) return;
        const k = Car.keys, run = k.drift, sp = run ? 9 : 4;
        if (k.left) W.yaw += 2.6 * dt;
        if (k.right) W.yaw -= 2.6 * dt;
        let mv = 0; if (k.fwd) mv = sp; else if (k.back) mv = -sp * 0.55;
        if (mv) { W.pos.x += Math.sin(W.yaw) * mv * dt; W.pos.z += Math.cos(W.yaw) * mv * dt; }
        if (frame++ % 2 === 0 || mv) W.gy = W.groundY(W.pos.x, W.pos.z, W.pos.y);
        const gy = W.gy === undefined ? W.pos.y : W.gy;
        if (W.pos.y > gy + 0.25) { W.vy -= 25 * dt; W.pos.y = Math.max(gy, W.pos.y + W.vy * dt); }
        else { W.pos.y = gy; W.vy = 0; }
        W.avatar.position.copy(W.pos); W.avatar.rotation.y = W.yaw;
        Peds.animate(W.avatar, dt, mv !== 0, run);
        // third-person camera behind the walker
        tmp.set(-Math.sin(W.yaw) * 4.2, 2.3, -Math.cos(W.yaw) * 4.2).add(W.pos);
        const g2 = Terrain.height(tmp.x, tmp.z) + 0.6; if (tmp.y < g2) tmp.y = g2;
        camPos.lerp(tmp, 1 - Math.exp(-dt * 7)); camera.position.copy(camPos);
        camLook.set(Math.sin(W.yaw) * 2, 1.4, Math.cos(W.yaw) * 2).add(W.pos); camera.lookAt(camLook);
        camera.fov += (70 - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix();
        // guide line to the nearest train stop, so you can walk there on your own
        guide();
        // hints
        const now = performance.now();
        if (now - lastHint > 4000) {
            if (W.pos.distanceTo(Car.body.position) < 5) { UI.toast('G: get back in the car', 1500); lastHint = now; }
            else if (window.Train && Train.near(W.pos)) { UI.toast('T: board the train', 1500); lastHint = now; }
        }
    };
    // "Train stop 240 m, up ahead on your left" while on foot; the station beacon marks it
    let guideEl = null, guideFrame = 0;
    function guide() {
        if (guideFrame++ % 10 || !window.Train) return;
        if (!guideEl) { guideEl = document.getElementById('hud-walk'); if (!guideEl) return; }
        let best = null, bd = Infinity;
        Train.stations.forEach(st => { if (!st.city.loaded || !st.platform) return; const d = st.platform.distanceTo(W.pos); if (d < bd) { bd = d; best = st; } });
        if (!best) { guideEl.textContent = 'No train stop near here — stops are beside the freeway at every city'; return; }
        const dx = best.platform.x - W.pos.x, dz = best.platform.z - W.pos.z;
        let rel = Math.atan2(dx, dz) - W.yaw; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
        const where = Math.abs(rel) < 0.4 ? 'straight ahead' : Math.abs(rel) > 2.7 ? 'behind you' : rel > 0 ? 'on your left' : 'on your right';
        const steps = bd < 15 ? 'Train stop right here — press T when the train is in' : best.city.name + ' train stop: ' + Math.round(bd) + ' m, ' + where + (bd > 60 ? ' (look for the blue beacon; stairs go down from the freeway\'s left shoulder)' : '');
        guideEl.textContent = steps;
    }
    W.hideGuide = function () { if (guideEl) guideEl.textContent = ''; };
    return W;
})();
