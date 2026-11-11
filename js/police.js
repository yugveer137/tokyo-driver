// tokyo-driver1 v2 — police. A patrol car shadows you on the freeway and the avenues. Go more
// than 15 over the limit near it and it lights up and gives chase: pull over (stop) and you pay
// a fine, outrun it by 500 m and you are clear. The siren is GameAudio.siren(). In ROBBERY
// mode a patrol car also idles along the street while you are on foot, watching the houses:
// walk and it ignores you, run within its sight and it comes for you.
window.Police = (function () {
    const P = { car: null, state: 'off', fine: 150 };
    let scene, flashT = 0, lights = [];
    const OVER = 15, CATCH_DIST = 9, LOSE_DIST = 500;

    P.init = function (sc) { scene = sc; };

    function spawn(road, s, dir) {
        const g = (window.Models && Models.ready) ? Models.car('police', 0xffffff, 4.5, { keepColors: true, wheels: true }) : new THREE.Group();
        if (!g.children.length && !(window.Models && Models.ready)) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 4.4), new THREE.MeshStandardMaterial({ color: 0xf4f4f4 })); m.position.y = 0.95; g.add(m); }
        lights = [[-0.45, 0xff2020], [0.45, 0x2040ff]].map(([x, c]) => {
            const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), new THREE.MeshBasicMaterial({ color: c }));
            l.position.set(x, 1.72, -0.2); g.add(l); return l;
        });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.45), new THREE.MeshStandardMaterial({ color: 0x222222 })); bar.position.set(0, 1.6, -0.2); g.add(bar);
        scene.add(g);
        P.car = { mesh: g, road, s, dir, speed: 0 };
    }
    function remove() { if (P.car) { scene.remove(P.car.mesh); if (P.car.arrest && P.car.arrest.cop) scene.remove(P.car.arrest.cop); } if (window.Walk) { Walk.cuffed = false; if (Walk.ride) { Walk.ride = null; if (Walk.avatar) Walk.avatar.visible = true; } } P.car = null; P.state = 'off'; P.wanted = false; if (window.GameAudio && GameAudio.siren) GameAudio.siren(false); }
    // a robber friend rammed the patrol car: the police give up for now
    P.standDown = function () { remove(); };                                   // the night officer has you already: the car outside goes back to its beat
    P.rammed = function (who) { if (!P.car) return false; UI.toast(who + ' ran the cops off the road! You are clear.', 3500); if (window.GameAudio) GameAudio.honk(); remove(); return true; };

    // the road the player is on (freeways and avenues only for patrols; any road once wanted)
    function playerRoad() {
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length || (!P.wanted && r.type !== 'freeway' && r.type !== 'avenue')) return; const n = Road.nearest(r, Car.body.position); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        return best && bd < best.r.width * (P.wanted ? 3 : 1) ? best : null;
    }
    // Robbery mode: a car comes for you right now, wherever you are, and keeps coming
    P.alert = function () {
        P.wanted = true;
        if (!P.car) {
            let best = null, bd = Infinity;
            Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, Car.body.position); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
            if (!best) return;
            const d = best.r.typeDef.twoWay ? (Math.random() < 0.5 ? 1 : -1) : 1;
            spawn(best.r, Math.max(0, Math.min(best.r.length, best.n.s - d * 140)), d);
        }
        P.state = 'chase'; P.car.t = 0;
        if (window.GameAudio && GameAudio.siren) GameAudio.siren(true);
    };
    function dirOnRoad(road, n) {
        const yaw = Car.yaw(), fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        return fwd.dot(n.frame.tan) >= 0 || !road.typeDef.twoWay ? 1 : -1;
    }
    function laneOffset(road, dir) { const ls = road.lanes.filter(l => l.dir === dir); return ls.length ? ls[ls.length - 1].offset : 0; }

    // On foot in robbery mode: a patrol car cruises slowly up and down the nearest street. It
    // only notices you if you run (Space) within 70 m of it; sneaking past on foot is fine.
    const WATCH_SPEED = 4.5, SEEN = 70;
    function watch(dt) {
        const me = Walk.pos;
        if (!P.car) {
            let best = null, bd = 150;
            Road.all.forEach(r => { if (!Object.keys(r.chunks).length || (r.type !== 'street' && r.type !== 'avenue')) return; const n = Road.nearest(r, me); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
            if (!best) return;
            spawn(best.r, Math.max(0, Math.min(best.r.length, best.n.s + 50)), -1); P.state = 'watch'; P.car.speed = WATCH_SPEED;
            return;
        }
        const c = P.car;
        if (P.state !== 'watch') return;
        c.s += c.dir * WATCH_SPEED * dt;
        if (c.s <= 0 || c.s >= c.road.length) {                                 // the end of the block: straight on to the next one, or turn round
            if (!straightOn(c)) { c.dir *= -1; c.s = Math.max(0, Math.min(c.road.length, c.s)); }
        }
        if (c.mesh.position.distanceTo(me) > 400) { remove(); return; }           // you wandered off: a new car picks you up elsewhere
        if (Walk.running && !Walk.room && c.mesh.position.distanceTo(me) < SEEN) {   // (running indoors is the sleeper's problem, not the street's)
            UI.toast('The police saw you running — they are coming!', 3500);
            P.alert();
        }
    }
    // City streets come in one segment per block, so a car that only paced its own segment
    // would never get further than a house or two from your door. At the end it carries on to
    // the segment that continues straight ahead, if there is one.
    function straightOn(c) {
        const r = c.road, atEnd = c.dir === 1;
        const end = Road.at(r, atEnd ? r.length : 0, 0), tan = end.tan.clone().multiplyScalar(c.dir);
        let best = null, bd = 0.8;
        Road.all.forEach(o => {
            if (o === r || !Object.keys(o.chunks).length || (o.type !== 'street' && o.type !== 'avenue')) return;
            const ps = Road.at(o, 0, 0), pe = Road.at(o, o.length, 0);
            if (ps.p.distanceTo(end.p) < 22 && ps.tan.dot(tan) > bd) { bd = ps.tan.dot(tan); best = { road: o, dir: 1, s: 0 }; }
            if (o.typeDef.twoWay && pe.p.distanceTo(end.p) < 22 && -pe.tan.dot(tan) > bd) { bd = -pe.tan.dot(tan); best = { road: o, dir: -1, s: o.length }; }
        });
        if (!best) return false;
        c.road = best.road; c.dir = best.dir; c.s = best.s;
        return true;
    }
    // Wanted while on foot in robbery mode: the car drives up, an officer gets out and comes
    // for you, kicking the door in if you are inside a house. Reach you and it's handcuffs and
    // a ride to the station (Robbery.onArrested). Get to your car first and it's a road chase.
    const COP_WALK = 5.5;
    function arrest(dt) {
        const c = P.car, me = Walk.pos;
        const inside = window.Robbery && Robbery.inside ? Robbery.inside.room : null;
        c.arrest = c.arrest || { phase: 'drive', t: 0 };
        const a = c.arrest;
        if (a.phase === 'drive') {
            const to = inside ? inside.doorOut : me;
            const dx = to.x - c.mesh.position.x, dz = to.z - c.mesh.position.z, d = Math.hypot(dx, dz);
            if (d > 7) { const step = Math.min(d - 6, 14 * dt); c.mesh.position.x += dx / d * step; c.mesh.position.z += dz / d * step; c.mesh.rotation.y = Math.atan2(dx, dz); c.mesh.position.y = Walk.groundY(c.mesh.position.x, c.mesh.position.z, c.mesh.position.y + 1); }
            else {
                a.phase = 'cop'; a.cop = Peds.person({ shirt: 0x1d3f8f, pants: 0x14172a, hair: 0x111111 });
                a.cop.position.copy(c.mesh.position); a.cop.position.y = Walk.groundY(a.cop.position.x, a.cop.position.z, c.mesh.position.y); scene.add(a.cop);
                UI.toast('POLICE! An officer is coming for you' + (inside ? ' — they are at the door!' : '. Run!'), 4500);
            }
            return;
        }
        const cop = a.cop;
        const walk = (to, speed) => { const dx = to.x - cop.position.x, dz = to.z - cop.position.z, d = Math.hypot(dx, dz); if (d > 0.4) { const step = Math.min(d, speed * dt); cop.position.x += dx / d * step; cop.position.z += dz / d * step; cop.rotation.y = Math.atan2(dx, dz); } Peds.animate(cop, dt, d > 0.4, true); return d; };
        const face = () => { cop.rotation.y = Math.atan2(me.x - cop.position.x, me.z - cop.position.z); };
        if (a.phase === 'cop') {
            if (inside && !a.in) {
                // to the door, then a shoulder through it
                if (walk(inside.doorOut, COP_WALK) < 1.2) { a.t += dt; if (a.t > 1.5) { a.in = true; cop.position.copy(inside.doorIn); cop.position.y = inside.floorY; UI.toast('BANG — they kicked the door in!', 4000); if (window.GameAudio) GameAudio.honk(); } }
                else cop.position.y = Walk.groundY(cop.position.x, cop.position.z, cop.position.y);
                return;
            }
            if (inside) { inside.clamp(cop.position); cop.position.y = inside.floorY; } else cop.position.y = Walk.groundY(cop.position.x, cop.position.z, cop.position.y);
            if (walk(me, COP_WALK) < 2.8) {
                // "Hands up!": the gun arm goes straight up
                a.phase = 'handsup'; a.t = 0; face(); Peds.animate(cop, dt, false);
                const arm = cop.userData.arms[1]; arm.rotation.x = -Math.PI;
                a.gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })); a.gun.position.set(0, -0.64, 0.1); arm.add(a.gun);
                Walk.cuffed = true;
                UI.toast('"HANDS UP! Don\'t move!"', 3200);
            }
        } else if (a.phase === 'handsup') {
            a.t += dt; face();
            if (a.t > 3.0) {
                // a warning shot over your head: a flash from the muzzle
                a.phase = 'shot'; a.t = 0;
                a.flash = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a })); a.flash.position.set(0, -0.75, 0.2); cop.userData.arms[1].add(a.flash);
                UI.toast('BANG! A warning shot over your head. "Next one\'s not a warning."', 3200);
                if (window.GameAudio) { GameAudio.honk(); if (GameAudio.clank) GameAudio.clank(); }
            }
        } else if (a.phase === 'shot') {
            a.t += dt;
            if (a.t > 0.12 && a.flash) { cop.userData.arms[1].remove(a.flash); a.flash = null; }
            if (a.t > 2.8) { a.phase = 'cuffs'; a.t = 0; cop.userData.arms[1].rotation.x = -0.6; UI.toast('Handcuffed! "You have the right to remain silent."', 3800); }
        } else if (a.phase === 'cuffs') {
            a.t += dt;
            if (a.t > 3.6) {
                // into the back seat; the car drives you to the station through the streets
                scene.remove(cop);
                if (window.Robbery && Robbery.leaveNow) Robbery.leaveNow();
                // the nearest station (any city or town), reached through its streets
                const cities = World.cities.filter(x => x.fw && !x.parentCity).sort((p, q) => Math.hypot(p.center.x - me.x, p.center.z - me.z) - Math.hypot(q.center.x - me.x, q.center.z - me.z));
                const city = cities[0], st = city ? World.policeStationAt(city) : null;
                if (!st) { Walk.cuffed = false; if (window.Robbery) Robbery.onArrested(); remove(); return; }
                a.phase = 'ride'; a.t = 0; a.city = city;
                a.route = Robbery.gridRoute ? Robbery.gridRoute(city, c.mesh.position, st.door) : [st.door.clone()];
                a.route.push(st.door.clone());
                Walk.avatar.visible = false; Walk.ride = c.mesh;
                UI.toast('They toss you in the back seat. "Enjoy the ride." Off to the ' + city.name + ' police station…', 6000);
            }
        } else if (a.phase === 'ride') {
            a.t += dt;
            const to = a.route[0], dx = to.x - c.mesh.position.x, dz = to.z - c.mesh.position.z, d = Math.hypot(dx, dz);
            if (d > 2.5) { const step = Math.min(d, 13 * dt); c.mesh.position.x += dx / d * step; c.mesh.position.z += dz / d * step; let e = Math.atan2(dx, dz) - c.mesh.rotation.y; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; c.mesh.rotation.y += e * Math.min(1, dt * 5); c.mesh.position.y = Walk.groundY(c.mesh.position.x, c.mesh.position.z, c.mesh.position.y + 1); }
            else { a.route.shift(); if (!a.route.length || a.t > 90) { Walk.ride = null; Walk.avatar.visible = true; Walk.cuffed = false; if (window.Robbery) Robbery.onArrested(a.city); remove(); } }
        }
    }
    P.update = function (dt) {
        if (window.Robbery && Robbery.isOn() && window.Walk && Walk.active && Game.started) {
            if (!P.wanted) { watch(dt); if (!P.car || P.state === 'watch') { place(dt); return; } }
            else if (P.car) { if (P.state !== 'arrest') { P.state = 'arrest'; P.car.arrest = null; } arrest(dt); flashT += dt; const ph = Math.floor(flashT * 6) % 2; lights.forEach((l, i) => l.material.color.setHex(ph === i ? (i ? 0x4060ff : 0xff3030) : 0x101018)); return; }
        }
        if (P.car && P.car.arrest) { if (P.car.arrest.cop) scene.remove(P.car.arrest.cop); P.car.arrest = null; Walk.cuffed = false; if (P.state === 'arrest') P.state = 'chase'; }   // you got to the car: a road chase now
        if (P.car && P.state === 'watch') { P.state = 'patrol'; P.car.lost = 0; }   // back behind the wheel: the watcher is an ordinary patrol car again, speeding counts
        if (!Car.body || !Game.started || Car.towed || (window.Train && Train.riding) || (Car.parked && !P.wanted)) { if (P.car && P.state !== 'off') remove(); return; }
        if (Car.parked && P.wanted && P.car) {                               // on foot while wanted: the car waits by yours, the clock runs
            P.car.wait = (P.car.wait || 0) + dt;
            if (P.car.wait > 25) { UI.toast('The police found you on foot. Busted!', 3500); if (window.Robbery) Robbery.onCaught(); remove(); }
            return;
        }
        const pr = playerRoad();
        const limit = UI.limit || 65;
        // put a patrol car on the road 160 m behind you now and then
        if (!P.car) {
            if (pr && Math.random() < dt / 20) { const d = dirOnRoad(pr.r, pr.n); spawn(pr.r, Math.max(0, Math.min(pr.r.length, pr.n.s - d * 160)), d); P.state = 'patrol'; }
            return;
        }
        const c = P.car;
        if (!pr) { if (P.state === 'patrol') { remove(); } else { c.lost = (c.lost || 0) + dt; if (c.lost > (P.wanted ? 12 : 6)) { UI.toast('You lost the police.', 2500); if (window.Robbery) Robbery.onEscaped(); remove(); } return; } }
        else if (pr.r !== c.road) { c.road = pr.r; c.dir = dirOnRoad(pr.r, pr.n); c.s = Math.max(0, Math.min(pr.r.length, pr.n.s - c.dir * Math.min(120, c.mesh.position.distanceTo(Car.body.position)))); }
        const n = pr ? pr.n : Road.nearest(c.road, Car.body.position);
        const gap = (n.s - c.s) * c.dir;                                        // how far ahead of the cop you are along the road
        if (P.state === 'patrol') {
            c.speed += ((limit / CFG.MPH) - c.speed) * Math.min(1, dt);
            if (Car.mph > limit + OVER && Math.abs(gap) < 220 && !(window.SelfDrive && SelfDrive.active)) { /* (the self-driving Waymo's 200 mph is the robot's, not yours) */ P.state = 'chase'; c.t = 0; UI.toast('POLICE! You were doing ' + Math.round(Car.mph) + ' in a ' + limit + '. Pull over or outrun them.', 3500); if (window.GameAudio && GameAudio.siren) GameAudio.siren(true); if (window.GameAudio) GameAudio.honk(); }
            if (Math.abs(gap) > 600) remove();                                   // drifted out of sight: off duty
        } else if (P.state === 'chase') {
            // close in fast from far back, ease off close behind, and back up if it overshoots
            const pv = Car.mph / CFG.MPH;
            let want;
            if (gap > 30) want = pv + 12; else if (gap > 10) want = pv + 4; else if (gap > 3) want = pv + 1;
            else if (gap >= -3) want = Math.min(pv, c.speed); else want = -6;
            want = Math.max(-6, Math.min(140 / CFG.MPH, want));
            c.speed += (want - c.speed) * Math.min(1, dt * 2.5);
            const near = Math.abs(gap) < CATCH_DIST;
            if (near && Car.mph < 12) { c.t += dt; if (c.t > 2) { if (P.wanted && window.Robbery) Robbery.onCaught(); else { const fine = Math.min(P.fine, Math.max(0, Game.state.coins)); Game.addCoins(-fine); UI.toast('Pulled over. Fine: ' + fine + ' coins. Keep it under the limit.', 4000); } remove(); return; } } else c.t = 0;
            if (gap > LOSE_DIST) { if (P.wanted && window.Robbery) Robbery.onEscaped(); else { UI.toast('You outran the police!', 2500); if (!(window.SelfDrive && SelfDrive.active)) Game.addCoins(50); } remove(); return; }
        }
        if (!P.car) return;
        c.s = Math.max(0, Math.min(c.road.length, c.s + c.dir * c.speed * dt));
        place(dt);
    };
    // put the car on its road and run the roof lights
    function place(dt) {
        const c = P.car; if (!c) return;
        const f = Road.at(c.road, c.s, laneOffset(c.road, c.dir));
        c.mesh.position.set(f.p.x, f.p.y + (c.road.conform ? 0 : 0.02), f.p.z);
        c.mesh.rotation.set(0, Road.yawOf(f.tan.clone().multiplyScalar(c.dir)), 0);
        flashT += dt;
        const on = P.state === 'chase', ph = Math.floor(flashT * 6) % 2;
        lights.forEach((l, i) => { l.material.color.setHex(on ? (ph === i ? (i ? 0x4060ff : 0xff3030) : 0x101018) : (i ? 0x203080 : 0x801818)); });
    }
    return P;
})();
