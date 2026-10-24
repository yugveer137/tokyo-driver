// tokyo-driver1 v2 — the seven cities: real street names, skylines and landmark builders.
// Each entry is handed to City.define by world.js, which also decides where along the
// freeway the city sits. `skyline(d)` maps distance-from-downtown (0 centre .. 1 edge) to a
// [min, max] building height. Landmark builders get (city, helpers) and place meshes with
// city.toWorld(lx, lz) in the city's local grid coordinates.
window.CITIES = (function () {
    const std = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, metalness: 0.2 });
    // Landmark coordinates are measured from the middle block, not the middle intersection
    // (city.lmX/lmZ, set in City.define), so a tower never stands in the road.
    const lm = (city, lx, lz) => city.toWorld(lx + (city.lmX || 0), lz + (city.lmZ || 0));
    const put = (h, city, mesh, lx, lz, yOff, shadow) => {
        const p = lm(city, lx, lz); const g = Terrain.height(p.x, p.z) + 0.3;
        mesh.position.set(p.x, g + (yOff || 0), p.z); mesh.rotation.y = city.heading;
        h.addMesh(mesh, shadow !== false); return mesh;
    };

    // --- landmark builders ---
    function tokyoTower(city, h) {
        // red/white lattice tower: tapered legs, two observation decks, antenna
        const red = std(0xe8431c), white = std(0xf4f4f4);
        const lx = city.W / 2 - 60, lz = -city.D / 2 + 60;
        const base = lm(city, lx, lz); const g = Terrain.height(base.x, base.z) + 0.3;
        for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 110, 6), red);
            leg.position.set(base.x + Math.cos(a) * 9, g + 55, base.z + Math.sin(a) * 9);
            leg.rotation.z = -Math.cos(a) * 0.15; leg.rotation.x = Math.sin(a) * 0.15;
            h.addMesh(leg, true);
        }
        const deck1 = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 22), white); deck1.position.set(base.x, g + 50, base.z); h.addMesh(deck1, true);
        const deck2 = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), white); deck2.position.set(base.x, g + 92, base.z); h.addMesh(deck2, true);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.8, 40, 6), red); mast.position.set(base.x, g + 125, base.z); h.addMesh(mast, true);
        h.addBox(20, 110, 20, base.x, g + 55, base.z, 0);
    }
    function shibuyaScreens(city, h) {
        // big glowing billboards on the downtown corner buildings
        const faces = [[0, -1], [1, 0]];
        faces.forEach(([dx, dz], k) => {
            const tex = Tex.textCanvas(512, 256, (ctx, W, H) => {
                ctx.fillStyle = k ? '#ff3fa0' : '#19d3ff'; ctx.fillRect(0, 0, W, H);
                ctx.fillStyle = '#fff'; ctx.font = 'bold 110px Helvetica, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(k ? 'SHIBUYA' : 'TOKYO', W / 2, H / 2);
            });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.MeshBasicMaterial({ map: tex }));
            const lx = 12 * dx, lz = 12 * dz;
            put(h, city, m, lx + dx * 30, lz + dz * 30, 24, false);
            m.rotation.y = city.heading + (k ? -Math.PI / 2 : Math.PI);
        });
    }
    function transamerica(city, h) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(14, 170, 4), std(0xe9e4d8));
        m.rotation.y = Math.PI / 4;
        const lx = 0, lz = 0;
        put(h, city, m, lx, lz, 85);
        const p = lm(city, lx, lz);
        h.addBox(20, 170, 20, p.x, Terrain.height(p.x, p.z) + 85, p.z, 0);
    }
    // The bay north of the city: terrain drops to the sea bed, a water sheet sits at sea level.
    // Registered at define time so the land is shaped before anything is built on it.
    const BAY = { from: 60, to: 640, depth: 10 };            // local lz past the grid edge
    function sfBay(city) {
        Terrain.shapers.push((x, z, h) => {
            const l = city.toLocal(x, z);
            const z0 = city.D / 2 + BAY.from, z1 = city.D / 2 + BAY.to;
            if (l.lz < z0 - 60 || l.lz > z1 + 60 || Math.abs(l.lx) > 900) return h;
            const edge = Math.min(l.lz - z0, z1 - l.lz, 900 - Math.abs(l.lx));     // distance in from the shore
            const k = Math.max(0, Math.min(1, (edge + 60) / 120));                // 0 on land, 1 well into the bay
            return h * (1 - k) + (city.base - BAY.depth) * k;
        });
    }
    function goldenGate(city, h) {
        const orange = std(0xc0471b);
        const sea = city.base - 2.5, deckY = city.base + 12;
        // water
        const z0 = city.D / 2 + BAY.from, z1 = city.D / 2 + BAY.to;
        const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, z1 - z0 + 40), new THREE.MeshStandardMaterial({ color: 0x2b6f9c, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.92 }));
        const wc = city.toWorld(0, (z0 + z1) / 2); water.position.set(wc.x, sea, wc.z); water.rotation.set(-Math.PI / 2, 0, 0); water.rotateZ(-city.heading);
        water.receiveShadow = true; h.addMesh(water, false);
        // two towers astride the deck, cross braces, and the main cables
        [230, 450].forEach(lz => {
            [-6, 6].forEach(off => {
                const t = new THREE.Mesh(new THREE.BoxGeometry(3, 95, 3), orange);
                const q = city.toWorld(off, city.D / 2 + lz); t.position.set(q.x, sea + 47.5, q.z); t.rotation.y = city.heading; h.addMesh(t, true);
            });
            [25, 55, 85].forEach(y => { const b = new THREE.Mesh(new THREE.BoxGeometry(15, 4, 3), orange); const q = city.toWorld(0, city.D / 2 + lz); b.position.set(q.x, sea + y, q.z); b.rotation.y = city.heading; h.addMesh(b, true); });
        });
        [-7, 7].forEach(side => {
            const pts = [];
            for (let lz = 110; lz <= 580; lz += 10) {
                const top = sea + 92, mid = (230 + 450) / 2;
                let y;
                if (lz < 230) y = deckY + 2 + (top - deckY - 2) * Math.pow((lz - 110) / 120, 1.6);
                else if (lz > 450) y = deckY + 2 + (top - deckY - 2) * Math.pow((580 - lz) / 130, 1.6);
                else y = top - (1 - Math.pow((lz - mid) / 110, 2)) * 60;
                const q = city.toWorld(side, city.D / 2 + lz); pts.push(new THREE.Vector3(q.x, y, q.z));
            }
            h.addMesh(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.45, 6, false), orange), false);
            // hangers every 20 m from the cable down to the deck
            for (let lz = 130; lz <= 560; lz += 20) {
                const i = Math.round((lz - 110) / 10); const top = pts[i]; if (!top) continue;
                const hgr = new THREE.Mesh(new THREE.BoxGeometry(0.15, Math.max(0.5, top.y - deckY - 1), 0.15), orange);
                hgr.position.set(top.x, (top.y + deckY + 1) / 2, top.z); h.addMesh(hgr, false);
            }
        });
    }
    // US-101 over the bridge: climbs from the end of the city's middle street, crosses the water
    // 14 m up, and comes down into Sausalito's middle street on the far shore.
    function goldenGateRoad(city) {
        const cx = city.streetX(3), deckY = city.base + 12;
        const pts = [];
        const g = (lz) => { const p = city.toWorld(cx, lz); return Terrain.height(p.x, p.z); };
        const add = (lz, y) => { const p = city.toWorld(cx, lz); pts.push([p.x, y === undefined ? deckY : y, p.z]); };
        add(city.D / 2 + 10, g(city.D / 2 + 10) + Road.DRAPE); add(city.D / 2 + 40, g(city.D / 2 + 40) + 1.5);
        add(city.D / 2 + 75, deckY - 4); add(city.D / 2 + 110);
        for (let lz = 150; lz <= 580; lz += 40) add(city.D / 2 + lz);
        add(city.D / 2 + 625); add(city.D / 2 + 660, deckY - 4);
        add(city.D / 2 + 690, g(city.D / 2 + 690) + 1.5); add(city.D / 2 + 720, g(city.D / 2 + 720) + Road.DRAPE);
        const road = Road.build({ type: 'avenue', name: 'US-101 Golden Gate Bridge', points: pts, segLen: 8, hugTerrain: true });
        // a US 101 shield at each end
        const sg = Road.at(road, 20, road.halfW + 2.5); city.signs.push(Signs.plain(sg.p, Signs.facingFrom(sg.tan), 'US 101', 'NORTH · GOLDEN GATE', 3.6, 2));
        const sg2 = Road.at(road, road.length - 20, -(road.halfW + 2.5)); city.signs.push(Signs.plain(sg2.p, Signs.facingFrom(sg2.tan.clone().negate()), 'US 101', 'SOUTH · SAN FRANCISCO', 3.6, 2));
        return [road];
    }
    // Sausalito: the small town across the water, laid out so its middle street meets the bridge
    function sausalito(city) {
        const c = city.toWorld(0, city.D / 2 + 720 + 132 + 10);
        return {
            id: 'sausalito', name: 'Sausalito', sub: 'Marin County', rows: 4, cols: 4, block: 50, street: 16,
            center: { x: c.x, z: c.z }, heading: city.heading, base: city.base, fw: city.fw, s: city.s, side: city.side,
            streets: { ns: ['Bridgeway', 'Caledonia St', 'Spring St', 'Nevada St', 'Tomales St'], ew: ['Princess St', 'Napa St', 'Johnson St', 'Bay St', 'Harbor Dr'] },
            skyline: () => [5, 12], palette: [0xf4ead8, 0xe8d9c0, 0xd6c3a8, 0xcad6df, 0xf7f3ea], landmarks: [], parks: [[1, 1]]
        };
    }
    function empireState(city, h) {
        const stone = std(0xb9b2a4);
        const tiers = [[40, 60], [30, 110], [20, 150], [10, 180]];
        let y = 0;
        tiers.forEach(([w, top]) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, top - y, w), stone);
            put(h, city, m, 0, 0, y + (top - y) / 2); y = top;
        });
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.5, 40, 8), std(0xd8d8d8)); put(h, city, spire, 0, 0, 200);
        const p = lm(city, 0, 0); h.addBox(40, 180, 40, p.x, Terrain.height(p.x, p.z) + 90, p.z, 0);
    }
    function chrysler(city, h) {
        const steel = std(0xcfd6dc);
        const body = new THREE.Mesh(new THREE.BoxGeometry(22, 130, 22), steel); put(h, city, body, 110, -90, 65);
        for (let k = 0; k < 5; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(11 - k * 2, 8, 8), steel); put(h, city, c, 110, -90, 134 + k * 7); }
        const p = lm(city, 110, -90); h.addBox(22, 130, 22, p.x, Terrain.height(p.x, p.z) + 65, p.z, 0);
    }
    function vegasStrip(city, h) {
        // giant lit casino signs along the main avenue + a pyramid + a sphere
        const names = ['BELLAGIO', 'CAESARS', 'MIRAGE', 'LUXOR', 'VENETIAN', 'MGM'];
        names.forEach((n, k) => {
            const tex = Tex.textCanvas(512, 160, (ctx, W, H) => {
                ctx.fillStyle = ['#ff2d7a', '#ffd21e', '#3af0ff', '#ff7a1e', '#c05bff', '#28ff6a'][k]; ctx.fillRect(0, 0, W, H);
                ctx.fillStyle = '#111'; ctx.font = 'bold 96px Helvetica, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, W / 2, H / 2);
            });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
            const side = k % 2 ? 1 : -1;
            put(h, city, m, side * 16, -city.D / 2 + 60 + k * 70, 14, false);
            m.rotation.y = city.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        });
        const pyr = new THREE.Mesh(new THREE.ConeGeometry(45, 70, 4), std(0x2b2f3a)); pyr.rotation.y = Math.PI / 4;
        put(h, city, pyr, city.W / 2 - 70, city.D / 2 - 70, 35);
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(28, 24, 16), new THREE.MeshStandardMaterial({ color: 0x223355, emissive: 0x2244ff, emissiveIntensity: 0.6 }));
        put(h, city, sphere, -city.W / 2 + 70, city.D / 2 - 70, 30);
    }
    function capitol(city, h) {
        const stone = std(0xf1ede4);
        const base = new THREE.Mesh(new THREE.BoxGeometry(70, 18, 30), stone); put(h, city, base, 0, 0, 9);
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 20, 24), stone); put(h, city, drum, 0, 0, 28);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(13, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), stone); put(h, city, dome, 0, 0, 38);
        for (let k = 0; k < 8; k++) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 14, 8), stone); put(h, city, col, -28 + k * 8, -16, 9); }
        const p = lm(city, 0, 0); h.addBox(70, 18, 30, p.x, Terrain.height(p.x, p.z) + 9, p.z, city.heading);
    }
    function renoArch(city, h) {
        const tex = Tex.textCanvas(1024, 200, (ctx, W, H) => {
            ctx.fillStyle = '#1b1f4a'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#ffd21e'; ctx.font = 'bold 64px Helvetica, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('RENO — THE BIGGEST LITTLE CITY IN THE WORLD', W / 2, H / 2);
        });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        put(h, city, m, 0, -city.D / 2 + 40, 9, false); m.rotation.y = city.heading;
        [-15, 15].forEach(x => { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), h.poleMat); put(h, city, leg, x, -city.D / 2 + 40, 6); });
    }
    function oaklandCranes(city, h) {
        const white = std(0xe6e6e6);
        for (let k = 0; k < 3; k++) {
            const lx = -city.W / 2 + 40 + k * 60, lz = city.D / 2 + 40;
            [-8, 8].forEach(dx => { const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 40, 2), white); put(h, city, leg, lx + dx, lz, 20); });
            const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 2, 2), white); put(h, city, beam, lx, lz, 40);
            const boom = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 50), white); put(h, city, boom, lx, lz - 10, 44);
        }
    }

    function slcTemple(city, h) {
        const granite = std(0xd9d5cc);
        const base = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 22), granite); put(h, city, base, 0, 0, 15);
        for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(2.2, 18, 6), granite); put(h, city, sp, -16 + (k % 3) * 16, k < 3 ? -9 : 9, 39); }
        const p = lm(city, 0, 0); h.addBox(40, 30, 22, p.x, Terrain.height(p.x, p.z) + 15, p.z, city.heading);
    }
    function denverCashRegister(city, h) {
        const glass = std(0xf0e6c8);
        const body = new THREE.Mesh(new THREE.BoxGeometry(26, 120, 18), glass); put(h, city, body, 0, 0, 60);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 14, 24, 1, false, 0, Math.PI), glass); crown.rotation.z = Math.PI / 2; put(h, city, crown, 0, 0, 120);
        const p = lm(city, 0, 0); h.addBox(26, 120, 18, p.x, Terrain.height(p.x, p.z) + 60, p.z, city.heading);
    }
    function willisTower(city, h) {
        const black = std(0x1b1e24);
        [[0, 0, 220, 16], [-16, 0, 180, 16], [16, 0, 180, 16], [0, -16, 150, 16], [0, 16, 150, 16], [-16, -16, 110, 16], [16, 16, 110, 16]].forEach(([x, z, hh, w]) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), black); put(h, city, m, x, z, hh / 2);
        });
        [-5, 5].forEach(x => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 40, 6), std(0xdddddd)); put(h, city, a, x, 0, 240); });
        const p = lm(city, 0, 0); h.addBox(48, 220, 48, p.x, Terrain.height(p.x, p.z) + 110, p.z, city.heading);
    }
    function cloudGate(city, h) {
        const bean = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 }));
        bean.scale.set(1.6, 0.8, 1); put(h, city, bean, city.W / 2 - 60, -city.D / 2 + 60, 9);
    }

    // --- city specs ---
    return [
        {
            id: 'tokyo', name: 'Tokyo', sub: 'Shibuya', rows: 6, cols: 6, block: 56, street: 18,
            streets: { ns: ['Meiji-dori', 'Dogenzaka', 'Aoyama-dori', 'Koen-dori', 'Bunkamura-dori', 'Inokashira-dori', 'Roppongi-dori'],
                       ew: ['Shibuya Crossing', 'Center-gai', 'Omotesando', 'Cat Street', 'Harajuku-dori', 'Takeshita-dori', 'Yamate-dori'] },
            skyline: (d) => d < 0.3 ? [50, 130] : d < 0.65 ? [18, 50] : [8, 20],
            palette: [0xd8d2c6, 0xc9c4ba, 0x9aa3ad, 0xe4e0d8, 0x7f8792],
            landmarks: [tokyoTower, shibuyaScreens], exitNumber: 1
        },
        {
            id: 'sf', name: 'San Francisco', sub: 'Downtown', rows: 6, cols: 6, block: 56, street: 18,
            hills: (lx, lz) => 4.5 * Math.sin(lx / 80) * Math.cos(lz / 65) + 2 * Math.sin((lx + lz) / 50),
            streets: { ns: ['Van Ness Ave', 'Polk St', 'Powell St', 'Grant Ave', 'Kearny St', 'Montgomery St', 'Embarcadero'],
                       ew: ['Market St', 'Mission St', 'Geary St', 'Lombard St', 'Bush St', 'California St', 'Broadway'] },
            skyline: (d) => d < 0.3 ? [60, 150] : d < 0.6 ? [15, 40] : [8, 16],
            palette: [0xf2ead9, 0xe6d9c4, 0xd9c8b4, 0xbfc9d6, 0xf7f3ea],
            landmarks: [transamerica, goldenGate], extraRoads: goldenGateRoad, shape: sfBay, satellite: sausalito, exitNumber: 12, parks: [[1, 4], [4, 1]]
        },
        {
            id: 'oakland', name: 'Oakland', sub: 'Jack London Square', rows: 5, cols: 5, block: 60, street: 18,
            streets: { ns: ['Broadway', 'Telegraph Ave', 'Webster St', 'Harrison St', 'Franklin St', 'Lakeside Dr'],
                       ew: ['Grand Ave', '14th St', '12th St', 'MacArthur Blvd', 'Embarcadero West', 'Lake Merritt Blvd'] },
            skyline: (d) => d < 0.3 ? [30, 90] : d < 0.6 ? [12, 30] : [7, 14],
            palette: [0xc8b89a, 0xb0a08a, 0xa8b4bc, 0xd4c7b0, 0x8c8c8c],
            landmarks: [oaklandCranes], exitNumber: 19, parks: [[2, 2]]
        },
        {
            id: 'sacramento', name: 'Sacramento', sub: 'State Capital', rows: 5, cols: 6, block: 60, street: 18,
            streets: { ns: ['Capitol Mall', '10th St', '12th St', '15th St', 'J St', 'K St', 'L St'],
                       ew: ['Capitol Ave', 'N St', 'P St', 'Broadway', 'Front St', 'Tower Bridge Gateway'] },
            skyline: (d) => d < 0.25 ? [25, 70] : d < 0.6 ? [10, 25] : [6, 12],
            palette: [0xe7dcc8, 0xd8ccb4, 0xf0e8d8, 0xbcc4c8, 0xc9a97e],
            landmarks: [capitol], exitNumber: 31, parks: [[2, 1], [3, 1]]
        },
        {
            id: 'reno', name: 'Reno', sub: 'The Biggest Little City', rows: 4, cols: 5, block: 60, street: 18,
            streets: { ns: ['Virginia St', 'Sierra St', 'Center St', 'Lake St', 'Arlington Ave', 'Wells Ave'],
                       ew: ['Commercial Row', '2nd St', '4th St', 'Plumb Ln', 'Mill St'] },
            skyline: (d) => d < 0.3 ? [25, 80] : [6, 18],
            palette: [0xd9c6a5, 0xc7b08c, 0xe8dcc0, 0x9ea8b0, 0xb08a5a],
            landmarks: [renoArch], exitNumber: 44
        },
        {
            id: 'vegas', name: 'Las Vegas', sub: 'The Strip', rows: 6, cols: 4, block: 64, street: 20,
            streets: { ns: ['Las Vegas Blvd', 'Koval Ln', 'Paradise Rd', 'Frank Sinatra Dr', 'Industrial Rd'],
                       ew: ['Flamingo Rd', 'Tropicana Ave', 'Sahara Ave', 'Spring Mountain Rd', 'Harmon Ave', 'Desert Inn Rd', 'Russell Rd'] },
            skyline: (d) => d < 0.35 ? [60, 140] : [8, 24],
            palette: [0xf3e2c0, 0xe8c99a, 0xd6b17e, 0x9bb0c4, 0xf7f0e2],
            landmarks: [vegasStrip], exitNumber: 58
        },
        {
            id: 'nyc', name: 'New York', sub: 'Midtown Manhattan', rows: 7, cols: 6, block: 54, street: 18,
            streets: { ns: ['5th Ave', '6th Ave', '7th Ave', 'Broadway', 'Madison Ave', 'Park Ave', 'Lexington Ave'],
                       ew: ['34th St', '38th St', '42nd St', '46th St', '50th St', '54th St', '57th St', '59th St'] },
            skyline: (d) => d < 0.5 ? [70, 190] : [30, 70],
            palette: [0xb7aa96, 0x9c9388, 0x7d8690, 0xc9c1b4, 0x6f7a86],
            landmarks: [empireState, chrysler], exitNumber: 73
        },
        // ---- I-15 loop (branches off I-80 near Reno, rejoins before Las Vegas) ----
        {
            id: 'slc', name: 'Salt Lake City', sub: 'Temple Square', fw: 1, rows: 5, cols: 5, block: 64, street: 20,
            streets: { ns: ['State St', 'Main St', 'West Temple', '200 East', '300 East', '400 East'],
                       ew: ['South Temple', '100 South', '200 South', '300 South', '400 South', 'North Temple'] },
            skyline: (d) => d < 0.3 ? [30, 90] : [8, 22],
            palette: [0xe9e2d2, 0xd8cdb6, 0xc9c0b0, 0xaab4bd, 0xf2eee6],
            landmarks: [slcTemple], exitNumber: 301, parks: [[2, 2]]
        },
        {
            id: 'denver', name: 'Denver', sub: 'LoDo', fw: 1, rows: 5, cols: 6, block: 60, street: 18,
            streets: { ns: ['Broadway', 'Lincoln St', 'Speer Blvd', 'Colfax Ave', 'Larimer St', 'Blake St', 'Wazee St'],
                       ew: ['16th St Mall', '17th St', '18th St', '20th St', 'Market St', 'Champa St'] },
            skyline: (d) => d < 0.3 ? [40, 120] : d < 0.6 ? [12, 36] : [7, 14],
            palette: [0xc9b79c, 0xb59e7e, 0x9fb3c8, 0xd9d2c5, 0x8f8a80],
            landmarks: [denverCashRegister], exitNumber: 312, parks: [[1, 3]]
        },
        {
            id: 'chicago', name: 'Chicago', sub: 'The Loop', fw: 1, rows: 6, cols: 6, block: 56, street: 18,
            streets: { ns: ['Michigan Ave', 'State St', 'Wabash Ave', 'Dearborn St', 'Clark St', 'LaSalle St', 'Wacker Dr'],
                       ew: ['Randolph St', 'Washington St', 'Madison St', 'Monroe St', 'Adams St', 'Jackson Blvd', 'Van Buren St'] },
            skyline: (d) => d < 0.45 ? [70, 200] : [25, 60],
            palette: [0x8a8f96, 0x6f7681, 0xb4aa9a, 0xcfc6b8, 0x5f6670],
            landmarks: [willisTower, cloudGate], exitNumber: 328
        }
    ];
})();
