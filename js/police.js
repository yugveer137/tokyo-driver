// tokyo-driver1 v2 — police. A patrol car shadows you on the freeway and the avenues. Go more
// than 15 over the limit near it and it lights up and gives chase: pull over (stop) and you pay
// a fine, outrun it by 500 m and you are clear. The siren is GameAudio.siren().
window.Police = (function () {
    const P = { car: null, state: 'off', fine: 150 };
    let scene, flashT = 0, lights = [];
    const OVER = 15, CATCH_DIST = 9, LOSE_DIST = 500;

    P.init = function (sc) { scene = sc; };

    function spawn(road, s, dir) {
        const g = (window.Models && Models.ready) ? Models.car('police', 0xffffff, 4.5, { keepColors: true }) : new THREE.Group();
        if (!g.children.length && !(window.Models && Models.ready)) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 4.4), new THREE.MeshStandardMaterial({ color: 0xf4f4f4 })); m.position.y = 0.95; g.add(m); }
        lights = [[-0.45, 0xff2020], [0.45, 0x2040ff]].map(([x, c]) => {
            const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), new THREE.MeshBasicMaterial({ color: c }));
            l.position.set(x, 1.72, -0.2); g.add(l); return l;
        });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.45), new THREE.MeshStandardMaterial({ color: 0x222222 })); bar.position.set(0, 1.6, -0.2); g.add(bar);
        scene.add(g);
        P.car = { mesh: g, road, s, dir, speed: 0 };
    }
    function remove() { if (P.car) scene.remove(P.car.mesh); P.car = null; P.state = 'off'; if (window.GameAudio && GameAudio.siren) GameAudio.siren(false); }

    // the road the player is on (freeways and avenues only: no patrols on ramps and side streets)
    function playerRoad() {
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length || (r.type !== 'freeway' && r.type !== 'avenue')) return; const n = Road.nearest(r, Car.body.position); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        return best && bd < best.r.width ? best : null;
    }
    function dirOnRoad(road, n) {
        const yaw = Car.yaw(), fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        return fwd.dot(n.frame.tan) >= 0 || !road.typeDef.twoWay ? 1 : -1;
    }
    function laneOffset(road, dir) { const ls = road.lanes.filter(l => l.dir === dir); return ls.length ? ls[ls.length - 1].offset : 0; }

    P.update = function (dt) {
        if (!Car.body || !Game.started || Car.towed || Car.parked || (window.Train && Train.riding)) { if (P.car && P.state !== 'off') remove(); return; }
        const pr = playerRoad();
        const limit = UI.limit || 65;
        // put a patrol car on the road 160 m behind you now and then
        if (!P.car) {
            if (pr && Math.random() < dt / 20) { const d = dirOnRoad(pr.r, pr.n); spawn(pr.r, Math.max(0, Math.min(pr.r.length, pr.n.s - d * 160)), d); P.state = 'patrol'; }
            return;
        }
        const c = P.car;
        if (!pr) { if (P.state === 'patrol') { remove(); } else { c.lost = (c.lost || 0) + dt; if (c.lost > 6) { UI.toast('You lost the police.', 2500); remove(); } return; } }
        else if (pr.r !== c.road) { c.road = pr.r; c.dir = dirOnRoad(pr.r, pr.n); c.s = Math.max(0, Math.min(pr.r.length, pr.n.s - c.dir * Math.min(120, c.mesh.position.distanceTo(Car.body.position)))); }
        const n = pr ? pr.n : Road.nearest(c.road, Car.body.position);
        const gap = (n.s - c.s) * c.dir;                                        // how far ahead of the cop you are along the road
        if (P.state === 'patrol') {
            c.speed += ((limit / CFG.MPH) - c.speed) * Math.min(1, dt);
            if (Car.mph > limit + OVER && Math.abs(gap) < 220) { P.state = 'chase'; c.t = 0; UI.toast('POLICE! You were doing ' + Math.round(Car.mph) + ' in a ' + limit + '. Pull over or outrun them.', 3500); if (window.GameAudio && GameAudio.siren) GameAudio.siren(true); if (window.GameAudio) GameAudio.honk(); }
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
            if (near && Car.mph < 12) { c.t += dt; if (c.t > 2) { const fine = Math.min(P.fine, Math.max(0, Game.state.coins)); Game.addCoins(-fine); UI.toast('Pulled over. Fine: ' + fine + ' coins. Keep it under the limit.', 4000); remove(); return; } } else c.t = 0;
            if (gap > LOSE_DIST) { UI.toast('You outran the police!', 2500); Game.addCoins(50); remove(); return; }
        }
        if (!P.car) return;
        c.s = Math.max(0, Math.min(c.road.length, c.s + c.dir * c.speed * dt));
        const f = Road.at(c.road, c.s, laneOffset(c.road, c.dir));
        c.mesh.position.set(f.p.x, f.p.y + (c.road.conform ? 0 : 0.02), f.p.z);
        c.mesh.rotation.set(0, Road.yawOf(f.tan.clone().multiplyScalar(c.dir)), 0);
        flashT += dt;
        const on = P.state === 'chase', ph = Math.floor(flashT * 6) % 2;
        lights.forEach((l, i) => { l.material.color.setHex(on ? (ph === i ? (i ? 0x4060ff : 0xff3030) : 0x101018) : (i ? 0x203080 : 0x801818)); });
    };
    return P;
})();
