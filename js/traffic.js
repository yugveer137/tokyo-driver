// tokyo-driver1 v2 — AI traffic. Cars follow road lanes (Road records), keep their distance,
// stop at red lights, turn at intersections, take exits and merge from on-ramps, and are
// recycled around the player. Each car has a kinematic physics box so the player can hit it.
//
// In a multiplayer room every player runs the traffic round themselves and tells the others
// about it (T.report, five times a second, through Multiplayer), and shows the cars the others
// are running (T.foreign): those just roll along their lane at the speed last heard, so both
// players see the same car in the same place. Players near each other share the MAX between
// them, or the road would hold twice the cars.
window.Traffic = (function () {
    const T = { cars: [], MAX: 34, SPAWN_R: 650, DESPAWN_R: 1000, links: [] };
    let scene, world;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const COLORS = [0xd8d8d8, 0x202428, 0x8a8f94, 0xb0121b, 0x1a3f8f, 0xf2f2f2, 0x5a6b3a, 0xc27a1e, 0x3a3f44, 0xe8c547];
    const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
    let nextId = 1, frame = 0;
    const theirs = {};                                                    // other players' cars here, by owner:id

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
    // real car shapes from the Kenney kit when the loader is there; a van or a truck now and then
    const KINDS = ['sedan', 'sedan', 'sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv', 'suv-luxury', 'taxi', 'van', 'police', 'truck', 'delivery'];
    // what a car looks like, as three numbers that can be sent to another player: its colour,
    // its model, and whether it is a big one (a truck or a van)
    function newLook() {
        const big = Math.random() < 0.15;
        return [Math.floor(Math.random() * COLORS.length), big ? KINDS.indexOf(Math.random() < 0.5 ? 'truck' : 'delivery') : Math.floor(Math.random() * KINDS.length), big ? 1 : 0];
    }
    function makeMesh(look) {
        const color = COLORS[look[0]] || COLORS[0], big = !!look[2];
        const long = big ? 5.2 : 4.2, tall = big ? 1.9 : 1.35;
        let g;
        if (window.Models && Models.ready) {
            const name = KINDS[look[1]] || 'sedan';
            // the model's own wheels are hidden; traffic cars get simple spinning-free wheels
            g = Models.car(name, color, long, { keepColors: name === 'taxi' || name === 'police' || name === 'delivery', wheels: true });
        } else {
            g = new THREE.Group();
            const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
            const dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.5 });
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, long), paint); body.position.y = 0.72; body.castShadow = true; g.add(body);
            const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, tall - 0.7, long * 0.5), dark); cabin.position.set(0, 0.72 + 0.35 + (tall - 0.7) / 2, -0.2); g.add(cabin);
            const wheelGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10); wheelGeom.rotateZ(Math.PI / 2);
            const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
            [[0.85, 1.35], [-0.85, 1.35], [0.85, -1.35], [-0.85, -1.35]].forEach(([x, z]) => { const w = new THREE.Mesh(wheelGeom, wheelMat); w.position.set(x, 0.36, z); g.add(w); });
        }
        const head = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0 });
        const tail = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2020, emissiveIntensity: 0.15 });
        [-0.65, 0.65].forEach(x => {
            const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), head); h.position.set(x, 0.85, long / 2 + 0.02); g.add(h);
            const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), tail); t.position.set(x, 0.85, -long / 2 - 0.02); g.add(t);
        });
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
        const look = newLook(), made = build(look);
        const limit = r.type === 'freeway' ? rnd(26, 34) : rnd(11, 16);   // units/s (~60-75 mph, ~25-35 mph)
        T.cars.push({ id: nextId++, look, road: r, lane, s, dir: lane.dir, speed: limit * 0.8, limit, mesh: made.mesh, body: made.body, cross: null, cooldown: 0 });
    }
    // the mesh and the kinematic box of a car that looks like `look`
    function build(look) {
        const mesh = makeMesh(look);
        scene.add(mesh);
        const size = mesh.userData.size;
        const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
        body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)), new CANNON.Vec3(0, size[1] / 2 + 0.3, 0));
        world.addBody(body);
        return { mesh, body };
    }

    function remove(car) {
        scene.remove(car.mesh); world.removeBody(car.body);
        const i = T.cars.indexOf(car); if (i >= 0) T.cars.splice(i, 1);
        if (car.key) delete theirs[car.key];
    }

    // ---------- multiplayer ----------
    // my own cars, for the other players: [id, road, lane, s, speed, dir, colour, model, big]
    T.report = function () {
        const out = [];
        T.cars.forEach(c => { if (!c.foreign) out.push([c.id, c.road.uid, c.road.lanes.indexOf(c.lane), Math.round(c.s * 10) / 10, Math.round(c.speed * 10) / 10, c.dir, c.look[0], c.look[1], c.look[2]]); });
        return out;
    };
    // another player's cars as they last reported them: new ones appear, the ones they no longer
    // list go, and the rest are nudged to where they say they are (or put there, if far out)
    T.foreign = function (owner, list) {
        if (!Array.isArray(list)) return;
        const seen = {}, now = Date.now();
        list.slice(0, 60).forEach(a => {
            if (!Array.isArray(a)) return;
            const key = owner + ':' + a[0], road = Road.byUid(a[1]), lane = road && road.lanes[a[2]];
            if (!road || !lane || !Object.keys(road.chunks).length) return;   // (a road that is not built here: they are further off than we can see)
            const s = Math.max(0, Math.min(road.length, Number(a[3]) || 0)), dir = a[5] === -1 ? -1 : 1;
            seen[key] = true;
            let c = theirs[key];
            if (!c) {
                const look = [a[6] | 0, a[7] | 0, a[8] ? 1 : 0], made = build(look);
                c = theirs[key] = { foreign: owner, key, look, mesh: made.mesh, body: made.body, road, lane, dir, s, speed: 0, limit: 0, cross: null, cooldown: 0 };
                T.cars.push(c);
            } else if (c.road !== road || c.lane !== lane || c.dir !== dir || Math.abs(c.s - s) > 12) { c.road = road; c.lane = lane; c.dir = dir; c.s = s; }
            else c.s += (s - c.s) * 0.35;
            c.speed = Math.max(0, Math.min(60, Number(a[4]) || 0)); c.stamp = now;
        });
        Object.keys(theirs).forEach(key => { if (theirs[key].foreign === owner && !seen[key]) remove(theirs[key]); });
    };
    // a player has left (or, with no owner, the room is over): their cars go
    T.dropForeign = function (owner) { Object.keys(theirs).forEach(key => { if (!owner || theirs[key].foreign === owner) remove(theirs[key]); }); };
    // the other players near enough to share this stretch of road with
    function sharers(playerPos) {
        if (!window.Multiplayer || !Multiplayer.others) return [];
        return Multiplayer.others().filter(o => Math.hypot(o.x - playerPos.x, o.z - playerPos.z) < T.SPAWN_R * 1.5);
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
        // the player, and any other player near: project onto this road (lateral offset from the
        // frame, not 3D distance, because frames are 8 units apart along the road)
        const person = (pos, speed) => {
            const n = Road.nearest(car.road, pos);
            if (n.dist >= car.road.width) return;
            const f = n.frame;
            const dx = pos.x - f.p.x, dz = pos.z - f.p.z;
            const along = dx * f.tan.x + dz * f.tan.z;
            const lateral = dx * f.right.x + dz * f.right.z;
            const gap = (n.s + along - car.s) * car.dir;
            if (gap > 0 && gap < 60 && Math.abs(lateral - car.lane.offset) < 2.6 && (!best || gap < best.gap)) best = { gap, speed: Math.max(0, speed) };
        };
        person(playerPos, playerSpeed);
        for (let i = 0; i < near.length; i++) { probe.set(near[i].x, playerPos.y, near[i].z); person(probe, near[i].speed); }
        return best;
    }
    let near = [];                                                        // the other players sharing the road (set once a frame)
    const probe = new THREE.Vector3();

    T.update = function (dt, playerPos, playerSpeed) {
        // recycle: my own cars when they are far from me, another player's when they have not
        // been heard of for a moment (that player went away, or the car left what we both see)
        const now = Date.now();
        let own = 0;
        for (let i = T.cars.length - 1; i >= 0; i--) {
            const c = T.cars[i];
            if (Object.keys(c.road.chunks).length === 0 || (c.foreign ? now - c.stamp > 1500 : c.mesh.position.distanceTo(playerPos) > T.DESPAWN_R)) remove(c);
            else if (!c.foreign) own++;
        }
        // players near each other share the MAX between them
        near = sharers(playerPos);
        const mine = Math.ceil(T.MAX / (1 + near.length));
        if (own < mine && Math.random() < 0.5) spawn(playerPos);
        else if (own > mine && frame++ % 20 === 0) {                      // too many now that someone has come near: the farthest of mine goes
            let far = null, fd = 80;
            T.cars.forEach(c => { if (c.foreign) return; const d = c.mesh.position.distanceTo(playerPos); if (d > fd) { fd = d; far = c; } });
            if (far) remove(far);
        }

        const night = window.Sky ? Sky.night : 0;
        for (let i = 0; i < T.cars.length; i++) {
            const c = T.cars[i];
            if (c.foreign) {                                              // another player's car: it only rolls on at the speed they gave
                c.s = Math.max(0, Math.min(c.road.length, c.s + c.dir * c.speed * dt));
                settle(c, night);
                continue;
            }
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
            settle(c, night);
        }
    };
    // put a car's mesh and box where its road, lane and s say, tilted with the slope, lights on at night
    function settle(c, night) {
        const f = Road.at(c.road, c.s, c.lane.offset);
        c.mesh.position.copy(f.p);
        c.mesh.rotation.set(0, Math.atan2(f.tan.x * c.dir, f.tan.z * c.dir), 0);
        const pitch = Math.asin(Math.max(-1, Math.min(1, f.tan.y))) * c.dir;
        c.mesh.rotation.x = -pitch;
        placeBody(c);
        c.mesh.userData.lights.head.emissiveIntensity = night * 1.2;
        c.mesh.userData.lights.tail.emissiveIntensity = 0.15 + night * 0.8;
    }

    function placeBody(c) {
        c.body.position.set(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z);
        tmpQ.setFromEuler(c.mesh.rotation);
        c.body.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
    }

    T.clear = function () { T.cars.slice().forEach(remove); };
    return T;
})();
