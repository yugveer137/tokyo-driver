// tokyo-driver1 v2 — pedestrians: people who walk the sidewalks of every loaded city
// and wait on the train platforms. Peds.person() is also the player's walking avatar (walk.js).
// Who they are and where they walk comes from the city's name and the clock, not from chance:
// each walks up and down its street as a fixed function of the time, so every player in a
// multiplayer room (whose clocks Multiplayer.now keeps together) sees the same person in the
// same place.
window.Peds = (function () {
    const P = { walkers: [] };
    let scene;
    // The palettes are written as the colours meant and turned into what the renderer wants
    // (it takes hex as linear light, which showed every skin as chalk).
    const lin = hex => new THREE.Color(hex).convertSRGBToLinear().getHex();
    const SHIRTS = [0xd8402f, 0x2f6fd0, 0xe8c12f, 0x2f9c68, 0xf0f0ec, 0x26262a, 0xb85ac8, 0xf07a2a, 0x6fb8e8, 0x7a1f3a, 0x3a4a6b, 0xd9b99a].map(lin);
    const PANTS = [0x2b3a55, 0x1d1d1d, 0x6b5a4a, 0x7a7a7a, 0x3a5f3a, 0x2f2f6b, 0x8a6f4a, 0x4a5a7a].map(lin);
    const SKINS = [0xf1c9a5, 0xd9a877, 0x9c6b43, 0x6b452c, 0xf5d5b8, 0xc68642, 0xe0b08a].map(lin);
    const HAIR = [0x1a1a1a, 0x4a2a10, 0xc9a35a, 0x6b4a3a, 0x9a9a9a, 0x2a1a12, 0x8a3a1a].map(lin);
    const SHOES = [0x1c1c1c, 0x4a3020, 0xe8e8e8, 0x5a2020, 0x2a3a5a].map(lin);
    const EYES = [0x2a1a10, 0x2a1a10, 0x3a2a18, 0x1f4a7a, 0x2f5a3a].map(lin);
    const WHITE = lin(0xf4f2ee), LASH = lin(0x1a1412);
    const pick = a => a[Math.floor(Math.random() * a.length)];
    function seeded(a) {
        return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    const hashOf = (text) => { let h = 9; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
    // Somebody's looks, drawn from a generator: colours, then who they are (hair, clothes, build).
    const WOMEN_HAIR = ['long', 'long', 'bob', 'bob', 'bun', 'tail', 'short'], MEN_HAIR = ['short', 'short', 'short', 'short', 'cap', 'bald', 'tail'];
    function lookFrom(r) {
        const of = a => a[Math.floor(r() * a.length)];
        const look = { skin: of(SKINS), shirt: of(SHIRTS), pants: of(PANTS), hair: of(HAIR) };
        look.woman = r() < 0.5;
        look.style = of(look.woman ? WOMEN_HAIR : MEN_HAIR);
        const legs = r();
        look.legs = look.woman && legs < 0.3 ? 'skirt' : legs > 0.82 ? 'shorts' : 'long';
        look.sleeves = r() < 0.45 ? 'short' : 'long';
        look.tall = (look.woman ? 0.93 : 0.98) + r() * 0.1;
        look.wide = 0.9 + r() * 0.24;
        look.shoes = of(SHOES); look.eyes = of(EYES);
        look.pack = r() < 0.16;
        return look;
    }
    P.lookFor = (text) => lookFrom(seeded(hashOf(text)));
    // seconds on the clock every player shares (counted from late 2025, to keep the number small)
    const clock = () => ((window.Multiplayer && Multiplayer.now ? Multiplayer.now() : Date.now()) - 1.76e12) / 1000;

    // ---------- building a person ----------
    // Everybody is made of the same few shapes in one material, each part saying its colour in
    // `userData.color`. When a person is finished the parts that move together are joined
    // (Batch.merge): the body with the head, two thighs, two shins, two upper arms, two forearms.
    // Nine meshes a person, where the box people were thirteen.
    const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
    const BALL = new THREE.SphereGeometry(1, 14, 10), BEAD = new THREE.SphereGeometry(1, 8, 6);
    const CAP = new THREE.SphereGeometry(1, 18, 7, 0, Math.PI * 2, 0, Math.PI / 2), CUBE = new THREE.BoxGeometry(1, 1, 1);
    const tubes = {};
    const tube = (top, bottom, length) => { const key = top + ' ' + bottom + ' ' + length; return tubes[key] || (tubes[key] = new THREE.CylinderGeometry(top, bottom, length, 10)); };
    function part(parent, geometry, color, x, y, z, sx, sy, sz) {
        const m = new THREE.Mesh(geometry, cloth);
        m.userData.color = color; m.position.set(x, y, z);
        if (sx !== undefined) m.scale.set(sx, sy, sz);
        parent.add(m);
        return m;
    }
    // a shape turned on a lathe from [half width, height] pairs, then flattened front to back
    function turned(parent, color, pairs, deep) {
        const m = part(parent, new THREE.LatheGeometry(pairs.map(([w, y]) => new THREE.Vector2(w, y)), 14), color, 0, 0, 0);
        m.scale.z = deep;
        return m;
    }
    // a joint: a group the limb below it hangs from (the merges leave it alone: it turns)
    function joint(parent, x, y, z) { const j = new THREE.Group(); j.position.set(x, y, z); j.userData.keep = true; parent.add(j); return j; }
    const darker = (hex, by) => new THREE.Color(hex).multiplyScalar(by).getHex();

    const HEAD = 1.55;                                                      // height of the middle of the head
    function face(rig, o, skin, hair) {
        part(rig, BALL, skin, 0, HEAD, 0.005, 0.112, 0.138, 0.122);        // the head
        part(rig, tube(0.046, 0.05, 0.13), skin, 0, 1.42, 0);              // neck
        [-1, 1].forEach(sd => {
            const x = sd * 0.043, turn = sd * 0.38;                         // (the eyes follow the curve of the face)
            if (o.asleep) {
                part(rig, BEAD, LASH, x, HEAD + 0.004, 0.117, 0.021, 0.0035, 0.006).rotation.y = turn;
            } else {
                part(rig, BEAD, WHITE, x, HEAD + 0.008, 0.1135, 0.021, 0.0155, 0.008).rotation.y = turn;
                part(rig, BEAD, o.eyes !== undefined ? o.eyes : EYES[0], x * 0.98, HEAD + 0.0065, 0.119, 0.0112, 0.0122, 0.0055).rotation.y = turn;
                part(rig, BEAD, LASH, x, HEAD + 0.0235, 0.114, 0.022, 0.0022, 0.008).rotation.y = turn;              // the upper lid
            }
            const brow = part(rig, BEAD, darker(hair, 0.7), x * 1.06, HEAD + 0.047, 0.112, 0.023, 0.0038, 0.006);
            brow.rotation.y = turn; brow.rotation.z = sd * 0.04;
            part(rig, BEAD, darker(skin, 0.93), sd * 0.113, HEAD - 0.006, 0.002, 0.012, 0.027, 0.018);                 // ear
        });
        part(rig, BEAD, darker(skin, 0.93), 0, HEAD - 0.024, 0.1255, 0.012, 0.019, 0.013);                             // nose
        // the mouth: two halves, each turned up at its corner, so everybody has a bit of a smile
        const lips = o.woman ? lin(0xb04a52) : darker(skin, 0.5);
        [-1, 1].forEach(sd => { part(rig, BEAD, lips, sd * 0.013, HEAD - 0.07, 0.1105, 0.017, 0.0048, 0.0055).rotation.z = sd * 0.3; });
    }
    function hairdo(rig, o, hair, shirt) {
        const style = o.style || 'short';
        const top = (color, sx, sy, sz, tilt) => { const c = part(rig, CAP, color, 0, HEAD + 0.004, 0, sx, sy, sz); c.rotation.x = tilt; return c; };
        if (style === 'bald') {                                             // only a fringe round the back
            part(rig, BALL, hair, 0, HEAD - 0.055, -0.022, 0.1155, 0.058, 0.112);
            return;
        }
        top(hair, 0.122, 0.15, 0.136, -0.45);                              // tipped back, to leave a forehead
        part(rig, BALL, hair, 0, HEAD - 0.04, -0.028, 0.115, 0.095, 0.105);   // the back of the head, down to the nape
        if (style === 'long') {
            part(rig, BALL, hair, 0, HEAD - 0.1, -0.07, 0.122, 0.17, 0.072);
            [-1, 1].forEach(sd => part(rig, BEAD, hair, sd * 0.106, HEAD - 0.08, -0.015, 0.03, 0.13, 0.062));
        } else if (style === 'bob') {
            part(rig, BALL, hair, 0, HEAD - 0.035, -0.035, 0.128, 0.115, 0.105);
        } else if (style === 'bun') {
            part(rig, BEAD, hair, 0, HEAD + 0.125, -0.075, 0.052, 0.05, 0.052);
        } else if (style === 'tail') {
            part(rig, BEAD, hair, 0, HEAD - 0.05, -0.145, 0.036, 0.115, 0.04).rotation.x = 0.25;
        } else if (style === 'cap') {                                       // a baseball cap over it
            const color = o.cap !== undefined ? o.cap : shirt;
            top(color, 0.127, 0.154, 0.141, -0.12).position.y = HEAD + 0.03;
            part(rig, tube(0.085, 0.085, 0.012), color, 0, HEAD + 0.04, 0.155, 1, 1, 0.95);
        }
    }
    P.person = function (o) {
        o = o || lookFrom(Math.random);
        const skin = o.skin !== undefined ? o.skin : pick(SKINS), shirt = o.shirt !== undefined ? o.shirt : pick(SHIRTS);
        const pants = o.pants !== undefined ? o.pants : pick(PANTS), hair = o.hair !== undefined ? o.hair : pick(HAIR);
        const wide = o.wide || 1, woman = !!o.woman, shoes = o.shoes !== undefined ? o.shoes : SHOES[0];
        const g = new THREE.Group(), rig = new THREE.Group();
        rig.scale.setScalar(o.tall || 1); g.add(rig);

        // body: hips in the trousers' colour, the shirt over them from hem to collar
        turned(rig, pants, [[0.09 * wide, 0.775], [0.14 * wide, 0.8], [0.146 * wide, 0.83], [0.146 * wide, 0.87]], 0.6);
        const waist = (woman ? 0.126 : 0.146) * wide, chest = (woman ? 0.152 : 0.166) * wide, across = (woman ? 0.154 : 0.172) * wide;
        turned(rig, shirt, [[0.157 * wide, 0.84], [waist, 0.98], [chest, 1.14], [across, 1.25], [across, 1.315], [across * 0.8, 1.35], [0.06, 1.375], [0.045, 1.382]], 0.64);
        if (o.legs === 'skirt') turned(rig, pants, [[0.2 * wide, 0.54], [0.19 * wide, 0.6], [0.16 * wide, 0.88]], 0.82);
        if (o.pack) part(rig, CUBE, darker(pants, 0.8), 0, 1.12, -0.155, 0.24, 0.32, 0.11);
        face(rig, o, skin, hair);
        hairdo(rig, o, hair, shirt);

        const bare = o.legs === 'skirt' || o.legs === 'shorts';
        const knees = [], elbows = [];
        const legs = [-1, 1].map(sd => {
            const hip = joint(rig, sd * 0.078 * wide, 0.8, 0);
            const thigh = o.legs === 'skirt' ? skin : pants;
            part(hip, BEAD, thigh, 0, 0, 0, 0.086, 0.086, 0.086);
            part(hip, tube(0.086, 0.064, 0.4), thigh, 0, -0.2, 0);
            const knee = joint(hip, 0, -0.4, 0); knees.push(knee);
            part(knee, BEAD, bare ? skin : pants, 0, 0, 0, 0.064, 0.064, 0.064);
            part(knee, tube(0.061, 0.044, 0.34), bare ? skin : pants, 0, -0.17, 0);
            part(knee, BEAD, shoes, 0, -0.35, 0.035, 0.052, 0.05, 0.105);            // shoe
            part(knee, tube(1, 1, 1), darker(shoes, 0.5), 0, -0.387, 0.035, 0.052, 0.026, 0.112);   // and its sole
            return hip;
        });
        const short = o.sleeves === 'short';
        const arms = [-1, 1].map(sd => {
            const shoulder = joint(rig, sd * (across + 0.014), 1.3, 0);
            part(shoulder, BEAD, shirt, 0, 0, 0, 0.05, 0.05, 0.05);
            part(shoulder, tube(0.048, 0.042, 0.27), shirt, 0, -0.135, 0);
            const elbow = joint(shoulder, 0, -0.27, 0); elbows.push(elbow);
            part(elbow, BEAD, short ? skin : shirt, 0, 0, 0, 0.043, 0.043, 0.043);
            part(elbow, tube(0.041, 0.033, 0.24), short ? skin : shirt, 0, -0.12, 0);
            part(elbow, BEAD, skin, 0, -0.277, 0.004, 0.031, 0.054, 0.042);            // hand
            return shoulder;
        });

        // join what moves together, the lowest joints last (a merge skips the joints inside it)
        Batch.merge(rig);
        legs.concat(arms, knees, elbows).forEach(j => Batch.merge(j));
        g.traverse(m => { if (m.isMesh) m.castShadow = true; });
        g.userData = { legs, arms, knees, elbows, phase: Math.random() * 6, keep: true };   // (keep: somebody else's merge must not take a person apart)
        return g;
    };
    // the stride: the thigh swings, the knee bends as the leg comes through, the arms go the other way
    P.animate = function (g, dt, moving, fast) {
        const u = g.userData; if (!u || !u.legs) return;
        if (moving) {
            u.phase += dt * (fast ? 11 : 7);
            const swing = Math.sin(u.phase), through = Math.cos(u.phase), a = swing * (fast ? 0.8 : 0.5);
            u.legs[0].rotation.x = a; u.legs[1].rotation.x = -a; u.arms[0].rotation.x = -a * 0.7; u.arms[1].rotation.x = a * 0.7;
            const bend = fast ? 1.5 : 0.95, crook = fast ? 1.25 : 0.22;
            u.knees[0].rotation.x = 0.06 + bend * Math.max(0, -through); u.knees[1].rotation.x = 0.06 + bend * Math.max(0, through);
            u.elbows[0].rotation.x = -crook - 0.3 * Math.max(0, swing); u.elbows[1].rotation.x = -crook - 0.3 * Math.max(0, -swing);
        } else {
            u.legs.concat(u.arms, u.knees, u.elbows).forEach(j => { j.rotation.x *= 0.8; });
        }
    };
    // sitting: thighs out in front, shins hanging down
    P.sit = function (g, lean) {
        g.userData.legs.forEach(l => { l.rotation.x = -(lean || Math.PI / 2); });
        g.userData.knees.forEach(k => { k.rotation.x = lean || Math.PI / 2; });
    };
    // a person who is gone for good gives their shapes back
    P.dispose = function (g) { g.traverse(m => { if (m.isMesh) m.geometry.dispose(); }); };

    function place(w) {
        const c = w.city, off = w.side * (c.street / 2 + 1.6);
        const lx = w.ns ? c.streetX(w.idx) + off : w.s, lz = w.ns ? w.s : c.streetZ(w.idx) + off;
        const p = c.toWorld(lx, lz); p.y = Terrain.height(p.x, p.z) + 0.22;
        w.mesh.position.copy(p);
        const f = c.toWorld(w.ns ? lx : lx + w.dir, w.ns ? lz + w.dir : lz);
        w.mesh.rotation.y = Math.atan2(f.x - p.x, f.z - p.z);
    }
    // sidewalk walkers for a city (called when the city loads)
    P.spawnCity = function (city) {
        if (!scene) return;
        const n = Math.min(44, Math.round(8 + city.rows * city.cols * 0.6));   // each person is nine draw calls: keep it modest
        city.peds = city.peds || [];
        const r = seeded(hashOf('walkers:' + city.id));
        for (let k = 0; k < n; k++) {
            const ns = r() < 0.5, side = r() < 0.5 ? -1 : 1;
            const idx = Math.floor(r() * ((ns ? city.cols : city.rows) + 1));
            const len = ns ? city.D : city.W, reach = len / 2 - 4;         // they walk from -reach to +reach and back
            // `lap` is where they start on that round trip (0..4 x reach), `speed` how fast they go round it
            const w = { mesh: P.person(lookFrom(r)), city, ns, idx, side, s: 0, dir: 1, speed: 1.1 + r() * 0.8, len, reach, lap: r() * 4 * reach };
            scene.add(w.mesh); city.peds.push(w); P.walkers.push(w); stride(w, clock()); place(w);
        }
    };
    // a few people waiting on a train platform
    P.spawnPlatform = function (city, point, tan) {
        if (!scene) return;
        city.peds = city.peds || [];
        const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
        const r = seeded(hashOf('platform:' + city.id));
        for (let k = 0; k < 4; k++) {
            const m = P.person(lookFrom(r));
            m.position.copy(point).addScaledVector(tan, -18 + k * 12 + r() * 4).addScaledVector(right, -1 + r() * 2);
            m.position.y = Terrain.height(m.position.x, m.position.z) + 0.95;
            m.rotation.y = Math.atan2(right.x, right.z) + (r() - 0.5);
            scene.add(m);
            const w = { mesh: m, city, idle: true, t: Math.random() * 5 };
            city.peds.push(w); P.walkers.push(w);
        }
    };
    P.unloadCity = function (city) {
        (city.peds || []).forEach(w => { scene.remove(w.mesh); P.dispose(w.mesh); });
        city.peds = [];
        P.walkers = P.walkers.filter(w => w.city !== city);
    };
    // where a walker is on its round trip at time t: out along the street, then back
    function stride(w, t) {
        const round = 4 * w.reach, at = (w.lap + w.speed * t) % round;
        w.dir = at < round / 2 ? 1 : -1;
        w.s = (at < round / 2 ? at : round - at) - w.reach;
    }
    P.update = function (dt, playerPos) {
        const t = clock();
        for (let i = 0; i < P.walkers.length; i++) {
            const w = P.walkers[i];
            const dx = w.mesh.position.x - playerPos.x, dz = w.mesh.position.z - playerPos.z;
            const d2 = dx * dx + dz * dz;
            const show = d2 < 220 * 220;                                        // too small to see further out, so don't draw them
            if (w.mesh.visible !== show) w.mesh.visible = show;
            if (!show) continue;
            if (w.idle) { w.t += dt; w.mesh.position.y += Math.sin(w.t * 2) * 0.0005; continue; }
            stride(w, t);
            place(w);
            P.animate(w.mesh, dt, true);
        }
    };
    P.init = function (sc) { scene = sc; };
    return P;
})();
