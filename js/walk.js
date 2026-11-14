// tokyo-driver1 v2 — on foot. G gets you out of the (stopped) car: W/A/S/D walk, Space runs,
// G by the car gets back in, T by a train boards it. You can walk on the freeway deck, down the
// station stairs beside it, along the streets. Falling off an edge just drops you to the ground.
// E at a downtown door goes inside (places.js). In multiplayer, G beside another player's car
// gets you in as their passenger: you ride along until G lets you out.
window.Walk = (function () {
    const W = { active: false, avatar: null, pos: new THREE.Vector3(), yaw: 0, vy: 0, surfaces: [], room: null, running: false };
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
            if (W.ride) { UI.toast('You are in the back of a police car. Sit tight.'); return; }
            if (W.cuffed) { UI.toast('You are handcuffed.'); return; }
            if (window.Robbery && Robbery.jumpInNearby && Robbery.jumpInNearby()) return;   // a robber friend's car (or your parked one) right here
            if (W.passenger) { W.stepOut(); return; }
            if (W.room) { UI.toast(W.room.jail ? 'The cell is locked. ESCAPE jumps out the window.' : 'Leave by the door first: E at the door'); return; }
            const other = W.rideOffer();
            if (other) W.rideWith(other);
            else if (W.pos.distanceTo(Car.body.position) < 5) W.getIn();
            else UI.toast('Walk back to your car to get in (G)');
            return;
        }
        if (Car.mph > 3) { UI.toast('Stop the car first, then press G'); return; }
        W.getOut();
    };
    W.getOut = function () {
        prevView = Car.view; if (Car.view !== 'chase') Car.view = 'chase';
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
    // Riding in another player's car (multiplayer). You sit in theirs and see it from behind;
    // your own car comes along out of sight, frozen underneath (as it does under a train), so the
    // world streams around you both and it is there when you get out.
    // the other player's car G would get you into: one within 6 m, unless your own is nearer
    W.rideOffer = function () {
        if (!W.active || W.passenger || W.room || W.ride || W.cuffed || !window.Multiplayer || !Multiplayer.carNear) return null;
        const c = Multiplayer.carNear(W.pos, 6);
        return c && c.mesh.position.distanceTo(W.pos) < W.pos.distanceTo(Car.body.position) ? c : null;
    };
    W.rideWith = function (c) {
        W.passenger = { id: c.id, label: c.label };
        if (W.avatar) W.avatar.visible = false;
        Car.frozen = true; Car.group.visible = false; Car.wheels.forEach(w => { w.visible = false; });
        W.hideGuide();
        Multiplayer.tell(c.id, 'I got in your car!');
        UI.toast('Riding with ' + c.label + '. G gets you out.', 3500);
    };
    W.stepOut = function (why) {
        const p = W.passenger; if (!p) return;
        W.passenger = null;
        // your car is parked just behind theirs; you stand at the roadside next to it
        Car.frozen = false;
        Car.teleport(W.pos.x - Math.sin(W.yaw) * 7, W.pos.y + 0.8, W.pos.z - Math.cos(W.yaw) * 7, W.yaw);
        Car.group.visible = true; Car.wheels.forEach(w => { w.visible = true; });
        Car.mph = 0;
        W.pos.x += Math.cos(W.yaw) * 2.4 - Math.sin(W.yaw) * 7; W.pos.z += -Math.sin(W.yaw) * 2.4 - Math.cos(W.yaw) * 7;
        W.pos.y = W.groundY(W.pos.x, W.pos.z, W.pos.y); W.vy = 0;
        if (W.avatar) W.avatar.visible = true;
        UI.toast(why || 'Out of ' + p.label + '\'s car. Your own car is right here: G gets in.', 3500);
    };
    // each frame as a passenger: go where their car goes (false once it is gone)
    function rideAlong() {
        const c = window.Multiplayer && Multiplayer.car ? Multiplayer.car(W.passenger.id) : null;
        if (!c || !c.mesh.visible) { W.stepOut(W.passenger.label + ' has gone. You are back on your feet, with your car.'); return false; }
        W.pos.copy(c.mesh.position);
        tmp.set(0, 0, 1).applyQuaternion(c.mesh.quaternion); W.yaw = Math.atan2(tmp.x, tmp.z);
        const b = Car.body;
        b.position.set(W.pos.x, W.pos.y + 0.5, W.pos.z); b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
        b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), W.yaw);
        Car.mph = Math.min(220, c.speed * CFG.MPH);                           // (their car jumping somewhere, by fast travel say, is not speed)
        return true;
    }

    W.getIn = function () {
        if (W.passenger) { W.passenger = null; Car.frozen = false; }
        if (W.avatar) scene.remove(W.avatar); W.avatar = null;
        W.active = false; Car.parked = false; Car.view = prevView; W.hideGuide();
        UI.toast('Back in the car');
    };
    W.leaveForTrain = function () {           // the train takes over from here
        W.passenger = null;
        if (W.avatar) scene.remove(W.avatar); W.avatar = null;
        W.active = false; Car.parked = false; Car.view = prevView; W.hideGuide();
    };

    // inside a house (robbery): the room keeps you within its walls and the camera comes in close
    // (inside you see through your own eyes: the rooms are too small for the camera behind you)
    W.enterRoom = function (room) {
        W.room = room; W.pos.copy(room.doorIn); W.pos.y = room.floorY; W.vy = 0; W.hideGuide(); if (W.avatar) W.avatar.visible = false;
        const at = room.loot || room.bed || room.lookAt; if (at) W.yaw = Math.atan2(at.x - W.pos.x, at.z - W.pos.z);   // in through the door, facing into the room
    };
    W.leaveRoom = function () { const r = W.room; W.room = null; if (W.avatar) W.avatar.visible = true; if (r) { W.pos.copy(r.doorOut); W.pos.y = W.groundY(W.pos.x, W.pos.z, r.doorOut.y + 0.5); } };

    W.update = function (dt) {
        if (!W.active || !W.avatar) return;
        const k = Car.keys, run = k.drift, sp = run ? 9 : 4;
        if (k.left) W.yaw += 2.6 * dt;
        if (k.right) W.yaw -= 2.6 * dt;
        let mv = 0; if (k.fwd) mv = sp; else if (k.back) mv = -sp * 0.55;
        if (W.cuffed) mv = 0;                                                  // handcuffed: you stand there
        if (W.ride) { W.pos.copy(W.ride.position); W.pos.y += 0.2; W.yaw = W.ride.rotation.y; mv = 0; }   // in the back of the police car
        const riding = !!(W.passenger && rideAlong());                       // in another player's car
        if (riding) mv = 0;
        if (mv) { W.pos.x += Math.sin(W.yaw) * mv * dt; W.pos.z += Math.cos(W.yaw) * mv * dt; }
        W.running = !!(run && mv); W.moving = mv !== 0;
        if (W.room) W.room.clamp(W.pos);
        if (W.room) W.gy = W.room.floorY;
        else if (W.ride || riding) W.gy = W.pos.y;
        else if (frame++ % 2 === 0 || mv) W.gy = W.groundY(W.pos.x, W.pos.z, W.pos.y);
        const gy = W.gy === undefined ? W.pos.y : W.gy;
        if (W.pos.y > gy + 0.25) { W.vy -= 25 * dt; W.pos.y = Math.max(gy, W.pos.y + W.vy * dt); }
        else { W.pos.y = gy; W.vy = 0; }
        W.avatar.position.copy(W.pos); W.avatar.rotation.y = W.yaw;
        Peds.animate(W.avatar, dt, mv !== 0, run);
        if (W.room) {
            // first person inside a house: eye height, looking where you face
            tmp.set(Math.sin(W.yaw) * 0.15, 1.5, Math.cos(W.yaw) * 0.15).add(W.pos);
            camPos.lerp(tmp, 1 - Math.exp(-dt * 14)); camera.position.copy(camPos);
            camLook.set(Math.sin(W.yaw) * 3, 1.25, Math.cos(W.yaw) * 3).add(W.pos); camera.lookAt(camLook);
        } else if (riding) {
            // a passenger sees the car they are in from behind, as its driver does
            tmp.set(-Math.sin(W.yaw) * 9, 3.4, -Math.cos(W.yaw) * 9).add(W.pos);
            camPos.lerp(tmp, 1 - Math.exp(-dt * 12)); camera.position.copy(camPos);
            camLook.set(Math.sin(W.yaw) * 4, 1.2, Math.cos(W.yaw) * 4).add(W.pos); camera.lookAt(camLook);
        } else {
            // third-person camera behind the walker
            tmp.set(-Math.sin(W.yaw) * 4.2, 2.3, -Math.cos(W.yaw) * 4.2).add(W.pos);
            const g2 = Terrain.height(tmp.x, tmp.z) + 0.6; if (tmp.y < g2) tmp.y = g2;
            camPos.lerp(tmp, 1 - Math.exp(-dt * 7)); camera.position.copy(camPos);
            camLook.set(Math.sin(W.yaw) * 2, 1.4, Math.cos(W.yaw) * 2).add(W.pos); camera.lookAt(camLook);
        }
        camera.fov += ((W.room ? 80 : 70) - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix();
        // guide line to the nearest train stop, so you can walk there on your own
        if (!W.room && !riding) guide();
        // hints
        const now = performance.now();
        if (now - lastHint > 4000) {
            if (riding || W.room) { /* (nothing to point out) */ }
            else if (W.pos.distanceTo(Car.body.position) < 5) { UI.toast('G: get back in the car', 1500); lastHint = now; }
            else if (window.Train && Train.near(W.pos)) { UI.toast('T: board the train', 1500); lastHint = now; }
        }
    };
    // "Train stop 240 m, up ahead on your left" while on foot; the station beacon marks it
    let guideEl = null, guideFrame = 0;
    function guide() {
        if (guideFrame++ % 10 || !window.Train) return;
        if (!guideEl) { guideEl = document.getElementById('hud-walk'); if (!guideEl) return; }
        // a robber friend's black car (or your own parked one) in reach comes first: G gets you in
        const near = window.Robbery && Robbery.carNearby && Robbery.carNearby();
        if (near) { guideEl.textContent = near; return; }
        let best = null, bd = Infinity;
        Train.stations.forEach(st => { if (!st.city.loaded || !st.platform) return; const d = st.platform.distanceTo(W.pos); if (d < bd) { bd = d; best = st; } });
        if (!best) { guideEl.textContent = 'No train stop near here — stops are beside the freeway at every city'; return; }
        const dx = best.platform.x - W.pos.x, dz = best.platform.z - W.pos.z;
        let rel = Math.atan2(dx, dz) - W.yaw; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
        const where = Math.abs(rel) < 0.4 ? 'straight ahead' : Math.abs(rel) > 2.7 ? 'behind you' : rel > 0 ? 'on your left' : 'on your right';
        const when = Train.nextAt(best);
        const timing = when.here ? 'train is in, leaves in ' + when.leavesIn + ' s — press T' : 'next train in ' + when.inSeconds + ' s';
        const steps = bd < 15 ? 'Train stop: ' + timing : best.city.name + ' train stop: ' + Math.round(bd) + ' m, ' + where + (bd > 60 ? ' (look for the blue beacon; stairs go down from the freeway\'s shoulder)' : '');
        guideEl.textContent = steps;
    }
    W.hideGuide = function () { if (guideEl) guideEl.textContent = ''; };
    return W;
})();
