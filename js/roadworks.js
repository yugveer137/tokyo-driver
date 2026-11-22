// tokyo-driver1 v2 — road works: stretches where the lane by the median is shut and a crew is
// mending the road. On the freeways a long site every few kilometres: a board on the median,
// cones that shut the lane off, a lorry with a flashing arrow, a crew breaking up the old road,
// a digger, a roller on the new asphalt, a light tower for the night. Downtown a short one on
// some avenue blocks: two barriers with a crew between them.
//
// Where the sites are comes from the roads themselves (a road's uid), so every player has the
// same ones. A site is built when the player comes near and dropped when they have gone. Each
// big thing in the lane is stood there with Traffic.stand, which makes it a stopped car to
// everything that looks out for the car ahead: the traffic moves over, and so do lane lock and
// self-drive. The lane by the median is the one that is shut because every exit and on-ramp
// uses the outer lane.
window.Roadworks = (function () {
    const RW = { sites: [] };
    let scene, mats = null, plans = null, scan = 0;
    const GAP = 2600;                                                      // metres of freeway between one site and the next
    const LONG = 138, SHORT = 24;                                          // how long a freeway site and a downtown site are

    // the renderer takes a hex colour as linear light and shows it paler: say the colour we want to see
    const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear().getHex();
    const C = { orange: lin(0xff6200), lime: lin(0xb4e000), yellow: lin(0xf0b000), dark: lin(0x24272c), tyre: lin(0x141414),
                steel: lin(0x858b92), white: lin(0xeeeeea), glass: lin(0x1c2a36), navy: lin(0x24304a), earth: lin(0x5c4a36),
                stone: lin(0x77746e), red: lin(0xa01c14), wood: lin(0x9a7448) };
    const AMBER = 0xffa200, UNLIT = 0x2a1c00;
    const stir = (n) => { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return (n ^ (n >>> 15)) >>> 0; };
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // seconds on the clock every player in a room shares, so the crews move alike on every screen
    const clock = () => ((window.Multiplayer && Multiplayer.now ? Multiplayer.now() : Date.now()) - 1.76e12) / 1000;
    const built = (road) => Object.keys(road.chunks).length > 0;

    // ---------- materials (made once, shared by every site) ----------
    function makeMaterials() {
        const speckle = (ctx, W, H, count, tones, size) => {
            for (let i = 0; i < count; i++) {
                ctx.fillStyle = tones[Math.floor(Math.random() * tones.length)];
                ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, size * (0.4 + Math.random()), 0, 6.3); ctx.fill();
            }
        };
        const tiled = (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex; };
        // broken-up road: earth with stones of every size
        const gravel = tiled(Tex.textCanvas(256, 256, (ctx, W, H) => {
            ctx.fillStyle = '#4e4236'; ctx.fillRect(0, 0, W, H);
            speckle(ctx, W, H, 900, ['#3a3128', '#5d5144', '#463c31'], 5);
            speckle(ctx, W, H, 700, ['#77706a', '#8d8880', '#5f5a55', '#a39c90'], 2.6);
            speckle(ctx, W, H, 1600, ['#2c2620', '#9a948a'], 0.9);
        }));
        // new asphalt: near black, fine grained, with the faint bands the roller leaves
        const fresh = tiled(Tex.textCanvas(256, 256, (ctx, W, H) => {
            ctx.fillStyle = '#0e0e10'; ctx.fillRect(0, 0, W, H);
            speckle(ctx, W, H, 2600, ['#191a1d', '#070708', '#222327'], 0.9);
            for (let x = 0; x < W; x += 64) { ctx.fillStyle = 'rgba(255,255,255,0.012)'; ctx.fillRect(x, 0, 30, H); }
        }));
        const stripes = Tex.textCanvas(128, 32, (ctx, W, H) => {
            ctx.fillStyle = '#e4e4e0'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#e04a00';
            for (let x = -H; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.lineTo(x + H + 16, 0); ctx.lineTo(x + 16, H); ctx.fill(); }
        });
        // the lorry's arrow board: three chevrons of lamps pointing to the open lanes
        const arrow = Tex.textCanvas(256, 128, (ctx, W, H) => {
            ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#ffb000';
            [34, 104, 174].forEach(x0 => [0, 1, 2, 1, 0].forEach((step, row) => { ctx.beginPath(); ctx.arc(x0 + step * 22, 20 + row * 22, 8, 0, 6.3); ctx.fill(); }));
        });
        // the board on the median. It hangs as a diamond, so the words are drawn turned.
        const board = Tex.textCanvas(256, 256, (ctx, W, H) => {
            ctx.fillStyle = '#e06000'; ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, W - 20, H - 20);
            ctx.translate(W / 2, H / 2); ctx.rotate(Math.PI / 4);
            ctx.fillStyle = '#0a0a0a'; ctx.font = 'bold 46px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ['ROAD', 'WORK', 'AHEAD'].forEach((word, i) => ctx.fillText(word, 0, (i - 1) * 48));
        });
        const slow = Tex.textCanvas(128, 64, (ctx, W, H) => {
            ctx.fillStyle = '#e06000'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#0a0a0a'; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SLOW', W / 2, H / 2 + 2);
        });
        const onRoad = { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };   // (a patch lies 3 cm over the road)
        const lamp = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
        const plain = (color, roughness) => new THREE.MeshStandardMaterial({ color, roughness: roughness || 0.8 });
        mats = {
            paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),     // everything that is a plain colour: one mesh a site
            gravel: new THREE.MeshStandardMaterial(Object.assign({ map: gravel, color: 0x707070, roughness: 1 }, onRoad)),
            fresh: new THREE.MeshStandardMaterial(Object.assign({ map: fresh, color: 0x9a9a9a, roughness: 0.9, envMapIntensity: 0.3 }, onRoad)),
            stripes: new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 }),
            board: new THREE.MeshStandardMaterial({ map: board, roughness: 0.6 }),
            slow: new THREE.MeshStandardMaterial({ map: slow, roughness: 0.6 }),
            arrow: new THREE.MeshBasicMaterial({ map: arrow, toneMapped: false }),
            lampA: lamp(AMBER), lampB: lamp(UNLIT),                         // the flashing lamps, in two sets that take turns
            flood: lamp(0xffffff),
            hat: plain(C.yellow, 0.5), hatWhite: plain(C.white, 0.5), band: plain(lin(0xd8dcd8), 0.4),
            tool: plain(C.dark, 0.5), wood: plain(C.wood), red: plain(C.red, 0.6), sign: plain(C.orange, 0.6)
        };
    }

    // ---------- where things go ----------
    // A site is laid out along its lane in the direction the traffic drives: `along` is metres
    // from where the site starts, `side` metres to the driver's right of the middle of the lane.
    function frameAt(site, along, side) {
        return Road.at(site.road, site.s + site.dir * along, site.lane.offset + site.dir * (side || 0));
    }
    const fwd = new THREE.Vector3(), left = new THREE.Vector3(), basis = new THREE.Matrix4();
    // stand `thing` on the road there, facing the way the traffic drives (or turned by `turn`)
    function put(site, thing, along, side, turn) {
        const f = frameAt(site, along, side);
        thing.position.copy(f.p).sub(site.origin);
        fwd.copy(f.tan).multiplyScalar(site.dir); left.copy(f.right).multiplyScalar(-site.dir);
        thing.quaternion.setFromRotationMatrix(basis.makeBasis(left, f.up, fwd));
        if (turn) thing.rotateY(turn);
        site.root.add(thing);
        return thing;
    }
    // the same, for a big thing that blocks the lane: the traffic is told about it
    function stand(site, made, along, turn) {
        const thing = put(site, made.group, along, 0, turn);
        const at = thing.position.clone().add(site.origin);
        const f = Traffic.stand(site.road, site.lane, site.s + site.dir * along, at, thing.quaternion, made.size);
        site.stands.push(f);
        return f;
    }

    // ---------- the parts ----------
    // a plain-coloured part: they all share one material and Batch.merge makes one mesh of them
    function part(group, geometry, color, x, y, z) {
        const m = new THREE.Mesh(geometry, mats.paint);
        m.position.set(x, y, z); m.userData.color = color; m.castShadow = true;
        group.add(m);
        return m;
    }
    const box = (g, w, h, d, x, y, z, color) => part(g, new THREE.BoxGeometry(w, h, d), color, x, y, z);
    // a wheel or a drum, lying across the vehicle
    function wheel(g, radius, width, x, y, z, color) {
        const geometry = new THREE.CylinderGeometry(radius, radius, width, 14); geometry.rotateZ(Math.PI / 2);
        return part(g, geometry, color, x, y, z);
    }
    // a part with a material of its own (lamps, striped boards, signs)
    function own(group, geometry, material, x, y, z) {
        const m = new THREE.Mesh(geometry, material);
        m.position.set(x, y, z); m.castShadow = true;
        group.add(m);
        return m;
    }

    function cone() {
        const g = new THREE.Group();
        box(g, 0.38, 0.04, 0.38, 0, 0.02, 0, C.dark);
        part(g, new THREE.ConeGeometry(0.15, 0.72, 10), C.orange, 0, 0.4, 0);
        part(g, new THREE.CylinderGeometry(0.052, 0.082, 0.14, 10), C.white, 0, 0.47, 0);
        return g;
    }

    // a barrier across the lane: three striped boards and two lamps that flash in turn
    function barrier() {
        const g = new THREE.Group();
        [-1.3, 1.3].forEach(x => { box(g, 0.08, 1.45, 0.08, x, 0.72, 0, C.steel); box(g, 0.1, 0.08, 0.9, x, 0.04, 0, C.steel); });
        [0.5, 0.88, 1.26].forEach(y => own(g, new THREE.BoxGeometry(3.0, 0.24, 0.05), mats.stripes, 0, y, 0));
        own(g, new THREE.BoxGeometry(0.18, 0.18, 0.12), mats.lampA, -1.3, 1.54, 0);
        own(g, new THREE.BoxGeometry(0.18, 0.18, 0.12), mats.lampB, 1.3, 1.54, 0);
        return { group: g, size: [3.0, 1.5, 0.7] };
    }

    // the lorry that stands at the head of the site with the arrow board on its back
    function lorry() {
        const g = new THREE.Group();
        box(g, 2.1, 0.3, 6.2, 0, 0.75, 0, C.dark);                         // chassis
        box(g, 2.2, 1.5, 1.8, 0, 1.6, 2.1, C.orange);                      // cab
        box(g, 2.0, 0.6, 0.06, 0, 1.95, 3.01, C.glass);                    // windscreen
        box(g, 2.3, 0.16, 4.1, 0, 0.98, -1.0, C.steel);                    // flat bed
        [[1, 2.0], [-1, 2.0], [1, -1.9], [-1, -1.9]].forEach(([x, z]) => wheel(g, 0.48, 0.36, x, 0.48, z, C.tyre));
        [-0.95, 0.95].forEach(x => box(g, 0.1, 1.5, 0.1, x, 1.8, -2.7, C.dark));   // the board's frame
        box(g, 2.7, 1.35, 0.12, 0, 3.1, -2.7, C.dark);
        own(g, new THREE.PlaneGeometry(2.5, 1.2), mats.arrow, 0, 3.1, -2.77).rotation.y = Math.PI;   // (it faces the cars coming up behind)
        own(g, new THREE.BoxGeometry(2.2, 0.5, 0.06), mats.stripes, 0, 1.35, -3.08);
        own(g, new THREE.BoxGeometry(0.3, 0.18, 0.3), mats.lampA, 0, 2.44, 2.1);
        return { group: g, size: [2.3, 2.4, 6.3] };
    }

    // the roller, with its driver. It rolls up and down the new asphalt (see `rolling`).
    function roller() {
        const g = new THREE.Group();
        [1.35, -1.35].forEach(z => {
            wheel(g, 0.65, 1.8, 0, 0.65, z, C.steel);                      // a drum
            [-0.98, 0.98].forEach(x => box(g, 0.1, 0.8, 0.5, x, 1.0, z, C.yellow));
        });
        box(g, 1.7, 1.0, 1.3, 0, 1.0, 0, C.yellow);                        // the body between the drums
        box(g, 1.9, 0.25, 4.0, 0, 1.5, 0, C.yellow);                       // the deck over them
        box(g, 1.6, 0.6, 1.2, 0, 1.92, -1.3, C.yellow);                    // engine cover
        box(g, 0.55, 0.12, 0.5, 0, 1.75, 0.1, C.dark); box(g, 0.55, 0.5, 0.1, 0, 2.0, -0.18, C.dark);   // seat
        box(g, 0.06, 0.6, 0.06, 0, 1.9, 0.75, C.dark);                     // steering column
        [[0.85, 0.95], [-0.85, 0.95], [0.85, -0.6], [-0.85, -0.6]].forEach(([x, z]) => box(g, 0.07, 1.8, 0.07, x, 2.5, z, C.dark));
        box(g, 1.9, 0.08, 1.8, 0, 3.42, 0.15, C.yellow);                   // canopy
        own(g, new THREE.BoxGeometry(0.26, 0.16, 0.26), mats.lampB, 0, 3.54, 0.15);
        Batch.merge(g);
        const driver = crewMember(7);
        driver.position.set(0, 1.0, 0.05);
        driver.userData.legs.forEach(l => { l.rotation.x = -1.45; });
        driver.userData.arms.forEach(a => { a.rotation.x = -1.0; });
        g.add(driver);
        g.userData.keep = true;                                            // (it moves: the site's own merge leaves it alone)
        return { group: g, size: [2.0, 3.4, 4.4] };
    }

    // the digger: tracks, a house that turns on them, a boom, a stick and a bucket
    function digger() {
        const g = new THREE.Group();
        [-0.8, 0.8].forEach(x => box(g, 0.45, 0.6, 3.0, x, 0.3, 0, C.tyre));
        box(g, 1.2, 0.3, 1.6, 0, 0.6, 0, C.dark);
        const house = new THREE.Group(); house.position.y = 0.8; g.add(house);
        box(house, 1.9, 0.2, 2.4, 0, 0.1, -0.2, C.yellow);                 // deck
        box(house, 1.9, 0.8, 1.1, 0, 0.6, -1.0, C.yellow);                 // engine and counterweight
        box(house, 1.0, 1.5, 1.2, 0.42, 0.95, 0.1, C.yellow);              // cab
        box(house, 0.9, 0.7, 0.05, 0.42, 1.25, 0.72, C.glass);
        const boom = new THREE.Group(); boom.position.set(-0.45, 0.5, 0.55); house.add(boom);
        box(boom, 0.24, 0.3, 2.7, 0, 0, 1.3, C.yellow);
        const stick = new THREE.Group(); stick.position.set(0, 0, 2.6); boom.add(stick);
        box(stick, 0.2, 0.22, 1.7, 0, 0, 0.85, C.yellow);
        box(stick, 0.7, 0.45, 0.5, 0, -0.05, 1.8, C.dark);                 // bucket
        // each moving piece becomes one mesh of its own, innermost first
        [stick, boom, house].forEach(piece => { Batch.merge(piece); piece.userData.keep = true; });
        return { group: g, size: [2.0, 2.6, 3.2], house, boom, stick };
    }
    // The digger's round, 7 seconds: reach down and scoop, lift, swing to the heap, tip, swing back.
    // `toHeap` is which way the heap lies (1: to the digger's left).
    function digging(d, toHeap) {
        return function (t) {
            const at = (t / 7) % 1;
            const scoop = at < 0.45 ? Math.sin(Math.PI * at / 0.45) : 0;
            const swing = smooth(0.45, 0.6, at) * (1 - smooth(0.82, 0.96, at));
            const tip = smooth(0.6, 0.68, at) * (1 - smooth(0.76, 0.84, at));
            d.house.rotation.y = toHeap * 0.6 * swing;
            d.boom.rotation.x = -0.75 + 0.45 * scoop;
            d.stick.rotation.x = 1.2 + 0.75 * scoop - 0.5 * tip;
        };
    }

    // a light tower on a trailer: its lamps are on all day, and at night it lights the road under it
    function tower() {
        const g = new THREE.Group();
        box(g, 1.0, 0.7, 1.7, 0, 0.75, 0, C.yellow);
        [-0.55, 0.55].forEach(x => wheel(g, 0.3, 0.16, x, 0.3, -0.2, C.tyre));
        box(g, 0.1, 5.2, 0.1, 0, 3.7, 0, C.steel);
        own(g, new THREE.BoxGeometry(1.3, 0.45, 0.16), mats.flood, 0, 6.4, 0.05).rotation.x = 0.5;
        const pool = new THREE.PlaneGeometry(18, 18); pool.rotateX(-Math.PI / 2);
        const light = own(g, pool, Tex.lightPool(), 0, 0.08, 5); light.castShadow = false;
        return g;
    }

    // the board on the median that says what is coming
    function warning() {
        const g = new THREE.Group();
        box(g, 0.08, 2.9, 0.08, 0, 1.45, 0.06, C.steel);
        box(g, 1.25, 1.25, 0.04, 0, 2.4, 0.03, C.steel).rotation.z = Math.PI / 4;
        own(g, new THREE.PlaneGeometry(1.25, 1.25), mats.board, 0, 2.4, -0.01).rotation.set(0, Math.PI, Math.PI / 4);
        return g;
    }

    function rubble(site, along, side, seed) {
        const g = new THREE.Group();
        for (let i = 0; i < 9; i++) {
            const h = stir(seed + i * 31), size = 0.12 + (h % 100) / 500;
            const rock = part(g, new THREE.DodecahedronGeometry(size, 0), i % 3 ? C.stone : C.dark, ((h >>> 8) % 100) / 60 - 0.8, size * 0.6, ((h >>> 16) % 100) / 40 - 1.25);
            rock.rotation.set(h % 6, (h >>> 4) % 6, 0);
        }
        return put(site, g, along, side);
    }
    function heap(site, along, side) {
        const g = new THREE.Group();
        part(g, new THREE.SphereGeometry(0.85, 9, 6), C.earth, 0, 0, 0).scale.y = 0.5;
        part(g, new THREE.SphereGeometry(0.5, 8, 5), C.earth, 0.3, 0.1, 0.6).scale.y = 0.55;
        return put(site, g, along, side);
    }

    // A patch laid over the lane from `a` to `b` metres into the site, `half` either side of the
    // middle. It follows the road, a row of points every two metres.
    function patch(site, a, b, half, material) {
        const spots = [], uv = [], index = [], rows = Math.ceil((b - a) / 2);
        for (let i = 0; i <= rows; i++) {
            const along = a + (b - a) * i / rows;
            [-half, half].forEach(side => {
                const p = frameAt(site, along, side).p;
                spots.push(p.x - site.origin.x, p.y + 0.03 - site.origin.y, p.z - site.origin.z);
                uv.push((side + half) / 3, along / 3);
            });
            if (i < rows) { const v = i * 2; index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(spots, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true; mesh.userData.keep = true;
        site.root.add(mesh);
    }

    // ---------- the crew ----------
    // one of the crew: a person in a bright vest and a hard hat
    function crewMember(seed) {
        const look = Peds.lookFor('road crew ' + seed);
        const man = Peds.person({ skin: look.skin, hair: look.hair, shirt: seed % 2 ? C.orange : C.lime, pants: C.navy });
        const cap = new THREE.SphereGeometry(0.152, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        const hat = seed % 3 ? mats.hat : mats.hatWhite;
        own(man, cap, hat, 0, 1.52, 0);
        own(man, new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), hat, 0, 1.53, 0.03);
        [0.95, 1.17].forEach(y => own(man, new THREE.BoxGeometry(0.395, 0.05, 0.235), mats.band, 0, y, 0));
        return man;
    }
    const rod = (length, material) => new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, length, 6), material);
    // A crew member at work. `job` is what they do: 'drill' breaks the road up, 'dig' shovels,
    // 'rake' spreads asphalt, 'flag' waves the traffic over, 'watch' stands by with a clipboard,
    // 'walk' goes up and down the site (between `along` and `to`).
    function crew(site, seed, job, along, side, turn, to) {
        const man = crewMember(seed), arms = man.userData.arms, phase = seed * 1.7;
        const hold = new THREE.Group(); hold.add(man); hold.userData.keep = true;
        put(site, hold, along, side, turn);
        const tool = new THREE.Group(); man.add(tool);
        let move = null;
        if (job === 'drill') {
            tool.position.set(0, 0, 0.4);
            own(tool, new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), mats.red, 0, 0.62, 0);
            const bit = rod(0.4, mats.tool); bit.position.y = 0.2; tool.add(bit);
            own(tool, new THREE.BoxGeometry(0.5, 0.05, 0.05), mats.tool, 0, 0.9, 0);
            move = (t) => {                                               // the whole of him shakes with it
                const shake = Math.sin(t * 40);
                man.position.y = 0.006 * shake; tool.position.y = 0.02 * shake;
                arms.forEach(a => { a.rotation.x = -0.76 + 0.02 * shake; });
            };
        } else if (job === 'dig' || job === 'rake') {
            const dig = job === 'dig';
            tool.position.set(0, 1.3, 0);                                  // (it turns about the shoulders, with the arms)
            const shaft = rod(dig ? 1.15 : 1.5, mats.wood); shaft.position.y = dig ? -0.9 : -1.05; tool.add(shaft);
            if (dig) own(tool, new THREE.BoxGeometry(0.24, 0.3, 0.03), mats.tool, 0, -1.52, 0);
            else own(tool, new THREE.BoxGeometry(0.55, 0.05, 0.06), mats.tool, 0, -1.8, 0);
            move = (t) => {
                const swing = Math.sin(t * (dig ? 2.4 : 2.0) + phase);
                const reach = dig ? -1.05 - 0.35 * swing : -1.02 - 0.14 * swing;
                arms.forEach(a => { a.rotation.x = reach; });
                tool.rotation.x = reach - 0.12;
                man.rotation.x = dig ? 0.12 - 0.08 * swing : 0.06;        // he bends to it
            };
        } else if (job === 'flag') {
            const pole = rod(2.1, mats.tool); pole.position.set(0.34, 1.05, 0.3); man.add(pole);
            const paddle = new THREE.CylinderGeometry(0.3, 0.3, 0.03, 8); paddle.rotateX(Math.PI / 2);
            own(man, paddle, mats.sign, 0.34, 2.2, 0.3);
            own(man, new THREE.PlaneGeometry(0.42, 0.2), mats.slow, 0.34, 2.2, 0.32);
            arms[1].rotation.x = -0.6;
            move = (t) => { arms[0].rotation.z = -(2.0 + 0.45 * Math.sin(t * 3.2)); };   // the free arm waves them over
        } else if (job === 'watch') {
            own(arms[1], new THREE.BoxGeometry(0.22, 0.02, 0.3), mats.hatWhite, 0, -0.6, 0.1);
            arms[1].rotation.x = -1.15;
            move = (t) => { man.rotation.y = 0.45 * Math.sin(t * 0.5 + phase); };
        } else if (job === 'walk') {
            const length = Math.abs(to - along), round = 2 * length;
            move = (t, dt) => {
                const lap = (t * 1.2 + phase) % round, back = lap > length;
                put(site, hold, along + Math.sign(to - along) * (back ? round - lap : lap), side, back ? Math.PI : 0);
                Peds.animate(man, dt, true);
            };
        }
        if (move) site.movers.push(move);
    }

    // ---------- the two kinds of site ----------
    function buildLong(site) {
        const half = site.half, cones = (along, side) => put(site, cone(), along, side);
        // the way in: a board on the median, then cones that shut the lane off bit by bit
        put(site, warning(), -150, -half - 0.5);
        for (let u = 0; u <= 36; u += 4.5) cones(u, -half + 0.3 + (2 * half - 0.45) * u / 36);
        for (let u = 43; u <= LONG; u += 7) cones(u, half - 0.15);
        crew(site, 1, 'flag', 30, -0.9, Math.PI);
        stand(site, lorry(), 40);
        // the old road being broken up, and the digger clearing it onto a heap by the median
        patch(site, 46, 59.5, half - 0.4, mats.gravel);
        crew(site, 2, 'drill', 49.5, 0.3);
        crew(site, 3, 'dig', 54, -1.0, -Math.PI / 2);
        rubble(site, 51.5, -0.2, site.road.uid);
        heap(site, 59.3, -half + 0.05);
        const d = digger();
        stand(site, d, 62, Math.PI);                                       // (it faces back up the road, at the trench)
        site.movers.push(digging(d, -1));
        // the new asphalt, with the roller going up and down it
        patch(site, 66, 126, half - 0.25, mats.fresh);
        const r = roller(), rolling = stand(site, r, 84);
        site.movers.push((t) => {
            const along = 84 + 7 * Math.sin(t * Math.PI / 10);
            put(site, r.group, along, 0);
            rolling.s = site.s + site.dir * along;
            rolling.mesh.position.copy(r.group.position).add(site.origin);
            rolling.body.position.set(rolling.mesh.position.x, rolling.mesh.position.y, rolling.mesh.position.z);
        });
        crew(site, 4, 'rake', 97, 0.7, Math.PI);
        crew(site, 5, 'watch', 101, 1.2, -2.2);
        crew(site, 6, 'walk', 66, -1.45, 0, 103);
        stand(site, barrier(), 106);
        put(site, tower(), 108.5, -half + 0.2, Math.PI);
        stand(site, barrier(), 128);
    }
    function buildShort(site) {
        const half = site.half, cones = (along, side) => put(site, cone(), along, side);
        for (let u = 0; u <= 6; u += 2) cones(u, -half + 0.3 + (2 * half - 0.45) * u / 6);
        for (let u = 10; u <= SHORT; u += 3.5) cones(u, half - 0.15);
        stand(site, barrier(), 8);
        patch(site, 10, 20.5, half - 0.4, mats.gravel);
        const seed = site.road.uid % 50;
        crew(site, seed + 2, 'drill', 12.5, 0.3);
        crew(site, seed + 3, 'dig', 16.5, -1.0, -Math.PI / 2);
        crew(site, seed + 5, 'watch', 19.3, 1.0, -2.2);
        rubble(site, 14.5, -0.2, site.road.uid);
        stand(site, barrier(), 22);
    }

    // ---------- building and dropping ----------
    // a place for a site: on `road`, in the lane by the median going `dir`, starting at `s`
    function plan(road, dir, s, long) {
        const lane = road.lanes.find(l => l.dir === dir && l.index === 0);
        const length = long ? LONG : SHORT;
        return { road, dir, lane, s, long, length, centre: Road.at(road, s + dir * length / 2, lane.offset).p, site: null };
    }
    function planFreeways() {
        plans = [];
        World.freeways.forEach(fw => {
            const count = Math.floor((fw.length - 1800) / GAP);
            for (let k = 0; k < count; k++) {
                const h = stir(fw.uid + k * 977);
                plans.push(plan(fw, h & 1 ? 1 : -1, 900 + k * GAP + (h >>> 8) % 900, true));
            }
        });
    }
    // one avenue block in eleven downtown has a short site, 8 m in from the corner the traffic comes from
    function planFor(rec) {
        const h = stir(rec.uid);
        if (h % 11 || rec.length < 38) return false;
        const dir = h & 16 ? 1 : -1;
        return plan(rec, dir, dir === 1 ? 8 : rec.length - 8, false);
    }

    function build(p) {
        if (!mats) makeMaterials();
        const site = { plan: p, road: p.road, dir: p.dir, lane: p.lane, s: p.s, length: p.length, half: p.road.typeDef.laneW / 2,
                       origin: Road.at(p.road, p.s, p.lane.offset).p, root: new THREE.Group(), stands: [], movers: [], centre: p.centre };
        site.root.position.copy(site.origin);
        if (p.long) buildLong(site); else buildShort(site);
        Batch.merge(site.root);
        scene.add(site.root);
        p.site = site; RW.sites.push(site);
    }
    function drop(site) {
        scene.remove(site.root);
        site.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        site.stands.forEach(f => Traffic.unstand(f));
        site.plan.site = null;
        RW.sites.splice(RW.sites.indexOf(site), 1);
    }
    function consider(p, pos, near, far) {
        const d = Math.hypot(p.centre.x - pos.x, p.centre.z - pos.z);
        if (!p.site && d < near && built(p.road)) build(p);
        else if (p.site && d > far) drop(p.site);
    }
    // once a second: which sites should be standing, now that the player is here?
    function look(pos) {
        if (!plans) planFreeways();
        plans.forEach(p => consider(p, pos, 700, 900));
        Road.all.forEach(rec => {
            if (rec.type !== 'avenue' || !rec.meta) return;
            if (rec.works === undefined) rec.works = planFor(rec);
            if (rec.works) consider(rec.works, pos, 420, 560);
        });
        RW.sites.slice().forEach(site => { if (!built(site.road)) drop(site); });   // (its city has been taken down)
    }

    // Is this lane shut here, or within `before` metres ahead? (Self-drive asks before it changes lanes.)
    RW.closed = function (road, dir, laneIndex, s, before) {
        return RW.sites.some(site => {
            if (site.road !== road || site.dir !== dir || site.lane.index !== laneIndex) return false;
            const along = (s - site.s) * dir;
            return along > -(before || 20) && along < site.length + 5;
        });
    };

    RW.update = function (dt, pos) {
        scan -= dt;
        if (scan <= 0) { scan = 1; look(pos); }
        if (!RW.sites.length) return;
        const t = clock(), night = window.Sky ? Sky.night : 0;
        // the lamps flash in two sets that take turns, the arrow board goes on and off
        const first = (t * 1.6) % 1 < 0.5;
        mats.lampA.color.setHex(first ? AMBER : UNLIT); mats.lampB.color.setHex(first ? UNLIT : AMBER);
        mats.arrow.color.setScalar(t % 1.2 < 0.8 ? 1 : 0.07);
        mats.flood.color.setScalar(0.35 + 0.65 * night);
        RW.sites.forEach(site => {
            if (Math.hypot(site.centre.x - pos.x, site.centre.z - pos.z) > 260) return;   // too far to see anyone move
            site.movers.forEach(move => move(t, dt));
        });
    };
    RW.init = function (sc) { scene = sc; };
    return RW;
})();
