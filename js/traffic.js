// tokyo-driver1 v2 — AI traffic. Cars follow road lanes (Road records), keep their distance,
// stop at red lights, turn at intersections, take exits and merge from on-ramps, and are
// recycled around the player. Each car has a kinematic physics box so the player can hit it.
window.Traffic = (function () {
    const T = { cars: [], MAX: 34, SPAWN_R: 650, DESPAWN_R: 1000, links: [] };
    let scene, world;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const COLORS = [0xd8d8d8, 0x202428, 0x8a8f94, 0xb0121b, 0x1a3f8f, 0xf2f2f2, 0x5a6b3a, 0xc27a1e, 0x3a3f44, 0xe8c547];
    const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();

    T.init = function (sc, w) { scene = sc; world = w; };

    // ---------- links between roads (mid-road junctions) ----------
    // When a car on `from` (travelling fromDir in lane `laneIndex`) passes arc length sFrom, with
    // probability p it continues on `to` at sTo travelling toDir.
    T.link = function (from, sFrom, to, sTo, laneIndex, p, fromDir, toDir) { T.links.push({ from, sFrom, to, sTo, laneIndex, p, fromDir: fromDir || 1, toDir: toDir || 1 }); };
    T.linkRamp = function (rec) {
        const fw = rec.from, outer = fw.typeDef.lanes - 1, d = rec.dir || 1;
        if (rec.isExit) T.link(fw, rec.s0 - d * 40, rec, 0, outer, rec.isUturn ? 0.15 : 0.4, d, 1);
        if (rec.isOnramp) { const md = rec.mergeDir || d; T.link(rec, rec.length - 10, fw, rec.s1 - md * 40, outer, 1, 1, md); }
    };
    T.unlinkRoad = function (rec) { T.links = T.links.filter(l => l.from !== rec && l.to !== rec); T.cars.filter(c => c.road === rec).forEach(remove); };

    // ---------- visuals ----------
    function makeMesh(color) {
        const g = new THREE.Group();
        const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.5 });
        const kind = Math.random();
        const long = kind < 0.15 ? 5.2 : 4.2, tall = kind < 0.15 ? 1.9 : 1.35;
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, long), paint); body.position.y = 0.72; g.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, tall - 0.7, long * 0.5), dark); cabin.position.set(0, 0.72 + 0.35 + (tall - 0.7) / 2, -0.2); g.add(cabin);
        const wheelGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10); wheelGeom.rotateZ(Math.PI / 2);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
        [[0.85, 1.35], [-0.85, 1.35], [0.85, -1.35], [-0.85, -1.35]].forEach(([x, z]) => { const w = new THREE.Mesh(wheelGeom, wheelMat); w.position.set(x, 0.36, z); g.add(w); });
        const head = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0 });
        const tail = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2020, emissiveIntensity: 0.15 });
        [-0.65, 0.65].forEach(x => {
            const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), head); h.position.set(x, 0.85, long / 2 + 0.02); g.add(h);
            const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), tail); t.position.set(x, 0.85, -long / 2 - 0.02); g.add(t);
        });
        body.castShadow = true;          // only the body: wheels and lamps are not worth a shadow pass each
        g.userData.lights = { head, tail };
        g.userData.size = [1.9, tall, long];
        return g;
    }

    // ---------- spawning ----------
    function candidateRoads(playerPos) {
        const out = [];
        Road.all.forEach(r => {
            if (r.type === 'ramp') return;
            if (Object.keys(r.chunks).length === 0) return;            // not built (streamed out)
            const n = Road.nearest(r, playerPos);
            if (n.dist < T.SPAWN_R + r.length) out.push({ r, n });
        });
        return out;
    }

    function spawn(playerPos) {
        const cands = candidateRoads(playerPos);
        if (!cands.length) return;
        const { r, n } = pick(cands);
        const lane = pick(r.lanes);
        // a point on this road within the spawn radius but not right next to the player
        let s = null;
        for (let k = 0; k < 6 && s === null; k++) {
            const sTry = Math.max(5, Math.min(r.length - 5, n.s + rnd(-T.SPAWN_R, T.SPAWN_R)));
            const p = Road.at(r, sTry, lane.offset).p;
            const d = p.distanceTo(playerPos);
            if (d > 60 && d < T.SPAWN_R) s = sTry;
        }
        if (s === null) return;
        if (T.cars.some(c => c.road === r && c.lane === lane && Math.abs(c.s - s) < 18)) return;
        const mesh = makeMesh(pick(COLORS));
        scene.add(mesh);
        const size = mesh.userData.size;
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
        body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)), new CANNON.Vec3(0, size[1] / 2 + 0.3, 0));
        world.addBody(body);
        const limit = r.type === 'freeway' ? rnd(26, 34) : rnd(11, 16);   // units/s (~60-75 mph, ~25-35 mph)
        T.cars.push({ road: r, lane, s, dir: lane.dir, speed: limit * 0.8, limit, mesh, body, cross: null, cooldown: 0 });
    }

    function remove(car) {
        scene.remove(car.mesh); world.removeBody(car.body);
        const i = T.cars.indexOf(car); if (i >= 0) T.cars.splice(i, 1);
    }

    // ---------- navigation ----------
    // At the end of a road: find roads whose start/end lies near this end; cross to one of them.
    function nextRoad(car) {
        const r = car.road, atEnd = car.dir === 1;
        const endP = Road.at(r, atEnd ? r.length : 0, 0).p;
        const endTan = Road.at(r, atEnd ? r.length : 0, 0).tan; if (!atEnd) endTan.negate();
        const opts = [];
        Road.all.forEach(o => {
            if (o === r || Object.keys(o.chunks).length === 0) return;
            const ps = Road.at(o, 0, 0), pe = Road.at(o, o.length, 0);
            const ds = ps.p.distanceTo(endP), de = pe.p.distanceTo(endP);
            if (ds < 22) opts.push({ road: o, dir: 1, s: 0, entry: ps, w: 1 });
            if (de < 22 && o.typeDef.twoWay) opts.push({ road: o, dir: -1, s: o.length, entry: pe, w: 1 });
        });
        // don't U-turn back onto the road we came from unless nothing else
        const forward = opts.filter(o => { const t = o.entry.tan.clone().multiplyScalar(o.dir); return t.dot(endTan) > -0.5; });
        const use = forward.length ? forward : opts;
        if (!use.length) return false;
        // prefer going straight (2x weight)
        use.forEach(o => { const t = o.entry.tan.clone().multiplyScalar(o.dir); o.w = t.dot(endTan) > 0.8 ? 2.5 : 1; });
        let total = use.reduce((a, o) => a + o.w, 0), x = Math.random() * total, chosen = use[0];
        for (const o of use) { x -= o.w; if (x <= 0) { chosen = o; break; } }
        const lane = laneFor(chosen.road, chosen.dir, car.lane.index);
        const p1 = Road.at(chosen.road, chosen.s, lane.offset).p;
        const p0 = Road.at(r, atEnd ? r.length : 0, car.lane.offset).p;
        const y0 = yawOf(car), y1 = Math.atan2(chosen.entry.tan.x * chosen.dir, chosen.entry.tan.z * chosen.dir);
        car.cross = { p0, p1, y0, y1, t: 0, len: Math.max(1, p0.distanceTo(p1)), road: chosen.road, lane, dir: chosen.dir, s: chosen.s };
        return true;
    }
    function laneFor(road, dir, index) {
        const same = road.lanes.filter(l => l.dir === dir);
        return same[Math.min(index, same.length - 1)] || same[0] || road.lanes[0];
    }
    function yawOf(car) { const f = Road.at(car.road, car.s, 0); return Math.atan2(f.tan.x * car.dir, f.tan.z * car.dir); }

    // Red light ahead? (grid street segments carry meta: city, axis, node for each direction)
    function lightAhead(car) {
        const m = car.road.meta; if (!m) return false;
        const node = car.dir === 1 ? m.endNode : m.startNode;
        const L = m.city.lightAt && m.city.lightAt(node[0], node[1]); if (!L) return false;
        const green = m.axis === 'ns' ? L.nsGreen : L.ewGreen;
        return !green;
    }

    // Nearest car (or the player) ahead in the same lane: returns {gap, speed}
    function leader(car, playerPos, playerSpeed) {
        let best = null;
        for (let i = 0; i < T.cars.length; i++) {
            const o = T.cars[i];
            if (o === car || o.road !== car.road || o.dir !== car.dir || o.lane.index !== car.lane.index) continue;
            const gap = (o.s - car.s) * car.dir;
            if (gap > 0 && gap < 60 && (!best || gap < best.gap)) best = { gap, speed: o.speed };
        }
        // the player: project onto this road (lateral offset from the frame, not 3D distance,
        // because frames are 8 units apart along the road)
        const n = Road.nearest(car.road, playerPos);
        if (n.dist < car.road.width) {
            const f = n.frame;
            const dx = playerPos.x - f.p.x, dz = playerPos.z - f.p.z;
            const along = dx * f.tan.x + dz * f.tan.z;
            const lateral = dx * f.right.x + dz * f.right.z;
            const gap = (n.s + along - car.s) * car.dir;
            if (gap > 0 && gap < 60 && Math.abs(lateral - car.lane.offset) < 2.6 && (!best || gap < best.gap)) best = { gap, speed: Math.max(0, playerSpeed) };
        }
        return best;
    }

    T.update = function (dt, playerPos, playerSpeed) {
        // recycle
        for (let i = T.cars.length - 1; i >= 0; i--) {
            const c = T.cars[i];
            if (c.mesh.position.distanceTo(playerPos) > T.DESPAWN_R || Object.keys(c.road.chunks).length === 0) remove(c);
        }
        if (T.cars.length < T.MAX && Math.random() < 0.5) spawn(playerPos);

        const night = window.Sky ? Sky.night : 0;
        for (let i = 0; i < T.cars.length; i++) {
            const c = T.cars[i];
            c.cooldown = Math.max(0, c.cooldown - dt);
            if (c.cross) {
                c.cross.t += c.speed * dt / c.cross.len;
                if (c.cross.t >= 1) {
                    c.road = c.cross.road; c.lane = c.cross.lane; c.dir = c.cross.dir; c.s = c.cross.s; c.cross = null;
                    c.limit = c.road.type === 'freeway' ? rnd(26, 34) : c.road.type === 'ramp' ? rnd(14, 18) : rnd(11, 16);
                } else {
                    const k = c.cross.t;
                    c.mesh.position.lerpVectors(c.cross.p0, c.cross.p1, k);
                    let dy = c.cross.y1 - c.cross.y0; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
                    c.mesh.rotation.set(0, c.cross.y0 + dy * k, 0);
                    placeBody(c);
                    continue;
                }
            }
            // target speed: limit, leader, lights, road end
            let target = c.limit;
            const L = leader(c, playerPos, playerSpeed);
            if (L) {
                if (L.gap < 8) target = Math.min(target, L.speed * 0.3);
                else if (L.gap < 20) target = Math.min(target, L.speed * (0.3 + 0.7 * (L.gap - 8) / 12));
                else if (L.gap < 30) target = Math.min(target, c.limit * (0.85 + 0.15 * (L.gap - 20) / 10));
            }
            const toEnd = c.dir === 1 ? c.road.length - c.s : c.s;
            if (c.road.meta && toEnd < 14 && lightAhead(c)) target = toEnd < 6 ? 0 : Math.min(target, 3);
            if (c.road.type !== 'freeway' && toEnd < 25) target = Math.min(target, 9);   // slow for the corner
            c.speed += (target - c.speed) * Math.min(1, dt * (target < c.speed ? 4 : 1.2));
            if (c.speed < 0.05) c.speed = 0;

            // links (exits / merges)
            if (c.cooldown === 0) {
                for (let k = 0; k < T.links.length; k++) {
                    const l = T.links[k];
                    if (l.from !== c.road || c.dir !== l.fromDir || c.lane.index !== l.laneIndex) continue;
                    const before = c.s, after = c.s + c.dir * c.speed * dt;
                    const crossed = l.fromDir === 1 ? (before < l.sFrom && after >= l.sFrom) : (before > l.sFrom && after <= l.sFrom);
                    if (crossed && Math.random() < l.p && Object.keys(l.to.chunks).length) {
                        const lane = laneFor(l.to, l.toDir, l.to.typeDef.lanes - 1);
                        c.road = l.to; c.s = l.sTo; c.lane = lane; c.dir = l.toDir; c.cooldown = 3;
                        c.limit = c.road.type === 'freeway' ? rnd(26, 34) : c.road.type === 'ramp' ? rnd(14, 18) : rnd(11, 16);
                        break;
                    }
                }
            }
            c.s += c.dir * c.speed * dt;
            if ((c.dir === 1 && c.s >= c.road.length) || (c.dir === -1 && c.s <= 0)) {
                c.s = Math.max(0, Math.min(c.road.length, c.s));
                if (!nextRoad(c)) { remove(c); i--; continue; }
                continue;
            }
            const f = Road.at(c.road, c.s, c.lane.offset);
            c.mesh.position.copy(f.p);
            c.mesh.rotation.set(0, Math.atan2(f.tan.x * c.dir, f.tan.z * c.dir), 0);
            // tilt with the road slope
            const pitch = Math.asin(Math.max(-1, Math.min(1, f.tan.y))) * c.dir;
            c.mesh.rotation.x = -pitch;
            placeBody(c);
            c.mesh.userData.lights.head.emissiveIntensity = night * 1.2;
            c.mesh.userData.lights.tail.emissiveIntensity = 0.15 + night * 0.8;
        }
    };

    function placeBody(c) {
        c.body.position.set(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z);
        tmpQ.setFromEuler(c.mesh.rotation);
        c.body.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
    }

    T.clear = function () { T.cars.slice().forEach(remove); };
    return T;
})();
