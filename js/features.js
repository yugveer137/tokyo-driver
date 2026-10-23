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
        if (!city) { const s = Road.nearest(World.freeway, pos).s; city = World.cities.find(c => c.s > s) || World.cities[World.cities.length - 1]; }
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
        const fw = World.freeway, pos = Car.body.position;
        const n = Road.nearest(fw, pos);
        if (n.dist > fw.width) return null;
        const f = n.frame, dx = pos.x - f.p.x, dz = pos.z - f.p.z;
        const yaw = Car.yaw(), fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const dir = fwd.dot(f.tan) >= 0 ? 1 : -1;
        return { s: n.s + dx * f.tan.x + dz * f.tan.z, lateral: dx * f.right.x + dz * f.right.z, dir, frame: f, fwd };
    }
    // nearest traffic car ahead in a given lane of the freeway: gap in units or null
    function trafficAhead(pose, laneIndex, maxGap) {
        let best = null;
        Traffic.cars.forEach(c => {
            if (c.road !== World.freeway || c.dir !== pose.dir || c.lane.index !== laneIndex) return;
            const gap = (c.s - pose.s) * pose.dir;
            if (gap > -6 && gap < maxGap && (best === null || gap < best.gap)) best = { gap, speed: c.speed };
        });
        return best;
    }
    function laneClear(pose, laneIndex) {
        return !Traffic.cars.some(c => c.road === World.freeway && c.dir === pose.dir && c.lane.index === laneIndex && Math.abs(c.s - pose.s) < 28);
    }
    function updateAids(dt) {
        A.cooldown = Math.max(0, A.cooldown - dt);
        if (!A.lane && !A.front) { Car.assistSteer = null; Car.autoBrake = false; return; }
        const pose = freewayPose();
        if (!pose) { Car.assistSteer = null; Car.autoBrake = false; return; }
        const lanes = World.freeway.lanes.filter(l => l.dir === pose.dir);
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

    F.init = function (sc) { scene = sc; };
    F.update = function (dt) {
        if (!Car.body || !Game.started) return;
        updateDelivery(dt); updateRain(dt); updateDrift(dt); updateLights(); updateAids(dt);
    };
    return F;
})();
