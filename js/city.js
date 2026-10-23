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
        city.W = city.cols * city.pitch; city.D = city.rows * city.pitch;   // grid extents (local x, z)
        city.radius = Math.hypot(city.W, city.D) / 2;
        city.loaded = false; city.meshes = []; city.bodies = []; city.roads = []; city.signs = []; city.mats = [];
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
        city.streetX = (j) => -city.W / 2 + j * city.pitch;       // local x of NS street j (0..cols)
        city.streetZ = (i) => -city.D / 2 + i * city.pitch;       // local z of EW street i (0..rows)
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
            g.traverse(o => { if (o.isMesh) o.castShadow = true; });
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
            // sidewalk slab over the whole block (draped, raised a bit), curb strips around it
            const slab = Road.drapedQuad(c.x, c.z, B, city.heading, walkMat, 0.3, 6);
            slab.geometry.attributes.uv.array.forEach((v, k, arr) => arr[k] = v * B / 4);
            slab.geometry.attributes.uv.needsUpdate = true;
            city.meshes.push(slab);
            const dNorm = Math.hypot(cx - downtown.lx, cz - downtown.lz) / city.radius;
            const isPark = city.parks && city.parks.some(p => p[0] === j && p[1] === i);
            if (isPark) {
                city.meshes.push(Road.drapedQuad(c.x, c.z, B - 8, city.heading, parkMat, 0.32, 4));
                buildTrees(city, cx, cz, B - 12, 10);
                continue;
            }
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

    function buildTrees(city, cx, cz, span, count) {
        const trunk = new THREE.MeshStandardMaterial({ color: 0x5b3f2a, roughness: 1 });
        const leaf = new THREE.MeshStandardMaterial({ color: 0x2f7a2f, roughness: 1 });
        for (let k = 0; k < count; k++) {
            const lx = cx + (Math.random() - 0.5) * span, lz = cz + (Math.random() - 0.5) * span;
            const p = city.toWorld(lx, lz); const g = Terrain.height(p.x, p.z) + 0.3;
            const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), trunk); t.position.set(p.x, g + 1.5, p.z); addMesh(city, t, true);
            const s = rnd(2, 3.5);
            const l = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), leaf); l.position.set(p.x, g + 3 + s * 0.7, p.z); addMesh(city, l, true);
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
        city.meshes.forEach(m => { scene.remove(m); m.traverse && m.traverse(o => { if (o.geometry) o.geometry.dispose(); }); });
        city.bodies.forEach(b => world.removeBody(b));
        city.roads.forEach(r => { if (window.Traffic) Traffic.unlinkRoad(r); Road.remove(r); });
        city.signs.forEach(s => scene.remove(s));
        C.lights = C.lights.filter(l => l.city !== city);
        C.nightMats = C.nightMats.filter(m => city.mats.indexOf(m) === -1);
        city.mats.forEach(m => m.dispose());
        city.meshes = []; city.bodies = []; city.roads = []; city.signs = []; city.mats = [];
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
