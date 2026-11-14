// tokyo-driver1 v2 — places you can walk into: the shops, hotels and apartments downtown.
// city.js gives a building a door on its street side and lists it in city.places; on foot,
// E at a door builds the inside and walks you in (first person, like the robbery's houses),
// E at the door again takes you out and the room is dropped.
//   a shop       shelves of goods, a cashier at the till, shoppers who look along the shelves,
//                queue, pay and leave with a bag. E at the till buys something for a few coins.
//   a hotel      the lobby: reception, sofas, the lifts, guests checking in and going up.
//                E at the desk takes a room; E at the lifts goes up to it: a bed, a desk, a
//                window over the city. E at the bed rests (and it is morning when you wake),
//                E at the room's door goes back down.
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
    function startRoom(place, W, D, H, wallColor, floorColor, opts) {
        if (!paint) { paint = new THREE.MeshBasicMaterial({ vertexColors: true }); paint.userData.shaded = true; }
        const g = new THREE.Group(), c = place.centre;
        // the floor stands clear of the land under the whole room, even on a slope
        let y = -Infinity;
        [[0, 0], [-5, -5], [5, -5], [-5, 5], [5, 5]].forEach(([dx, dz]) => { y = Math.max(y, Terrain.height(c.x + dx, c.z + dz)); });
        g.position.set(c.x, y + 0.4, c.z); g.rotation.y = place.yaw;
        const room = { group: g, W, D, H, place, people: [], blocks: [], actions: [], payer: null };
        // which room this is, the same on every player's machine (it stands in the same place for
        // all of them): two players whose rooms have the same id are in the room together
        room.id = Math.round(c.x) + ':' + Math.round(c.z) + ':' + W + ':' + D + ':' + H + (opts && opts.noDoor ? ':up' : '');
        room.box = (w, h, d, color, x, yy, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint); m.userData.color = lin(color); m.position.set(x, yy, z); g.add(m); return m; };
        room.shape = (geom, color, x, yy, z) => { const m = new THREE.Mesh(geom, paint); m.userData.color = lin(color); m.position.set(x, yy, z); g.add(m); return m; };
        room.glow = (w, h, d, color, x, yy, z) => { const mat = glows[color] || (glows[color] = new THREE.MeshBasicMaterial({ color: lin(color) })); const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, yy, z); g.add(m); return m; };
        // something you cannot walk through: a box plus its footprint
        room.solid = (w, h, d, color, x, yy, z) => { room.blocks.push({ x, z, hx: w / 2, hz: d / 2 }); return room.box(w, h, d, color, x, yy, z); };
        // the shell: floor, ceiling, four walls, the door you came in by and ceiling lights
        room.box(W, 0.1, D, floorColor, 0, 0.05, 0);
        room.box(W, 0.1, D, 0xf4f1ea, 0, H, 0);
        [-1, 1].forEach(s => { room.box(0.1, H, D, wallColor, s * W / 2, H / 2, 0); room.box(W, H, 0.1, wallColor, 0, H / 2, s * D / 2); });
        if (!(opts && opts.noDoor)) {                                                           // (an upstairs room has no door to the street)
            room.box(1.6, 2.4, 0.06, 0x3a2a20, 0, 1.2, D / 2 - 0.09);
            room.glow(0.7, 0.22, 0.05, 0x2fd06a, 0, 2.62, D / 2 - 0.09);                      // the green EXIT light over it
        } else room.noDoor = true;
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
    // round; a step marked `leave` ends it, and a new person comes in a little later. With
    // opts.loop the same person goes round again instead (someone who lives or works there),
    // opts.look dresses them, and a step's `say` is what they tell you when they get there.
    function walker(room, script, delay, opts) {
        const w = Object.assign({ script, rest: delay || 0 }, opts);
        const fresh = () => {
            if (w.mesh) room.group.remove(w.mesh);
            w.mesh = Peds.person(w.look); w.steps = script(); w.i = 0; w.t = 0;
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
        if (s.say && w.t === 0) UI.toast(s.say, 4000);
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
        if (w.loop && w.i >= w.steps.length) { w.i = 0; w.steps = w.script(); }
        else if (s.leave || w.i >= w.steps.length) { w.rest = rnd(2, 7); w.fresh(); }
    }

    // ---------- a shop ----------
    const GOODS = {
        'MARKET': { food: true, colors: [0xd8402f, 0xf2b01e, 0x3f9a4f, 0xe8e2d0, 0x2f6fd0, 0xf07f2a], buy: ['an apple', 'a carton of milk', 'a bag of chips', 'a bunch of bananas'] },
        'BAKERY': { food: true, colors: [0xc98a4a, 0xe2b872, 0x9a6234, 0xf2dfb4, 0xd9a05a], buy: ['a croissant', 'a loaf of bread', 'a donut', 'a slice of cake'] },
        'TOY SHOP': { colors: [0xe2362f, 0x2f6fe2, 0xf2d21e, 0x3fb24f, 0xd24fd0, 0xff8a1e], buy: ['a toy car', 'a kite', 'a puzzle', 'a bouncy ball'] },
        'BOOKS': { colors: [0x7a2f2f, 0x2f4f7a, 0x3f6a3f, 0x8a6a2f, 0x4a3a6a, 0xd9cdb4], buy: ['a comic book', 'a map of the Bay Area', 'a book about cars'] },
        'CAFE': { food: true, colors: [0x6a4028, 0xe8dcc4, 0xc98a4a, 0x2f2a26, 0xd24f3f], buy: ['a hot chocolate', 'a sandwich', 'a muffin', 'an orange juice'] },
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
            const item = pick(goods.buy);
            Game.addCoins(-PRICE); Shop.add(item, goods.food);               // (into your bag: the SHOP button shows it)
            UI.toast('You bought ' + item + ' for ' + PRICE + ' coins.' + (goods.food ? ' SHOP lets you eat it.' : ' It is in your bag (SHOP).'), 3500);
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
        // the desk gives you a room (once a stay), the lifts take you up to it
        room.actions.push({ x: 0, z: -1.7, reach: 1.7, label: 'TAKE A ROOM', run: () => {
            const stay = P.inside;
            if (stay.key) { UI.toast('"You are in room ' + stay.key + '. The lifts are on your right."', 3000); return; }
            if (Game.state.coins < NIGHT) { UI.toast('"A room for the night is ' + NIGHT + ' coins." You have ' + Game.state.coins + '.', 3000); return; }
            Game.addCoins(-NIGHT);
            stay.key = 200 + Math.floor(Math.random() * 40) + 1;
            UI.toast('"Room ' + stay.key + ', on the second floor. Take the lift." You paid ' + NIGHT + ' coins.', 4500);
        } });
        room.actions.push({ x: 3.6, z: -0.1, reach: 1.6, label: 'TAKE THE LIFT', lift: true, run: () => {
            if (!P.inside.key) { UI.toast('The rooms are for guests: take one at the desk first.', 3000); return; }
            moveTo(hotelRoom(place));
            UI.toast('Room ' + P.inside.key + '. E at the bed to rest. E at the door goes back down.', 4500);
        } });
        room.hint = 'Reception is straight ahead: E at the desk takes a room, then E at the lifts goes up to it. E at the door to leave.';
        // guests arrive, check in and go up in the lift; others come down and go out
        const arriving = () => [{ x: 0, z: 3.5 }, { x: rnd(-1, 1), z: -1.75, wait: rnd(4, 7), face: Math.PI }, { x: 3.7, z: 0.7, wait: 1.5, face: Math.PI / 2, leave: true }];
        const going = () => [{ x: 3.7, z: -0.9 }, { x: 0.4, z: 0.5, wait: rnd(0, 2) }, { x: 0, z: 3.2 }, { x: 0, z: 4.1, leave: true }];
        return finishRoom(room, () => {
            stander(room, 0.5, -3.6, 0, { shirt: 0x1f1f2a, pants: 0x1f1f2a });   // the receptionist
            stander(room, -3.6, 0.2, Math.PI / 2, null, true);                   // someone waiting on the sofa
            walker(room, arriving, 1); walker(room, going, 5); walker(room, arriving, 12);
        });
    }

    // ---------- your room upstairs ----------
    function hotelRoom(place) {
        const room = startRoom(place, 7, 6, 3, 0xe9dfcf, 0x7a5a48);
        room.box(6.6, 0.03, 5.6, 0x8a3a3a, 0, 0.11, 0);                                       // carpet, wall to wall
        // the bed against the left wall: headboard, covers, two pillows, a lamp on each side table
        room.solid(2.1, 0.5, 1.9, 0x6b4a32, -2.35, 0.25, -0.4); room.box(0.12, 1.2, 2.0, 0x5a3a26, -3.4, 0.6, -0.4);
        room.box(2.0, 0.16, 1.8, 0xf4f1ea, -2.3, 0.58, -0.4); room.box(1.3, 0.2, 1.84, 0x2f5a8a, -2.0, 0.64, -0.4);
        [-0.85, 0.05].forEach(z => room.box(0.45, 0.14, 0.7, 0xffffff, -3.05, 0.73, z));
        [-1.7, 0.9].forEach(z => { room.solid(0.5, 0.55, 0.45, 0x6b4a32, -3.2, 0.28, z); room.glow(0.2, 0.26, 0.2, 0xffe2a8, -3.2, 0.72, z); });
        // a window over the city in the back wall: the sky, and the tops of the towers across the street
        room.box(3.2, 1.7, 0.06, 0xf4f1ea, 0.6, 1.7, -2.93); room.glow(3.0, 1.5, 0.04, 0xbfe3ff, 0.6, 1.7, -2.9);
        [[-0.5, 0.9, 0x6f86a0], [0.2, 0.55, 0x8fa1b3], [0.9, 1.15, 0x5f7690], [1.6, 0.7, 0x7f93a8]].forEach(([x, h, c]) => room.glow(0.55, h, 0.02, c, x, 0.95 + h / 2, -2.87));
        [-1.15, 2.35].forEach(x => room.box(0.4, 2.1, 0.1, 0x8a3a3a, x, 1.75, -2.85));        // curtains
        // a desk and chair under the TV on the right wall, the wardrobe by the door, your suitcase
        room.solid(0.6, 0.75, 1.5, 0x6b4a32, 3.05, 0.375, -0.9); room.solid(0.45, 0.48, 0.45, 0x4a3524, 2.3, 0.24, -0.9); room.box(0.06, 0.5, 0.45, 0x4a3524, 2.08, 0.72, -0.9);
        room.box(0.06, 0.7, 1.2, 0x111111, 3.42, 1.75, -0.9); room.glow(0.02, 0.6, 1.1, 0x7fb4ff, 3.38, 1.75, -0.9);
        room.solid(0.65, 2.1, 1.3, 0x5a3a26, 3.05, 1.05, 1.9);
        room.solid(0.45, 0.6, 0.28, 0x7a2f2f, -0.9, 0.3, 1.6);
        room.box(0.06, 2.1, 0.9, 0xf4f1ea, -3.42, 1.05, 2.2);                                 // the bathroom door
        room.actions.push({ x: -0.9, z: -0.4, reach: 1.5, label: 'REST', run: rest });
        room.hint = 'This is your room. E at the bed to rest. E at the door goes back down to the lobby.';
        room.door = { label: 'BACK TO THE LOBBY', run: () => { const lobby = hotel(place); moveTo(lobby, lobby.actions.find(a => a.lift).at); } };
        return finishRoom(room, () => {});
    }
    // from one room of a building to another (the lobby and your room): the new one is built,
    // you are put in it (at its door, or `at`), and the old one is dropped
    function moveTo(room, at) {
        const stay = P.inside, old = stay.room;
        stay.room = room;
        Walk.enterRoom(room);
        if (at) { Walk.pos.x = at.x; Walk.pos.z = at.z; }
        old.remove();
    }
    // Resting: the screen goes dark for a moment, and it is morning when it comes back.
    let fade = null, resting = false;
    function rest() {
        if (resting) return;
        resting = true;
        if (!fade) {
            fade = document.createElement('div');
            fade.style.cssText = 'position:fixed;inset:0;z-index:40;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;letter-spacing:0.08em;opacity:0;pointer-events:none;transition:opacity 0.7s';
            document.body.appendChild(fade);
        }
        fade.textContent = 'Zzz...'; fade.style.opacity = '1';
        setTimeout(() => {
            // on to just after sunrise (Sky.update moves the clock on by the time it is given)
            const cycle = CFG.CYCLE.day + CFG.CYCLE.night, morning = 0.04;
            Sky.update(((morning - Sky.t + 1) % 1) * cycle / (Sky.speed || 1), Car.body.position);
            fade.textContent = 'Good morning!';
        }, 1100);
        setTimeout(() => { fade.style.opacity = '0'; resting = false; UI.toast('You slept like a log. It is morning.', 3000); }, 2300);
    }

    // ---------- a house you own ----------
    // (shop.js keeps the list of them; `home` is { o, city, plan } from Shop.homeNear)
    // `view` (from Shop.viewNear) makes it a house you have come to see: the same rooms, with
    // the realtor showing you round instead of your own things in them.
    // A house of two storeys (place.floors, from City.housePlan) has stairs where the bed would
    // be, and the bedrooms are upstairs (`upperFloor`).
    // place.guestOf (another player's name) makes it their house, which you are visiting: the
    // same rooms, nothing of yours in them and nothing to use.
    function ownHouse(place, view) {
        const upper = place.floors === 2, mine = !view && !place.guestOf;
        const room = startRoom(place, 8.6, 6.2, 3, 0xece6d8, 0x9a7a55);
        // the kitchen along the back wall; the fridge opens your bag of food
        room.solid(3.2, 0.9, 0.6, 0xf0efe8, 0.6, 0.45, -2.75); room.box(3.3, 0.05, 0.65, 0x2f2f2f, 0.6, 0.93, -2.75);
        room.box(0.6, 0.02, 0.45, 0x111111, -0.2, 0.97, -2.75);
        room.solid(0.8, 1.9, 0.7, 0xdfe3e6, 3.6, 0.95, -2.7);
        if (mine) room.actions.push({ x: 3.4, z: -1.6, reach: 1.4, label: 'OPEN THE FRIDGE', run: () => Shop.open() });
        // sofa, rug and TV
        room.box(2.6, 0.03, 1.8, 0x7a3a3a, -2.3, 0.11, 0.9);
        room.solid(2.2, 0.42, 0.85, 0x55708a, -2.3, 0.21, 2.2); room.box(2.2, 0.9, 0.2, 0x4a6278, -2.3, 0.45, 2.72);
        room.solid(1.6, 0.5, 0.4, 0x4a3524, -2.3, 0.25, -0.5);
        room.box(1.3, 0.75, 0.06, 0x111111, -2.3, 0.95, -0.5); room.glow(1.2, 0.66, 0.02, 0x7fb4ff, -2.3, 0.95, -0.46);
        // a window, and a shelf that fills up with the things you have bought
        room.box(0.06, 1.5, 1.8, 0xf4f1ea, -4.23, 1.6, 1.0); room.glow(0.04, 1.3, 1.6, 0xbfe3ff, -4.2, 1.6, 1.0);
        room.solid(0.4, 1.8, 1.6, 0x6b4a32, -4.05, 0.9, -1.6);
        let n = 0; if (mine) Shop.things().forEach(x => { n += x.n; });
        for (let k = 0; k < Math.min(n, 12); k++) room.box(0.28, 0.3, 0.3, pick([0xe2362f, 0x2f6fe2, 0xf2d21e, 0x3fb24f, 0xd24fd0, 0xff8a1e]), -3.8, 0.5 + Math.floor(k / 4) * 0.5, -2.2 + (k % 4) * 0.4);
        // a table and chair, and your bed
        room.solid(1.2, 0.06, 0.8, 0x8a6a48, 0.9, 0.76, -0.4); [[0.4, -0.7], [1.4, -0.7], [0.4, -0.1], [1.4, -0.1]].forEach(([x, z]) => room.box(0.07, 0.74, 0.07, 0x6b4f3a, x, 0.37, z));
        room.box(0.45, 0.06, 0.45, 0x6b4f3a, 0.9, 0.46, 0.45); room.box(0.45, 0.5, 0.06, 0x6b4f3a, 0.9, 0.72, 0.66);
        if (upper) {
            // the stairs up, along the right-hand wall from by the front door: nine steps to a gap in the ceiling
            for (let k = 0; k < 9; k++) room.box(1.1, (k + 1) * 0.31, 0.28, k % 2 ? 0x8a6a48 : 0x7a5a3c, 3.7, (k + 1) * 0.155, 2.3 - k * 0.28);
            room.blocks.push({ x: 3.7, z: 1.18, hx: 0.55, hz: 1.27 });
            room.box(0.06, 0.95, 0.06, 0x4a3524, 3.13, 0.48, 2.42); room.box(0.06, 0.95, 0.06, 0x4a3524, 3.13, 2.6, 0.1);
            room.box(1.1, 0.05, 1.5, 0x242424, 3.7, 2.93, 0.5);
            room.actions.push({ x: 3.7, z: 2.85, reach: 1.0, label: 'GO UPSTAIRS', stairs: true, run: () => {
                moveTo(upperFloor(place, view));
                UI.toast(P.inside.room.hint, 4500);
            } });
        } else {
            room.solid(1.5, 0.45, 2.1, 0x8a6a4a, 3.4, 0.23, 1.3); room.box(1.4, 0.14, 2.0, 0xf2efe6, 3.4, 0.52, 1.3); room.box(1.4, 0.2, 1.3, 0x3f8a5a, 3.4, 0.62, 1.0); room.box(0.9, 0.14, 0.4, 0xffffff, 3.4, 0.66, 2.1);
        }
        if (!view) {
            // the door through to the garage, in the back wall beside the kitchen: your cars, to pick the one parked outside
            room.box(0.9, 2.1, 0.06, 0x8a8f94, -2.4, 1.05, -3.04); room.glow(0.5, 0.16, 0.04, 0xffd24a, -2.4, 2.3, -3.02);
            if (!mine) {                                                    // a visitor: it is somebody else's house
                room.hint = 'This is ' + place.guestOf + "'s house. " + (upper ? 'The stairs by the door go up to the bedrooms. ' : '') + 'E at the door to leave.';
                return finishRoom(room, () => {});
            }
            if (!upper) room.actions.push({ x: 2.3, z: 1.3, reach: 1.3, label: 'REST', run: rest });
            // (with the car parked in this house's garage, the door drives it out; otherwise it is the list of your cars)
            const inHere = () => { const g = Shop.garaged(); return !!(g && place.key && g.key === place.key); };
            room.actions.push({ x: -2.4, z: -2.1, reach: 1.1, get label() { return inHere() ? 'DRIVE OUT OF THE GARAGE' : 'OPEN YOUR GARAGE'; },
                run: () => { if (inHere()) Shop.driveOut(); else { UI.renderGarage(); document.getElementById('garage-modal').classList.add('open'); } } });
            room.hint = 'Your own house. ' + (upper ? 'The stairs by the door go up to the bedrooms. ' : 'E at the bed rests. ') + 'E at the fridge opens your food, E at the grey door in the back wall opens your garage. E at the door to leave.';
            return finishRoom(room, () => {});
        }
        // a viewing: the papers are on the table (E there to bid), and E anywhere else asks the realtor
        const who = Shop.realtor(), h = view.h;
        room.box(0.5, 0.02, 0.35, 0xf4f1ea, 0.9, 0.8, -0.4);
        room.actions.push({ x: 0.9, z: 0.5, reach: 1.3, label: 'BID FOR THIS HOUSE', run: () => Shop.openBid(h.key) });
        const answers = ['"They are asking ' + h.price + ' coins. Another buyer wants it too."', '"You get one bid and so do they. The higher bid gets the house."', '"Two minutes from the freeway, and so quiet at night."', '"When you are ready, the papers are on the table."'];
        let asked = 0;
        room.anywhere = { label: 'ASK ' + who.name.toUpperCase(), run: () => UI.toast(who.name + ': ' + answers[asked++ % answers.length], 4000) };
        room.hint = who.name + ' shows you round. E asks her about the house, E at the table bids for it' + (upper ? ', the stairs by the door go up to the bedrooms' : '') + '. E at the door to leave.';
        const tour = () => [
            { x: -1.0, z: 0.9, wait: 5, face: -Math.PI / 2, say: who.name + ': "This is the living room. Lots of light."' },
            { x: 1.6, z: -1.8, wait: 5, face: Math.PI, say: who.name + ': "The kitchen. Brand new, and the fridge stays."' },
            upper ? { x: 2.5, z: 2.0, wait: 5, face: Math.PI / 2, say: who.name + ': "The bedrooms are upstairs. Go on up and have a look."' }
                  : { x: 2.2, z: 0.9, wait: 5, face: Math.PI / 2, say: who.name + ': "And here is the bedroom corner. Cosy!"' }];
        return finishRoom(room, () => { walker(room, tour, 0, { loop: true, look: who.look }); });
    }
    // Upstairs in a two-storey house: the big bedroom, a child's bed, a desk. You arrive at the
    // top of the stairs (the far end of the railed-off stairwell) and go back down from there.
    function upperFloor(place, view) {
        const room = startRoom(place, 8.6, 6.2, 2.9, 0xe9e2d2, 0xa88a62, { noDoor: true });
        // the stairwell in the corner: a dark gap in the floor with a rail on its two open sides
        room.box(1.1, 0.02, 2.5, 0x1a1a1a, 3.7, 0.11, 1.2);
        for (let k = 0; k < 4; k++) room.box(1.1, 0.04, 0.28, 0x7a5a3c, 3.7, 0.08 - k * 0.02, 0.2 + k * 0.3);
        room.solid(0.08, 0.95, 2.6, 0x4a3524, 3.1, 0.48, 1.2); room.solid(1.2, 0.95, 0.08, 0x4a3524, 3.7, 0.48, 2.5);
        room.blocks.push({ x: 3.75, z: 1.25, hx: 0.5, hz: 1.2 });
        room.actions.push({ x: 3.7, z: -0.75, reach: 1.1, label: 'GO DOWNSTAIRS', run: () => { const down = ownHouse(place, view); moveTo(down, down.actions.find(a => a.stairs).at); } });
        // the big bed against the left wall, a lamp each side, a rug at its foot
        room.solid(2.1, 0.5, 1.9, 0x6b4a32, -3.1, 0.25, -1.1); room.box(0.12, 1.2, 2.0, 0x5a3a26, -4.15, 0.6, -1.1);
        room.box(2.0, 0.16, 1.8, 0xf4f1ea, -3.05, 0.58, -1.1); room.box(1.3, 0.2, 1.84, 0x3f6a8a, -2.75, 0.64, -1.1);
        [-1.55, -0.65].forEach(z => room.box(0.45, 0.14, 0.7, 0xffffff, -3.8, 0.73, z));
        [-2.4, 0.2].forEach(z => { room.solid(0.5, 0.55, 0.45, 0x6b4a32, -3.95, 0.28, z); room.glow(0.2, 0.26, 0.2, 0xffe2a8, -3.95, 0.72, z); });
        room.box(2.2, 0.03, 1.6, 0x7a3a3a, -0.9, 0.11, -1.1);
        if (!view && !place.guestOf) room.actions.push({ x: -1.6, z: -1.1, reach: 1.4, label: 'REST', run: rest });
        // windows front and back, a wardrobe, a desk with a screen, and a child's bed with a box of toys
        room.box(3.0, 1.5, 0.06, 0xf4f1ea, -1.2, 1.6, 3.07); room.glow(2.8, 1.3, 0.04, 0xbfe3ff, -1.2, 1.6, 3.04);
        room.box(1.8, 1.4, 0.06, 0xf4f1ea, 2.8, 1.6, -3.07); room.glow(1.6, 1.2, 0.04, 0xbfe3ff, 2.8, 1.6, -3.04);
        room.solid(1.6, 2.1, 0.6, 0x5a3a26, -0.6, 1.05, -2.75);
        room.solid(1.4, 0.75, 0.6, 0x6b4a32, 1.3, 0.375, -2.75); room.box(0.6, 0.42, 0.04, 0x111111, 1.3, 1.02, -2.95); room.glow(0.54, 0.36, 0.02, 0x7fd0ff, 1.3, 1.02, -2.92);
        room.solid(0.45, 0.48, 0.45, 0x4a3524, 1.3, 0.24, -1.95);
        room.solid(1.0, 0.4, 1.9, 0x8a6a4a, -3.65, 0.2, 2.0); room.box(0.95, 0.16, 1.8, 0xf2d21e, -3.65, 0.46, 2.0); room.box(0.7, 0.12, 0.35, 0xffffff, -3.65, 0.56, 2.7);
        room.solid(0.6, 0.4, 0.45, 0xd24f3f, -2.5, 0.2, 2.6); [0xe2362f, 0x2f6fe2, 0x3fb24f].forEach((c, k) => room.box(0.16, 0.16, 0.16, c, -2.68 + k * 0.18, 0.48, 2.6));
        room.box(0.06, 2.1, 0.9, 0xf4f1ea, -4.24, 1.05, 0.95);                                   // the bathroom door
        room.hint = 'Upstairs' + (place.guestOf ? ' in ' + place.guestOf + "'s house" : '') + ': the bedrooms. ' + (view || place.guestOf ? '' : 'E at the big bed rests. ') + 'E at the top of the stairs goes back down.';
        finishRoom(room, () => {});
        room.doorIn = room.group.localToWorld(new THREE.Vector3(3.7, 0.1, -0.75));              // (where you come up: there is no door here)
        return room;
    }
    function enterViewing(view) {
        const plan = view.plan;
        const place = { kind: 'viewing', name: 'HOUSE FOR SALE', p: plan.p.clone(), centre: plan.centre.clone(), yaw: view.city.heading + plan.facing * Math.PI / 2, floors: plan.floors };
        const room = ownHouse(place, view);
        P.inside = { place, room };
        Walk.enterRoom(room);
        UI.toast(view.h.address + ', asking ' + view.h.price + ' coins. ' + room.hint, 6000);
    }
    // into another player's house (multiplayer): they are told you have come in
    function enterFriend(friend) {
        const plan = friend.plan;
        const place = { kind: 'visit', name: friend.name + "'S HOUSE", guestOf: friend.name, p: plan.p.clone(), centre: plan.centre.clone(), yaw: friend.city.heading + plan.facing * Math.PI / 2, floors: plan.floors, key: plan.key };
        const room = ownHouse(place);
        P.inside = { place, room };
        Walk.enterRoom(room);
        UI.toast(room.hint, 6000);
        if (window.Multiplayer && Multiplayer.tell) Multiplayer.tell(friend.id, 'I came into your house!');
    }
    function enterHome(home) {
        const plan = home.plan;
        const place = { kind: 'home', name: 'YOUR HOUSE', p: plan.p.clone(), centre: plan.centre.clone(), yaw: home.city.heading + plan.facing * Math.PI / 2, floors: plan.floors, key: plan.key };
        const room = ownHouse(place);
        P.inside = { place, room };
        Walk.enterRoom(room);
        UI.toast('Home: ' + home.o.address + '. ' + room.hint, 5000);
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
            walker(room, pottering, 0, { loop: true });
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
    P.goHome = (home) => enterHome(home);                                   // (shop.js: straight in from the garage)

    // What E (or the big button) would do right here, if anything: { label, run }.
    P.prompt = function () {
        if (!window.Walk || !Game.started) return null;
        if (!Walk.active) return window.Shop && Shop.garagePrompt && !(window.Train && Train.riding) ? Shop.garagePrompt() : null;   // (driving: your garage, if you are by it)
        if (P.inside) {
            const r = P.inside.room, me = Walk.pos;
            if (!r.noDoor && flat(me, r.doorIn) < 1.7) return r.door || { label: 'LEAVE', run: leave };
            const a = r.actions.find(a => flat(me, a.at) < a.reach);
            return a ? { label: a.label, run: a.run } : r.anywhere || { label: '', run: () => UI.toast(r.hint, 2500) };
        }
        if (Walk.passenger) return { label: 'GET OUT', run: () => Walk.toggle(), key: 'G' };
        if (Walk.room || Walk.ride || Walk.cuffed) return null;
        const view = window.Shop ? Shop.viewNear(Walk.pos, REACH + 1) : null;   // a house for sale you came to see: the realtor is at the door
        if (view) return { label: 'SEE THE HOUSE WITH THE REALTOR', run: () => enterViewing(view) };
        const home = window.Shop ? Shop.homeNear(Walk.pos, REACH) : null;    // the door of a house you own
        if (home) return { label: 'GO INTO YOUR HOUSE', run: () => enterHome(home) };
        const friend = window.Shop && Shop.friendHomeNear ? Shop.friendHomeNear(Walk.pos, REACH) : null;   // or of another player's
        if (friend) return { label: 'GO INTO ' + String(friend.name).toUpperCase() + "'S HOUSE", run: () => enterFriend(friend) };
        const pl = P.near(Walk.pos, REACH);
        if (pl) return { label: 'GO INTO THE ' + pl.name, run: () => enter(pl) };
        const c = Walk.rideOffer();                                         // another player's car right here: G rides along
        return c ? { label: 'RIDE WITH ' + c.label, run: () => Walk.toggle(), key: 'G' } : null;
    };
    // E on foot. True if there was something here to do (else the key goes on to the robbery).
    P.use = function () {
        const p = P.prompt();
        if (!p || p.key) return false;                                      // (G and P have their own keys)
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
        const getIn = document.getElementById('getin-btn');                 // (shown only while you are on foot)
        if (getIn) getIn.style.display = window.Walk && Walk.active ? '' : 'none';
        button = button || document.getElementById('place-btn'); if (!button) return;
        const p = P.prompt(), text = p && p.label ? p.label + ' (' + (p.key || 'E') + ')' : '';
        if (text === shown) return;
        shown = text; button.textContent = text; button.style.display = text ? 'block' : 'none';
        button.onclick = () => { button.blur(); const now = P.prompt(); if (now) now.run(); };
    };

    return P;
})();
