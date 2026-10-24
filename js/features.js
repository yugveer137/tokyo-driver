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
        A.lane = !A.lane; A.laneIndex = null; Car.assistSteer = null;
        UI.toast(A.lane ? 'Lane lock on (steer to cancel)' : 'Lane lock off');
        const b = document.getElementById('lane-btn'); if (b) b.classList.toggle('on', A.lane);
    };
    F.toggleFrontLock = function () {
        A.front = !A.front; Car.autoBrake = false;
        UI.toast(A.front ? 'Front lock on: auto-braking for traffic' : 'Front lock off');
        const b = document.getElementById('front-btn'); if (b) b.classList.toggle('on', A.front);
    };
    // where the player is on the freeway: {s, lateral, dir, frame} or null
    function freewayPose() {
        const pos = Car.body.position;
        const near = World.freewayAt(pos), fw = near.fw, n = near.n;
        if (!fw || n.dist > fw.width) return null;
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
    function laneClear(pose, laneIndex) {
        return !Traffic.cars.some(c => c.road === A.fw && c.dir === pose.dir && c.lane.index === laneIndex && Math.abs(c.s - pose.s) < 28);
    }
    function updateAids(dt) {
        A.cooldown = Math.max(0, A.cooldown - dt);
        if (!A.lane && !A.front) { Car.assistSteer = null; Car.autoBrake = false; return; }
        const pose = freewayPose();
        if (!pose) { Car.assistSteer = null; Car.autoBrake = false; return; }
        const lanes = A.fw.lanes.filter(l => l.dir === pose.dir);
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
            const lane = lanes.find(l => l.index === A.laneIndex) || lanes[0];
            const err = (lane.offset - pose.lateral) * pose.dir;             // + = need to move toward the driver's right
            const tx = pose.frame.tan.x * pose.dir, tz = pose.frame.tan.z * pose.dir;
            const heading = Math.atan2(pose.fwd.x * tz - pose.fwd.z * tx, pose.fwd.x * tx + pose.fwd.z * tz);   // + = nose points left of the road
            // steer: proportional on lateral error, damped by heading relative to the road
            Car.assistSteer = Math.max(-0.25, Math.min(0.25, -err * 0.06 - heading * 0.9));
        }
        if (A.front) {
            const li = A.laneIndex !== null ? A.laneIndex : lanes.reduce((b, l) => Math.abs(l.offset - pose.lateral) < Math.abs(b.offset - pose.lateral) ? l : b, lanes[0]).index;
            const ahead = trafficAhead(pose, li, 40);
            Car.autoBrake = !!(ahead && ahead.gap < 40 && Car.mph > 8 && ahead.speed < Car.mph / CFG.MPH);
        }
    }

    // ---------- tires + tow truck ----------
    // Pressure wears with speed and drops on hard impacts. Low pressure softens handling and
    // caps speed; at <= 6 psi the car is stranded until a tow truck drives up and repairs it.
    const Tires = { psi: [32, 32, 32, 32], stranded: false, tow: null, lastImpact: 0 };
    F.tires = Tires;
    function tireHud() {
        const el = document.getElementById('hud-tires'); if (!el) return;
        const min = Math.min(...Tires.psi);
        el.textContent = Tires.stranded ? (Tires.tow ? 'STRANDED — tow truck on its way' : 'STRANDED — limp to a WORKSHOP (any city) or press TOW TRUCK') : min < 14 ? 'LOW TIRE PRESSURE (' + Math.round(min) + ' psi) — any city WORKSHOP fixes it' : '';
        el.style.color = Tires.stranded ? '#ff5d6c' : '#ffb000';
    }
    // Only a real crash costs air: over ~30 mph straight into something. A scrape or a tap does
    // nothing; a big hit (60+ mph) can blow a tire outright.
    F.onImpact = function (speedAlongNormal) {
        const now = performance.now();
        if (speedAlongNormal < 14 || now - Tires.lastImpact < 1500) return;
        Tires.lastImpact = now;
        const i = Math.floor(Math.random() * 4);
        const loss = speedAlongNormal > 27 ? 20 + Math.random() * 14 : 5 + Math.random() * 7;
        Tires.psi[i] = Math.max(0, Tires.psi[i] - loss);
        UI.toast('Crash! Tire ' + (i + 1) + ' lost ' + Math.round(loss) + ' psi' + (Tires.psi[i] <= 6 ? ' — blown out' : ''));
        if (window.GameAudio) GameAudio.npcHorn();
        tireHud();
    };
    // TIRE PRESSURE panel: the four tires as bars, live while it is open
    F.renderTires = function () {
        const el = document.getElementById('tires-list'); if (!el) return;
        const names = ['Front left', 'Front right', 'Rear left', 'Rear right'];
        el.innerHTML = Tires.psi.map((p, i) => {
            const pct = Math.max(0, Math.min(100, p / 32 * 100)), col = p <= 6 ? '#ff5d6c' : p < 14 ? '#ffb000' : '#38d66b';
            return '<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;font-weight:700"><span>' + names[i] + '</span><span style="color:' + col + '">' + Math.round(p) + ' psi' + (p <= 6 ? ' — BLOWN' : p < 14 ? ' — low' : '') + '</span></div>' +
                '<div style="height:12px;border-radius:6px;background:#ffffff18;margin-top:4px"><div style="height:100%;width:' + pct + '%;border-radius:6px;background:' + col + '"></div></div></div>';
        }).join('') + '<div style="opacity:0.7;font-size:0.8rem;margin-top:10px">32 psi is full. Tires lose air in hard crashes (30+ mph) and wear slowly at speed. Any city WORKSHOP or the FIX CAR button there refills all four; the TOW TRUCK takes you to one.</div>';
    };
    // TOW TRUCK button: call one any time (fixes low tires too); it drives up from behind you
    F.callTow = function () {
        if (Tires.tow) { UI.toast('The tow truck is already on its way'); return; }
        spawnTow();
        UI.toast('Tow truck called — it is coming up behind you', 2500);
    };
    function updateTires(dt) {
        if (Tires.tow && !Tires.stranded) updateTow(dt);
        if (Tires.tow && (Tires.tow.phase === 'tow' || Tires.tow.phase === 'hook' || Tires.tow.phase === 'drop')) { if (Tires.stranded) updateTow(dt); return; }
        if (!Tires.stranded) {
            const wear = Car.mph > 100 ? 0.08 : Car.mph > 60 ? 0.02 : 0.005;
            for (let i = 0; i < 4; i++) Tires.psi[i] = Math.max(0, Tires.psi[i] - wear * dt);
            const min = Math.min(...Tires.psi);
            Car.tireGrip = min < 14 ? 0.55 + (min / 14) * 0.45 : 1;
            if (min <= 6) {
                Tires.stranded = true; Car.tireGrip = 0.3;
                UI.toast('Tire blown out! Limp to a city WORKSHOP, or press TOW TRUCK.', 4000);
            }
            if (Math.floor(performance.now() / 500) % 2 === 0) tireHud();
            const modal = document.getElementById('tires-modal'); if (modal && modal.classList.contains('open') && Math.floor(performance.now() / 250) % 2 === 0) F.renderTires();
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
    // and stop: the door comes down, sparks fly for a few seconds, your tires are new again.
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
                if (Math.abs(w.door.position.y - w.closedY) < 0.15) { w.state = 'working'; w.t = 0; UI.toast('Working on your car…', 3500); if (window.GameAudio && GameAudio.clank) GameAudio.clank(); }
            } else if (w.state === 'working') {
                w.t += dt;
                w.sparks.visible = Math.random() < 0.5; w.sparks.position.x = -1.5 + Math.random() * 3; w.sparks.position.z = -1.5 + Math.random() * 3;
                if (Math.floor(w.t * 4) !== Math.floor((w.t - dt) * 4) && window.GameAudio && GameAudio.clank) GameAudio.clank();
                if (w.t > 5) {
                    w.sparks.visible = false; w.state = 'opening'; Car.autoBrake = false;
                    Tires.psi = [32, 32, 32, 32]; Tires.stranded = false; Car.tireGrip = 1; tireHud();
                    if (Tires.tow) { scene.remove(Tires.tow.mesh); Tires.tow = null; }
                    UI.toast('All fixed — four new tires. Door opening!', 3000);
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
        Tires.tow = { mesh: g, phase: 'approach', t: 0, beacon };
    }
    function updateTow(dt) {
        const T = Tires.tow; if (!T) return;
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
                else { T.phase = 'repair'; T.t = 0; UI.toast('Tow truck here. Repairing tires…', 2500); }
            }
        } else if (T.phase === 'hook') {
            T.t += dt;
            if (T.t > 2) {
                T.phase = 'tow'; T.t = 0;
                Tires.stranded = false; Car.tireGrip = 1; Car.cruise = null;
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
                Tires.psi = [32, 32, 32, 32]; Tires.stranded = false; Car.tireGrip = 1; T.phase = 'leave'; T.t = 0;
                UI.toast('Service station: tires repaired. Drive on!', 3000); tireHud();
            }
        } else if (T.phase === 'repair') {
            T.t += dt;
            if (T.t > 5) {
                Tires.psi = [32, 32, 32, 32]; Tires.stranded = false; Car.tireGrip = 1; T.phase = 'leave'; T.t = 0;
                UI.toast('Tires repaired. Drive on!', 2500); tireHud();
            }
        } else {
            T.t += dt;
            m.position.x += Math.sin(m.rotation.y) * 12 * dt; m.position.z += Math.cos(m.rotation.y) * 12 * dt;
            if (T.t > 8) { scene.remove(m); Tires.tow = null; }
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
            if (window.GameAudio) GameAudio.honk();
        }
    }

    F.init = function (sc) {
        scene = sc;
        Car.onImpact = F.onImpact;
    };
    F.update = function (dt) {
        if (!Car.body || !Game.started) return;
        updateDelivery(dt); updateRain(dt); updateDrift(dt); updateLights(); updateAids(dt); updateTires(dt); updateWorkshop(dt); updateTada();
    };
    return F;
})();
