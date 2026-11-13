// tokyo-driver1 v2 — gameplay extras carried over from the old game: deliveries, cruise
// control (speed lock), rain, and drift rewards.
window.Features = (function () {
    const F = {};
    let scene;

    // ---------- deliveries ----------
    const D = { active: null, beacon: null, pkg: null, cooldown: 0 };
    F.deliveries = D;
    function beaconMesh() {
        const g = new THREE.Group();
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 80, 16, 1, true),
            new THREE.MeshBasicMaterial({ color: 0x3af0ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
        pillar.position.y = 40; g.add(pillar);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.4, 8, 32), new THREE.MeshBasicMaterial({ color: 0x3af0ff }));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.6; g.add(ring);
        return g;
    }
    F.startDelivery = function () {
        if (D.active) { UI.toast('Finish the current delivery first'); return; }
        if (D.cooldown > 0) { UI.toast('Next delivery in ' + Math.ceil(D.cooldown) + 's'); return; }
        const pos = Car.body.position;
        // destination: a random intersection in the nearest loaded city, else the next city
        let city = World.cities.filter(c => c.loaded).sort((a, b) => a.center.x === b.center.x ? 0 : 0)[0];
        if (!city) { const near = World.freewayAt(pos); city = near.fw.cities.find(c => c.s > near.n.s) || near.fw.cities[near.fw.cities.length - 1]; }
        const i = 1 + Math.floor(Math.random() * (city.rows - 1)), j = 1 + Math.floor(Math.random() * (city.cols - 1));
        const p = city.toWorld(city.streetX(j), city.streetZ(i));
        const dist = p.distanceTo(pos);
        D.active = { city, i, j, target: p, reward: 10 + Math.round(dist / 60) * 5,
                     label: city.streets.ns[j % city.streets.ns.length] + ' & ' + city.streets.ew[i % city.streets.ew.length] + ', ' + city.name };
        D.beacon = beaconMesh(); D.beacon.position.set(p.x, Terrain.height(p.x, p.z), p.z); scene.add(D.beacon);
        D.pkg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: 0xc8933f, roughness: 0.9 }));
        D.pkg.position.set(0, 1.6, -0.6); Car.group.add(D.pkg);
        UI.toast('Deliver the package to ' + D.active.label + ' for ' + D.active.reward + ' coins', 3500);
    };
    function updateDelivery(dt) {
        D.cooldown = Math.max(0, D.cooldown - dt);
        const el = document.getElementById('hud-delivery');
        if (!D.active) { if (el) el.textContent = ''; return; }
        const pos = Car.body.position, d = pos.distanceTo(D.active.target);
        if (el) el.textContent = 'Delivery: ' + D.active.label + ' — ' + (d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m');
        D.beacon.rotation.y += dt;
        if (d < 16 && Car.mph < 12) {
            Game.addCoins(D.active.reward);
            UI.toast('Delivered! +' + D.active.reward + ' coins', 3000);
            scene.remove(D.beacon); if (D.pkg && D.pkg.parent) D.pkg.parent.remove(D.pkg);
            D.active = null; D.beacon = null; D.pkg = null; D.cooldown = 20;
        }
    }

    // ---------- cruise control (speed lock) ----------
    F.toggleCruise = function () {
        if (Car.cruise) { Car.cruise = null; UI.toast('Cruise off'); }
        else if (Car.mph >= 5) { Car.cruise = Car.mph; UI.toast('Cruise set at ' + Math.round(Car.mph) + ' mph'); }
        else UI.toast('Get moving first');
        const b = document.getElementById('cruise-btn'); if (b) b.classList.toggle('on', !!Car.cruise);
    };

    // ---------- rain ----------
    const R = { on: false, mesh: null, count: 1500 };
    F.toggleRain = function () {
        R.on = !R.on;
        if (R.on && !R.mesh) {
            const pos = new Float32Array(R.count * 6);
            for (let i = 0; i < R.count; i++) {
                const x = (Math.random() - 0.5) * 80, y = Math.random() * 40, z = (Math.random() - 0.5) * 80;
                pos.set([x, y, z, x, y - 1.2, z], i * 6);
            }
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            R.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaac4e0, transparent: true, opacity: 0.45 }));
            R.mesh.frustumCulled = false;
        }
        if (R.mesh) { if (R.on) scene.add(R.mesh); else scene.remove(R.mesh); }
        Sky.rain = R.on;
        UI.toast(R.on ? 'Rain on' : 'Rain off');
    };
    function updateRain(dt) {
        if (!R.on || !R.mesh) return;
        const p = R.mesh.geometry.attributes.position, a = p.array;
        for (let i = 0; i < R.count; i++) {
            a[i * 6 + 1] -= 28 * dt; a[i * 6 + 4] -= 28 * dt;
            if (a[i * 6 + 1] < 0) { a[i * 6 + 1] += 40; a[i * 6 + 4] += 40; }
        }
        p.needsUpdate = true;
        R.mesh.position.set(Car.body.position.x, Car.body.position.y, Car.body.position.z);
    }

    // ---------- drift rewards ----------
    const S = { score: 0, mult: 1, timer: 0 };
    function updateDrift(dt) {
        const drifting = Car.drifting && Math.abs(Car.lateralVel) > 5 && Car.mph > 15;
        if (drifting) {
            S.timer += dt; S.mult = Math.min(5, 1 + Math.floor(S.timer / 2));
            S.score += dt * Car.mph * S.mult;
            if (S.score >= 400) { S.score -= 400; Game.addCoins(1); }
        } else if (S.timer > 0) {
            if (S.timer > 1.5) UI.toast('Drift x' + S.mult + '!');
            S.timer = 0; S.mult = 1;
        }
    }

    // ---------- turn signals, hazards, brake lights ----------
    // The ported car bodies expose group.userData.hazardLights (each with userData.side) and
    // .brakeLights; we drive their opacity like the old updateHazardLights() did.
    F.signal = 'off';           // 'off' | 'left' | 'right' | 'hazard'
    F.setSignal = function (s) {
        F.signal = (F.signal === s) ? 'off' : s;
        UI.toast(F.signal === 'off' ? 'Signals off' : F.signal === 'hazard' ? 'Hazard lights on' : 'Signalling ' + F.signal);
    };
    function updateLights() {
        const ud = Car.group && Car.group.userData; if (!ud) return;
        const blinkOn = Math.floor(performance.now() / 400) % 2 === 0;
        (ud.hazardLights || []).forEach(l => {
            const active = (F.signal === 'hazard' || F.signal === l.userData.side) && blinkOn;
            l.material.opacity = active ? 1 : 0;
        });
        (ud.brakeLights || []).forEach(l => { l.material.opacity = Car.keys.back ? 1 : 0.3; });
    }

    // ---------- lane lock + front lock (freeway driver aids) ----------
    // Lane lock holds the car in a freeway lane and changes lanes around slower traffic;
    // front lock brakes automatically for a car ahead in the same lane.
    const A = { lane: false, front: false, laneIndex: null, cooldown: 0 };
    F.aids = A;
    F.toggleLaneLock = function () {
        A.lane = !A.lane; A.laneIndex = null; A.held = 0; Car.assistSteer = null;
        UI.toast(A.lane ? 'Lane lock on: steering you back into the lane (steer to cancel)' : 'Lane lock off');
        const b = document.getElementById('lane-btn'); if (b) b.classList.toggle('on', A.lane);
    };
    F.toggleFrontLock = function () {
        A.front = !A.front; Car.autoBrake = false;
        UI.toast(A.front ? 'Front lock on: keeps a safe gap to the car ahead' : 'Front lock off');
        const b = document.getElementById('front-btn'); if (b) b.classList.toggle('on', A.front);
    };
    // where the player is on the road: {s, lateral, dir, frame} or null. The freeway when it
    // is within reach (so an exit beside you does not steal the lock), else whatever built road
    // with lanes you are on: ramps and city streets lock too.
    function freewayPose() {
        const pos = Car.body.position;
        let near = World.freewayAt(pos), fw = near.fw, n = near.n;
        if (!fw || n.dist > fw.width * 0.6 || Math.abs(pos.y - n.frame.p.y) > 3) {
            fw = null; let bd = Infinity;
            const yaw0 = Car.yaw(), fx = Math.sin(yaw0), fz = Math.cos(yaw0);
            Road.all.forEach(r => { if (!r.lanes || !r.lanes.length || !Object.keys(r.chunks).length) return; const m = Road.nearest(r, pos); if (Math.abs(fx * m.frame.tan.x + fz * m.frame.tan.z) < 0.7) return; /* a cross street at a junction is not ours */ if (m.dist < r.width * 0.7 && Math.abs(pos.y - m.frame.p.y) < 3 && m.dist < bd) { bd = m.dist; fw = r; n = m; } });
            if (!fw) return null;
        }
        A.fw = fw;
        const f = n.frame, dx = pos.x - f.p.x, dz = pos.z - f.p.z;
        const yaw = Car.yaw(), fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const dir = fwd.dot(f.tan) >= 0 ? 1 : -1;
        return { s: n.s + dx * f.tan.x + dz * f.tan.z, lateral: dx * f.right.x + dz * f.right.z, dir, frame: f, fwd };
    }
    // nearest traffic car ahead in a given lane of the freeway: gap in units or null
    function trafficAhead(pose, laneIndex, maxGap) {
        let best = null;
        Traffic.cars.forEach(c => {
            if (c.road !== A.fw || c.dir !== pose.dir || c.lane.index !== laneIndex) return;
            const gap = (c.s - pose.s) * pose.dir;
            if (gap > -6 && gap < maxGap && (best === null || gap < best.gap)) best = { gap, speed: c.speed };
        });
        return best;
    }
    // the gap to hold behind a car doing `speed`: two car lengths, plus about a second
    const followGap = (speed) => 9 + speed * 1.1;
    function laneClear(pose, laneIndex) {
        return !Traffic.cars.some(c => c.road === A.fw && c.dir === pose.dir && c.lane.index === laneIndex && Math.abs(c.s - pose.s) < 28);
    }
    function updateAids(dt) {
        A.cooldown = Math.max(0, A.cooldown - dt);
        if (!A.lane && !A.front) { Car.assistSteer = null; Car.autoBrake = false; Car.cruiseCap = null; return; }
        const pose = freewayPose();
        if (!pose) { Car.assistSteer = null; Car.autoBrake = false; Car.cruiseCap = null; return; }
        const lanes = A.fw.lanes.filter(l => l.dir === pose.dir);
        if (!lanes.length) { Car.assistSteer = null; Car.autoBrake = false; return; }
        if (A.lane) {
            if (Car.keys.left || Car.keys.right) { F.toggleLaneLock(); return; }
            if (A.laneIndex === null) {
                // start in the lane we're closest to
                A.laneIndex = lanes.reduce((b, l) => Math.abs(l.offset - pose.lateral) < Math.abs(b.offset - pose.lateral) ? l : b, lanes[0]).index;
            }
            const ahead = trafficAhead(pose, A.laneIndex, 40);
            if (ahead && A.cooldown === 0 && ahead.speed < Car.mph / CFG.MPH * 0.95) {
                const options = [A.laneIndex - 1, A.laneIndex + 1].filter(i => i >= 0 && i < lanes.length);
                const free = options.find(i => laneClear(pose, i) && !trafficAhead(pose, i, 45));
                if (free !== undefined) { A.laneIndex = free; A.cooldown = 3; }
            }
            // Stuck behind someone slow for 15 seconds: move over as soon as the lane beside us is
            // clear alongside, even if it is not empty further on (the quick rule above waits for
            // an empty lane, and stops applying once we have slowed to the other car's speed).
            // "Slow" is under nine tenths of what we would be doing: the cruise speed, or the limit.
            const limit = A.fw.type === 'freeway' ? 65 : A.fw.type === 'avenue' ? 45 : A.fw.type === 'ramp' ? 35 : 30;
            const want = Math.max(Car.cruise || 0, limit) / CFG.MPH;
            // (held up = within the gap front lock follows at, plus a little: see followGap)
            const near = trafficAhead(pose, A.laneIndex, 110);
            const held = near && near.gap < followGap(near.speed) + 15 && near.speed < want * 0.9;
            A.held = held ? (A.held || 0) + dt : 0;
            if (A.held >= 15 && A.cooldown === 0) {
                const room = (i) => { const t = trafficAhead(pose, i, 90); return t ? t.gap : Infinity; };
                const beside = [A.laneIndex - 1, A.laneIndex + 1].filter(i => i >= 0 && i < lanes.length && laneClear(pose, i));
                if (beside.length) {
                    A.laneIndex = beside.sort((x, y) => room(y) - room(x))[0];      // (the one with more room ahead)
                    A.cooldown = 3; A.held = 0;
                    UI.toast('Lane lock: changing lanes to get past', 2000);
                }
            }
            const lane = lanes.find(l => l.index === A.laneIndex) || lanes[0];
            // steer at a point ahead in the lane (further ahead the faster you go), like the
            // self-drive does: smooth through bends, no wobble at speed, and from the shoulder
            // it visibly pulls back in. Out of the lane it looks closer, to come back sooner.
            const err = Math.abs(lane.offset - pose.lateral);
            const lookAhead = Math.max(6, (err > 1.5 ? 6 : 12) + Car.mph * 0.14);
            const sAhead = Math.max(0, Math.min(A.fw.length, pose.s + pose.dir * lookAhead));
            const look = Road.at(A.fw, sAhead, lane.offset).p;
            const pos = Car.body.position;
            let e = Math.atan2(look.x - pos.x, look.z - pos.z) - Car.yaw();
            while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
            const lim = err > 1.5 ? 0.45 : 0.3;
            Car.assistSteer = Math.max(-lim, Math.min(lim, e * 2.5));
        }
        if (A.front) {
            // Front lock keeps a safe gap to whoever is ahead in our lane, traffic or another
            // player. It looks further ahead the faster we go (the old fixed 40 m was under a
            // second at freeway speed, so it braked too late to matter), brakes while we are
            // closing too fast to settle in behind, and holds cruise down to the other car's speed
            // so we follow about a second behind instead of charging up and braking over and over.
            const li = A.laneIndex !== null ? A.laneIndex : lanes.reduce((b, l) => Math.abs(l.offset - pose.lateral) < Math.abs(b.offset - pose.lateral) ? l : b, lanes[0]).index;
            const v = Car.mph / CFG.MPH;
            let ahead = trafficAhead(pose, li, 60 + v * 4);
            const pos = Car.body.position;
            (window.Multiplayer && Multiplayer.others ? Multiplayer.others() : []).forEach(o => {
                // (another player: ahead of our nose and within a lane's half width of our line)
                const dx = o.x - pos.x, dz = o.z - pos.z;
                const along = dx * pose.fwd.x + dz * pose.fwd.z, across = Math.abs(dx * pose.fwd.z - dz * pose.fwd.x);
                if (along > 2 && along < 60 + v * 4 && across < 1.9 && (!ahead || along < ahead.gap)) ahead = { gap: along, speed: o.speed };
            });
            let brake = false; Car.cruiseCap = null;
            if (ahead && Car.mph > 4) {
                const closing = v - ahead.speed;
                const keep = followGap(ahead.speed);
                const settle = closing > 0 ? closing * closing / (2 * 6) + closing * 0.4 : 0;   // room needed to slow to its speed (6 m/s² and a moment to react)
                brake = (closing > 0.5 && ahead.gap < keep + settle) || ahead.gap < keep * 0.5;
                if (ahead.gap < keep * 1.25 + settle) Car.cruiseCap = ahead.speed * CFG.MPH;   // (not from further back: we would trail it at a distance and never count as held up)
            }
            Car.autoBrake = brake;
        } else Car.cruiseCap = null;
    }

    // ---------- damage + tow truck ----------
    // Every crash adds damage, shown on the small DAMAGE board under the HUD. Damage never slows
    // the car down: it is a score to keep low, and any workshop or the tow truck resets it.
    const Damage = { pct: 0, stranded: false, tow: null, lastImpact: 0 };
    F.damage = Damage;
    function damageColor(pct) { return pct >= 100 ? '#ff5d6c' : pct >= 60 ? '#ffb000' : '#38d66b'; }
    function damageHud() {
        const el = document.getElementById('hud-damage'); if (!el) return;
        const pct = Math.round(Damage.pct), col = damageColor(pct);
        const note = Damage.tow ? 'tow truck on its way' : pct >= 100 ? 'WRECKED — any city WORKSHOP repairs it' : pct >= 60 ? 'any city WORKSHOP repairs it' : '';
        el.innerHTML = '<span class="dmg-label">DAMAGE</span><span class="dmg-bar"><span style="width:' + pct + '%;background:' + col + '"></span></span><span class="dmg-pct" style="color:' + col + '">' + pct + '%</span>' + (note ? '<span class="dmg-note" style="color:' + col + '">' + note + '</span>' : '');
        el.classList.toggle('hot', pct >= 60);
    }
    // A hard hit (walls, buildings, traffic) adds damage with the speed of the hit: a 30 mph
    // wall is about 15%, a flat-out crash about 40%. Little bumps and kerbs cost nothing.
    F.onImpact = function (speedAlongNormal) {
        const now = performance.now();
        if (speedAlongNormal < 8 || now - Damage.lastImpact < 1500) return;
        Damage.lastImpact = now;
        const hit = Math.min(40, (speedAlongNormal - 6) * 2);
        Damage.pct = Math.min(100, Damage.pct + hit);
        UI.toast('Crash! +' + Math.round(hit) + '% damage');
        damageHud();
    };
    // DAMAGE panel: the bar bigger, live while it is open
    F.renderDamage = function () {
        const el = document.getElementById('damage-list'); if (!el) return;
        const pct = Math.round(Damage.pct), col = damageColor(pct);
        el.innerHTML = '<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;font-weight:700"><span>Car damage</span><span style="color:' + col + '">' + pct + '%' + (pct >= 100 ? ' — WRECKED' : pct >= 60 ? ' — bad' : pct > 0 ? ' — dents' : ' — like new') + '</span></div>' +
            '<div style="height:16px;border-radius:8px;background:#ffffff18;margin-top:6px"><div style="height:100%;width:' + pct + '%;border-radius:8px;background:' + col + '"></div></div></div>' +
            '<div style="opacity:0.7;font-size:0.8rem;margin-top:10px">Every crash adds damage, harder crashes add more. It never slows you down — keep it low for the look of it. Any city WORKSHOP or the FIX CAR button there repairs it; the TOW TRUCK takes you to one.</div>';
    };
    // TOW TRUCK button: call one any time (repairs damage too); it drives up from behind you
    F.callTow = function () {
        if (Damage.tow) { UI.toast('The tow truck is already on its way'); return; }
        spawnTow();
        UI.toast('Tow truck called — it is coming up behind you', 2500);
    };
    function updateDamage(dt) {
        if (Damage.tow && !Damage.stranded) updateTow(dt);
        if (Damage.tow && (Damage.tow.phase === 'tow' || Damage.tow.phase === 'hook' || Damage.tow.phase === 'drop')) { if (Damage.stranded) updateTow(dt); return; }
        if (!Damage.stranded) {
            Car.damageGrip = 1;                                                 // damage never costs speed
            if (Math.floor(performance.now() / 500) % 2 === 0) damageHud();
            const modal = document.getElementById('damage-modal'); if (modal && modal.classList.contains('open') && Math.floor(performance.now() / 250) % 2 === 0) F.renderDamage();
            return;
        }
        // stranded: creep only (to a workshop), or wait for the tow truck
        Car.cruise = null;
        updateTow(dt);
    }
    // FIX CAR button: at a workshop (within 40 m of its bay) the car is pulled into the bay and
    // the repair runs; anywhere else it tells you where to go.
    F.fixAtWorkshop = function () {
        if (!Car.body) return;
        let best = null, bd = 40;
        World.cities.forEach(c => { const w = c.workshop; if (!c.loaded || !w) return; const d = Math.hypot(Car.body.position.x - w.center.x, Car.body.position.z - w.center.z); if (d < bd) { bd = d; best = w; } });
        if (!best) { UI.toast('Drive to a city WORKSHOP first — it is beside every city\'s frontage road, just after the exit', 4000); return; }
        if (best.state !== 'open' && best.state !== 'done') return;
        const yaw = Math.atan2(Math.sin(best.yaw || 0), Math.cos(best.yaw || 0));
        Car.teleport(best.center.x, best.center.y + 1.0, best.center.z, Car.yaw());
        Car.cruise = null;
        best.state = 'closing'; best.t = 0; Car.autoBrake = true;
        UI.toast(best.city.name + ' workshop: door closing…', 2500);
    };
    // ---------- workshop ----------
    // Every city has a workshop beside its frontage road (World builds it). Pull into the bay
    // and stop: the door comes down, sparks fly for a few seconds, the damage is gone.
    function updateWorkshop(dt) {
        const p = Car.body.position;
        World.cities.forEach(c => {
            const w = c.workshop; if (!c.loaded || !w) return;
            const d = Math.hypot(p.x - w.center.x, p.z - w.center.z);
            const wantClosed = w.state === 'closing' || w.state === 'working';
            w.door.position.y += ((wantClosed ? w.closedY : w.openY) - w.door.position.y) * Math.min(1, dt * 2.5);
            if (w.state === 'open') {
                if (d < 3.2 && Car.mph < 2 && !Car.parked) { w.state = 'closing'; w.t = 0; Car.autoBrake = true; UI.toast(c.name + ' workshop: door closing…', 2500); }
            } else if (w.state === 'closing') {
                if (Math.abs(w.door.position.y - w.closedY) < 0.15) { w.state = 'working'; w.t = 0; UI.toast('Working on your car…', 3500); }
            } else if (w.state === 'working') {
                w.t += dt;
                w.sparks.visible = Math.random() < 0.5; w.sparks.position.x = -1.5 + Math.random() * 3; w.sparks.position.z = -1.5 + Math.random() * 3;
                if (w.t > 5) {
                    w.sparks.visible = false; w.state = 'opening'; Car.autoBrake = false;
                    Damage.pct = 0; Damage.stranded = false; Car.damageGrip = 1; damageHud();
                    if (Damage.tow) { scene.remove(Damage.tow.mesh); Damage.tow = null; }
                    UI.toast('All fixed — damage repaired. Door opening!', 3000);
                }
            } else if (w.state === 'opening') {
                if (Math.abs(w.door.position.y - w.openY) < 0.2) w.state = 'done';
            } else if (w.state === 'done') {
                if (d > 9) w.state = 'open';
            }
        });
    }
    // the closest loaded city that has a service station on its collector road
    function nearestStation() {
        let best = null, bd = Infinity;
        World.cities.forEach(c => {
            if (!c.loaded || !c.servicePoint) return;
            const d = c.servicePoint.distanceTo(Car.body.position);
            if (d < bd) { bd = d; best = { city: c, point: c.servicePoint }; }
        });
        return best;
    }
    function spawnTow() {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color: 0xffb000, roughness: 0.5 }), dark = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 6), paint); bed.position.y = 0.9; g.add(bed);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.3, 2), dark); cab.position.set(0, 1.9, 1.8); g.add(cab);
        const boom = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3), paint); boom.position.set(0, 2.2, -1.6); boom.rotation.x = 0.5; g.add(boom);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xffa000, emissiveIntensity: 2 })); beacon.position.set(0, 2.7, 1.8); g.add(beacon);
        const wheelGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 10); wheelGeom.rotateZ(Math.PI / 2);
        [[1, 2], [-1, 2], [1, -1.8], [-1, -1.8]].forEach(([x, z]) => { const w = new THREE.Mesh(wheelGeom, dark); w.position.set(x, 0.45, z); g.add(w); });
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        // start 120 units behind the car along its heading, on the ground
        const yaw = Car.yaw(), p = Car.body.position;
        const sx = p.x - Math.sin(yaw) * 120, sz = p.z - Math.cos(yaw) * 120;
        g.position.set(sx, Terrain.height(sx, sz), sz); g.rotation.y = yaw;
        scene.add(g);
        Damage.tow = { mesh: g, phase: 'approach', t: 0, beacon };
    }
    function updateTow(dt) {
        const T = Damage.tow; if (!T) return;
        const p = Car.body.position, m = T.mesh;
        T.beacon.material.emissiveIntensity = Math.floor(performance.now() / 300) % 2 ? 2.5 : 0.2;
        if (T.phase === 'approach') {
            const dx = p.x - m.position.x, dz = p.z - m.position.z, d = Math.hypot(dx, dz);
            if (d > 9.5) {                                               // (not 9: the step shrinks to nothing right at 9 and it never arrives)
                const step = Math.min(d - 9, 14 * dt);
                m.position.x += dx / d * step; m.position.z += dz / d * step;
                m.position.y = Math.max(Terrain.height(m.position.x, m.position.z), p.y - 0.8) ;
                m.rotation.y = Math.atan2(dx, dz);
            } else {
                // hook up and tow the car to the nearest city's service station; if no station is
                // reachable (open country, nothing loaded), repair on the spot instead
                const station = nearestStation();
                if (station) { T.phase = 'hook'; T.t = 0; T.station = station; UI.toast('Tow truck here. Hooking you up…', 2500); }
                else { T.phase = 'repair'; T.t = 0; UI.toast('Tow truck here. Repairing the damage…', 2500); }
            }
        } else if (T.phase === 'hook') {
            T.t += dt;
            if (T.t > 2) {
                T.phase = 'tow'; T.t = 0;
                Damage.stranded = false; Car.damageGrip = 1; Car.cruise = null;
                SelfDrive.goTo(T.station.point, { quiet: true, tow: true, onArrive: () => { T.phase = 'drop'; T.t = 0; } });
                UI.toast('Towing you to the ' + T.station.city.name + ' workshop — hold on, 200 mph!', 3000);
            }
        } else if (T.phase === 'tow') {
            // the truck rides just ahead of the car, pulling it along the autopilot's route
            const yaw = Car.yaw();
            m.position.set(p.x + Math.sin(yaw) * 7.5, p.y - 0.9, p.z + Math.cos(yaw) * 7.5);
            m.rotation.y = yaw;
            if (!SelfDrive.active && SelfDrive.lastTow !== 'arrived') {   // the player grabbed the wheel
                T.phase = 'leave'; T.t = 0; Car.towed = false; UI.toast('Unhooked. The tow truck leaves.', 2500);
            }
        } else if (T.phase === 'drop') {
            Car.towed = false;
            T.t += dt;
            if (T.t > 3) {
                Damage.pct = 0; Damage.stranded = false; Car.damageGrip = 1; T.phase = 'leave'; T.t = 0;
                UI.toast('Service station: damage repaired. Drive on!', 3000); damageHud();
            }
        } else if (T.phase === 'repair') {
            T.t += dt;
            if (T.t > 5) {
                Damage.pct = 0; Damage.stranded = false; Car.damageGrip = 1; T.phase = 'leave'; T.t = 0;
                UI.toast('Damage repaired. Drive on!', 2500); damageHud();
            }
        } else {
            T.t += dt;
            m.position.x += Math.sin(m.rotation.y) * 12 * dt; m.position.z += Math.cos(m.rotation.y) * 12 * dt;
            if (T.t > 8) { scene.remove(m); Damage.tow = null; }
        }
    }

    // "TA-DA!" banner each time you blow past a new speed milestone
    const Tada = { next: 65, el: null };
    function updateTada() {
        if ((window.Train && Train.riding) || Car.towed) return;         // the train's or the tow truck's speed is not your doing
        if (Car.mph >= Tada.next) {
            const el = Tada.el || (Tada.el = document.getElementById('tada'));
            if (el) { el.textContent = 'TA-DA! ' + Tada.next + ' MPH'; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
            Tada.next = Tada.next < 100 ? 100 : Tada.next < 150 ? 150 : Tada.next + 100;
        }
    }

    F.init = function (sc) {
        scene = sc;
        Car.onImpact = F.onImpact; damageHud();
    };
    // Drove into the bay: after a couple of seconds under water the car is pulled back onto
    // the nearest road (what RESET CAR does), so a wrong turn at a bridge never strands you
    let wet = 0;
    function updateWater(dt) {
        const w = World.water; if (!w || !Car.body || Car.towed) return;
        const p = Car.body.position;
        const inBay = p.y < w.y - 1.2 && Math.abs(p.x - w.x) < w.w / 2 && Math.abs(p.z - w.z) < w.d / 2;
        wet = inBay ? wet + dt : 0;
        if (wet > 2.5) { wet = 0; UI.toast('You drove into the bay! Pulled back onto the road.', 3500); Car.reset(); }
    }
    F.update = function (dt) {
        updateWater(dt);
        if (!Car.body || !Game.started) return;
        updateDelivery(dt); updateRain(dt); updateDrift(dt); updateLights(); updateAids(dt); updateDamage(dt); updateWorkshop(dt); updateTada();
    };
    return F;
})();
