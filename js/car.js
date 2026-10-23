// tokyo-driver1 v2 — the player's car: Cannon RaycastVehicle (tuning ported from the old
// game), gears, drift, anti-flip, headlights, and the chase / cockpit cameras.
// Visuals come from CarModels (carmodels.js) when loaded, else a simple placeholder.
window.Car = (function () {
    const C = { data: null, body: null, vehicle: null, group: null, wheels: [], gear: 1, drifting: false,
                mph: 0, throttle: 0, lateralVel: 0, view: 'chase', headlights: [] };
    let scene, world, camera;
    const keys = { fwd: false, back: false, left: false, right: false, drift: false };
    let steer = 0;
    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
    const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

    C.keys = keys;

    // Chassis + suspension per car variant (old createCar, index.html ~10353-10448)
    function tuning(d) {
        const truckish = d.isTruck || d.isPickup;
        // Suspension rides a little longer and stiffer than the old game so the chassis box
        // clears rough terrain (it used to scrape heightfield seams and stop dead).
        const t = {
            half: new CANNON.Vec3(1, 0.4, 2), offsetY: 0.6, mass: 150,
            stiffness: 45, rest: 0.42, slip: 3, relax: 2.3, comp: 4.4, roll: 0.01,
            linDamp: 0.1, angDamp: 0.5, radius: 0.4,
            points: [[0.9, 0.3, 1.3], [-0.9, 0.3, 1.3], [0.9, 0.3, -1.3], [-0.9, 0.3, -1.3]]
        };
        if (d.isRaceCar) { t.half.set(1.1, 0.25, 2.3); t.offsetY = 0.35; t.radius = 0.35; }
        if (d.isOffroad) { t.half.set(1.2, 0.5, 2.2); t.mass = 380; t.stiffness = 45; t.rest = 0.55; t.slip = 3.5; t.roll = 0.03; t.radius = 0.55; t.linDamp = 0.15; t.angDamp = 0.7; }
        if (d.isPickup) { t.half.set(1.2, 0.5, 2.5); t.mass = 350; }
        if (d.isTruck) { t.half.set(1.3, 0.7, 4.5); t.mass = 250; }
        if (truckish) { t.stiffness = 50; t.rest = 0.5; t.slip = 2.5; t.roll = 0.05; t.radius = 0.5; t.linDamp = 0.15; t.angDamp = 0.7; }
        if (d.heavyCar) { t.mass = 400; t.stiffness = 65; t.relax = 3.0; t.comp = 6.0; t.roll = 0.001; t.angDamp = 0.95; }
        t.offsetY += 0.25;   // collision box sits higher than the visual body: never touches the road
        if (d.isDrift) t.linDamp = 0.05;
        if (window.CarModels && CarModels.wheelLayout) {
            const wl = CarModels.wheelLayout(d.id);
            if (wl) { t.radius = wl.radius; t.points = wl.points; }
        }
        return t;
    }

    function placeholderBody(d) {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color: d.bodyColor || d.color || 0x4466ff, roughness: 0.35, metalness: 0.6 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.4, metalness: 0.2 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), paint); body.position.y = 0.35; g.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), dark); cabin.position.set(0, 1.0, -0.2); g.add(cabin);
        const lamp = new THREE.MeshBasicMaterial({ color: 0xffffee });
        [-0.7, 0.7].forEach(x => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), lamp); l.position.set(x, 0.45, 2.1); g.add(l); });
        const tail = new THREE.MeshBasicMaterial({ color: 0xff2222 });
        [-0.7, 0.7].forEach(x => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), tail); l.position.set(x, 0.45, -2.1); g.add(l); });
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        return g;
    }

    function placeholderWheel(r) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.32, 18), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }));
        m.geometry.rotateZ(Math.PI / 2);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.34, 12), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.4, metalness: 0.8 }));
        hub.geometry.rotateZ(Math.PI / 2);
        m.add(hub);
        m.castShadow = true;
        return m;
    }

    C.init = function (sc, w, cam) { scene = sc; world = w; camera = cam; };

    C.spawn = function (data, pos, yaw) {
        C.destroy();
        C.data = data;
        const t = tuning(data);
        C.tuning = t;

        // collisionFilterMask ~2: the chassis never collides with terrain (group 2); see terrain.js
        const body = new CANNON.Body({ mass: t.mass, material: world.wheelMaterial, linearDamping: t.linDamp, angularDamping: t.angDamp, allowSleep: false, collisionFilterMask: ~2 });
        body.addShape(new CANNON.Box(t.half), new CANNON.Vec3(0, t.offsetY, 0));
        body.position.set(pos.x, pos.y, pos.z);
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw || 0);
        // hard hits (walls, buildings, traffic) are reported to Features for tire damage
        body.addEventListener('collide', (e) => {
            if (!C.onImpact) return;
            const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
            if (v > 4) C.onImpact(v);
        });
        world.addBody(body);

        const vehicle = new CANNON.RaycastVehicle({ chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
        t.points.forEach(p => vehicle.addWheel({
            radius: t.radius,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            axleLocal: new CANNON.Vec3(1, 0, 0),
            chassisConnectionPointLocal: new CANNON.Vec3(p[0], p[1], p[2]),
            suspensionStiffness: t.stiffness,
            suspensionRestLength: t.rest,
            maxSuspensionTravel: t.rest,
            frictionSlip: t.slip,
            dampingRelaxation: t.relax,
            dampingCompression: t.comp,
            maxSuspensionForce: 200000,
            rollInfluence: t.roll,
            customSlidingRotationalSpeed: -30,
            useCustomSlidingRotationalSpeed: true
        }));
        if (data.isDrift) { vehicle.wheelInfos[0].frictionSlip = vehicle.wheelInfos[1].frictionSlip = 4; vehicle.wheelInfos[2].frictionSlip = vehicle.wheelInfos[3].frictionSlip = 1.2; }
        vehicle.addToWorld(world);

        const group = (window.CarModels && CarModels.buildBody) ? CarModels.buildBody(data.id) : placeholderBody(data);
        scene.add(group);
        const wheels = t.points.map(() => {
            const m = (window.CarModels && CarModels.buildWheel) ? CarModels.buildWheel(data.id) : placeholderWheel(t.radius);
            scene.add(m); return m;
        });

        // Headlights: two spotlights, on at night (Sky.night)
        const lights = [-0.7, 0.7].map(x => {
            const l = new THREE.SpotLight(0xfff5e0, 0, 90, Math.PI / 7, 0.45, 1.4);
            l.position.set(x, 0.6, 2.0); l.target.position.set(x * 1.5, -0.2, 30);
            group.add(l); group.add(l.target); return l;
        });

        let interior = null;
        if (window.CarModels && CarModels.buildInterior) {
            try { interior = CarModels.buildInterior(data.id, dashTexture()); } catch (e) { console.warn('interior failed for ' + data.id, e); }
            if (interior) { interior.visible = false; interior.renderOrder = 999; scene.add(interior); }
        }
        C.body = body; C.vehicle = vehicle; C.group = group; C.wheels = wheels; C.headlights = lights; C.interior = interior;
        C.gear = 1; steer = 0;
        camPos.set(pos.x, pos.y + 6, pos.z - 14);
    };

    C.destroy = function () {
        if (!C.body) return;
        C.vehicle.removeFromWorld(world); world.removeBody(C.body);
        scene.remove(C.group); C.wheels.forEach(w => scene.remove(w));
        if (C.interior) scene.remove(C.interior);
        C.body = C.vehicle = C.group = C.interior = null; C.wheels = [];
    };

    C.yaw = function () { const q = C.body ? C.body.quaternion : null; return q ? Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) : 0; };

    // Cockpit: the ported interior (steering wheel, dash) shown instead of the body; the dash
    // screen is a canvas we redraw with the live speed and gear.
    let dashCanvas, dashCtx, dashTex, dashFrame = 0;
    function dashTexture() {
        if (dashTex) return dashTex;
        dashCanvas = document.createElement('canvas'); dashCanvas.width = 512; dashCanvas.height = 200;
        dashCtx = dashCanvas.getContext('2d');
        dashTex = new THREE.CanvasTexture(dashCanvas);
        dashTex.center.set(0.5, 0.5); dashTex.repeat.x = -1;      // the screen plane faces backwards
        return dashTex;
    }
    function drawDash() {
        if (!dashCtx || C.view !== 'cockpit' || dashFrame++ % 6) return;
        const ctx = dashCtx, W = dashCanvas.width, H = dashCanvas.height;
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0c0e14'); g.addColorStop(1, '#040507');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(200,155,108,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, W - 10, H - 10);
        ctx.fillStyle = '#efe7d8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 96px Helvetica, Arial, sans-serif'; ctx.fillText(Math.round(C.mph), W * 0.35, H * 0.5);
        ctx.font = '600 22px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#c89b6c'; ctx.fillText('MPH', W * 0.35, H * 0.82);
        ctx.fillText((C.data ? C.data.name : '').toUpperCase(), W * 0.5, H * 0.14);
        ctx.font = 'bold 64px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#efe7d8'; ctx.fillText(CFG.GEARS[C.gear].name, W * 0.74, H * 0.5);
        ctx.font = '600 20px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#c89b6c'; ctx.fillText('GEAR', W * 0.74, H * 0.82);
        dashTex.needsUpdate = true;
    }

    // Put the car back on the nearest built road, upright, facing along it (R key, and
    // automatically after a few seconds stuck or on its side).
    C.reset = function (quiet) {
        if (!C.body) return;
        const pos = C.body.position;
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, pos); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        if (!best) return;
        const r = best.r, f = best.n.frame;
        const yaw = C.yaw(), fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const dir = (fwd.dot(f.tan) >= 0 || !r.typeDef.twoWay) ? 1 : -1;
        const lanes = r.lanes.filter(l => l.dir === dir);
        const lane = lanes[Math.min(lanes.length - 1, Math.floor(lanes.length / 2))] || r.lanes[0];
        const at = Road.at(r, best.n.s, lane.offset);
        const tan = at.tan.clone().multiplyScalar(dir);
        C.teleport(at.p.x, at.p.y + 1.2, at.p.z, Road.yawOf(tan));
        C.stuckTimer = 0; C.cruise = null;
        if (!quiet && window.UI) UI.toast('Back on the road');
    };
    C.stuckTimer = 0;
    function watchStuck(dt) {
        const b = C.body;
        tmpQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        tmpV.set(0, 1, 0).applyQuaternion(tmpQ);
        const onSide = tmpV.y < 0.86;                      // leaning more than ~30 degrees
        const pushingButStill = keys.fwd && C.mph < 2;
        const fallen = b.position.y < Terrain.height(b.position.x, b.position.z) - 3;
        if (onSide || pushingButStill || fallen) C.stuckTimer += dt; else C.stuckTimer = 0;
        if (C.stuckTimer > 4 || fallen && C.stuckTimer > 1) C.reset();
    }

    C.gearUp = function () { if (C.gear < CFG.GEARS.length - 1) C.gear++; C.manualTimer = 4; };
    C.gearDown = function () { if (C.gear > 0) C.gear--; C.manualTimer = 4; };
    C.toggleView = function () { C.view = C.view === 'chase' ? 'cockpit' : 'chase'; };

    C.teleport = function (x, y, z, yaw) {
        const b = C.body; if (!b) return;
        b.position.set(x, y, z); b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
        b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw || 0);
        camPos.set(x, y + 6, z - 14);
    };

    C.update = function (dt) {
        const b = C.body, v = C.vehicle, d = C.data, t = C.tuning;
        if (!b) return;
        if (C.frozen) {                              // riding the train: Train moves the body + camera
            for (let i = 0; i < 4; i++) { v.applyEngineForce(0, i); v.setBrake(50, i); }
            C.group.position.copy(b.position); C.group.quaternion.copy(b.quaternion);
            for (let i = 0; i < 4; i++) { v.updateWheelTransform(i); const tr = v.wheelInfos[i].worldTransform; C.wheels[i].position.copy(tr.position); C.wheels[i].quaternion.copy(tr.quaternion); }
            if (C.interior) C.interior.visible = false;
            return;
        }

        // Speed and gear cap. Automatic gearbox unless the driver shifted in the last 4 s.
        const vel = b.velocity;
        C.mph = Math.hypot(vel.x, vel.z) * CFG.MPH;
        C.manualTimer = Math.max(0, (C.manualTimer || 0) - dt);
        if (C.manualTimer === 0 && C.gear > 0) {
            const upCap = d.maxSpeed * CFG.GEARS[C.gear].speedFrac;
            if (C.mph > upCap * 0.92 && C.gear < CFG.GEARS.length - 1) C.gear++;
            else if (C.gear > 1 && C.mph < d.maxSpeed * CFG.GEARS[C.gear - 1].speedFrac * 0.7) C.gear--;
        }
        const gear = CFG.GEARS[C.gear];
        const cap = d.maxSpeed * gear.speedFrac;
        const maxForce = d.acceleration * 100;

        // Forward is the body's local +z
        tmpV.set(0, 0, 1).applyQuaternion(tmpQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
        const forwardSpeed = vel.x * tmpV.x + vel.z * tmpV.z;

        let engine = 0, brake = 0;
        C.throttle = 0;
        if (keys.back && C.cruise) C.cruise = null;                  // braking cancels cruise
        const fwd = keys.fwd || (C.cruise && C.mph < C.cruise);
        if (C.gear === 0) {                          // reverse gear
            if (keys.fwd && C.mph < cap) { engine = maxForce * 0.5; C.throttle = 0.6; }
            if (keys.back) brake = 50;
        } else if (fwd) {
            if (C.mph < cap) { engine = -maxForce * gear.force; C.throttle = 1; }
        } else if (keys.back) {
            if (forwardSpeed > 1.5) brake = 50;       // moving forward: brake
            else { engine = maxForce * 0.3; C.throttle = 0.3; } // stopped: creep backwards
        } else {
            brake = C.mph < 3 ? 12 : 0.6 + Math.min(C.mph, 150) / 150 * 2.5;   // coast / engine braking
        }
        if (C.drifting) engine *= 0.6;
        if (C.autoBrake && C.mph > 2) { engine = 0; brake = Math.max(brake, 35); C.throttle = 0; }
        // worn tires: less power and a lower cap (Features.tires)
        const grip = C.tireGrip === undefined ? 1 : C.tireGrip;
        if (grip < 1) { engine *= grip; if (C.mph > 25 + 60 * grip) engine = 0; }
        v.applyEngineForce(engine, 2); v.applyEngineForce(engine, 3);
        for (let i = 0; i < 4; i++) v.setBrake(brake, i);

        // Steering: pick a comfortable turning radius for the current speed (tight when crawling,
        // wide at freeway speed) and derive the wheel angle from the wheelbase. Better handling
        // tightens the radius.
        const wheelbase = Math.abs(t.points[0][2] - t.points[2][2]) || 2.6;
        const handling = Math.sqrt(0.012 / Math.max(d.handling || 0.012, 0.004));
        const radius = (7 + C.mph * 1.1) * handling;
        const maxSteer = Math.min(0.5, Math.atan(wheelbase / radius));
        let target = 0;
        if (keys.left) target = maxSteer;
        if (keys.right) target = -maxSteer;
        if (C.assistSteer !== null && C.assistSteer !== undefined && !keys.left && !keys.right) target = Math.max(-maxSteer, Math.min(maxSteer, C.assistSteer));
        const k = 1 - Math.exp(-dt * 8);
        steer += (target - steer) * k;
        v.setSteeringValue(steer, 0); v.setSteeringValue(steer, 1);

        // Drift: loosen the rear, cap yaw
        const wantDrift = keys.drift && C.mph > 10;
        if (wantDrift !== C.drifting) {
            C.drifting = wantDrift;
            const wi = v.wheelInfos;
            if (wantDrift) { wi[0].frictionSlip = wi[1].frictionSlip = 4.5; wi[2].frictionSlip = wi[3].frictionSlip = 3.2; b.angularDamping = 0.99; }
            else if (d.isDrift) { wi[0].frictionSlip = wi[1].frictionSlip = 4; wi[2].frictionSlip = wi[3].frictionSlip = 1.2; b.angularDamping = t.angDamp; }
            else { wi.forEach(w => w.frictionSlip = t.slip); b.angularDamping = t.angDamp; }
        }
        // Yaw-rate cap: never spin faster than the kinematic turn (v / radius) plus a margin,
        // so grip steering stays calm at speed; drifting gets the old fixed cap.
        const speed = C.mph / CFG.MPH;
        const yawCap = C.drifting ? 0.8 : Math.max(0.6, speed / radius * 1.4);
        if (Math.abs(b.angularVelocity.y) > yawCap) b.angularVelocity.y = Math.sign(b.angularVelocity.y) * yawCap;

        // Lateral velocity (for screech / smoke)
        tmpV.set(1, 0, 0).applyQuaternion(tmpQ);
        C.lateralVel = vel.x * tmpV.x + vel.z * tmpV.z;

        // Anti-flip: if the car tips past ~45deg, snap back to yaw-only and kill the tumble
        tmpV.set(0, 1, 0).applyQuaternion(tmpQ);
        if (tmpV.y < 0.7) {
            const e = new THREE.Euler().setFromQuaternion(tmpQ, 'YXZ');
            tmpQ.setFromEuler(new THREE.Euler(0, e.y, 0));
            b.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
            b.angularVelocity.x *= 0.1; b.angularVelocity.z *= 0.1;
            if (b.position.y < Terrain.height(b.position.x, b.position.z) + 1) b.position.y = Terrain.height(b.position.x, b.position.z) + 1;
        }

        watchStuck(dt);

        // Visuals follow physics
        C.group.position.copy(b.position);
        C.group.quaternion.copy(b.quaternion);
        if (C.interior) { C.interior.position.copy(b.position); C.interior.quaternion.copy(b.quaternion); C.interior.visible = C.view === 'cockpit'; }
        drawDash();
        for (let i = 0; i < 4; i++) {
            v.updateWheelTransform(i);
            const tr = v.wheelInfos[i].worldTransform;
            C.wheels[i].position.copy(tr.position);
            C.wheels[i].quaternion.copy(tr.quaternion);
        }
        const night = window.Sky ? Sky.night : 0;
        C.headlights.forEach(l => l.intensity = 1.6 * Math.max(0, night - 0.1));

        updateCamera(dt);
    };

    function updateCamera(dt) {
        const b = C.body;
        tmpQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        if (C.view === 'cockpit') {
            tmpV.set(0.4, 0.72, 0.05).applyQuaternion(tmpQ).add(b.position);
            camera.position.copy(tmpV);
            camLook.set(0.4, 0.55, 8).applyQuaternion(tmpQ).add(b.position);
            camera.lookAt(camLook);
            camera.fov += ((80 + 12 * Math.min(C.mph / 200, 1)) - camera.fov) * (1 - Math.exp(-dt * 5));
            camera.updateProjectionMatrix();
            if (C.group.visible) { C.group.visible = false; C.wheels.forEach(w => w.visible = false); }
            return;
        }
        if (!C.group.visible) { C.group.visible = true; C.wheels.forEach(w => w.visible = true); }
        const s = Math.min(C.mph / 200, 1);
        tmpV.set(0, 6 + 2 * s, -14 - 6 * s).applyQuaternion(tmpQ).add(b.position);
        // keep the camera above the ground
        const gy = Terrain.height(tmpV.x, tmpV.z) + 1.5;
        if (tmpV.y < gy) tmpV.y = gy;
        const k = 1 - Math.exp(-dt * 6);
        camPos.lerp(tmpV, k);
        camera.position.copy(camPos);
        camLook.set(b.position.x, b.position.y + 1, b.position.z);
        camera.lookAt(camLook);
        camera.fov += ((75 + 10 * s) - camera.fov) * (1 - Math.exp(-dt * 4));
        camera.updateProjectionMatrix();
    }

    return C;
})();
