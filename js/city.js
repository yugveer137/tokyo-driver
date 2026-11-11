// tokyo-driver1 v2 — city generator.
// A city is a rotated grid of streets draped on the terrain, blocks with sidewalks and
// buildings (height from the city's skyline function), intersections with crosswalks and
// traffic lights, street-name blades, street lamps, and the city's landmark builders.
// City.define(spec) registers the terrain plateau right away; City.load/unload stream it.
window.City = (function () {
    const C = { all: [], nightMats: [], lights: [] };
    let scene, world;
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    C.init = function (sc, w) { scene = sc; world = w; buildTextures(); };

    // ---------- textures ----------
    let windowSets = [], patchTex, lampMat, poleMat, glassMat;
    function buildTextures() {
        // 4 window layouts: a facade map (concrete with dark glass) + an emissive map (lit panes)
        for (let v = 0; v < 4; v++) {
            const size = 256, cols = 4, rows = 2;          // one tile = 8 units wide x 7 units tall
            const base = document.createElement('canvas'); base.width = base.height = size;
            const lit = document.createElement('canvas'); lit.width = lit.height = size;
            const b = base.getContext('2d'), l = lit.getContext('2d');
            b.drawImage(Tex.facade.image, 0, 0, size, size);
            l.fillStyle = '#000'; l.fillRect(0, 0, size, size);
            const ww = size / cols, wh = size / rows;
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const x = c * ww + ww * 0.18, y = r * wh + wh * 0.2, w = ww * 0.64, h = wh * 0.55;
                b.fillStyle = `rgba(${20 + Math.random() * 20 | 0},${30 + Math.random() * 20 | 0},${50 + Math.random() * 25 | 0},0.92)`;
                b.fillRect(x, y, w, h);
                b.fillStyle = 'rgba(255,255,255,0.12)'; b.fillRect(x, y, w, h * 0.3);
                const on = Math.random() < 0.55;
                if (on) {
                    const warm = Math.random() < 0.75;
                    l.fillStyle = warm ? `rgb(${230 + Math.random() * 25 | 0},${190 + Math.random() * 40 | 0},${110 + Math.random() * 60 | 0})`
                                       : `rgb(${150 + Math.random() * 40 | 0},${200 + Math.random() * 40 | 0},255)`;
                    l.fillRect(x, y, w, h);
                }
            }
            const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
            windowSets.push({ map: mk(base), emissive: mk(lit) });
        }
        // Intersection patch: asphalt with four crosswalks and stop lines
        patchTex = Tex.textCanvas(512, 512, (ctx, W, H) => {
            const img = ctx.createImageData(W, H), d = img.data;
            for (let i = 0; i < d.length; i += 4) { const v = 62 + (Math.random() - 0.5) * 34; d[i] = v; d[i + 1] = v; d[i + 2] = v + 3; d[i + 3] = 255; }
            ctx.putImageData(img, 0, 0);
            ctx.fillStyle = '#e8e8e8';
            const band = 54, stripe = 14, gap = 12;
            for (let x = 40; x < W - 40; x += stripe + gap) { ctx.fillRect(x, 8, stripe, band); ctx.fillRect(x, H - 8 - band, stripe, band); }
            for (let y = 40; y < H - 40; y += stripe + gap) { ctx.fillRect(8, y, band, stripe); ctx.fillRect(W - 8 - band, y, band, stripe); }
            ctx.fillRect(0, band + 14, W, 6); ctx.fillRect(0, H - band - 20, W, 6);
            ctx.fillRect(band + 14, 0, 6, H); ctx.fillRect(W - band - 20, 0, 6, H);
        });
        patchTex.anisotropy = 4;
        lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe6a0, emissiveIntensity: 0 });
        C.nightMats.push(lampMat);
        poleMat = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.5, metalness: 0.7 });
        glassMat = new THREE.MeshStandardMaterial({ color: 0x6a8fb0, roughness: 0.25, metalness: 0.5 });
    }

    // ---------- definition ----------
    // spec: { id, name, center: {x, z}, heading, rows, cols, block, street, base, hills(lx,lz)->dh,
    //         streets: { ns: [...names], ew: [...names] }, skyline(dNorm)->[minH, maxH], palette: [hex],
    //         landmarks: [fn(city)], collector: { lateral } }
    C.define = function (spec) {
        const city = Object.assign({ rows: 5, cols: 5, block: 60, street: 18, heading: 0, palette: [0x9a9a9a], landmarks: [] }, spec);
        city.pitch = city.block + city.street;
        // `suburb` columns of small houses sit on the far side of downtown (local -x, away from
        // the freeway): the grid grows by that many columns and downtown keeps the others
        city.suburbCols = spec.suburb || 0; city.cols = (spec.cols || 5) + city.suburbCols;
        city.W = city.cols * city.pitch; city.D = city.rows * city.pitch;   // grid extents (local x, z)
        city.streetX = (j) => -city.W / 2 + j * city.pitch;       // local x of NS street j (0..cols)
        city.streetZ = (i) => -city.D / 2 + i * city.pitch;       // local z of EW street i (0..rows)
        // where landmarks go: the centre of downtown's middle block (with an even street count
        // the middle is an intersection, so step back half a block)
        const dc = city.cols - city.suburbCols, dtX = (city.streetX(city.suburbCols) + city.W / 2) / 2;
        city.downtown = { lx: dtX, lz: 0 };
        city.lmX = dtX + (dc % 2 === 0 ? -city.pitch / 2 : 0); city.lmZ = city.rows % 2 === 0 ? -city.pitch / 2 : 0;
        city.parks = (spec.parks || []).map(p => [p[0] + city.suburbCols, p[1]]);   // park blocks are given in downtown columns
        city.radius = Math.hypot(city.W, city.D) / 2;
        city.loaded = false; city.meshes = []; city.bodies = []; city.roads = []; city.signs = []; city.mats = []; city.houses = [];
        const cosH = Math.cos(city.heading), sinH = Math.sin(city.heading);
        city.toWorld = (lx, lz) => new THREE.Vector3(city.center.x + lx * cosH + lz * sinH, 0, city.center.z - lx * sinH + lz * cosH);
        city.toLocal = (x, z) => { const dx = x - city.center.x, dz = z - city.center.z; return { lx: dx * cosH - dz * sinH, lz: dx * sinH + dz * cosH }; };
        // terrain: flatten to the plateau (plus the city's own hills), blended over 120 units outside
        Terrain.shapers.push((x, z, h) => {
            const l = city.toLocal(x, z);
            const ox = Math.max(0, Math.abs(l.lx) - city.W / 2 - 40), oz = Math.max(0, Math.abs(l.lz) - city.D / 2 - 40);
            const out = Math.hypot(ox, oz);
            if (out > 120) return h;
            const inside = city.base + (city.hills ? city.hills(l.lx, l.lz) : 0);
            const k = smooth(0, 120, out);
            return inside * (1 - k) + h * k;
        });
        C.all.push(city);
        return city;
    };

    // ---------- building ----------
    function addMesh(city, m, shadow) { m.castShadow = !!shadow; m.receiveShadow = true; scene.add(m); city.meshes.push(m); return m; }
    function addBox(city, w, h, d, x, y, z, yaw) {
        const body = new CANNON.Body({ mass: 0 });
        body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
        body.position.set(x, y, z);
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw || 0);
        world.addBody(body); city.bodies.push(body);
        return body;
    }
    C.addBox = addBox;                                                       // (world.js uses it for the police station)
    const groundAt = (city, lx, lz) => { const p = city.toWorld(lx, lz); return Terrain.height(p.x, p.z); };

    function buildStreets(city) {
        const ns = city.streets.ns, ew = city.streets.ew, half = city.street / 2;
        // street segments between intersections (so the ribbons never overlap at crossings)
        for (let j = 0; j <= city.cols; j++) {
            const type = (j % 3 === 0) ? 'avenue' : 'street';
            for (let i = 0; i < city.rows; i++) {
                const a = city.toWorld(city.streetX(j), city.streetZ(i) + half), b = city.toWorld(city.streetX(j), city.streetZ(i + 1) - half);
                const mid = city.toWorld(city.streetX(j), (city.streetZ(i) + city.streetZ(i + 1)) / 2);
                const r = Road.build({ type, name: ns[j % ns.length], conform: true, points: [[a.x, 0, a.z], [mid.x, 0, mid.z], [b.x, 0, b.z]] });
                r.meta = { city, axis: 'ns', startNode: [i, j], endNode: [i + 1, j] };
                city.roads.push(r);
            }
        }
        for (let i = 0; i <= city.rows; i++) {
            const type = (i % 2 === 0) ? 'avenue' : 'street';
            for (let j = 0; j < city.cols; j++) {
                const a = city.toWorld(city.streetX(j) + half, city.streetZ(i)), b = city.toWorld(city.streetX(j + 1) - half, city.streetZ(i));
                const mid = city.toWorld((city.streetX(j) + city.streetX(j + 1)) / 2, city.streetZ(i));
                const r = Road.build({ type, name: ew[i % ew.length], conform: true, points: [[a.x, 0, a.z], [mid.x, 0, mid.z], [b.x, 0, b.z]] });
                r.meta = { city, axis: 'ew', startNode: [i, j], endNode: [i, j + 1] };
                city.roads.push(r);
            }
        }
        city.lightMap = {};
        city.lightAt = (i, j) => city.lightMap[i + ',' + j];
        // intersections: crosswalk patch, traffic lights, street blades, lamps
        const patchMat = new THREE.MeshStandardMaterial({ map: patchTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
        for (let i = 0; i <= city.rows; i++) for (let j = 0; j <= city.cols; j++) {
            const c = city.toWorld(city.streetX(j), city.streetZ(i));
            city.meshes.push(Road.drapedQuad(c.x, c.z, city.street, city.heading, patchMat, Road.DRAPE + 0.01, 3));
            buildTrafficLight(city, j, i);
            const corner = city.toWorld(city.streetX(j) + half + 1.2, city.streetZ(i) + half + 1.2);
            corner.y = Terrain.height(corner.x, corner.z) + 0.3;
            city.signs.push(Signs.streetBlade(corner, city.heading, ns[j % ns.length]));
            const b2 = Signs.streetBlade(corner.clone().setY(corner.y - 0.6), city.heading + Math.PI / 2, ew[i % ew.length]);
            city.signs.push(b2);
        }
    }

    function buildTrafficLight(city, j, i) {
        // two mast arms per intersection: one facing NS traffic, one facing EW traffic
        const half = city.street / 2;
        const heads = { ns: [], ew: [] };
        const armGeom = new THREE.CylinderGeometry(0.07, 0.07, 1, 6), poleGeom = new THREE.CylinderGeometry(0.12, 0.14, 1, 8);
        const headGeom = new THREE.BoxGeometry(0.5, 1.4, 0.4), lensGeom = new THREE.CircleGeometry(0.16, 10);
        [[-half - 1.2, -half - 1.2, 0, 'ns'], [half + 1.2, half + 1.2, Math.PI, 'ns'], [half + 1.2, -half - 1.2, Math.PI / 2, 'ew'], [-half - 1.2, half + 1.2, -Math.PI / 2, 'ew']].forEach(([lx, lz, rot, axis], k) => {
            if (k === 1 || k === 3) return;   // one head per direction keeps it cheap
            const base = city.toWorld(city.streetX(j) + lx, city.streetZ(i) + lz);
            const gy = Terrain.height(base.x, base.z);
            const g = new THREE.Group();
            const pole = new THREE.Mesh(poleGeom, poleMat); pole.scale.y = 6; pole.position.y = 3; g.add(pole);
            const arm = new THREE.Mesh(armGeom, poleMat); arm.scale.y = 7; arm.rotation.z = Math.PI / 2; arm.position.set(3.5, 5.8, 0); g.add(arm);
            const head = new THREE.Mesh(headGeom, new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); head.position.set(6.3, 5.0, 0); g.add(head);
            const lenses = [0xff2020, 0xffb000, 0x20ff40].map((col, n) => {
                const m = new THREE.MeshStandardMaterial({ color: 0x202020, emissive: col, emissiveIntensity: 0 });
                const lens = new THREE.Mesh(lensGeom, m); lens.position.set(6.3, 5.5 - n * 0.45, 0.21); g.add(lens);
                return m;
            });
            heads[axis].push(lenses);
            g.position.set(base.x, gy, base.z);
            g.rotation.y = city.heading + rot;
            scene.add(g); city.meshes.push(g);
        });
        const L = { city, heads, phase: ((i + j) % 2) * 4, nsGreen: true, ewGreen: false };
        C.lights.push(L);
        city.lightMap[i + ',' + j] = L;
    }

    function buildBlocks(city) {
        const half = city.street / 2, B = city.block;
        const walkMat = new THREE.MeshStandardMaterial({ color: 0xb5b5b0, map: Tex.concrete, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        const parkMat = new THREE.MeshStandardMaterial({ color: 0x4f8a3a, map: Tex.grass, roughness: 1 });
        const downtown = city.downtown || { lx: 0, lz: 0 };
        for (let i = 0; i < city.rows; i++) for (let j = 0; j < city.cols; j++) {
            const cx = (city.streetX(j) + city.streetX(j + 1)) / 2, cz = (city.streetZ(i) + city.streetZ(i + 1)) / 2;
            const c = city.toWorld(cx, cz);
            if (j < city.suburbCols) {
                // a suburb block: lawns, with a sidewalk along each of the two streets the houses face
                const lawn = Road.drapedQuad(c.x, c.z, B, city.heading, parkMat, 0.3, 6);
                lawn.geometry.attributes.uv.array.forEach((v, k, arr) => arr[k] = v * B / 6);
                lawn.geometry.attributes.uv.needsUpdate = true;
                city.meshes.push(lawn);
                [-1, 1].forEach(side => { const e = city.toWorld(cx + side * (B / 2 - 1.3), cz); const walk = Road.drapedQuad(e.x, e.z, 2.6, city.heading, walkMat, 0.31, 2, B); city.meshes.push(walk); });
            } else {
                // sidewalk slab over the whole block (draped, raised a bit), curb strips around it
                const slab = Road.drapedQuad(c.x, c.z, B, city.heading, walkMat, 0.3, 6);
                slab.geometry.attributes.uv.array.forEach((v, k, arr) => arr[k] = v * B / 4);
                slab.geometry.attributes.uv.needsUpdate = true;
                city.meshes.push(slab);
            }
            const dNorm = Math.hypot(cx - downtown.lx, cz - downtown.lz) / city.radius;
            const isPark = city.parks && city.parks.some(p => p[0] === j && p[1] === i);
            if (isPark) {
                city.meshes.push(Road.drapedQuad(c.x, c.z, B - 8, city.heading, parkMat, 0.32, 4));
                buildTrees(city, cx, cz, B - 12, 10);
                continue;
            }
            if (j < city.suburbCols) { buildHouses(city, i, j, cx, cz, B); continue; }
            buildLots(city, cx, cz, B, dNorm);
        }
    }

    function buildLots(city, cx, cz, B, dNorm) {
        // 3x3 lots per block, 2.5-unit sidewalk margin; centre lot becomes a small plaza / parking
        const n = 3, lot = (B - 6) / n, margin = 3;
        const [minH, maxH] = city.skyline(dNorm);
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
            const lx = cx - B / 2 + margin + lot * (a + 0.5), lz = cz - B / 2 + margin + lot * (b + 0.5);
            if (a === 1 && b === 1 && Math.random() < 0.6) continue;         // courtyard gap
            const w = lot * rnd(0.6, 0.92), d = lot * rnd(0.6, 0.92);
            let h = rnd(minH, maxH);
            if (Math.random() < 0.08) h *= 1.5;                               // the odd standout tower
            buildBuilding(city, lx, lz, w, h, d, dNorm);
        }
    }

    function buildBuilding(city, lx, lz, w, h, d, dNorm) {
        const p = city.toWorld(lx, lz);
        const ground = Terrain.height(p.x, p.z) + 0.3;
        const tall = h > 45;
        const set = pick(windowSets);
        const mat = new THREE.MeshStandardMaterial({
            color: tall && Math.random() < 0.5 ? 0x6a8fb0 : pick(city.palette),
            map: set.map, emissiveMap: set.emissive, emissive: 0xffffff, emissiveIntensity: 0,
            roughness: tall ? 0.45 : 0.8, metalness: tall ? 0.35 : 0.05
        });
        C.nightMats.push(mat); city.mats.push(mat);
        const found = 3;                                                     // sunk foundation hides slopes
        const geom = Tex.scaleBoxUVs(new THREE.BoxGeometry(w, h + found, d), w, h + found, d, 8);
        // windows: 7-unit floors -> v repeat uses height/7 instead of /8
        const uv = geom.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * 8 / 7);
        const m = new THREE.Mesh(geom, mat);
        m.position.set(p.x, ground + (h - found) / 2, p.z);
        m.rotation.y = city.heading;
        addMesh(city, m, true);
        addBox(city, w, h, d, p.x, ground + h / 2, p.z, city.heading);
        // roof clutter / spire
        if (tall) {
            const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, h * 0.12, 6), poleMat);
            spire.position.set(p.x, ground + h + h * 0.06, p.z); addMesh(city, spire, true);
        } else if (Math.random() < 0.5) {
            const ac = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 1.2, d * 0.3), new THREE.MeshStandardMaterial({ color: 0x8a8f94 }));
            ac.position.set(p.x + (Math.random() - 0.5) * w * 0.4, ground + h + 0.6, p.z + (Math.random() - 0.5) * d * 0.4);
            ac.rotation.y = city.heading; addMesh(city, ac, true);
        }
    }

    // ---------- the suburb: small houses ----------
    // A residential block: a row of little houses along each of its two north-south streets,
    // each with a door onto the sidewalk, lit windows at night and a tree in the back garden.
    // Every house is listed in city.houses with its address, for the robbery mode.
    const HOUSE_COLORS = [0xd9c9a6, 0xc9b490, 0xa9bdc9, 0xd4b4a4, 0xb7c6a4, 0xdcd3bd, 0xc4ae9c, 0x9fb0bd, 0xd8b8a0, 0xb5a98f];
    const ROOF_COLORS = [0x5a3d2e, 0x3c3c44, 0x6a4a3a, 0x334050, 0x4c3a32];
    let houseWindowMat = null, houseDoorMat = null, houseTrimMat = null, housePathMat = null, houseChimneyMat = null;
    // Where house k on `side` of block (i, j) stands, with its address: the same maths whether
    // or not the city is built, so the robbery can pick houses in a city that is not loaded yet.
    C.housesPerBlock = (city) => Math.max(2, Math.floor(city.block / 14));
    C.housePlan = function (city, i, j, side, k) {
        const B = city.block, n = C.housesPerBlock(city), lot = B / n;
        const cx = (city.streetX(j) + city.streetX(j + 1)) / 2, cz = (city.streetZ(i) + city.streetZ(i + 1)) / 2;
        const lz = cz - B / 2 + lot * (k + 0.5), lx = cx + side * (B / 2 - 8);
        const w = Math.min(10, lot - 3), d = 7, h = 3.4;                         // w along the street, d toward the back
        const street = city.streets.ns, name = street[(side < 0 ? j : j + 1) % street.length];
        const no = 100 * (i + 1) + k * 2 + (side < 0 ? 1 : 2);                  // odd numbers one side, even the other
        const centre = city.toWorld(lx, lz), ground = Terrain.height(centre.x, centre.z) + 0.3;
        const door = city.toWorld(lx + side * (d / 2 + 1.6), lz - w / 4); door.y = ground;   // where you stand to go in
        return { city, i, j, side, k, lx, lz, facing: side, w, d, h, ground, centre, p: door, address: no + ' ' + name, key: city.id + ':' + i + ':' + j + ':' + side + ':' + k };
    };
    function buildHouses(city, i, j, cx, cz, B) {
        const n = C.housesPerBlock(city);
        [-1, 1].forEach(side => { for (let k = 0; k < n; k++) buildHouse(city, C.housePlan(city, i, j, side, k)); });   // -1 faces street j, +1 faces street j+1
        buildTrees(city, cx, cz, B - 30, 3);
    }
    function buildHouse(city, plan) {
        if (!houseWindowMat) {
            houseWindowMat = new THREE.MeshStandardMaterial({ color: 0x1c2a3c, emissive: 0xffe2a8, emissiveIntensity: 0, roughness: 0.3 });
            houseDoorMat = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.8 });
            C.nightMats.push(houseWindowMat);
        }
        const { w, d, h, facing, ground } = plan, p = plan.centre;
        const yaw = city.heading;
        const wall = new THREE.MeshStandardMaterial({ color: pick(HOUSE_COLORS), roughness: 0.9 });   // painted stucco
        city.mats.push(wall);
        if (!houseTrimMat) { houseTrimMat = new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.7 }); housePathMat = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 1 }); houseChimneyMat = new THREE.MeshStandardMaterial({ color: 0x8a5a48, roughness: 0.95 }); }
        const g = new THREE.Group(); g.position.set(p.x, ground, p.z); g.rotation.y = yaw;
        const put = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
        put(new THREE.BoxGeometry(d, h + 1, w), wall, 0, h / 2 - 0.5, 0);      // the house (local x = toward the street side)
        put(new THREE.BoxGeometry(d + 0.5, 0.18, w + 0.5), houseTrimMat, 0, h + 0.05, 0);   // the eaves
        const roof = put(new THREE.ConeGeometry(Math.hypot(d, w) / 2 + 0.6, 2.6, 4), new THREE.MeshStandardMaterial({ color: pick(ROOF_COLORS), roughness: 0.9 }), 0, h + 1.3, 0);
        roof.rotation.y = Math.PI / 4; roof.scale.set(d / Math.hypot(d, w) * 1.42, 1, w / Math.hypot(d, w) * 1.42);
        put(new THREE.BoxGeometry(0.7, 1.6, 0.7), houseChimneyMat, -facing * 1.2, h + 1.6, w / 2 - 1.4);   // chimney
        const fx = facing * (d / 2 + 0.03);                                      // the street-facing wall
        // door with its frame and a little porch roof, windows in white frames
        put(new THREE.BoxGeometry(0.1, 2.3, 1.25), houseTrimMat, fx, 1.15, -w / 4);
        put(new THREE.BoxGeometry(0.08, 2.1, 1.0), houseDoorMat, fx + facing * 0.03, 1.05, -w / 4);
        put(new THREE.BoxGeometry(1.1, 0.12, 1.8), houseTrimMat, fx + facing * 0.5, 2.4, -w / 4);
        const win = (x, y, z, wide, tall, alongZ) => { put(alongZ ? new THREE.BoxGeometry(0.1, tall + 0.24, wide + 0.24) : new THREE.BoxGeometry(wide + 0.24, tall + 0.24, 0.1), houseTrimMat, x, y, z); put(alongZ ? new THREE.BoxGeometry(0.08, tall, wide) : new THREE.BoxGeometry(wide, tall, 0.08), houseWindowMat, x + (alongZ ? Math.sign(x) * 0.03 : 0), y, z + (alongZ ? 0 : Math.sign(z) * 0.03)); };
        win(fx, 1.9, w / 4, 1.4, 1.0, true);                                     // front window
        win(-fx, 1.9, 0, 1.2, 1.0, true);                                        // back window
        [-1, 1].forEach(s => win(0, 1.9, s * (w / 2 + 0.03), 1.2, 1.0, false));  // side windows
        // a path from the door across the lawn to the sidewalk
        const pathLen = 8 - d / 2 - 1.3;
        put(new THREE.BoxGeometry(pathLen, 0.06, 1.3), housePathMat, fx + facing * pathLen / 2, 0.03, -w / 4);
        addMesh(city, g, true);
        addBox(city, d, h, w, p.x, ground + h / 2, p.z, yaw);
        plan.group = g;
        city.houses.push(plan);
    }

    // ---------- inside a house ----------
    // Built when you go in, dropped when you leave: walls, floor and ceiling you can't see
    // through, a bed with someone asleep in it, and a dresser with the valuables. Local x runs
    // from the back of the house to the street side (facing), z along the street.
    C.houseInterior = function (plan) {
        const { w, d, h, facing, ground, centre } = plan, city = plan.city;
        const g = new THREE.Group(); g.position.set(centre.x, ground, centre.z); g.rotation.y = city.heading;
        // the room is dim: the ceiling and walls throw the sun's shadow, so only the sky light and
        // the bedside lamp's glow reach the floor
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9bca6, emissive: 0x262019, roughness: 0.95, side: THREE.DoubleSide });
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, map: Tex.grain || null, emissive: 0x1a120c, roughness: 0.9 });
        const put = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
        put(new THREE.BoxGeometry(d - 0.3, 0.08, w - 0.3), floorMat, 0, 0.04, 0);                   // floor
        put(new THREE.BoxGeometry(d - 0.3, 0.08, w - 0.3), wallMat, 0, h - 0.1, 0);                 // ceiling
        [-1, 1].forEach(s => { put(new THREE.BoxGeometry(0.08, h, w - 0.3), wallMat, s * (d / 2 - 0.2), h / 2, 0); put(new THREE.BoxGeometry(d - 0.3, h, 0.08), wallMat, 0, h / 2, s * (w / 2 - 0.2)); });
        // a rug in the middle and a picture on the wall, so it feels like somebody's home
        put(new THREE.BoxGeometry(2.6, 0.03, 3.4), new THREE.MeshStandardMaterial({ color: 0x8a2f2f, roughness: 1 }), 0, 0.1, 0.4);
        put(new THREE.BoxGeometry(0.04, 0.8, 1.1), new THREE.MeshStandardMaterial({ color: 0x3b6b9a, emissive: 0x0d1a26, roughness: 0.6 }), -facing * (d / 2 - 0.27), 2.0, -w / 4);
        // the door, seen from inside, on the street wall
        const doorX = facing * (d / 2 - 0.22);
        put(new THREE.BoxGeometry(0.06, 2.1, 1.0), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, emissive: 0x1a100a, roughness: 0.8 }), doorX, 1.05, -w / 4);
        // bed against the back wall, someone asleep under the blanket, a lamp on the night table
        const bedX = -facing * (d / 2 - 1.4), bedZ = w / 4;
        put(new THREE.BoxGeometry(1.6, 0.45, 2.1), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }), bedX, 0.25, bedZ);
        put(new THREE.BoxGeometry(1.5, 0.12, 2.0), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }), bedX, 0.53, bedZ);
        put(new THREE.BoxGeometry(0.9, 0.14, 0.45), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), bedX, 0.66, bedZ - 0.75);   // pillow
        const sleeper = Peds.person({ shirt: 0x8fb8e8, pants: 0x8fb8e8 });
        sleeper.rotation.x = -Math.PI / 2; sleeper.position.set(bedX, 0.62, bedZ + 0.95);                  // lying with the head on the pillow
        sleeper.userData.legs[0].rotation.x = sleeper.userData.legs[1].rotation.x = 0.15; g.add(sleeper);
        put(new THREE.BoxGeometry(1.5, 0.22, 1.3), new THREE.MeshStandardMaterial({ color: 0x3a5a8a, roughness: 1 }), bedX, 0.7, bedZ + 0.2);   // blanket
        put(new THREE.BoxGeometry(0.5, 0.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.9 }), bedX, 0.3, bedZ - 1.35);  // night table
        put(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd080, emissiveIntensity: 0.9 }), bedX, 0.78, bedZ - 1.35);   // lamp
        const glow = new THREE.PointLight(0xffd9a0, 1.1, 9, 2); glow.position.set(bedX, 1.2, bedZ - 1.35); g.add(glow);                                   // its warm light
        // the side table against the far side wall: three drawers that pull out, with the
        // household's cash in some of them (which ones is fixed per house)
        const lootX = 0, tableZ = -w / 2 + 0.5;
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.85 });
        put(new THREE.BoxGeometry(1.3, 0.95, 0.55), woodMat, lootX, 0.475, tableZ);
        put(new THREE.BoxGeometry(1.4, 0.05, 0.62), new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.8 }), lootX, 0.97, tableZ);
        const lampTop = put(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd080, emissiveIntensity: 0.6 }), lootX + 0.45, 1.1, tableZ);
        let hash = 0; for (const ch of plan.key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
        const cashCount = 1 + (hash % 3), drawers = [];
        // which drawers hold cash: at least one always does, or the house could never be robbed
        const hasCash = [0, 1, 2].map(k => !!(((hash >> (k + 2)) & 1) || (k === 0 && cashCount === 1) || cashCount === 3));
        if (!hasCash.some(Boolean)) hasCash[0] = true;
        for (let k = 0; k < 3; k++) {
            const dm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 }));
            dm.position.set(lootX, 0.2 + k * 0.28, tableZ + 0.04); g.add(dm);
            const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshStandardMaterial({ color: 0xd8c070, metalness: 0.7, roughness: 0.3 })); knob.position.set(0, 0, 0.26); dm.add(knob);
            const cash = hasCash[k];
            let bundle = null;
            if (cash) { bundle = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: 0x3f9a4f, emissive: 0x1d5a26, emissiveIntensity: 0.5, roughness: 0.7 })); bundle.position.set(0, 0.08, -0.02); bundle.visible = false; dm.add(bundle); }
            drawers.push({ mesh: dm, bundle, cash: !!bundle, open: false, taken: false, closedZ: tableZ + 0.04 });
        }
        scene.add(g); g.updateMatrixWorld(true);
        const world = (x, z, y) => g.localToWorld(new THREE.Vector3(x, y || 0, z));
        return {
            group: g, sleeper, drawers, lamp: lampTop, awake: false, floorY: ground + 0.09,
            bed: world(bedX, bedZ), loot: world(lootX, tableZ + 0.75), doorIn: world(doorX - facing * 0.9, -w / 4), doorOut: plan.p.clone(),
            // pull a drawer out (the cash shows if there is any)
            openDrawer: (dr) => { dr.open = true; dr.mesh.position.z = dr.closedZ + 0.34; if (dr.bundle) dr.bundle.visible = true; },
            takeCash: (dr) => { dr.taken = true; if (dr.bundle) dr.bundle.visible = false; },
            // keep the walker inside the four walls
            clamp: (pos) => { const l = g.worldToLocal(pos.clone()); l.x = Math.max(-d / 2 + 0.55, Math.min(d / 2 - 0.55, l.x)); l.z = Math.max(-w / 2 + 0.55, Math.min(w / 2 - 0.55, l.z)); const o = g.localToWorld(l); pos.x = o.x; pos.z = o.z; },
            // the sleeper wakes: sits up on the edge of the bed
            wake: function () { if (this.awake) return; this.awake = true; sleeper.rotation.x = 0; sleeper.position.set(bedX + facing * 0.9, 0.0, bedZ); sleeper.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2; },
            remove: () => { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
        };
    };

    // ---------- the jail cell ----------
    // A small police station beside the frontage road with one cell inside: bunk, bars, and a
    // window you can jump out of. Same shape of object as a house interior (walk.js uses it).
    C.cellInterior = function (center, yaw) {
        const g = new THREE.Group(); g.position.copy(center); g.rotation.y = yaw;
        const grey = new THREE.MeshStandardMaterial({ color: 0x9a9da3, emissive: 0x1a1b1e, roughness: 0.95, side: THREE.DoubleSide });
        const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.9 });
        const put = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
        const W = 4.2, D = 3.4, H = 3.0;                                      // (the station building itself stands in world.js)
        // inside: floor, ceiling, walls
        put(new THREE.BoxGeometry(D, 0.08, W), dark, 0, 0.04, 0);
        put(new THREE.BoxGeometry(D, 0.08, W), grey, 0, H - 0.1, 0);
        [-1, 1].forEach(s => { put(new THREE.BoxGeometry(0.08, H, W), grey, s * (D / 2 - 0.2), H / 2, 0); put(new THREE.BoxGeometry(D, H, 0.08), grey, 0, H / 2, s * (W / 2 - 0.2)); });
        // bars across the front, a bunk, and the barred window in the back wall
        for (let z = -W / 2 + 0.6; z <= W / 2 - 0.6; z += 0.35) put(new THREE.CylinderGeometry(0.03, 0.03, H - 0.2, 6), dark, D / 2 - 0.5, H / 2, z);
        put(new THREE.BoxGeometry(0.9, 0.3, 2.0), new THREE.MeshStandardMaterial({ color: 0x6b6b70, roughness: 0.9 }), -D / 2 + 0.8, 0.5, 0.8);
        put(new THREE.BoxGeometry(0.8, 0.08, 1.9), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 1 }), -D / 2 + 0.8, 0.69, 0.8);
        const winZ = -W / 2 + 0.24;
        put(new THREE.BoxGeometry(1.2, 0.9, 0.06), new THREE.MeshStandardMaterial({ color: 0x9fc4ff, emissive: 0x6a90c0, emissiveIntensity: 0.6 }), 0.3, 2.0, winZ);
        for (let x = -0.3; x <= 0.9; x += 0.3) put(new THREE.BoxGeometry(0.04, 0.95, 0.1), dark, x, 2.0, winZ - 0.02);
        const tube = new THREE.PointLight(0xdfe8ff, 0.9, 8, 2); tube.position.set(0, H - 0.4, 0); g.add(tube);                                     // a cold strip light
        scene.add(g); g.updateMatrixWorld(true);
        const world = (x, z, y) => g.localToWorld(new THREE.Vector3(x, y || 0, z));
        return {
            group: g, floorY: center.y + 0.09, window: world(0.3, winZ + 0.6),
            doorIn: world(0, 0.4), doorOut: world(0.3, -W / 2 - 2.0, 0),
            clamp: (pos) => { const l = g.worldToLocal(pos.clone()); l.x = Math.max(-D / 2 + 0.55, Math.min(D / 2 - 0.9, l.x)); l.z = Math.max(-W / 2 + 0.55, Math.min(W / 2 - 0.55, l.z)); const o = g.localToWorld(l); pos.x = o.x; pos.z = o.z; },
            remove: () => { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
        };
    };

    // ---------- the cell block ----------
    // Where you wake up after an arrest: a cell with a barred door at the back of the station,
    // a hallway along the back wall, a corridor past the front desk (the night officer dozing
    // at it) to the exit door. SNEAK opens the cell; walking keeps him asleep, running does not.
    // Local x runs from the back (-) to the road (+), z along the road; the exit is at (+6, -6).
    C.cellBlockInterior = function (st) {
        const g = new THREE.Group(); g.position.copy(st.center); g.rotation.y = st.yaw;
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xa9adb5, emissive: 0x16181c, roughness: 0.95, side: THREE.DoubleSide });
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x4a4e55, emissive: 0x0e1012, roughness: 0.9 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.8 }), steel = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.6, roughness: 0.4 });
        const put = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
        const D = 12, W = 16, H = 3.6;
        put(new THREE.BoxGeometry(D - 0.3, 0.08, W - 0.3), floorMat, 0, 0.04, 0);
        put(new THREE.BoxGeometry(D - 0.3, 0.08, W - 0.3), wallMat, 0, H - 0.1, 0);
        [-1, 1].forEach(s => { put(new THREE.BoxGeometry(0.08, H, W - 0.3), wallMat, s * (D / 2 - 0.2), H / 2, 0); put(new THREE.BoxGeometry(D - 0.3, H, 0.08), wallMat, 0, H / 2, s * (W / 2 - 0.2)); });
        // the rooms you can be in, as rectangles [x0, x1, z0, z1]
        // (they overlap where you pass from one to the next: the bars' door gap, the hall's end)
        const CELL = [-5.6, -2.6, 2.6, 7.6], DOOR = [-3.6, -1.6, 4.4, 5.8], HALL = [-2.6, -0.6, -7.6, 7.6], CORR = [-2.6, 5.6, -7.6, -4.6], OFFICE = [-0.6, 5.6, -4.6, 7.6];
        // partition walls: cell/hall bars, hall/office wall, office/corridor wall with a window
        put(new THREE.BoxGeometry(0.08, H, OFFICE[3] - OFFICE[2]), wallMat, -0.6, H / 2, (OFFICE[2] + OFFICE[3]) / 2);             // hall | office
        put(new THREE.BoxGeometry(OFFICE[1] - OFFICE[0], H, 0.08), wallMat, (OFFICE[0] + OFFICE[1]) / 2, H / 2, -4.6);         // office | corridor
        put(new THREE.BoxGeometry(0.08, H, CELL[3] - CELL[2]), wallMat, -5.6, H / 2, (CELL[2] + CELL[3]) / 2);                  // cell back
        put(new THREE.BoxGeometry(CELL[1] - CELL[0], H, 0.08), wallMat, (CELL[0] + CELL[1]) / 2, H / 2, 2.6);                   // cell side
        const bars = [];
        for (let z = CELL[2] + 0.3; z <= CELL[3] - 0.3; z += 0.3) { const isDoor = z > 4.4 && z < 5.8; const b = put(new THREE.CylinderGeometry(0.03, 0.03, H - 0.2, 6), dark, -2.6, H / 2, z); if (isDoor) bars.push(b); }
        put(new THREE.BoxGeometry(0.06, 0.08, CELL[3] - CELL[2]), dark, -2.6, H - 0.3, (CELL[2] + CELL[3]) / 2);
        // the cell: bunk, bars, a barred window high in the back wall
        put(new THREE.BoxGeometry(0.9, 0.3, 2.0), new THREE.MeshStandardMaterial({ color: 0x6b6b70, roughness: 0.9 }), -4.9, 0.5, 6.3);
        put(new THREE.BoxGeometry(0.8, 0.08, 1.9), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 1 }), -4.9, 0.69, 6.3);
        put(new THREE.BoxGeometry(0.06, 0.8, 1.1), new THREE.MeshStandardMaterial({ color: 0x9fc4ff, emissive: 0x6a90c0, emissiveIntensity: 0.6 }), -5.56, 2.3, 4.2);
        // the front desk with the night officer dozing at it, a lamp, the notice board
        const deskX = 2.4, deskZ = -3.6;
        put(new THREE.BoxGeometry(2.6, 0.9, 1.0), dark, deskX, 0.45, deskZ);
        put(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd080, emissiveIntensity: 0.9 }), deskX - 1.0, 1.15, deskZ);
        const glow = new THREE.PointLight(0xffe0b0, 0.8, 9, 2); glow.position.set(deskX, 2.0, deskZ); g.add(glow);
        const sleeper = Peds.person({ shirt: 0x1d3f8f, pants: 0x14172a, hair: 0x111111 });
        sleeper.position.set(deskX, 0, deskZ - 0.9); sleeper.rotation.y = Math.PI; sleeper.rotation.x = 0.55;   // slumped forward over the desk
        sleeper.userData.arms[0].rotation.x = sleeper.userData.arms[1].rotation.x = -1.4; g.add(sleeper);
        put(new THREE.BoxGeometry(1.6, 1.0, 0.04), new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 1 }), deskX, 2.2, -4.56);
        // strip lights down the hallway and the corridor
        [[-1.6, 4], [-1.6, -4], [2.5, -6.1]].forEach(([x, z]) => { put(new THREE.BoxGeometry(0.2, 0.05, 1.6), new THREE.MeshStandardMaterial({ color: 0xdfe8ff, emissive: 0xc0d0ff, emissiveIntensity: 0.9 }), x, H - 0.2, z); });
        const tube = new THREE.PointLight(0xdfe8ff, 0.7, 12, 2); tube.position.set(-1.6, H - 0.5, 0); g.add(tube);
        // the exit door at the front-left corner, seen from inside
        put(new THREE.BoxGeometry(0.06, 2.2, 1.1), new THREE.MeshStandardMaterial({ color: 0x1b2a44, roughness: 0.6 }), D / 2 - 0.22, 1.1, -6);
        scene.add(g); g.updateMatrixWorld(true);
        const world = (x, z, y) => g.localToWorld(new THREE.Vector3(x, y || 0, z));
        let open = false;
        const rects = () => open ? [CELL, DOOR, HALL, CORR] : [CELL];
        return {
            group: g, sleeper, awake: false, floorY: st.center.y + 0.09, jail: true, cellBlock: true,
            cell: world(-4.2, 4.5), bed: world(deskX, deskZ - 0.9), doorIn: world(D / 2 - 1.1, -6), doorOut: st.door.clone(),
            get open() { return open; },
            // SNEAK: the cell door's bars slide up out of the way
            openCell: () => { open = true; bars.forEach(b => { b.position.y = H + 1.4; }); },
            closeCell: () => { open = false; bars.forEach(b => { b.position.y = H / 2; }); },
            // keep the walker inside the rooms that are open to them
            clamp: (pos) => {
                const l = g.worldToLocal(pos.clone()); let best = null, bd = Infinity;
                rects().forEach(r => { const cx = Math.max(r[0] + 0.3, Math.min(r[1] - 0.3, l.x)), cz = Math.max(r[2] + 0.3, Math.min(r[3] - 0.3, l.z)); const d = Math.hypot(cx - l.x, cz - l.z); if (d < bd) { bd = d; best = [cx, cz]; } });
                const o = g.localToWorld(new THREE.Vector3(best[0], 0, best[1])); pos.x = o.x; pos.z = o.z;
            },
            wake: function () { if (this.awake) return; this.awake = true; sleeper.rotation.x = 0; sleeper.position.set(deskX - 1.9, 0, deskZ); sleeper.rotation.y = -Math.PI / 2; },
            sleep: function () { this.awake = false; sleeper.rotation.x = 0.55; sleeper.position.set(deskX, 0, deskZ - 0.9); sleeper.rotation.y = Math.PI; },
            remove: () => { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
        };
    };

    // ---------- inside the police station ----------
    // The evidence room at night: a desk, the night officer asleep on the cot in the corner,
    // and the evidence locker with the confiscated cash in its drawers. Same shape of object
    // as a house interior, so the sneaking and the drawers work the same way.
    C.stationInterior = function (st) {
        const g = new THREE.Group(); g.position.copy(st.center); g.rotation.y = st.yaw;
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xaab0b8, emissive: 0x1a1d22, roughness: 0.95, side: THREE.DoubleSide });
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x4a4e55, emissive: 0x0e1012, roughness: 0.9 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.8 }), steel = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.6, roughness: 0.4 });
        const put = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
        const D = 8.2, W = 9.4, H = 3.8, facing = 1;                          // x toward the road (the door), z along it
        put(new THREE.BoxGeometry(D - 0.3, 0.08, W - 0.3), floorMat, 0, 0.04, 0);
        put(new THREE.BoxGeometry(D - 0.3, 0.08, W - 0.3), wallMat, 0, H - 0.1, 0);
        [-1, 1].forEach(s => { put(new THREE.BoxGeometry(0.08, H, W - 0.3), wallMat, s * (D / 2 - 0.2), H / 2, 0); put(new THREE.BoxGeometry(D - 0.3, H, 0.08), wallMat, 0, H / 2, s * (W / 2 - 0.2)); });
        const doorX = D / 2 - 0.22;
        put(new THREE.BoxGeometry(0.06, 2.2, 1.1), new THREE.MeshStandardMaterial({ color: 0x1b2a44, roughness: 0.6 }), doorX, 1.1, 0);
        // the front desk with a lamp, the notice board, the cell bars along the back
        put(new THREE.BoxGeometry(1.0, 0.9, 3.0), dark, 1.6, 0.45, 2.2);
        put(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd080, emissiveIntensity: 0.9 }), 1.6, 1.15, 1.2);
        const glow = new THREE.PointLight(0xffe0b0, 0.9, 10, 2); glow.position.set(1.6, 1.8, 1.2); g.add(glow);
        put(new THREE.BoxGeometry(0.04, 1.0, 1.6), new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 1 }), doorX - 0.02, 2.2, 2.6);
        for (let z = -W / 2 + 0.8; z <= -1.2; z += 0.35) put(new THREE.CylinderGeometry(0.03, 0.03, H - 0.2, 6), dark, -1.0, H / 2, z);
        // the night officer asleep on the cot in the far corner
        const bedX = -D / 2 + 1.3, bedZ = W / 2 - 1.6;
        put(new THREE.BoxGeometry(1.0, 0.4, 2.1), steel, bedX, 0.2, bedZ);
        put(new THREE.BoxGeometry(0.9, 0.1, 2.0), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 1 }), bedX, 0.46, bedZ);
        const sleeper = Peds.person({ shirt: 0x1d3f8f, pants: 0x14172a, hair: 0x111111 });
        sleeper.rotation.x = -Math.PI / 2; sleeper.position.set(bedX, 0.55, bedZ + 0.95); g.add(sleeper);
        put(new THREE.BoxGeometry(0.95, 0.2, 1.3), new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 1 }), bedX, 0.62, bedZ + 0.2);
        // the evidence locker: a steel cabinet, three drawers, the confiscated cash in two of them
        const lootX = 0.4, tableZ = -W / 2 + 0.55;
        put(new THREE.BoxGeometry(1.4, 1.6, 0.6), steel, lootX, 0.8, tableZ);
        put(new THREE.BoxGeometry(0.5, 0.18, 0.04), new THREE.MeshStandardMaterial({ color: 0xffd21e }), lootX, 1.7, tableZ + 0.31);   // "EVIDENCE" tag
        const drawers = [];
        for (let k = 0; k < 3; k++) {
            const dm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.55), new THREE.MeshStandardMaterial({ color: 0x737a84, metalness: 0.5, roughness: 0.5 }));
            dm.position.set(lootX, 0.3 + k * 0.48, tableZ + 0.04); g.add(dm);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.05), dark); handle.position.set(0, 0, 0.29); dm.add(handle);
            let bundle = null;
            if (k < 2) { bundle = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.26), new THREE.MeshStandardMaterial({ color: 0x3f9a4f, emissive: 0x1d5a26, emissiveIntensity: 0.5, roughness: 0.7 })); bundle.position.set(0, 0.1, -0.02); bundle.visible = false; dm.add(bundle); }
            drawers.push({ mesh: dm, bundle, cash: !!bundle, open: false, taken: false, closedZ: tableZ + 0.04 });
        }
        scene.add(g); g.updateMatrixWorld(true);
        const world = (x, z, y) => g.localToWorld(new THREE.Vector3(x, y || 0, z));
        return {
            group: g, sleeper, drawers, lamp: g.children.find(o => o.geometry && o.geometry.type === 'SphereGeometry'), awake: false, floorY: st.center.y + 0.09, station: true,
            bed: world(bedX, bedZ), loot: world(lootX, tableZ + 0.8), doorIn: world(doorX - 0.9, 0), doorOut: st.door.clone(),
            openDrawer: (dr) => { dr.open = true; dr.mesh.position.z = dr.closedZ + 0.36; if (dr.bundle) dr.bundle.visible = true; },
            takeCash: (dr) => { dr.taken = true; if (dr.bundle) dr.bundle.visible = false; },
            clamp: (pos) => { const l = g.worldToLocal(pos.clone()); l.x = Math.max(-D / 2 + 0.55, Math.min(D / 2 - 0.55, l.x)); l.z = Math.max(-W / 2 + 0.55, Math.min(W / 2 - 0.55, l.z)); const o = g.localToWorld(l); pos.x = o.x; pos.z = o.z; },
            wake: function () { if (this.awake) return; this.awake = true; sleeper.rotation.x = 0; sleeper.position.set(bedX + 0.9, 0, bedZ); sleeper.rotation.y = Math.PI / 2; },
            remove: () => { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
        };
    };

    function buildTrees(city, cx, cz, span, count) {
        const trunk = new THREE.MeshStandardMaterial({ color: 0x5b3f2a, roughness: 1 });
        const leaf = new THREE.MeshStandardMaterial({ color: 0x2f7a2f, roughness: 1 });
        for (let k = 0; k < count; k++) {
            const lx = cx + (Math.random() - 0.5) * span, lz = cz + (Math.random() - 0.5) * span;
            const p = city.toWorld(lx, lz); const g = Terrain.height(p.x, p.z) + 0.3;
            const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), trunk); t.position.set(p.x, g + 1.5, p.z); addMesh(city, t, false);
            const s = rnd(2, 3.5);
            const l = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), leaf); l.position.set(p.x, g + 3 + s * 0.7, p.z); addMesh(city, l, false);
        }
    }

    function buildLamps(city) {
        const bulbGeom = new THREE.SphereGeometry(0.22, 8, 6), poleGeom = new THREE.CylinderGeometry(0.08, 0.1, 1, 6);
        for (let j = 0; j <= city.cols; j += 3) {
            for (let s = -city.D / 2 + 20; s < city.D / 2; s += 40) {
                [-1, 1].forEach(side => {
                    const p = city.toWorld(city.streetX(j) + side * (city.street / 2 + 1.0), s);
                    const g = Terrain.height(p.x, p.z) + 0.3;
                    const pole = new THREE.Mesh(poleGeom, poleMat); pole.scale.y = 7; pole.position.set(p.x, g + 3.5, p.z); addMesh(city, pole, false);
                    const bulb = new THREE.Mesh(bulbGeom, lampMat); bulb.position.set(p.x, g + 7.1, p.z); addMesh(city, bulb, false);
                });
            }
        }
    }

    C.load = function (city) {
        if (city.loaded) return; city.loaded = true;
        buildStreets(city);
        buildBlocks(city);
        buildLamps(city);
        city.landmarks.forEach(fn => { try { fn(city, { addMesh: (m, s) => addMesh(city, m, s), addBox: (...a) => addBox(city, ...a), glassMat, poleMat }); } catch (e) { console.error('landmark failed in ' + city.name, e); } });
    };

    C.unload = function (city) {
        if (!city.loaded) return; city.loaded = false;
        if (window.Peds) Peds.unloadCity(city);
        city.workshop = null;
        city.station = false;                                             // the stop is rebuilt with the city
        if (window.Train) Train.stations = Train.stations.filter(st => st.city !== city);
        city.meshes.forEach(m => { scene.remove(m); m.traverse && m.traverse(o => { if (o.geometry) o.geometry.dispose(); }); });
        city.bodies.forEach(b => world.removeBody(b));
        city.roads.forEach(r => { if (window.Traffic) Traffic.unlinkRoad(r); Road.remove(r); });
        city.signs.forEach(s => scene.remove(s));
        C.lights = C.lights.filter(l => l.city !== city);
        C.nightMats = C.nightMats.filter(m => city.mats.indexOf(m) === -1);
        city.mats.forEach(m => m.dispose());
        city.meshes = []; city.bodies = []; city.roads = []; city.signs = []; city.mats = []; city.houses = [];
    };

    // Night: windows and lamps glow; traffic lights cycle (8 s, like the old game)
    let cycleT = 0;
    C.update = function (dt) {
        const night = window.Sky ? Sky.night : 0;
        for (let i = 0; i < C.nightMats.length; i++) C.nightMats[i].emissiveIntensity = night * 1.3;
        cycleT = (cycleT + dt) % 8;
        for (let i = 0; i < C.lights.length; i++) {
            const L = C.lights[i], t = (cycleT + L.phase) % 8;
            const nsState = t < 3.2 ? 2 : t < 4 ? 1 : 0;                 // green, yellow, red
            const ewState = t < 4 ? 0 : t < 7.2 ? 2 : 1;
            L.heads.ns.forEach(h => h.forEach((m, k) => m.emissiveIntensity = (k === 2 - nsState) ? 2.5 : 0));
            L.heads.ew.forEach(h => h.forEach((m, k) => m.emissiveIntensity = (k === 2 - ewState) ? 2.5 : 0));
            L.nsGreen = nsState === 2; L.ewGreen = ewState === 2;
        }
    };

    C.at = function (pos) {
        for (let i = 0; i < C.all.length; i++) {
            const c = C.all[i], l = c.toLocal(pos.x, pos.z);
            if (Math.abs(l.lx) < c.W / 2 + 30 && Math.abs(l.lz) < c.D / 2 + 30) return c;
        }
        return null;
    };

    return C;
})();
