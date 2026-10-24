// tokyo-driver1 v2 — spline roads.
// A road is a THREE.CatmullRomCurve3 with a cross-section painted once into a texture strip
// (lanes, dashes, edge lines) and extruded along the curve as a ribbon. Slopes and banking
// come from the waypoints. Physics is a chain of Cannon boxes aligned to the curve.
//
//   Road.define(spec)            -> record with curve, frames, lanes (no meshes yet)
//   Road.buildRange(rec, s0, s1) -> meshes + physics for that stretch (streamable)
//   Road.build(spec)             -> define + build everything (ramps, streets)
//   Road.exit / Road.onramp      -> ramps that peel off / merge onto a freeway
window.Road = (function () {
    const R = { all: [], DRAPE: 0.12 };   // DRAPE: how far draped streets float above the terrain
    let scene, world;
    const UP = new THREE.Vector3(0, 1, 0);

    // Cross-section presets (widths in world units; a lane is 3.6)
    R.types = {
        freeway: { lanes: 3, laneW: 3.6, shoulder: 2.4, median: 2.0, twoWay: true, barriers: true, deck: true },
        ramp:    { lanes: 1, laneW: 5.6, shoulder: 2.1, median: 0,   twoWay: false, barriers: true, deck: true },
        street:  { lanes: 1, laneW: 3.6, shoulder: 0.4, median: 0,   twoWay: true, barriers: false, deck: false },
        avenue:  { lanes: 2, laneW: 3.5, shoulder: 0.5, median: 1.2, twoWay: true, barriers: false, deck: false }
    };
    function widthOf(t) { return t.twoWay ? 2 * (t.lanes * t.laneW + t.shoulder) + t.median : t.lanes * t.laneW + 2 * t.shoulder; }
    R.widthOf = (name) => widthOf(R.types[name]);

    const stripCache = {};
    // Paint one road type's cross-section into a texture: u across the road, v along it
    // (one tile = 12 units along, so the dash pattern repeats cleanly).
    function stripTexture(typeName) {
        if (stripCache[typeName]) return stripCache[typeName];
        const t = R.types[typeName];
        const W = widthOf(t), pxPerUnit = 48;
        const w = Math.round(W * pxPerUnit), h = 12 * pxPerUnit;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        // Asphalt the way it really looks: a mid-grey base, large soft tonal patches, fine
        // aggregate speckle, tar-filled cracks, and darker worn tracks where the wheels run.
        if (window.Tex && Tex.photo && Tex.photo.asphalt) {
            // real asphalt photo (CC0) tiled at about 8 units per tile, darkened a little
            const pat = ctx.createPattern(Tex.photo.asphalt, 'repeat');
            ctx.save(); ctx.scale(8 * pxPerUnit / 1024, 8 * pxPerUnit / 1024); ctx.fillStyle = pat; ctx.fillRect(0, 0, w / (8 * pxPerUnit / 1024), h / (8 * pxPerUnit / 1024)); ctx.restore();
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, w, h);
        } else {
            const img = ctx.createImageData(w, h), d = img.data;
            for (let i = 0; i < d.length; i += 4) { const v = 70 + (Math.random() - 0.5) * 26; d[i] = v; d[i + 1] = v; d[i + 2] = v + 2; d[i + 3] = 255; }
            ctx.putImageData(img, 0, 0);
        }
        for (let i = 0; i < 40; i++) {                                   // big soft patches (old repairs, damp spots)
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            const dark = Math.random() > 0.45;
            g.addColorStop(0, dark ? 'rgba(20,20,22,0.22)' : 'rgba(150,150,145,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.save(); ctx.translate(Math.random() * w, Math.random() * h); ctx.scale(60 + Math.random() * 160, 40 + Math.random() * 120);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.3); ctx.fill(); ctx.restore();
        }
        for (let i = 0; i < w * h / 70; i++) {                           // aggregate
            const g = 95 + Math.random() * 110 | 0;
            ctx.fillStyle = `rgba(${g},${g},${g - 4},${0.1 + Math.random() * 0.3})`;
            ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
        }
        ctx.strokeStyle = 'rgba(12,12,12,0.7)'; ctx.lineWidth = 1.5;
        for (let i = 0; i < Math.round(W / 4); i++) {                     // tar cracks
            let px = Math.random() * w, py = Math.random() * h;
            ctx.beginPath(); ctx.moveTo(px, py);
            for (let k = 0; k < 14; k++) { px += (Math.random() - 0.5) * 26; py += (Math.random() - 0.3) * 40; ctx.lineTo(px, py); }
            ctx.stroke();
        }
        const X = (u) => u * pxPerUnit;
        const track = (uCentre) => {                                      // wheel tracks: two darker bands per lane
            [-0.28, 0.28].forEach(off => {
                const g = ctx.createLinearGradient(X(uCentre + off * t.laneW) - 14, 0, X(uCentre + off * t.laneW) + 14, 0);
                g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g; ctx.fillRect(X(uCentre + off * t.laneW) - 14, 0, 28, h);
            });
        };
        // paint that has seen traffic: solid colour with nicks worn out of it
        const paint = (x, y, lw, lh, color) => {
            ctx.fillStyle = color; ctx.fillRect(x, y, lw, lh);
            for (let i = 0; i < lw * lh / 40; i++) { ctx.fillStyle = `rgba(60,60,60,${0.2 + Math.random() * 0.5})`; ctx.fillRect(x + Math.random() * lw, y + Math.random() * lh, 1 + Math.random() * 2, 1 + Math.random() * 3); }
        };
        const line = (u, color, width, dashed) => {
            const x = X(u) - width * pxPerUnit / 2, lw = Math.max(2, width * pxPerUnit);
            if (!dashed) paint(x, 0, lw, h, color);
            else {
                paint(x, 0, lw, 3 * pxPerUnit, color);                     // 3-unit dash, 9-unit gap
                ctx.fillStyle = '#f4f4f0'; ctx.fillRect(X(u) - 4, 7.5 * pxPerUnit, 8, 5);   // reflective road stud in the gap
            }
        };
        const white = '#dcdcd6', yellow = '#e6b800';
        let u = 0;
        const lanesFwd = (count) => { for (let l = 0; l < count; l++) { track(u + t.laneW / 2); u += t.laneW; if (l < count - 1) line(u, white, 0.15, true); } };
        if (t.twoWay) {
            u += t.shoulder; line(u, white, 0.15, false);
            lanesFwd(t.lanes);
            if (t.median > 0) {
                line(u, yellow, 0.15, false);
                ctx.fillStyle = '#9a9a96'; ctx.fillRect(X(u) + 4, 0, X(t.median) - 8, h);
                u += t.median; line(u, yellow, 0.15, false);
            } else { line(u - 0.12, yellow, 0.13, false); line(u + 0.12, yellow, 0.13, false); }
            lanesFwd(t.lanes);
            line(u, white, 0.15, false); u += t.shoulder;
        } else {
            u += t.shoulder; line(u, white, 0.15, false);
            lanesFwd(t.lanes);
            line(u, white, 0.15, false); u += t.shoulder;
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        stripCache[typeName] = tex;
        return tex;
    }
    R.stripTexture = stripTexture;

    const mats = {};
    function concreteMat() { return mats.concrete || (mats.concrete = new THREE.MeshStandardMaterial({ color: 0xa8a8a2, map: Tex.concrete, roughness: 0.9 })); }
    function deckMat() { return mats.deck || (mats.deck = new THREE.MeshStandardMaterial({ color: 0x8d8d88, map: Tex.concrete, roughness: 0.95 })); }
    function pierMat() { return mats.pier || (mats.pier = new THREE.MeshStandardMaterial({ color: 0x8a8a84, map: Tex.concrete, roughness: 0.95 })); }
    function surfMat(type, conform) {
        const k = type + (conform ? '_c' : '');
        return mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ map: stripTexture(type), roughness: 0.92, metalness: 0.05,
            polygonOffset: !!conform, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    }

    // Frames along the curve: points, tangents, rights, ups. `right` is the DRIVER's right when
    // travelling along the tangent (tan x up), which for three.js's handedness is the negative
    // x side when heading +z. Rotations built from it must use (-right, up, tan).
    function frames(curve, segs) {
        const out = [];
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const p = curve.getPointAt(t), tan = curve.getTangentAt(t).normalize();
            const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
            const up = new THREE.Vector3().crossVectors(right, tan).normalize();
            out.push({ p, tan, right, up, t });
        }
        return out;
    }

    // A strip between two offsets {x: lateral (right+), y: vertical (up+)} along the frames.
    // With `drape` (a lift), every vertex is laid on the terrain at that height instead.
    function strip(fr, a, b, vUnit, length, uA, uB, drape) {
        const n = fr.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
        for (let i = 0; i < n; i++) {
            const f = fr[i], v = f.t * length / vUnit;
            const pa = f.p.clone().addScaledVector(f.right, a.x).addScaledVector(f.up, a.y);
            const pb = f.p.clone().addScaledVector(f.right, b.x).addScaledVector(f.up, b.y);
            if (drape !== undefined) { pa.y = Terrain.height(pa.x, pa.z) + drape + a.y; pb.y = Terrain.height(pb.x, pb.z) + drape + b.y; }
            pos.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], i * 6);
            uv.set([uA === undefined ? 0 : uA, v, uB === undefined ? 1 : uB, v], i * 4);
            if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }   // CCW seen from +up
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
    }
    R.strip = strip; R.frames = frames;

    function mesh(geom, mat, shadow, chunk) {
        const m = new THREE.Mesh(geom, mat);
        m.receiveShadow = true; m.castShadow = !!shadow;
        scene.add(m);
        chunk.meshes.push(m);
        return m;
    }

    // Physics boxes along the frames: one per frame step, rotated to the local frame.
    function physicsChain(fr, segLen, lateral, halfW, halfH, yCenter, chunk) {
        for (let i = 0; i < fr.length - 1; i++) {
            const a = fr[i], b = fr[i + 1];
            const mid = a.p.clone().add(b.p).multiplyScalar(0.5);
            const tan = b.p.clone().sub(a.p).normalize();
            const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
            const up = new THREE.Vector3().crossVectors(right, tan).normalize();
            mid.addScaledVector(right, lateral).addScaledVector(up, yCenter);
            const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right.clone().negate(), up, tan));
            const body = new CANNON.Body({ mass: 0, material: world.groundMaterial });
            body.addShape(new CANNON.Box(new CANNON.Vec3(halfW, halfH, segLen / 2 + 0.4)));
            body.position.set(mid.x, mid.y, mid.z);
            body.quaternion.set(q.x, q.y, q.z, q.w);
            world.addBody(body);
            chunk.bodies.push(body);
        }
    }

    // Define a road. spec: { type, points: [[x,y,z],...] | curve, name, segLen,
    //   conform: true  -> a surface street draped on the terrain (every vertex at terrain + lift,
    //                     no physics of its own: cars ride the terrain heightfield),
    //   openLeft/openRight (no barrier on that side), noBarriers, gapsLeft/gapsRight ([[s0,s1],..]),
    //   openStart/openEnd (units with no barriers at the ends) }
    R.define = function (spec) {
        const type = R.types[spec.type], W = widthOf(type), halfW = W / 2;
        const lift = spec.conform ? (spec.lift === undefined ? R.DRAPE : spec.lift) : undefined;
        let curve = spec.curve;
        if (!curve) {
            const pts = spec.points.map(p => {
                const v = new THREE.Vector3(p[0], p[1], p[2]);
                if (spec.conform) v.y = Terrain.height(v.x, v.z) + lift;
                return v;
            });
            curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
        }
        const length = curve.getLength();
        const segs = Math.max(4, Math.round(length / (spec.segLen || (spec.conform ? 4 : 8))));
        const segLen = length / segs;
        const fr = frames(curve, segs);
        if (spec.conform) fr.forEach(f => { f.p.y = Terrain.height(f.p.x, f.p.z) + lift; });
        // ramps: never let the deck sink below the land between waypoints (walls + physics follow the frames)
        if (spec.hugTerrain) fr.forEach(f => { const g = Terrain.height(f.p.x, f.p.z) + 0.5; if (f.p.y < g) f.p.y = g; });
        const rec = { name: spec.name || spec.type, type: spec.type, typeDef: type, curve, length, width: W, halfW, frames: fr,
                      segLen, lanes: [], spec, lift, chunks: {} };

        // Lane centre offsets. Right-hand traffic: lanes right of the centreline run forward (dir 1).
        if (type.twoWay) {
            for (let l = 0; l < type.lanes; l++) {
                const off = type.median / 2 + type.laneW * (l + 0.5);
                rec.lanes.push({ offset: off, dir: 1, index: l });
                rec.lanes.push({ offset: -off, dir: -1, index: l });
            }
        } else {
            for (let l = 0; l < type.lanes; l++) rec.lanes.push({ offset: -halfW + type.shoulder + type.laneW * (l + 0.5), dir: 1, index: l });
        }
        R.all.push(rec);
        return rec;
    };

    // Build meshes + physics for the stretch [s0, s1] of a defined road. Returns the chunk key.
    R.buildRange = function (rec, s0, s1, key) {
        const spec = rec.spec, type = rec.typeDef, halfW = rec.halfW, length = rec.length, lift = rec.lift;
        key = key || (s0 + ':' + s1);
        if (rec.chunks[key]) return key;
        const i0 = Math.max(0, Math.floor(s0 / rec.segLen)), i1 = Math.min(rec.frames.length - 1, Math.ceil(s1 / rec.segLen));
        if (i1 - i0 < 1) return null;
        const fr = rec.frames.slice(i0, i1 + 1);
        const chunk = { meshes: [], bodies: [] };
        rec.chunks[key] = chunk;

        // Surface
        mesh(strip(fr, { x: -halfW, y: 0 }, { x: halfW, y: 0 }, 12, length, 0, 1, lift), surfMat(rec.type, spec.conform), false, chunk);
        if (!spec.conform) physicsChain(fr, rec.segLen, 0, halfW, 0.3, -0.3, chunk);

        // Deck skirts + piers for elevated roads
        if (type.deck) {
            const dm = deckMat();
            mesh(strip(fr, { x: -halfW, y: -1.4 }, { x: -halfW, y: 0 }, 4, length, 0, 0.35), dm, false, chunk);
            mesh(strip(fr, { x: halfW, y: 0 }, { x: halfW, y: -1.4 }, 4, length, 0, 0.35), dm, false, chunk);
            mesh(strip(fr, { x: halfW, y: -1.4 }, { x: -halfW, y: -1.4 }, 4, length), dm, false, chunk);
            const pierGeom = new THREE.CylinderGeometry(1.1, 1.3, 1, 12);
            chunk.piers = [];
            for (let i = 1; i < fr.length; i += Math.max(1, Math.round(24 / rec.segLen))) {
                const f = fr[i];
                [-halfW * 0.45, halfW * 0.45].forEach(off => {
                    const px = f.p.x + f.right.x * off, pz = f.p.z + f.right.z * off;
                    const g2 = Terrain.height(px, pz), h2 = f.p.y - 1.3 - g2 + 0.5;
                    if (h2 < 1.2) return;
                    if (pierBlocked(px, pz)) return;               // a U-turn loop passes under here
                    const pier = new THREE.Mesh(pierGeom, pierMat());
                    pier.scale.y = h2; pier.position.set(px, g2 - 0.5 + h2 / 2, pz);
                    pier.castShadow = true; pier.receiveShadow = true;
                    scene.add(pier); chunk.meshes.push(pier); chunk.piers.push(pier);
                });
            }
        }

        // Barriers: concrete walls on both edges, plus a median wall on freeways
        if (type.barriers && !spec.noBarriers) {
            const bm = concreteMat();
            const wall = (lat, w, h, gaps) => {
                gaps = (gaps || []).slice();
                if (spec.openStart) gaps.push([0, spec.openStart]);
                if (spec.openEnd) gaps.push([length - spec.openEnd, length]);
                const runs = []; let run = [];
                fr.forEach(f => {
                    const s = f.t * length;
                    const inGap = gaps.some(g => s >= g[0] && s <= g[1]);
                    if (inGap) { if (run.length > 1) runs.push(run); run = []; } else run.push(f);
                });
                if (run.length > 1) runs.push(run);
                runs.forEach(r => {
                    mesh(strip(r, { x: lat - w / 2, y: h }, { x: lat + w / 2, y: h }, 4, length, 0, 0.3), bm, true, chunk);
                    mesh(strip(r, { x: lat - w / 2, y: 0 }, { x: lat - w / 2, y: h }, 4, length, 0, 0.3), bm, false, chunk);
                    mesh(strip(r, { x: lat + w / 2, y: h }, { x: lat + w / 2, y: 0 }, 4, length, 0, 0.3), bm, false, chunk);
                    physicsChain(r, rec.segLen, lat, w / 2, h / 2, h / 2, chunk);
                });
            };
            if (!spec.openLeft) wall(-halfW + 0.35, 0.6, 1.1, spec.gapsLeft);
            if (!spec.openRight) wall(halfW - 0.35, 0.6, 1.1, spec.gapsRight);
            if (type.median > 0 && type.twoWay) wall(0, 0.6, 1.0);
            if (rec.type === 'freeway') furniture(fr, halfW, length, spec, chunk);
        }
        return key;
    };

    // What a real freeway has along it: reflectors on the barriers, and tall light poles on the
    // median every 50 m whose heads glow at night (City.nightMats drives the glow).
    let poleGeom, armGeom, headGeom, reflGeom;
    function furniture(fr, halfW, length, spec, chunk) {
        poleGeom = poleGeom || new THREE.CylinderGeometry(0.14, 0.2, 12, 8);
        armGeom = armGeom || new THREE.BoxGeometry(0.16, 0.16, 3.2);
        headGeom = headGeom || new THREE.BoxGeometry(0.5, 0.18, 1.1);
        reflGeom = reflGeom || new THREE.BoxGeometry(0.1, 0.08, 0.04);
        const poleMat = mats.pole || (mats.pole = new THREE.MeshStandardMaterial({ color: 0x8e9398, metalness: 0.7, roughness: 0.4 }));
        if (!mats.lampHead) { mats.lampHead = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd080, emissiveIntensity: 0 }); if (window.City) City.nightMats.push(mats.lampHead); }
        const reflMat = mats.refl || (mats.refl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe9a0, emissiveIntensity: 0.6 }));
        const inGap = (s, gaps) => (gaps || []).some(g => s >= g[0] && s <= g[1]);
        fr.forEach((f, i) => {
            const s = f.t * length;
            if (Math.round(s) % 16 === 0) {                              // reflectors on both outer walls
                [[-halfW + 0.35, spec.gapsLeft], [halfW - 0.35, spec.gapsRight]].forEach(([lat, gaps]) => {
                    if (inGap(s, gaps)) return;
                    const m = new THREE.Mesh(reflGeom, reflMat);
                    m.position.copy(f.p).addScaledVector(f.right, lat); m.position.y += 0.95;
                    m.rotation.y = Math.atan2(f.tan.x, f.tan.z);
                    scene.add(m); chunk.meshes.push(m);
                });
            }
            if (Math.round(s) % 48 === 0) {                               // a light pole on the median, arms over both carriageways
                const pole = new THREE.Mesh(poleGeom, poleMat); pole.position.copy(f.p); pole.position.y += 6.5; pole.castShadow = true;
                scene.add(pole); chunk.meshes.push(pole);
                [-1, 1].forEach(sd => {
                    const arm = new THREE.Mesh(armGeom, poleMat); arm.position.copy(f.p).addScaledVector(f.right, sd * 1.5); arm.position.y += 12.3;
                    arm.rotation.y = Math.atan2(f.tan.x, f.tan.z) + Math.PI / 2; scene.add(arm); chunk.meshes.push(arm);
                    const head = new THREE.Mesh(headGeom, mats.lampHead); head.position.copy(f.p).addScaledVector(f.right, sd * 3.0); head.position.y += 12.2;
                    head.rotation.y = arm.rotation.y; scene.add(head); chunk.meshes.push(head);
                });
            }
        });
    }

    R.dropRange = function (rec, key) {
        const c = rec.chunks[key]; if (!c) return;
        c.meshes.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); });
        c.bodies.forEach(b => world.removeBody(b));
        delete rec.chunks[key];
    };

    R.build = function (spec) {
        const rec = R.define(spec);
        R.buildRange(rec, 0, rec.length, 'all');
        return rec;
    };

    R.remove = function (rec) {
        Object.keys(rec.chunks).forEach(k => R.dropRange(rec, k));
        const i = R.all.indexOf(rec); if (i >= 0) R.all.splice(i, 1);
    };

    // Point / frame at arc-length s along a road, offset laterally (right+) and vertically
    R.at = function (rec, s, lateral, vertical) {
        const t = Math.min(1, Math.max(0, s / rec.length));
        const p = rec.curve.getPointAt(t), tan = rec.curve.getTangentAt(t).normalize();
        const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
        const up = new THREE.Vector3().crossVectors(right, tan).normalize();
        p.addScaledVector(right, lateral || 0).addScaledVector(up, vertical || 0);
        if (rec.lift !== undefined) p.y = Terrain.height(p.x, p.z) + rec.lift + (vertical || 0);
        return { p, tan, right, up };
    };

    // Closest frame on a road to a world point
    R.nearest = function (rec, pos) {
        let best = 0, bd = Infinity;
        for (let i = 0; i < rec.frames.length; i++) {
            const d = rec.frames[i].p.distanceToSquared(pos);
            if (d < bd) { bd = d; best = i; }
        }
        return { s: rec.frames[best].t * rec.length, dist: Math.sqrt(bd), frame: rec.frames[best] };
    };

    // Yaw that makes a car (forward = local +z) face along `tan`
    R.yawOf = (tan) => Math.atan2(tan.x, tan.z);

    // Piers must not stand in a U-turn loop (or anything else flagged underFreeway) that passes under the freeway
    function pierBlocked(px, pz) {
        for (let k = 0; k < R.all.length; k++) {
            const u = R.all[k]; if (!u.isUturn && !u.underFreeway) continue;
            for (let i = 0; i < u.frames.length; i++) { const p = u.frames[i].p; if (Math.hypot(p.x - px, p.z - pz) < 8) return true; }
        }
        return false;
    }
    R.removePiersNear = function (fw, ramp) {
        Object.values(fw.chunks).forEach(chunk => {
            if (!chunk.piers) return;
            chunk.piers = chunk.piers.filter(pier => {
                const hit = ramp.frames.some(f => Math.hypot(f.p.x - pier.position.x, f.p.z - pier.position.z) < 8);
                if (hit) { scene.remove(pier); chunk.meshes.splice(chunk.meshes.indexOf(pier), 1); }
                return !hit;
            });
        });
    };

    // Keep ramp waypoints [i0, i1] at least 0.6 above the land so hills never poke through
    function clearTerrain(pts, i0, i1) {
        for (let i = i0; i <= i1; i++) {
            const g = Terrain.height(pts[i].x, pts[i].z) + 0.6;
            if (pts[i].y < g) pts[i].y = g;
        }
    }

    // Ramps always leave / join on the driver's RIGHT. `dir` is the direction of travel on the
    // freeway: +1 = toward increasing s (northbound), -1 = the other carriageway. Lateral
    // offsets are measured from the freeway's edge (hw); the freeway is on the ramp's left.
    // The peel-off profile stays near deck height until lateral 32 so it clears the railway.
    const PEEL = [[-40, 'rw0.6', 0.03], [40, 'rw1.4', 0.03], [100, 0.6, 0.03], [160, 5.0, -0.3], [220, 20.0, -0.9], [280, 32.0, -1.6]];
    function peelPoint(fw, sBase, dir, k, lat, dy) {
        const rw = widthOf(R.types.ramp) / 2, hw = fw.width / 2;
        const l = lat === 'rw0.6' ? -rw + 0.6 : lat === 'rw1.4' ? -rw + 1.4 : lat;
        const f = R.at(fw, sBase + dir * k, dir * (hw + l), 0); f.p.y += dy; return f.p;
    }

    // An exit at arc-length s0, descending to `toPoint` (street level), continuing along `toDir`.
    R.exit = function (fw, s0, dir, toPoint, toDir, name) {
        const pts = PEEL.map(([k, lat, dy]) => peelPoint(fw, s0, dir, k, lat, dy));
        const end = toPoint.clone(), d = toDir.clone().normalize();
        end.y = Terrain.height(end.x, end.z) + R.DRAPE;
        const tail = end.clone().addScaledVector(d, 30); tail.y = Terrain.height(tail.x, tail.z) + R.DRAPE;
        pts.push(end.clone().addScaledVector(d, -40).setY((pts[pts.length - 1].y + end.y) / 2));
        pts.push(end); pts.push(tail);
        clearTerrain(pts, 3, pts.length - 2);
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
        const rec = R.build({ type: 'ramp', curve, name: name || 'exit', segLen: 6, hugTerrain: true, gapsLeft: [[0, 170]], openEnd: 45 });
        rec.isExit = true; rec.from = fw; rec.s0 = s0; rec.dir = dir;
        return rec;
    };

    // An on-ramp: from a street point (heading fromDir) climbing to merge with `fw` at s1.
    R.onramp = function (fw, s1, dir, fromPoint, fromDir, name) {
        const pts = [], d = fromDir.clone().normalize();
        const start = fromPoint.clone(); start.y = Terrain.height(start.x, start.z) + R.DRAPE;
        const head = start.clone().addScaledVector(d, -30); head.y = Terrain.height(head.x, head.z) + R.DRAPE;
        pts.push(head); pts.push(start);
        const climb = PEEL.slice().reverse().map(([k, lat, dy]) => peelPoint(fw, s1, dir, -k, lat, dy));   // merge is reached last
        pts.push(start.clone().addScaledVector(d, 40).setY(start.y + (climb[0].y - start.y) * 0.3));
        climb.forEach(p => pts.push(p));
        clearTerrain(pts, 2, pts.length - 5);
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
        const len = curve.getLength();
        const rec = R.build({ type: 'ramp', curve, name: name || 'onramp', segLen: 6, hugTerrain: true, gapsLeft: [[len - 170, len]], openStart: 45 });
        rec.isOnramp = true; rec.from = fw; rec.s1 = s1; rec.dir = dir;
        return rec;
    };

    // A U-turn: exits right at sU, drops to the ground, loops under the elevated freeway and
    // merges onto the opposite carriageway at the same sU, now travelling in direction -dir.
    R.uturn = function (fw, sU, dir, name) {
        const pts = PEEL.map(([k, lat, dy]) => peelPoint(fw, sU, dir, k, lat, dy));
        const hw = fw.width / 2;
        // ground level: `lat` here is measured from the freeway CENTRELINE (signed by dir)
        const groundC = (k, lat) => { const f = R.at(fw, sU + dir * k, dir * lat, 0); f.p.y = Terrain.height(f.p.x, f.p.z) + 0.8; return f.p; };
        pts.push(groundC(340, hw + 36));
        // a semicircle of radius 40 centred on the freeway at sU+380: crosses under the deck at sU+420
        const RADIUS = 48, cS = 380;
        for (let a = 90; a >= -90; a -= 30) { const th = a * Math.PI / 180; pts.push(groundC(cS + RADIUS * Math.cos(th), RADIUS * Math.sin(th))); }
        pts.push(groundC(340, -(hw + 36)));
        // merge onto the other carriageway: its right edge is lateral -(hw + lat) for travel in -dir
        PEEL.slice().reverse().forEach(([k, lat, dy]) => pts.push(peelPoint(fw, sU, -dir, -k, lat, dy)));
        clearTerrain(pts, 3, pts.length - 4);
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
        const len = curve.getLength();
        const rec = R.build({ type: 'ramp', curve, name: name || 'U-turn', segLen: 6, hugTerrain: true, gapsLeft: [[0, 170], [len - 170, len]] });
        rec.isExit = true; rec.isOnramp = true; rec.isUturn = true; rec.from = fw; rec.s0 = sU; rec.s1 = sU; rec.dir = dir; rec.mergeDir = -dir;
        R.removePiersNear(fw, rec);
        return rec;
    };

    // A draped square patch (intersections, plazas): size x size centred at (cx, cz), rotated
    // by `heading`, laid on the terrain, textured with `tex`. Returns the mesh.
    // A flat patch draped on the terrain: `size` across (local x), `sizeZ` along (defaults to
    // square). World positions are baked into the vertices, so never scale the result.
    R.drapedQuad = function (cx, cz, size, heading, mat, lift, n, sizeZ) {
        n = n || 4;
        const g = new THREE.PlaneGeometry(size, sizeZ || size, n, n);
        g.rotateX(-Math.PI / 2); g.rotateY(heading);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = cx + p.getX(i), z = cz + p.getZ(i);
            p.setXYZ(i, x, Terrain.height(x, z) + (lift === undefined ? R.DRAPE : lift), z);
        }
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat);
        m.receiveShadow = true;
        scene.add(m);
        return m;
    };

    R.init = function (sc, w) { scene = sc; world = w; };
    return R;
})();
