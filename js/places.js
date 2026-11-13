// tokyo-driver1 v2 — places you can walk into: the shops, hotels and apartments downtown.
// city.js gives a building a door on its street side and lists it in city.places; on foot,
// E at a door builds the inside and walks you in (first person, like the robbery's houses),
// E at the door again takes you out and the room is dropped.
//   a shop       shelves of goods, a cashier at the till, shoppers who look along the shelves,
//                queue, pay and leave with a bag. E at the till buys something for a few coins.
//   a hotel      the lobby: reception, sofas, the lifts, guests checking in and going up.
//                E at the desk takes a room for the night (and it is morning when you wake).
//   an apartment somebody's flat: sofa and TV, kitchen, table, bed. E says hello.
// Places.prompt also runs the one big button at the bottom of the screen (GO IN, LEAVE, BUY,
// RIDE WITH a player), so all of this works without a keyboard.
window.Places = (function () {
    const P = { inside: null };
    let scene, paint = null, button = null, shown = '';
    const glows = {};
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    // (the renderer shows a hex colour paler than written: this gives the colour that looks as written)
    const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear().getHex();
    const REACH = 2.6, PRICE = 3, NIGHT = 10;

    P.init = function (sc) { scene = sc; };

    // the nearest door within `reach` of someone on foot
    P.near = function (pos, reach) {
        let best = null, bd = reach;
        City.all.forEach(c => {
            if (!c.loaded || !c.places) return;
            c.places.forEach(pl => { const d = flat(pl.p, pos); if (d < bd && Math.abs(pl.p.y - pos.y) < 3) { bd = d; best = pl; } });
        });
        return best;
    };

    // ---------- a room ----------
    // A room is a Group standing where its building stands, its own +z toward the door. Local x
    // runs along the street wall, y up from the floor. Everything still is a box of one shared
    // material (the colour goes into the vertices: batch.js) or a "glow" (lamps, screens). The
    // shared material is unlit with its shading painted on: lit by the game's sun, a room came
    // out bleached by day and black by night, and it has to look the same at any hour.
    function startRoom(place, W, D, H, wallColor, floorColor) {
        if (!paint) { paint = new THREE.MeshBasicMaterial({ vertexColors: true }); paint.userData.shaded = true; }
        const g = new THREE.Group(), c = place.centre;
        // the floor stands clear of the land under the whole room, even on a slope
        let y = -Infinity;
        [[0, 0], [-5, -5], [5, -5], [-5, 5], [5, 5]].forEach(([dx, dz]) => { y = Math.max(y, Terrain.height(c.x + dx, c.z + dz)); });
        g.position.set(c.x, y + 0.4, c.z); g.rotation.y = place.yaw;
        const room = { group: g, W, D, H, place, people: [], blocks: [], actions: [], payer: null };
        room.box = (w, h, d, color, x, yy, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint); m.userData.color = lin(color); m.position.set(x, yy, z); g.add(m); return m; };
        room.shape = (geom, color, x, yy, z) => { const m = new THREE.Mesh(geom, paint); m.userData.color = lin(color); m.position.set(x, yy, z); g.add(m); return m; };
        room.glow = (w, h, d, color, x, yy, z) => { const mat = glows[color] || (glows[color] = new THREE.MeshBasicMaterial({ color: lin(color) })); const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, yy, z); g.add(m); return m; };
        // something you cannot walk through: a box plus its footprint
        room.solid = (w, h, d, color, x, yy, z) => { room.blocks.push({ x, z, hx: w / 2, hz: d / 2 }); return room.box(w, h, d, color, x, yy, z); };
        // the shell: floor, ceiling, four walls, the door you came in by and ceiling lights
        room.box(W, 0.1, D, floorColor, 0, 0.05, 0);
        room.box(W, 0.1, D, 0xf4f1ea, 0, H, 0);
        [-1, 1].forEach(s => { room.box(0.1, H, D, wallColor, s * W / 2, H / 2, 0); room.box(W, H, 0.1, wallColor, 0, H / 2, s * D / 2); });
        room.box(1.6, 2.4, 0.06, 0x3a2a20, 0, 1.2, D / 2 - 0.09);
        room.glow(0.7, 0.22, 0.05, 0x2fd06a, 0, 2.62, D / 2 - 0.09);                          // the green EXIT light over it
        for (let x = -W / 4; x <= W / 4; x += W / 2) for (let z = -D / 4; z <= D / 4; z += D / 2) room.glow(1.3, 0.05, 0.5, 0xfff4d6, x, H - 0.08, z);
        const lamp = new THREE.PointLight(0xfff0d8, 1.3, 18, 1.5); lamp.position.set(0, H - 0.7, 0); g.add(lamp);   // (for the people, who are lit)
        return room;
    }
    // the room is built: join its still parts, put it in the world, and give walk.js what it needs
    function finishRoom(room, people) {
        const g = room.group, W = room.W, D = room.D;
        Batch.merge(g);
        people();                                                           // (after the merge: people move)
        scene.add(g); g.updateMatrixWorld(true);
        const world = (x, z) => g.localToWorld(new THREE.Vector3(x, 0.1, z));
        room.floorY = g.position.y + 0.1;
        room.doorIn = world(0, D / 2 - 1.0); room.doorOut = room.place.p.clone(); room.lookAt = world(0, 0);
        room.actions.forEach(a => { a.at = world(a.x, a.z); });
        // keep the walker inside the walls and out of the furniture
        room.clamp = (pos) => {
            const l = g.worldToLocal(pos.clone());
            l.x = Math.max(-W / 2 + 0.5, Math.min(W / 2 - 0.5, l.x)); l.z = Math.max(-D / 2 + 0.5, Math.min(D / 2 - 0.5, l.z));
            room.blocks.forEach(b => {
                const px = b.hx + 0.3 - Math.abs(l.x - b.x), pz = b.hz + 0.3 - Math.abs(l.z - b.z);
                if (px <= 0 || pz <= 0) return;
                if (px < pz) l.x += (l.x < b.x ? -px : px); else l.z += (l.z < b.z ? -pz : pz);   // out by the nearer side
            });
            const o = g.localToWorld(l); pos.x = o.x; pos.z = o.z;
        };
        room.remove = () => { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); };
        return room;
    }

    // ---------- the people inside ----------
    // someone who stays put: standing, or sitting (legs out in front, hips at seat height)
    function stander(room, x, z, yaw, look, sitting) {
        const m = Peds.person(look);
        m.position.set(x, sitting ? -0.3 : 0.1, z); m.rotation.y = yaw;
        if (sitting) m.userData.legs.forEach(l => { l.rotation.x = -Math.PI / 2; });
        room.group.add(m);
        return m;
    }
    // Someone who walks a list of steps { x, z, wait, face, queue, pay, leave }: to each spot in
    // turn, there to stand `wait` seconds facing `face`. `script` writes a fresh list each time
    // round; a step marked `leave` ends it, and a new person comes in a little later.
    function walker(room, script, delay) {
        const w = { script, rest: delay || 0 };
        const fresh = () => {
            if (w.mesh) room.group.remove(w.mesh);
            w.mesh = Peds.person(); w.steps = script(); w.i = 0; w.t = 0;
            w.mesh.position.set(w.steps[0].x, 0.1, w.steps[0].z); w.mesh.visible = w.rest <= 0;
            room.group.add(w.mesh);
        };
        fresh(); w.fresh = fresh;
        room.people.push(w);
    }
    function moveWalker(room, w, dt) {
        if (w.rest > 0) { w.rest -= dt; if (w.rest <= 0) w.mesh.visible = true; return; }
        const s = w.steps[w.i], m = w.mesh, dx = s.x - m.position.x, dz = s.z - m.position.z, dist = Math.hypot(dx, dz);
        if (dist > 0.06) {
            const go = Math.min(dist, 1.25 * dt);
            m.position.x += dx / dist * go; m.position.z += dz / dist * go; m.rotation.y = Math.atan2(dx, dz);
            Peds.animate(m, dt, true);
            return;
        }
        Peds.animate(m, dt, false);
        if (s.face !== undefined) m.rotation.y = s.face;
        if (s.queue && room.payer && room.payer !== w) return;               // somebody is at the till: wait your turn
        w.t += dt;
        if (w.t < (s.wait || 0)) return;
        if (s.queue) room.payer = w;
        if (s.pay) {                                                         // paid: off you go with a bag in your hand
            room.payer = null;
            const bag = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.12), new THREE.MeshStandardMaterial({ color: lin(0xb98a4a), roughness: 0.9 }));
            bag.position.y = -0.75; m.userData.arms[1].add(bag);
        }
        w.t = 0; w.i++;
        if (s.leave || w.i >= w.steps.length) { w.rest = rnd(2, 7); w.fresh(); }
    }

    // ---------- a shop ----------
    const GOODS = {
        'MARKET': { colors: [0xd8402f, 0xf2b01e, 0x3f9a4f, 0xe8e2d0, 0x2f6fd0, 0xf07f2a], buy: ['an apple', 'a carton of milk', 'a bag of chips', 'a bunch of bananas'] },
        'BAKERY': { colors: [0xc98a4a, 0xe2b872, 0x9a6234, 0xf2dfb4, 0xd9a05a], buy: ['a croissant', 'a loaf of bread', 'a donut', 'a slice of cake'] },
        'TOY SHOP': { colors: [0xe2362f, 0x2f6fe2, 0xf2d21e, 0x3fb24f, 0xd24fd0, 0xff8a1e], buy: ['a toy car', 'a kite', 'a puzzle', 'a bouncy ball'] },
        'BOOKS': { colors: [0x7a2f2f, 0x2f4f7a, 0x3f6a3f, 0x8a6a2f, 0x4a3a6a, 0xd9cdb4], buy: ['a comic book', 'a map of the Bay Area', 'a book about cars'] },
        'CAFE': { colors: [0x6a4028, 0xe8dcc4, 0xc98a4a, 0x2f2a26, 0xd24f3f], buy: ['a hot chocolate', 'a sandwich', 'a muffin', 'an orange juice'] },
        'CLOTHES': { colors: [0x2f3f6a, 0xd9d2c4, 0x8a2f3f, 0x3f6a5a, 0x1f1f1f, 0xd9a03f], buy: ['a cap', 'a pair of socks', 'a T-shirt', 'a scarf'] }
    };
    function shop(place) {
        const goods = GOODS[place.name] || GOODS.MARKET;
        const room = startRoom(place, 9, 9, 3.4, 0xe9e4d8, 0xb9b4a8);
        // a row of goods along a shelf: boxes of odd sizes, shoulder to shoulder
        const stock = (x, y, z0, z1, depth) => {
            for (let z = z0; z < z1 - 0.2;) {
                const long = rnd(0.24, 0.42), high = rnd(0.18, 0.34);
                room.box(depth, high, long, pick(goods.colors), x, y + high / 2, z + long / 2);
                z += long + 0.05;
            }
        };
        // two island shelves down the middle, goods on both sides of each
        [-2.2, 0.2].forEach(x => {
            room.solid(0.8, 0.25, 4.4, 0x55504a, x, 0.125, -1.8);
            room.box(0.08, 1.75, 4.4, 0x8a8478, x, 0.9, -1.8);
            [0.25, 0.7, 1.15, 1.6].forEach(y => { if (y > 0.3) room.box(0.8, 0.05, 4.4, 0xd9d4c8, x, y, -1.8); [-0.22, 0.22].forEach(side => stock(x + side, y + 0.03, -3.95, 0.35, 0.3)); });
        });
        // a shelf along the left wall, and a tall glass-fronted fridge along the right one
        room.solid(0.6, 2.0, 8.2, 0x8a8478, -4.15, 1.0, 0);
        [0.3, 0.75, 1.2, 1.65].forEach(y => { room.box(0.5, 0.05, 8.0, 0xd9d4c8, -4.0, y, 0); stock(-3.95, y + 0.03, -3.95, 3.95, 0.3); });
        room.solid(0.55, 2.1, 4.6, 0xdfe3e6, 4.2, 1.05, -1.9);
        room.glow(0.04, 1.6, 4.3, 0xbfe6ff, 3.91, 1.1, -1.9);
        // the counter by the door, with the till on it
        room.solid(1.0, 1.0, 2.4, 0x6b4a32, 3.3, 0.5, 2.7);
        room.box(1.1, 0.06, 2.5, 0x2a2a2a, 3.3, 1.03, 2.7);
        room.box(0.4, 0.3, 0.45, 0x33373d, 3.3, 1.2, 2.3);
        room.glow(0.02, 0.2, 0.3, 0x7fffd0, 3.09, 1.24, 2.3);
        room.actions.push({ x: 2.3, z: 2.7, reach: 1.5, label: 'BUY', run: () => {
            if (Game.state.coins < PRICE) { UI.toast('That costs ' + PRICE + ' coins and you have ' + Game.state.coins + '.', 2500); return; }
            Game.addCoins(-PRICE); UI.toast('You bought ' + pick(goods.buy) + ' for ' + PRICE + ' coins.', 2500);
        } });
        room.hint = 'The till is by the door: E there buys something. E at the door to leave.';
        const aisles = [-3.2, -1.0, 2.2];
        const shopper = () => {
            const steps = [{ x: 0, z: 3.5 }];
            for (let n = 0, stops = 1 + Math.floor(Math.random() * 2); n < stops; n++) {
                const x = pick(aisles);
                steps.push({ x, z: 1.25 }, { x, z: rnd(-3.4, 0.2), wait: rnd(2, 5), face: Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2 }, { x, z: 1.25 });
            }
            steps.push({ x: 1.6, z: 1.25, queue: true, face: Math.PI / 2 }, { x: 2.3, z: 2.7, wait: 3.5, face: Math.PI / 2, pay: true }, { x: 0, z: 3.2 }, { x: 0, z: 4.1, leave: true });
            return steps;
        };
        return finishRoom(room, () => {
            stander(room, 4.05, 2.7, -Math.PI / 2, { shirt: 0x2f8f5f });         // the cashier, behind the counter
            [0, 3, 6, 10].forEach(delay => walker(room, shopper, delay));
        });
    }

    // ---------- a hotel lobby ----------
    function hotel(place) {
        const room = startRoom(place, 9, 9, 4, 0xe6d6b8, 0xcfc8b8);
        room.box(2.0, 0.03, 6.4, 0x8a1f2a, 0, 0.11, 0.9);                                    // the red carpet from the door to the desk
        // reception: the desk, a bell, the board of room keys and the sign over it
        room.solid(4.2, 1.1, 0.9, 0x5a3a26, 0, 0.55, -2.8);
        room.box(4.4, 0.06, 1.0, 0x1f1f1f, 0, 1.13, -2.8);
        room.glow(0.14, 0.1, 0.14, 0xffd24a, -1.2, 1.2, -2.6);
        room.box(2.6, 1.3, 0.06, 0x3a2a20, 0, 2.2, -4.4);
        for (let i = 0; i < 15; i++) room.glow(0.07, 0.14, 0.03, 0xffd24a, -1.05 + (i % 5) * 0.52, 1.8 + Math.floor(i / 5) * 0.4, -4.36);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), Signs.nameFace('RECEPTION', '#5a0a12')); sign.position.set(0, 3.3, -4.4); room.group.add(sign);
        // sofas and a low table on the left, pot plants in the corners
        room.solid(0.9, 0.42, 2.4, 0x3d5a80, -3.7, 0.21, 0.6); room.box(0.25, 0.95, 2.4, 0x34506f, -4.25, 0.48, 0.6);
        room.solid(2.0, 0.42, 0.9, 0x3d5a80, -2.4, 0.21, -1.6); room.box(2.0, 0.95, 0.25, 0x34506f, -2.4, 0.48, -2.1);
        room.solid(0.8, 0.4, 1.2, 0x4a3524, -2.3, 0.2, 0.6);
        [[-4.0, 3.9], [4.0, 3.9], [-4.0, -3.9]].forEach(([x, z]) => {
            room.solid(0.5, 0.5, 0.5, 0x8a5a3a, x, 0.25, z);
            room.shape(new THREE.SphereGeometry(0.55, 7, 5), 0x2f7a3a, x, 1.05, z);
        });
        // two lifts in the right wall, a light over each, and somebody's luggage waiting
        [-0.9, 0.7].forEach(z => { room.box(0.06, 2.3, 1.2, 0x9aa0a6, 4.42, 1.15, z); room.box(0.07, 2.3, 0.04, 0x55595e, 4.41, 1.15, z); room.glow(0.05, 0.14, 0.3, 0xff8a3a, 4.42, 2.5, z); });
        room.solid(0.45, 0.7, 0.3, 0x7a2f2f, 1.9, 0.35, -1.7); room.solid(0.4, 0.55, 0.28, 0x2f4f7a, 2.4, 0.28, -1.7);
        // a chandelier
        room.glow(0.5, 0.35, 0.5, 0xffe9b0, 0, 3.6, 0.6); [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]].forEach(([x, z]) => room.glow(0.2, 0.2, 0.2, 0xffe9b0, x, 3.45, 0.6 + z));
        room.actions.push({ x: 0, z: -1.7, reach: 1.7, label: 'TAKE A ROOM', run: () => {
            if (Game.state.coins < NIGHT) { UI.toast('"A room for the night is ' + NIGHT + ' coins." You have ' + Game.state.coins + '.', 3000); return; }
            Game.addCoins(-NIGHT);
            // sleep until just after sunrise (Sky.update moves the clock on by the time it is given)
            const cycle = CFG.CYCLE.day + CFG.CYCLE.night, morning = 0.04;
            Sky.update(((morning - Sky.t + 1) % 1) * cycle / (Sky.speed || 1), Car.body.position);
            UI.toast('You took a room for ' + NIGHT + ' coins and slept like a log. Good morning!', 4000);
        } });
        room.hint = 'Reception is straight ahead: E at the desk takes a room. E at the door to leave.';
        // guests arrive, check in and go up in the lift; others come down and go out
        const arriving = () => [{ x: 0, z: 3.5 }, { x: rnd(-1, 1), z: -1.75, wait: rnd(4, 7), face: Math.PI }, { x: 3.7, z: 0.7, wait: 1.5, face: Math.PI / 2, leave: true }];
        const going = () => [{ x: 3.7, z: -0.9 }, { x: 0.4, z: 0.5, wait: rnd(0, 2) }, { x: 0, z: 3.2 }, { x: 0, z: 4.1, leave: true }];
        return finishRoom(room, () => {
            stander(room, 0.5, -3.6, 0, { shirt: 0x1f1f2a, pants: 0x1f1f2a });   // the receptionist
            stander(room, -3.6, 0.2, Math.PI / 2, null, true);                   // someone waiting on the sofa
            walker(room, arriving, 1); walker(room, going, 5); walker(room, arriving, 12);
        });
    }

    // ---------- an apartment ----------
    function apartment(place) {
        const room = startRoom(place, 8, 7, 3, 0xe6e0d4, 0x9a7a55);
        // the living room: a sofa facing the TV, a rug between them
        room.box(2.6, 0.03, 2.0, 0x7a3a3a, -1.9, 0.11, 0.9);
        room.solid(2.2, 0.42, 0.9, 0x55708a, -1.9, 0.21, 2.6); room.box(2.2, 0.9, 0.22, 0x4a6278, -1.9, 0.45, 3.1);
        room.solid(1.6, 0.5, 0.4, 0x4a3524, -1.9, 0.25, -0.9);
        room.box(1.3, 0.75, 0.06, 0x111111, -1.9, 0.95, -0.9); room.glow(1.2, 0.66, 0.02, 0x7fb4ff, -1.9, 0.95, -0.86);
        // a window in the left wall (the daylight is a glowing pane), a shelf of books beside it
        room.box(0.06, 1.5, 2.0, 0xf4f1ea, -3.93, 1.6, 1.2); room.glow(0.04, 1.3, 1.8, 0xbfe3ff, -3.9, 1.6, 1.2);
        room.solid(0.4, 1.8, 1.4, 0x6b4a32, -3.75, 0.9, -1.6);
        [0.35, 0.85, 1.35].forEach(y => { for (let z = -2.2; z < -1.05; z += 0.13) room.box(0.3, rnd(0.3, 0.42), 0.1, pick([0x7a2f2f, 0x2f4f7a, 0x3f6a3f, 0x8a6a2f, 0xd9cdb4]), -3.7, y + 0.2, z); });
        // the kitchen along the back wall: counter, stove, fridge
        room.solid(3.4, 0.9, 0.65, 0xf0efe8, 1.2, 0.45, -3.1); room.box(3.5, 0.05, 0.7, 0x2f2f2f, 1.2, 0.93, -3.1);
        room.box(0.6, 0.02, 0.5, 0x111111, 0.4, 0.97, -3.1); room.box(0.5, 0.25, 0.3, 0xc9ccd0, 2.2, 1.08, -3.15);
        room.solid(0.8, 1.9, 0.75, 0xdfe3e6, 3.5, 0.95, -3.05);
        // a table with two chairs, and the bed in the corner by the door
        room.solid(1.3, 0.06, 0.9, 0x8a6a48, 1.3, 0.76, -0.6); [[0.75, -0.95], [1.85, -0.95], [0.75, -0.25], [1.85, -0.25]].forEach(([x, z]) => room.box(0.07, 0.74, 0.07, 0x6b4f3a, x, 0.37, z));
        [[-1, 0.3], [1, -1.5]].forEach(([s, z]) => { room.box(0.45, 0.06, 0.45, 0x6b4f3a, 1.3, 0.46, z); room.box(0.45, 0.5, 0.06, 0x6b4f3a, 1.3, 0.72, z + s * 0.2); });
        room.solid(1.5, 0.45, 2.1, 0x8a6a4a, 3.1, 0.23, 2.2); room.box(1.4, 0.14, 2.0, 0xf2efe6, 3.1, 0.52, 2.2); room.box(1.4, 0.2, 1.3, 0x3a5a8a, 3.1, 0.62, 1.9); room.box(0.9, 0.14, 0.4, 0xffffff, 3.1, 0.66, 3.0);
        const hello = ['"Oh, hello! Are you the new neighbour?"', '"Make yourself at home."', '"Nice car out front. Is it yours?"', '"Careful on the freeway, they drive fast out there."'];
        room.actions.push({ x: 1.2, z: -1.9, reach: 2.0, label: 'SAY HELLO', run: () => UI.toast(pick(hello), 3000) });
        room.hint = 'Somebody lives here. E near them says hello. E at the door to leave.';
        // whoever lives here potters between the kitchen and the table
        const pottering = () => [{ x: 1.0, z: -2.3, wait: rnd(3, 6), face: Math.PI }, { x: 2.6, z: -2.3, wait: rnd(2, 4), face: Math.PI }, { x: 2.3, z: -0.6, wait: rnd(2, 5), face: -Math.PI / 2 }];
        return finishRoom(room, () => {
            stander(room, -1.9, 2.55, Math.PI, null, true);                      // on the sofa, watching TV
            walker(room, pottering, 0);
        });
    }

    // ---------- going in and out ----------
    function enter(place) {
        const room = place.kind === 'hotel' ? hotel(place) : place.kind === 'apartment' ? apartment(place) : shop(place);
        P.inside = { place, room };
        Walk.enterRoom(room);
        UI.toast((place.kind === 'shop' ? 'Inside the ' + place.name.toLowerCase() + '. ' : place.kind === 'hotel' ? 'Inside the hotel. ' : 'Inside an apartment. ') + room.hint, 5000);
    }
    function leave() {
        const i = P.inside; if (!i) return;
        P.inside = null;
        if (Walk.room === i.room) Walk.leaveRoom();
        i.room.remove();
    }
    P.leave = leave;

    // What E (or the big button) would do right here, if anything: { label, run }.
    P.prompt = function () {
        if (!window.Walk || !Walk.active || !Game.started) return null;
        if (P.inside) {
            const r = P.inside.room, me = Walk.pos;
            if (flat(me, r.doorIn) < 1.7) return { label: 'LEAVE', run: leave };
            const a = r.actions.find(a => flat(me, a.at) < a.reach);
            return a ? { label: a.label, run: a.run } : { label: '', run: () => UI.toast(r.hint, 2500) };
        }
        if (Walk.passenger) return { label: 'GET OUT', run: () => Walk.toggle(), key: 'G' };
        if (Walk.room || Walk.ride || Walk.cuffed) return null;
        const pl = P.near(Walk.pos, REACH);
        if (pl) return { label: 'GO INTO THE ' + pl.name, run: () => enter(pl) };
        const c = Walk.rideOffer();                                         // another player's car right here: G rides along
        return c ? { label: 'RIDE WITH ' + c.label, run: () => Walk.toggle(), key: 'G' } : null;
    };
    // E on foot. True if there was something here to do (else the key goes on to the robbery).
    P.use = function () {
        const p = P.prompt();
        if (!p || p.key === 'G') return false;
        p.run(); return true;
    };

    let frame = 0;
    P.update = function (dt) {
        if (P.inside) {
            if (!Walk.active || Walk.room !== P.inside.room) { const i = P.inside; P.inside = null; i.room.remove(); }   // (pulled out some other way)
            else P.inside.room.people.forEach(w => moveWalker(P.inside.room, w, dt));
        }
        // the big button follows what can be done here
        if (frame++ % 6) return;
        button = button || document.getElementById('place-btn'); if (!button) return;
        const p = P.prompt(), text = p && p.label ? p.label + ' (' + (p.key || 'E') + ')' : '';
        if (text === shown) return;
        shown = text; button.textContent = text; button.style.display = text ? 'block' : 'none';
        button.onclick = () => { button.blur(); const now = P.prompt(); if (now) now.run(); };
    };

    return P;
})();
