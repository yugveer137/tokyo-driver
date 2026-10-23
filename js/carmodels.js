// carmodels.js — car body / wheel / interior builders, ported from the old index.html.
// Needs only the global THREE (r128). Exposes window.CARS and window.CarModels.
//
//   CarModels.buildBody(id)            -> THREE.Group  body in the chassis-body frame (no wheels).
//        Includes the amber turn-signal and red brake-light boxes the old createCar() added;
//        they are in group.userData.hazardLights / .brakeLights (opacity 0 / 0.3 as before).
//   CarModels.buildWheel(id)           -> THREE.Mesh   axle along local X (geometry pre-rotated),
//        so copy the physics wheel quaternion straight onto it (the old game multiplied by a
//        90deg-about-Z quaternion; do NOT do that here).
//   CarModels.buildInterior(id, tex[, opts]) -> THREE.Group  cockpit. Right-hand-drive mirror and
//        renderOrder 999 are applied like the old createCar() did (opts.rhd === false skips the
//        mirror). group.userData.steeringWheelSpin is the rotating steering sub-group.
//   CarModels.wheelLayout(id)          -> { radius, width, points: [[x,y,z] x4], suspensionRestLength,
//        maxSuspensionTravel }  chassisConnectionPointLocal for FL, FR, RL, RR.
//   CarModels.chassis(id)              -> { half: [x,y,z], offset: [x,y,z] } physics box of the old game.
(function () {
    'use strict';

    // Set by the _iv steering-wheel builders (was a global in the old game).
    let steeringWheelSpin = null;

        const cars = {
            starter: {
                name: 'Starter',
                price: 0,
                maxSpeed: 80,
                acceleration: 12,
                handling: 0.012,
                color: 0x4488ff,
                bodyColor: 0x4488ff
            },
            sport: {
                name: 'Sport GT',
                price: 150,
                maxSpeed: 120,
                acceleration: 18,
                handling: 0.015,
                color: 0xff4444,
                bodyColor: 0xff4444
            },
            muscle: {
                name: 'Muscle King',
                price: 150,
                maxSpeed: 140,
                acceleration: 22,
                handling: 0.013,
                color: 0x44ff44,
                bodyColor: 0x44ff44
            },
            super: {
                name: 'Supercar',
                price: 150,
                maxSpeed: 180,
                acceleration: 30,
                handling: 0.018,
                color: 0xffcc00,
                bodyColor: 0xffcc00
            },
            hyper: {
                name: 'Hyperion',
                price: 150,
                maxSpeed: 220,
                acceleration: 40,
                handling: 0.02,
                color: 0xff00ff,
                bodyColor: 0xff00ff
            },
            legend: {
                name: 'Legend X',
                price: 150,
                maxSpeed: 320,
                acceleration: 50,
                handling: 0.022,
                color: 0x00ffff,
                bodyColor: 0x00ffff
            },
            electric: {
                name: 'Tokyo EV',
                price: 150,
                maxSpeed: 150,
                acceleration: 35,
                handling: 0.017,
                color: 0x00ff88,
                bodyColor: 0x00ff88,
                isElectric: true
            },
            trailer: {
                name: 'Trailer Truck',
                price: 150,
                maxSpeed: 60,
                acceleration: 15,
                handling: 0.007,
                color: 0x2255aa,
                bodyColor: 0x2255aa,
                isTruck: true
            },
            gtbh: {
                name: 'GT BH',
                price: 20,
                maxSpeed: 100,
                acceleration: 18,
                handling: 0.006,
                color: 0x8B4513,
                bodyColor: 0x8B4513,
                isTruck: true
            },
            supra: {
                name: 'Supra MK4',
                price: 150,
                maxSpeed: 1000,
                acceleration: 80,
                handling: 0.010,
                color: 0xff6600,
                bodyColor: 0xff6600,
                isDrift: true,
                heavyCar: true
            },
            ferrari: {
                name: 'Ferrari SF90',
                price: 50,
                maxSpeed: 1000,
                acceleration: 80,
                handling: 0.018,
                color: 0xcc0000,
                bodyColor: 0xcc0000,
                heavyCar: true
            },
            mclaren: {
                name: 'McLaren P1',
                price: 50,
                maxSpeed: 1000,
                acceleration: 80,
                handling: 0.018,
                color: 0xff8800,
                bodyColor: 0xff8800,
                heavyCar: true
            },
            m4supra: {
                name: 'M4 Supra',
                price: 150,
                maxSpeed: 1000,
                acceleration: 85,
                handling: 0.016,
                color: 0xffdd00,
                bodyColor: 0xffdd00,
                isDrift: true,
                heavyCar: true
            },
            lec: {
                name: 'LEC',
                price: 200,
                maxSpeed: 2000,
                acceleration: 100,
                handling: 0.020,
                color: 0xaa00ff,
                bodyColor: 0xaa00ff,
                heavyCar: true
            },
            f550: {
                name: 'F550',
                price: 150,
                maxSpeed: 90,
                acceleration: 20,
                handling: 0.009,
                color: 0x222222,
                bodyColor: 0x222222,
                isPickup: true,
                heavyCar: true
            },
            wrangler: {
                name: 'Jeep Wrangler',
                price: 150,
                maxSpeed: 1000,
                acceleration: 80,
                handling: 0.011,
                color: 0x4a7a3d,
                bodyColor: 0x4a7a3d,
                isOffroad: true,
                heavyCar: true,
                isElectric: true
            },
            porsche: {
                name: 'Porsche 911 GT3',
                price: 300,
                maxSpeed: 1000,
                acceleration: 40,
                handling: 0.019,
                color: 0x2266ff,
                bodyColor: 0x2266ff,
                isElectric: true,
                heavyCar: true
            },
            gv60: {
                name: 'Genesis GV60',
                price: 200,
                maxSpeed: 1000,
                acceleration: 70,
                handling: 0.016,
                color: 0x4a6741,
                bodyColor: 0x4a6741,
                isElectric: true,
                heavyCar: true
            },
            sonata: {
                name: 'Hyundai Sonata Hybrid',
                price: 100,
                maxSpeed: 110,
                acceleration: 16,
                handling: 0.015,
                color: 0xc0c8d0,
                bodyColor: 0xc0c8d0,
                isElectric: true
            },
            mustangev: {
                name: 'Ford Mustang Electric',
                price: 200,
                maxSpeed: 180,
                acceleration: 55,
                handling: 0.02,
                color: 0xff4400,
                bodyColor: 0xff4400,
                isElectric: true,
                heavyCar: true
            },
            genesisveet: {
                name: 'Genesis Sedan Veet',
                price: 100,
                maxSpeed: 500,
                acceleration: 65,
                handling: 0.017,
                color: 0x1a3a5c,
                bodyColor: 0x1a3a5c,
                isElectric: true,
                heavyCar: true
            },
            gv70veet: {
                name: 'Genesis GV70 Veet',
                price: 20,
                maxSpeed: 1000,
                acceleration: 90,
                handling: 0.019,
                color: 0x8b0000,
                bodyColor: 0x8b0000,
                isElectric: true,
                heavyCar: true
            },
            nes2451: {
                name: 'NES 2451',
                price: 100,
                maxSpeed: 1000,
                acceleration: 85,
                handling: 0.020,
                color: 0x00ccff,
                bodyColor: 0x00ccff,
                isElectric: true,
                heavyCar: true
            },
            gr4: {
                name: 'GR.4',
                price: 10,
                maxSpeed: 2000,
                acceleration: 100,
                handling: 0.022,
                color: 0x111111,
                bodyColor: 0x111111,
                isElectric: true,
                heavyCar: true,
                isRaceCar: true
            },
            genesisi5: {
                name: 'Genesis i5',
                price: 20,
                maxSpeed: 1000,
                acceleration: 85,
                handling: 0.018,
                color: 0x1a6dff,
                bodyColor: 0x1a6dff,
                isElectric: true,
                heavyCar: true
            },
            aventador: {
                name: 'Lamborghini Aventador',
                price: 250,
                maxSpeed: 1000,
                acceleration: 90,
                handling: 0.019,
                color: 0x00cc00,
                bodyColor: 0x00cc00,
                heavyCar: true
            },
            raptor: {
                name: 'Ford Raptor R',
                price: 200,
                maxSpeed: 1000,
                acceleration: 85,
                handling: 0.013,
                color: 0xd35400,
                bodyColor: 0xd35400,
                isOffroad: true,
                heavyCar: true
            },
            tesla: {
                name: 'Tesla Model S Plaid',
                price: 150,
                maxSpeed: 200,
                acceleration: 55,
                handling: 0.019,
                color: 0xeef0f2,
                bodyColor: 0xeef0f2,
                isElectric: true,
                heavyCar: true
            },
            model3: {
                name: 'Tesla Model 3',
                price: 120,
                maxSpeed: 160,
                acceleration: 45,
                handling: 0.018,
                color: 0xffffff,
                bodyColor: 0xffffff,
                isElectric: true,
                heavyCar: true
            },
            modely: {
                name: 'Tesla Model Y',
                price: 140,
                maxSpeed: 155,
                acceleration: 42,
                handling: 0.016,
                color: 0x1a1a1a,
                bodyColor: 0x1a1a1a,
                isElectric: true,
                heavyCar: true
            },
            modelx: {
                name: 'Tesla Model X',
                price: 180,
                maxSpeed: 170,
                acceleration: 50,
                handling: 0.015,
                color: 0x8b0000,
                bodyColor: 0x8b0000,
                isElectric: true,
                heavyCar: true
            },
            cybertruck: {
                name: 'Tesla Cybertruck',
                price: 250,
                maxSpeed: 180,
                acceleration: 60,
                handling: 0.012,
                color: 0xb0b4b8,
                bodyColor: 0xb0b4b8,
                isElectric: true,
                isPickup: true,
                heavyCar: true
            }
        };

        const _cv = {
            // Glossy car paint. Standard material picks up the city's neon point lights and
            // the bloom pass far better than the old flat Phong did.
            phong: (c, sh = 80) => new THREE.MeshStandardMaterial({
                color: c, metalness: 0.55, roughness: Math.max(0.12, 0.42 - sh / 600)
            }),
            lambert: (c) => new THREE.MeshLambertMaterial({ color: c }),
            // Matte black plastic: bumpers, skirts, arch liners
            trim: (c = 0x15151c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.25, roughness: 0.85 }),
            // Satin chrome. Fully metallic (1.0) renders near-black here because the scene has
            // no reflection map, so keep enough diffuse for it to read bright under the lights.
            chrome: () => new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.55, roughness: 0.28 }),
            // Dark tinted night glass — reflective rather than pale blue
            glass: () => new THREE.MeshStandardMaterial({
                color: 0x0e1a28, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.75
            }),
            emissive: (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }),
            box(g, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, cast = true) {
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
                m.position.set(x, y, z);
                m.rotation.set(rx, ry, rz);
                m.castShadow = cast;
                g.add(m);
                return m;
            },
            cyl(g, rt, rb, h, seg, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
                const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
                m.position.set(x, y, z);
                m.rotation.set(rx, ry, rz);
                g.add(m);
                return m;
            },
            headlights(g, y, z, hw = 0.6, color = 0xffffcc) {
                const mat = _cv.emissive(color);
                [-hw, hw].forEach(x => _cv.box(g, 0.34, 0.16, 0.1, mat, x, y, z, 0, 0, 0, false));
            },
            tailbar(g, y, z, w = 1.7) {
                _cv.box(g, w, 0.09, 0.06, _cv.emissive(0xff1a1a), 0, y, z, 0, 0, 0, false);
            },
            taillights(g, y, z, hw = 0.6) {
                const mat = _cv.emissive(0xff1a1a);
                [-hw, hw].forEach(x => _cv.box(g, 0.34, 0.16, 0.06, mat, x, y, z, 0, 0, 0, false));
            },

            // ---- Shared detail helpers (used by every archetype) ----

            // Chamfered body block. A plain box reads as a flat slab; shaving the top and
            // bottom edges gives the car a rounded shoulder without extra geometry cost.
            shell(g, w, h, d, mat, x, y, z, o = {}) {
                const inset = o.inset !== undefined ? o.inset : 0.14;
                const cap = o.cap !== undefined ? o.cap : 0.15;
                _cv.box(g, w, h - cap * 2, d, mat, x, y, z);
                _cv.box(g, w - inset * 2, cap, d - inset, mat, x, y + h / 2 - cap / 2, z);
                _cv.box(g, w - inset * 2, cap, d - inset, mat, x, y - h / 2 + cap / 2, z);
            },

            // Wheel arches: a dark recess so the wheel looks set INTO the body, plus a
            // body-coloured flare arcing over it. zs = wheel z positions.
            // Defaults match where the physics puts the wheels in-game: z ±1.3, centre height
            // 0.25 on normal cars and 0.15 on heavyCar ones, radius 0.4. y=0.2 splits the
            // difference so the arch sits just over the tyre on both.
            arches(g, wid, mat, o = {}) {
                const zs = o.zs || [1.3, -1.3];
                const y = o.y !== undefined ? o.y : 0.2;
                const r = o.r !== undefined ? o.r : 0.52;
                const liner = _cv.trim(0x05050a);
                const n = 9;                                   // slats in the arc
                const slat = r * Math.PI / (n - 1) * 1.15;     // overlap so the arc is continuous
                zs.forEach(z => [-1, 1].forEach(s => {
                    // Dark liner in the upper half of the arch, sized so its corners stay
                    // inside the curve and nothing hangs below the body.
                    _cv.box(g, 0.09, r * 0.75, r * 1.5, liner, s * (wid / 2 - 0.04), y + r * 0.25, z, 0, 0, 0, false);
                    // Thin lip that follows the curve over the wheel. Each slat is rotated to
                    // lie tangent to the circle, so together they read as one smooth arch.
                    for (let i = 0; i < n; i++) {
                        const a = Math.PI * (i / (n - 1));    // 0 = front, PI/2 = top, PI = back
                        // skip slats that would hang below the body sill
                        if (o.floor !== undefined && y + Math.sin(a) * r < o.floor) continue;
                        _cv.box(g, 0.06, 0.07, slat, mat,
                            s * (wid / 2 + 0.015),
                            y + Math.sin(a) * r,
                            z + Math.cos(a) * r,
                            Math.PI / 2 - a, 0, 0, false);
                    }
                }));
            },

            // Front/rear bumper bar with a lower valance
            bumper(g, wid, y, z, o = {}) {
                const mat = _cv.trim(o.color || 0x14141a);
                const face = z > 0 ? 1 : -1;
                _cv.box(g, wid - 0.06, 0.26, 0.14, mat, 0, y, z + face * 0.04, 0, 0, 0, false);
                _cv.box(g, wid - 0.5, 0.1, 0.16, mat, 0, y - 0.2, z + face * 0.04, 0, 0, 0, false);
            },

            // Mesh grille between the headlights
            grille(g, w, y, z) {
                _cv.box(g, w, 0.2, 0.08, _cv.trim(0x0a0a0e), 0, y, z, 0, 0, 0, false);
                for (let i = -1; i <= 1; i++) {
                    _cv.box(g, w - 0.12, 0.03, 0.1, _cv.chrome(), 0, y + i * 0.06, z + 0.01, 0, 0, 0, false);
                }
            },

            // Wing mirrors on stalks
            mirrors(g, wid, y, z, mat) {
                [-1, 1].forEach(s => {
                    // short stalk from the door, housing tucked in close
                    _cv.box(g, 0.08, 0.035, 0.05, _cv.trim(), s * (wid / 2 - 0.12), y, z, 0, 0, 0, false);
                    _cv.box(g, 0.08, 0.1, 0.14, mat, s * (wid / 2 - 0.05), y + 0.03, z, 0, 0, 0, false);
                    _cv.box(g, 0.01, 0.07, 0.1, _cv.chrome(), s * (wid / 2 - 0.004), y + 0.03, z, 0, 0, 0, false);
                });
            },

            // Crease running down the flank. Flush with the body so it reads as a panel
            // line rather than something bolted on.
            sideCrease(g, wid, y, z, len, mat) {
                const line = _cv.trim(0x0b0b10);
                [-1, 1].forEach(s => {
                    _cv.box(g, 0.012, 0.025, len, line, s * (wid / 2 + 0.004), y, z, 0, 0, 0, false);
                    // door shut-line, kept within the main body so it can't float
                    _cv.box(g, 0.012, 0.22, 0.02, line, s * (wid / 2 + 0.004), y - 0.12, z + len * 0.1, 0, 0, 0, false);
                });
            },
            // ---- Archetype: classic sedan (4-door) ----
            sedan(g, color, o = {}) {
                const len = o.len || 4, wid = o.wid || 2;
                const bodyMat = _cv.phong(color);
                _cv.shell(g, wid, 0.8, len, bodyMat, 0, 0.6, 0);
                // Bonnet and boot sit slightly proud of the main body
                _cv.box(g, wid - 0.3, 0.1, len * 0.3, bodyMat, 0, 1.0, len * 0.28);
                _cv.box(g, wid - 0.3, 0.1, len * 0.22, bodyMat, 0, 1.0, -len * 0.36);
                const roofLen = o.roofLen || len * 0.55;
                const roofZ = o.roofZ || -0.3;
                _cv.shell(g, wid - 0.4, 0.6, roofLen, bodyMat, 0, 1.3, roofZ, { cap: 0.1, inset: 0.1 });
                _cv.box(g, wid - 0.6, 0.5, 0.1, _cv.glass(), 0, 1.2, roofZ + roofLen / 2 + 0.4, Math.PI / 6);
                _cv.box(g, wid - 0.6, 0.4, 0.1, _cv.glass(), 0, 1.2, roofZ - roofLen / 2 - 0.3, -Math.PI / 5);
                [-wid / 2 + 0.02, wid / 2 - 0.02].forEach(x => _cv.box(g, 0.05, 0.45, roofLen - 0.2, _cv.glass(), x, 1.25, roofZ));
                _cv.arches(g, wid, bodyMat);
                _cv.sideCrease(g, wid, 0.72, 0, len * 0.5, bodyMat);
                _cv.mirrors(g, wid, 1.15, roofZ + roofLen / 2 + 0.25, bodyMat);
                _cv.bumper(g, wid, 0.34, len / 2);
                _cv.bumper(g, wid, 0.34, -len / 2);
                _cv.grille(g, wid * 0.42, 0.62, len / 2 + 0.02);
                _cv.headlights(g, 0.62, len / 2 + 0.01, wid / 3.3);
                _cv.tailbar(g, 0.74, -len / 2 - 0.01, wid - 0.3);
                _cv.taillights(g, 0.6, -len / 2 - 0.01, wid / 3.3);
            },
            // ---- Archetype: low coupe / sports car ----
            coupe(g, color, o = {}) {
                const len = o.len || 4.2, wid = o.wid || 2;
                const bodyMat = _cv.phong(color, 120);
                _cv.shell(g, wid, 0.7, len, bodyMat, 0, 0.55, 0);
                // Long low bonnet
                _cv.box(g, wid - 0.3, 0.09, len * 0.34, bodyMat, 0, 0.92, len * 0.26);
                // Sloped fastback roof, tapering to the tail
                const roofMat = bodyMat;
                _cv.shell(g, wid - 0.3, 0.5, len * 0.45, roofMat, 0, 1.15, -0.2, { cap: 0.09, inset: 0.09 });
                _cv.box(g, wid - 0.5, 0.26, len * 0.3, roofMat, 0, 1.0, -len * 0.4, 0.22);
                _cv.box(g, wid - 0.55, 0.45, 0.1, _cv.glass(), 0, 1.1, 0.7, Math.PI / 5);
                _cv.box(g, wid - 0.55, 0.4, 0.1, _cv.glass(), 0, 1.05, -1.2, -Math.PI / 4.5);
                [-wid / 2 + 0.02, wid / 2 - 0.02].forEach(x =>
                    _cv.box(g, 0.05, 0.36, len * 0.34, _cv.glass(), x, 1.12, -0.2));
                // Side air intakes
                [-wid / 2 - 0.02, wid / 2 + 0.02].forEach(x =>
                    _cv.box(g, 0.06, 0.2, 0.6, _cv.trim(0x0c0c11), x, 0.55, 0.5));
                _cv.arches(g, wid, bodyMat);
                _cv.sideCrease(g, wid, 0.66, 0, len * 0.46, bodyMat);
                _cv.mirrors(g, wid, 1.02, 0.95, bodyMat);
                _cv.bumper(g, wid, 0.3, len / 2);
                _cv.bumper(g, wid, 0.3, -len / 2);
                _cv.grille(g, wid * 0.45, 0.55, len / 2 + 0.02);
                _cv.headlights(g, 0.55, len / 2 + 0.01, wid / 3.3);
                _cv.tailbar(g, 0.65, -len / 2 - 0.01, wid - 0.3);
                _cv.taillights(g, 0.55, -len / 2 - 0.01, wid / 3.3);
            },
            // ---- Archetype: supercar (mid-engine wedge) ----
            supercar(g, color, o = {}) {
                const len = o.len || 4.4, wid = o.wid || 2.05;
                const bodyMat = _cv.phong(color, 140);
                // Low wedge body
                _cv.shell(g, wid, 0.55, len, bodyMat, 0, 0.45, 0, { cap: 0.12, inset: 0.12 });
                // Wedge nose sloping down to the splitter
                _cv.box(g, wid - 0.22, 0.16, len * 0.26, bodyMat, 0, 0.62, len * 0.32, -0.18);
                // Cockpit bubble (mid-mounted, small)
                _cv.shell(g, wid - 0.45, 0.45, len * 0.35, bodyMat, 0, 0.95, -0.1, { cap: 0.09, inset: 0.09 });
                _cv.box(g, wid - 0.6, 0.4, 0.1, _cv.glass(), 0, 0.95, 0.5, Math.PI / 3.5);
                _cv.box(g, wid - 0.6, 0.35, 0.1, _cv.glass(), 0, 0.95, -0.7, -Math.PI / 3.5);
                // Roof scoop feeding the mid engine
                _cv.box(g, 0.34, 0.12, 0.5, _cv.trim(0x0c0c11), 0, 1.2, -0.35, 0, 0, 0, false);
                // Rear deck louvres over the engine bay
                for (let i = 0; i < 3; i++) {
                    _cv.box(g, wid - 0.6, 0.03, 0.12, _cv.trim(0x0a0a0e),
                        0, 0.78 - i * 0.02, -len * 0.3 - i * 0.16, 0.25, 0, 0, false);
                }
                // Front splitter
                _cv.box(g, wid - 0.05, 0.08, 0.45, _cv.trim(0x0c0c11), 0, 0.18, len / 2 - 0.2);
                // Side skirts, BETWEEN the wheels (wheels at z ±1.3 — full-length skirts
                // used to run straight through the tyres)
                [-wid / 2 + 0.05, wid / 2 - 0.05].forEach(x =>
                    _cv.box(g, 0.1, 0.18, 1.5, _cv.trim(0x0c0c11), x, 0.2, 0));
                _cv.arches(g, wid, bodyMat);
                _cv.mirrors(g, wid, 0.92, 0.75, bodyMat);
                // Quad exhaust tips
                [-0.45, -0.15, 0.15, 0.45].forEach(x =>
                    _cv.cyl(g, 0.07, 0.07, 0.16, 10, _cv.chrome(), x, 0.3, -len / 2 - 0.06, Math.PI / 2));
                // Rear wing
                if (o.wing !== false) {
                    [-wid / 2 + 0.35, wid / 2 - 0.35].forEach(x =>
                        _cv.box(g, 0.06, 0.35, 0.06, _cv.lambert(0x222222), x, 0.95, -len / 2 + 0.2));
                    _cv.box(g, wid - 0.4, 0.05, 0.4, _cv.lambert(0x111111), 0, 1.15, -len / 2 + 0.2);
                }
                _cv.headlights(g, 0.5, len / 2 + 0.01, wid / 3.3, o.headlightColor || 0xffffff);
                _cv.tailbar(g, 0.55, -len / 2 - 0.01, wid - 0.4);
                _cv.taillights(g, 0.5, -len / 2 - 0.01, wid / 3.3);
            },
            // ---- Archetype: SUV / crossover ----
            suv(g, color, o = {}) {
                const len = o.len || 4.2, wid = o.wid || 2.2, tall = o.tall || 1.2;
                const bodyMat = _cv.phong(color);
                _cv.shell(g, wid, 1.0, len, bodyMat, 0, 0.7, 0);
                _cv.shell(g, wid - 0.2, tall, len * 0.65, bodyMat, 0, 1.2 + tall / 2 - 0.5, -0.1, { cap: 0.1, inset: 0.1 });
                _cv.box(g, wid - 0.45, 0.6, 0.1, _cv.glass(), 0, 1.4, len * 0.3, Math.PI / 9);
                _cv.box(g, wid - 0.45, 0.6, 0.1, _cv.glass(), 0, 1.4, -len * 0.35);
                [-wid / 2 + 0.02, wid / 2 - 0.02].forEach(x =>
                    _cv.box(g, 0.05, 0.55, len * 0.55, _cv.glass(), x, 1.4, -0.1));
                // Roof rails
                [-1, 1].forEach(s =>
                    _cv.box(g, 0.07, 0.07, len * 0.55, _cv.trim(0x1a1a20),
                        s * (wid / 2 - 0.22), 1.25 + tall / 2, -0.1, 0, 0, 0, false));
                _cv.arches(g, wid, _cv.trim(0x101016), { r: 0.56 });
                _cv.sideCrease(g, wid, 0.85, 0, len * 0.5, bodyMat);
                _cv.mirrors(g, wid, 1.35, len * 0.22, bodyMat);
                // Chunky bumpers front and rear
                _cv.bumper(g, wid, 0.42, len / 2, { color: 0x1a1a20 });
                _cv.bumper(g, wid, 0.42, -len / 2, { color: 0x1a1a20 });
                _cv.grille(g, wid * 0.5, 0.86, len / 2 + 0.02);
                _cv.headlights(g, 0.85, len / 2 + 0.01, wid / 3);
                _cv.tailbar(g, 0.95, -len / 2 - 0.01, wid - 0.3);
                _cv.taillights(g, 0.85, -len / 2 - 0.01, wid / 3);
            },
            // ---- Archetype: muscle (long hood, blocky) ----
            muscle(g, color, o = {}) {
                const len = o.len || 4.5, wid = o.wid || 2.1;
                const bodyMat = _cv.phong(color);
                _cv.shell(g, wid, 0.85, len, bodyMat, 0, 0.6, 0);
                // Long flat muscle-car bonnet
                _cv.box(g, wid - 0.3, 0.1, len * 0.36, bodyMat, 0, 1.03, len * 0.26);
                _cv.shell(g, wid - 0.3, 0.55, len * 0.4, bodyMat, 0, 1.25, -0.5, { cap: 0.1, inset: 0.1 });
                _cv.box(g, wid - 0.55, 0.5, 0.1, _cv.glass(), 0, 1.2, 0.2, Math.PI / 5.5);
                _cv.box(g, wid - 0.55, 0.4, 0.1, _cv.glass(), 0, 1.15, -1.3, -Math.PI / 4.5);
                [-wid / 2 + 0.02, wid / 2 - 0.02].forEach(x =>
                    _cv.box(g, 0.05, 0.4, len * 0.3, _cv.glass(), x, 1.22, -0.5));
                // Hood scoop
                _cv.box(g, 0.6, 0.18, 0.6, _cv.trim(0x0c0c11), 0, 1.07, 0.9);
                _cv.box(g, 0.5, 0.07, 0.4, _cv.trim(0x050508), 0, 1.16, 1.0, 0, 0, 0, false);
                // Twin racing stripes down the centre
                [-0.17, 0.17].forEach(x =>
                    _cv.box(g, 0.13, 0.03, len * 0.88, _cv.trim(0xf2f2f5), x, 1.09, 0, 0, 0, 0, false));
                _cv.arches(g, wid, bodyMat, { r: 0.55 });
                _cv.sideCrease(g, wid, 0.74, 0, len * 0.5, bodyMat);
                _cv.mirrors(g, wid, 1.12, 0.45, bodyMat);
                _cv.bumper(g, wid, 0.34, len / 2, { color: 0x2a2a30 });
                _cv.bumper(g, wid, 0.34, -len / 2, { color: 0x2a2a30 });
                _cv.grille(g, wid * 0.55, 0.66, len / 2 + 0.02);
                // Twin exhaust
                [-0.6, 0.6].forEach(x =>
                    _cv.cyl(g, 0.08, 0.08, 0.3, 10, _cv.chrome(), x, 0.4, -len / 2 - 0.1, Math.PI / 2));
                _cv.headlights(g, 0.65, len / 2 + 0.01, wid / 3);
                _cv.tailbar(g, 0.7, -len / 2 - 0.01, wid - 0.3);
                _cv.taillights(g, 0.6, -len / 2 - 0.01, wid / 3);
            },
            // ---- Archetype: hatchback / small EV ----
            hatch(g, color, o = {}) {
                const len = o.len || 3.6, wid = o.wid || 1.85;
                const bodyMat = _cv.phong(color);
                _cv.shell(g, wid, 0.7, len, bodyMat, 0, 0.55, 0);
                _cv.shell(g, wid - 0.2, 0.65, len * 0.55, bodyMat, 0, 1.2, -0.4, { cap: 0.1, inset: 0.1 });
                _cv.box(g, wid - 0.45, 0.45, 0.1, _cv.glass(), 0, 1.2, 0.4, Math.PI / 6);
                _cv.box(g, wid - 0.45, 0.5, 0.1, _cv.glass(), 0, 1.2, -1.4, -Math.PI / 5);
                [-wid / 2 + 0.02, wid / 2 - 0.02].forEach(x =>
                    _cv.box(g, 0.05, 0.42, len * 0.4, _cv.glass(), x, 1.2, -0.4));
                // Contrast roof — small-hatch styling cue
                _cv.box(g, wid - 0.16, 0.06, len * 0.5, _cv.trim(0x15151c), 0, 1.53, -0.4, 0, 0, 0, false);
                _cv.arches(g, wid, _cv.trim(0x101016));
                _cv.sideCrease(g, wid, 0.64, 0, len * 0.44, bodyMat);
                _cv.mirrors(g, wid, 1.1, 0.55, bodyMat);
                _cv.bumper(g, wid, 0.3, len / 2);
                _cv.bumper(g, wid, 0.3, -len / 2);
                _cv.grille(g, wid * 0.4, 0.56, len / 2 + 0.02);
                _cv.headlights(g, 0.55, len / 2 + 0.01, wid / 3);
                _cv.tailbar(g, 0.7, -len / 2 - 0.01, wid - 0.3);
                _cv.taillights(g, 0.6, -len / 2 - 0.01, wid / 3);
            },
        };

        const carVisuals = {
            // -- Generic / starter sedans --
            starter: (g, d) => _cv.sedan(g, d.bodyColor),
            sport: (g, d) => _cv.coupe(g, d.bodyColor),
            muscle: (g, d) => _cv.muscle(g, d.bodyColor),
            super: (g, d) => _cv.supercar(g, d.bodyColor),
            hyper: (g, d) => {
                _cv.supercar(g, d.bodyColor);
                // Extra exotic accents: chrome air dam + neon underglow
                _cv.box(g, 1.6, 0.04, 0.04, _cv.emissive(0xff00ff), 0, 0.08, 0);
            },
            legend: (g, d) => {
                _cv.supercar(g, d.bodyColor);
                // Tron-style neon strips along sides
                [-0.95, 0.95].forEach(x => _cv.box(g, 0.04, 0.04, 3.5, _cv.emissive(0x00ffff), x, 0.35, 0));
            },
            // -- Tokyo EV --
            electric: (g, d) => _cv.hatch(g, d.bodyColor),
            // -- Drift / sport coupes --
            supra: (g, d) => {
                _cv.coupe(g, d.bodyColor, { len: 4.3 });
                // Tall rear wing (Supra MK4 signature)
                [-0.7, 0.7].forEach(x =>
                    _cv.box(g, 0.06, 0.5, 0.06, _cv.lambert(0x111111), x, 1.0, -1.9));
                _cv.box(g, 1.7, 0.06, 0.35, _cv.lambert(0x222222), 0, 1.25, -1.9);
            },
            m4supra: (g, d) => {
                _cv.coupe(g, d.bodyColor, { len: 4.3 });
                // Race-style wing + roof scoop
                [-0.75, 0.75].forEach(x =>
                    _cv.box(g, 0.06, 0.45, 0.06, _cv.lambert(0x111111), x, 0.95, -1.95));
                _cv.box(g, 1.8, 0.05, 0.4, _cv.lambert(0x222222), 0, 1.18, -1.95);
                _cv.box(g, 0.4, 0.08, 0.4, _cv.lambert(0x111111), 0, 1.42, -0.4);
            },
            // -- Mid-engine supercars --
            ferrari: (g, d) => {
                _cv.supercar(g, d.bodyColor, { len: 4.5, wid: 2.05 });
                // Quad taillights row
                [-0.55, -0.2, 0.2, 0.55].forEach(x =>
                    _cv.box(g, 0.18, 0.12, 0.06, _cv.emissive(0xff1a1a), x, 0.55, -2.27, 0, 0, 0, false));
            },
            mclaren: (g, d) => {
                _cv.supercar(g, d.bodyColor, { len: 4.5 });
                // Larger active aero wing
                [-0.85, 0.85].forEach(x =>
                    _cv.box(g, 0.07, 0.5, 0.06, _cv.lambert(0x111111), x, 1.0, -2.0));
                _cv.box(g, 2.0, 0.05, 0.45, _cv.lambert(0x222222), 0, 1.3, -2.0);
            },
            lec: (g, d) => {
                _cv.sedan(g, d.bodyColor, { len: 4.4 });
                // Race-stripe + huge rear wing for the LEC
                _cv.box(g, 0.3, 0.05, 3.6, _cv.emissive(0xffffff), 0, 1.02, -0.3);
                [-0.85, 0.85].forEach(x =>
                    _cv.box(g, 0.07, 0.5, 0.06, _cv.lambert(0x111111), x, 1.1, -2.15));
                _cv.box(g, 2.0, 0.06, 0.5, _cv.lambert(0x222222), 0, 1.4, -2.15);
            },
            aventador: (g, d) => {
                // Distinct angular Lambo: sharper wedge + bigger air intakes
                _cv.supercar(g, d.bodyColor, { len: 4.6, wid: 2.1, wing: false });
                // Custom rear wing
                [-0.85, 0.85].forEach(x =>
                    _cv.box(g, 0.07, 0.45, 0.06, _cv.lambert(0x111111), x, 1.0, -2.1));
                _cv.box(g, 2.0, 0.06, 0.45, _cv.lambert(0x222222), 0, 1.27, -2.1);
                // Y-shape headlight accents
                [-0.6, 0.6].forEach(x =>
                    _cv.box(g, 0.06, 0.06, 0.4, _cv.emissive(0xffffff), x, 0.5, 2.0));
            },
            nes2451: (g, d) => {
                _cv.supercar(g, d.bodyColor, { len: 4.4 });
                // Full-width neon LED strip front and rear
                _cv.box(g, 1.85, 0.05, 0.05, _cv.emissive(0x00ccff), 0, 0.45, 2.21);
                _cv.box(g, 1.85, 0.05, 0.05, _cv.emissive(0xff00ff), 0, 0.5, -2.21);
            },
            porsche: (g, d) => {
                // 911-style: rounded silhouette, sloping rear
                _cv.coupe(g, d.bodyColor, { len: 4.2 });
                // Round rear "hump" engine bay
                const humpMat = _cv.phong(d.bodyColor);
                _cv.cyl(g, 0.65, 0.65, 1.6, 16, humpMat, 0, 0.95, -1.4, 0, 0, Math.PI / 2);
                // Iconic ducktail
                _cv.box(g, 1.7, 0.05, 0.3, _cv.lambert(0x222222), 0, 1.05, -2.0);
            },
            // -- Genesis line: crossovers + sedans --
            gv60: (g, d) => _cv.suv(g, d.bodyColor, { len: 4.3, wid: 2.1, tall: 1.0 }),
            gv70veet: (g, d) => {
                _cv.suv(g, d.bodyColor, { len: 4.4, wid: 2.15, tall: 1.1 });
                // Sport accent: glossy lower trim
                _cv.box(g, 2.2, 0.15, 4.3, _cv.lambert(0x111111), 0, 0.2, 0);
            },
            genesisveet: (g, d) => {
                _cv.sedan(g, d.bodyColor, { len: 4.5 });
                // Twin-light signature
                [-0.5, -0.7].forEach(x => _cv.box(g, 0.04, 0.05, 0.05, _cv.emissive(0xffffcc), x, 0.7, 2.26));
                [0.5, 0.7].forEach(x => _cv.box(g, 0.04, 0.05, 0.05, _cv.emissive(0xffffcc), x, 0.7, 2.26));
            },
            genesisi5: (g, d) => _cv.hatch(g, d.bodyColor, { len: 4.0, wid: 1.95 }),
            // -- Hyundai --
            sonata: (g, d) => {
                _cv.sedan(g, d.bodyColor, { len: 4.1 });
                // Hidden DRL strip across the grille
                _cv.box(g, 1.7, 0.03, 0.04, _cv.emissive(0xffffff), 0, 0.62, 2.06);
            },
            // -- Ford --
            mustangev: (g, d) => {
                // Mach-E: SUV-coupe with sporty falling roof
                _cv.suv(g, d.bodyColor, { len: 4.3, wid: 2.1, tall: 0.95 });
                // Galloping-horse-style accent (just a strip)
                _cv.box(g, 1.6, 0.04, 0.05, _cv.emissive(0xff4400), 0, 0.65, 2.16);
            },
            // -- Tesla lineup --
            tesla: (g, d) => {
                // Model S Plaid: long sleek sedan, very smooth
                _cv.sedan(g, d.bodyColor, { len: 4.6, roofLen: 2.4 });
                // Full-width front LED bar
                _cv.box(g, 1.85, 0.04, 0.05, _cv.emissive(0xffffff), 0, 0.7, 2.31);
            },
            model3: (g, d) => {
                // Slightly shorter than Model S
                _cv.sedan(g, d.bodyColor, { len: 4.2, roofLen: 2.1 });
                // No grille — smooth front + minimal LED strip
                _cv.box(g, 1.5, 0.03, 0.04, _cv.emissive(0xddddff), 0, 0.7, 2.11);
            },
            modely: (g, d) => {
                // SUV-coupe — slightly taller than Model 3
                _cv.suv(g, d.bodyColor, { len: 4.3, wid: 2.0, tall: 1.0 });
                _cv.box(g, 1.5, 0.03, 0.04, _cv.emissive(0xddddff), 0, 0.85, 2.16);
            },
            modelx: (g, d) => {
                // Larger SUV, taller
                _cv.suv(g, d.bodyColor, { len: 4.5, wid: 2.2, tall: 1.25 });
                _cv.box(g, 1.6, 0.03, 0.04, _cv.emissive(0xddddff), 0, 0.85, 2.26);
                // Falcon-wing roof seam hint
                _cv.box(g, 0.04, 0.1, 1.2, _cv.lambert(0x111111), 0, 1.85, 0);
            },
            cybertruck: (g, d) => {
                // Brushed stainless steel: high metalness catches the neon like the real truck.
                const steel = new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 0.7, roughness: 0.34 });
                const dark = _cv.trim(0x141418);
                const glass = _cv.glass();
                // Extrude a side profile (drawn as car z/y) across the car's width.
                function side(shape, depth, mat, xCenter, cast) {
                    const geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: 14 });
                    geo.translate(0, 0, -depth / 2);
                    const m = new THREE.Mesh(geo, mat);
                    m.rotation.y = -Math.PI / 2;   // shape x -> car z, extrusion -> car x
                    m.position.x = xCenter;
                    m.castShadow = cast !== false;
                    g.add(m);
                    return m;
                }
                // The signature triangle silhouette, with wheel wells cut at the real wheel
                // positions (z ±2.0, centre 0.15). The old flares sat at ±1.8.
                const s = 0.18;
                const body = new THREE.Shape();
                body.moveTo(2.65, 0.25);
                body.lineTo(2.65, 0.66);                            // nose
                body.lineTo(0.2, 1.64);                             // windscreen up to the peak
                body.lineTo(-2.65, 1.04);                           // long tonneau down to the tail
                body.lineTo(-2.65, 0.25);
                body.lineTo(-2.0 - 0.56 * Math.cos(s), 0.25);
                body.absarc(-2.0, 0.15, 0.56, Math.PI - s, s, true);  // rear wheel well
                body.lineTo(2.0 - 0.56 * Math.cos(s), 0.25);
                body.absarc(2.0, 0.15, 0.56, Math.PI - s, s, true);   // front wheel well
                body.lineTo(2.65, 0.25);
                side(body, 2.3, steel, 0);
                // Tinted windscreen lying on the front slope
                _cv.box(g, 2.0, 0.02, 1.4, glass, 0, 1.355, 0.956, 0.38, 0, 0, false);
                // Side windows following the roofline
                const win = new THREE.Shape();
                win.moveTo(1.5, 0.98);
                win.lineTo(1.25, 1.12);
                win.lineTo(0.2, 1.54);
                win.lineTo(-1.3, 1.22);
                win.lineTo(-1.3, 0.98);
                win.lineTo(1.5, 0.98);
                [-1, 1].forEach(sd => side(win, 0.02, glass, sd * 1.16, false));
                // Black arch cladding and a dark sill between the wheels
                _cv.arches(g, 2.3, dark, { zs: [2.0, -2.0], y: 0.15, r: 0.6, floor: 0.24 });
                [-1, 1].forEach(sd => _cv.box(g, 0.05, 0.14, 2.8, dark, sd * 1.165, 0.32, 0, 0, 0, 0, false));
                _cv.mirrors(g, 2.6, 1.05, 1.55, steel);
                // Full-width light bars front and rear
                _cv.box(g, 2.1, 0.05, 0.04, _cv.emissive(0xffffff), 0, 0.61, 2.66, 0, 0, 0, false);
                _cv.box(g, 2.1, 0.05, 0.04, _cv.emissive(0xff1a1a), 0, 0.98, -2.66, 0, 0, 0, false);
            },
            // -- Trucks / commercial --
            trailer: (g, d) => carVisuals._builtinTrailer(g, d),
            gtbh: (g, d) => {
                // Box truck. The cab now sits over the front wheels (z 2.8) and the cargo box
                // reaches past the rear wheels (z -4.0) — they used to hang out the back.
                const bodyMat = _cv.phong(d.bodyColor);
                const trim = _cv.trim();
                const boxMat = new THREE.MeshStandardMaterial({ color: 0xe6e6ea, metalness: 0.15, roughness: 0.6 });
                _cv.shell(g, 2.2, 1.4, 2.4, bodyMat, 0, 0.9, 2.3);
                _cv.shell(g, 2.1, 0.8, 1.9, bodyMat, 0, 1.95, 2.15, { cap: 0.1, inset: 0.08 });
                _cv.box(g, 1.9, 0.62, 0.08, _cv.glass(), 0, 1.95, 3.1, 0.12, 0, 0, false);
                [-1, 1].forEach(sd => _cv.box(g, 0.05, 0.55, 1.2, _cv.glass(), sd * 1.06, 1.95, 2.35, 0, 0, 0, false));
                // Cargo box with ribbed sides (ribs kept above the rear arch)
                _cv.box(g, 2.4, 2.4, 5.4, boxMat, 0, 1.5, -1.95);
                for (let i = 0; i < 6; i++) {
                    [-1, 1].forEach(sd => _cv.box(g, 0.04, 1.85, 0.06, _cv.trim(0xb4b4ba),
                        sd * 1.22, 1.72, 0.5 - i * 0.95, 0, 0, 0, false));
                }
                _cv.box(g, 2.3, 0.2, 5.3, trim, 0, 0.25, -1.95);   // chassis rail
                _cv.arches(g, 2.2, trim, { zs: [2.8], y: 0.2, r: 0.6 });
                _cv.arches(g, 2.4, trim, { zs: [-4.0], y: 0.15, r: 0.6 });
                _cv.mirrors(g, 2.6, 1.7, 3.0, trim);
                _cv.grille(g, 1.1, 0.75, 3.52);
                _cv.bumper(g, 2.3, 0.3, 3.5, { color: 0x9a9ea6 });
                _cv.headlights(g, 0.75, 3.51, 0.8);
                _cv.tailbar(g, 0.55, -4.66, 1.8);
                _cv.taillights(g, 0.55, -4.66, 0.95);
            },
            // -- Pickup / offroad --
            f550: (g, d) => carVisuals._builtinPickup(g, d),
            raptor: (g, d) => {
                // Off-road pickup. Fender flares are now centred on the real wheels (z ±1.6);
                // they used to sit at 1.7 / -1.5.
                const bodyMat = _cv.phong(d.bodyColor);
                const trim = _cv.trim(0x17171c);
                _cv.shell(g, 2.4, 0.8, 5, bodyMat, 0, 0.6, 0);
                _cv.shell(g, 2.3, 1.05, 2.3, bodyMat, 0, 1.55, 0.9, { cap: 0.12, inset: 0.1 });
                _cv.box(g, 2.0, 0.75, 0.1, _cv.glass(), 0, 1.6, 2.05, Math.PI / 8, 0, 0, false);
                _cv.box(g, 1.8, 0.55, 0.1, _cv.glass(), 0, 1.5, -0.24, 0, 0, 0, false);
                [-1, 1].forEach(sd => _cv.box(g, 0.06, 0.5, 1.8, _cv.glass(), sd * 1.13, 1.62, 0.95, 0, 0, 0, false));
                // Bed
                [-1.15, 1.15].forEach(x => _cv.box(g, 0.1, 0.6, 2.5, bodyMat, x, 1.3, -1.35));
                _cv.box(g, 2.3, 0.6, 0.1, bodyMat, 0, 1.3, -2.55);
                _cv.box(g, 2.2, 0.05, 2.4, trim, 0, 1.03, -1.35, 0, 0, 0, false);
                // Off-road fender flares: flat top, raked front and back edges, dark liner
                [[-1, 1.6], [1, 1.6], [-1, -1.6], [1, -1.6]].forEach(([sd, z]) => {
                    _cv.box(g, 0.08, 0.5, 1.15, _cv.trim(0x05050a), sd * 1.18, 0.55, z, 0, 0, 0, false);
                    _cv.box(g, 0.28, 0.12, 1.3, trim, sd * 1.32, 0.86, z);
                    _cv.box(g, 0.26, 0.42, 0.12, trim, sd * 1.32, 0.62, z + 0.6, 0.35);
                    _cv.box(g, 0.26, 0.42, 0.12, trim, sd * 1.32, 0.62, z - 0.6, -0.35);
                });
                // Big dark grille with a chrome bar
                _cv.box(g, 2.0, 0.55, 0.1, trim, 0, 0.72, 2.52, 0, 0, 0, false);
                _cv.box(g, 1.3, 0.14, 0.12, _cv.chrome(), 0, 0.74, 2.56, 0, 0, 0, false);
                // Roof LED bar, now sitting on the roof instead of floating above it
                _cv.box(g, 1.6, 0.1, 0.2, _cv.emissive(0xffffff), 0, 2.13, 1.5, 0, 0, 0, false);
                _cv.box(g, 2.6, 0.32, 0.3, trim, 0, 0.3, 2.6);
                _cv.box(g, 2.5, 0.3, 0.25, trim, 0, 0.3, -2.62);
                _cv.mirrors(g, 2.7, 1.5, 1.85, bodyMat);
                _cv.headlights(g, 0.8, 2.51, 1.0);
                _cv.tailbar(g, 0.85, -2.51, 1.7);
                _cv.taillights(g, 0.7, -2.51, 0.9);
            },
            wrangler: (g, d) => carVisuals._builtinOffroad(g, d),
            // -- Race car --
            gr4: (g, d) => carVisuals._builtinRaceCar(g, d),

            // === Built-in detailed builders (used by trailer/pickup/offroad/race archetypes) ===
            _builtinTrailer(g, d) {
                const bodyMat = _cv.phong(d.bodyColor);
                const trim = _cv.trim();
                const chrome = _cv.chrome();
                const boxMat = new THREE.MeshStandardMaterial({ color: 0xdedee4, metalness: 0.15, roughness: 0.6 });
                // Cab: front wheels (z 2.8) sit under it
                _cv.shell(g, 2.4, 1.4, 2.5, bodyMat, 0, 0.9, 2.5);
                _cv.shell(g, 2.2, 0.6, 2.0, bodyMat, 0, 1.9, 2.3, { cap: 0.1, inset: 0.08 });
                _cv.box(g, 2.0, 0.8, 0.2, bodyMat, 0, 2.4, 1.5, -0.3);             // wind deflector
                // Windscreen on the upper cab (it used to float in front of it)
                _cv.box(g, 2.0, 0.5, 0.1, _cv.glass(), 0, 1.9, 3.3, Math.PI / 10, 0, 0, false);
                [-1, 1].forEach(sd => _cv.box(g, 0.05, 0.4, 1.3, _cv.glass(), sd * 1.11, 1.9, 2.5, 0, 0, 0, false));
                // Chrome grille, bumper and exhaust stacks
                _cv.box(g, 1.3, 0.8, 0.08, trim, 0, 0.9, 3.77, 0, 0, 0, false);
                for (let i = 0; i < 6; i++) _cv.box(g, 1.2, 0.04, 0.1, chrome, 0, 0.6 + i * 0.12, 3.81, 0, 0, 0, false);
                _cv.headlights(g, 0.7, 3.76, 0.9);
                _cv.box(g, 2.6, 0.4, 0.3, chrome, 0, 0.3, 3.9);
                [-1.3, 1.3].forEach(x => {
                    _cv.cyl(g, 0.12, 0.12, 2, 10, chrome, x, 2.2, 1.8);
                    _cv.cyl(g, 0.14, 0.11, 0.14, 10, trim, x, 3.25, 1.8);
                });
                _cv.mirrors(g, 2.9, 1.5, 3.2, trim);
                // Trailer box: rear wheels (z -4.0) sit under it
                _cv.box(g, 2.6, 2.8, 7, boxMat, 0, 1.6, -2.3);
                for (let i = 0; i < 7; i++) {
                    [-1, 1].forEach(sd => _cv.box(g, 0.04, 1.8, 0.06, _cv.trim(0xb4b4ba),
                        sd * 1.32, 2.05, 0.9 - i * 1.0, 0, 0, 0, false));
                }
                _cv.box(g, 2.4, 0.3, 7, trim, 0, 0.15, -2.3);
                _cv.arches(g, 2.4, trim, { zs: [2.8], y: 0.2, r: 0.6 });
                _cv.arches(g, 2.6, trim, { zs: [-4.0], y: 0.15, r: 0.6 });
                // Amber side reflectors, above the rear arch
                const amber = _cv.emissive(0xff5500);
                [-1, 1].forEach(sd => {
                    for (let i = 0; i < 5; i++) _cv.box(g, 0.04, 0.12, 0.6, amber, sd * 1.32, 0.95, -0.5 - i * 1.2, 0, 0, 0, false);
                });
                _cv.taillights(g, 1.0, -5.81, 0.9);
                _cv.tailbar(g, 0.4, -5.81, 2.2);
            },
            _builtinPickup(g, d) {
                const bodyMat = _cv.phong(d.bodyColor);
                const trim = _cv.trim();
                _cv.shell(g, 2.4, 0.8, 5, bodyMat, 0, 0.6, 0);
                _cv.shell(g, 2.3, 1.0, 2.2, bodyMat, 0, 1.5, 1.0, { cap: 0.12, inset: 0.1 });
                _cv.box(g, 2.2, 0.12, 2.1, bodyMat, 0, 2.06, 1.0);
                _cv.box(g, 2.0, 0.7, 0.1, _cv.glass(), 0, 1.6, 2.1, Math.PI / 8, 0, 0, false);
                _cv.box(g, 1.8, 0.5, 0.1, _cv.glass(), 0, 1.55, -0.12, 0, 0, 0, false);
                [-1, 1].forEach(sd => _cv.box(g, 0.06, 0.5, 1.7, _cv.glass(), sd * 1.13, 1.6, 1.05, 0, 0, 0, false));
                // Bed with a dark liner
                [-1.15, 1.15].forEach(x => _cv.box(g, 0.1, 0.6, 2.4, bodyMat, x, 1.3, -1.3));
                _cv.box(g, 2.3, 0.6, 0.1, bodyMat, 0, 1.3, -2.5);
                _cv.box(g, 2.2, 0.06, 2.3, trim, 0, 1.03, -1.3, 0, 0, 0, false);
                // Arches on the real wheels (z ±2.0)
                _cv.arches(g, 2.4, trim, { zs: [2.0, -2.0], y: 0.15, r: 0.58 });
                _cv.mirrors(g, 2.7, 1.55, 1.85, bodyMat);
                _cv.grille(g, 1.3, 0.8, 2.52);
                _cv.bumper(g, 2.5, 0.32, 2.55, { color: 0x9a9ea6 });
                _cv.bumper(g, 2.5, 0.3, -2.55, { color: 0x9a9ea6 });
                _cv.headlights(g, 0.8, 2.51, 0.85);
                _cv.taillights(g, 0.75, -2.52, 0.95);
            },
            _builtinOffroad(g, d) {
                const bodyMat = _cv.phong(d.bodyColor);
                const trim = _cv.trim(0x1a1a1f);
                const chrome = _cv.chrome();
                _cv.shell(g, 2.4, 1.0, 4.4, bodyMat, 0, 0.8, 0);
                _cv.shell(g, 2.3, 1.0, 2.8, bodyMat, 0, 1.8, -0.2, { cap: 0.1, inset: 0.08 });
                _cv.box(g, 2.2, 0.12, 2.7, trim, 0, 2.36, -0.2);                   // hard top
                [-0.8, 0, 0.8].forEach(z => _cv.box(g, 2.3, 0.08, 0.08, chrome, 0, 2.46, -0.2 + z, 0, 0, 0, false));
                _cv.box(g, 2.0, 0.8, 0.1, _cv.glass(), 0, 1.8, 1.2, Math.PI / 12, 0, 0, false);
                _cv.box(g, 1.8, 0.6, 0.1, _cv.glass(), 0, 1.8, -1.62, 0, 0, 0, false);
                [-1.16, 1.16].forEach(x => _cv.box(g, 0.08, 0.6, 2.0, _cv.glass(), x, 1.8, -0.1, 0, 0, 0, false));
                // Square fender flares over the real wheels (z ±1.6)
                [[-1, 1.6], [1, 1.6], [-1, -1.6], [1, -1.6]].forEach(([sd, z]) => {
                    _cv.box(g, 0.08, 0.5, 1.1, _cv.trim(0x05050a), sd * 1.18, 0.6, z, 0, 0, 0, false);
                    _cv.box(g, 0.3, 0.12, 1.25, trim, sd * 1.32, 0.86, z);
                    _cv.box(g, 0.28, 0.42, 0.12, trim, sd * 1.32, 0.62, z + 0.6, 0.35);
                    _cv.box(g, 0.28, 0.42, 0.12, trim, sd * 1.32, 0.62, z - 0.6, -0.35);
                });
                // Seven-slot grille between round headlights
                _cv.box(g, 1.8, 0.6, 0.15, trim, 0, 0.9, 2.2);
                for (let i = 0; i < 7; i++) _cv.box(g, 0.09, 0.45, 0.05, chrome, -0.42 + i * 0.14, 0.9, 2.29, 0, 0, 0, false);
                [-0.72, 0.72].forEach(x => {
                    _cv.cyl(g, 0.23, 0.23, 0.08, 18, chrome, x, 1.0, 2.25, Math.PI / 2);
                    _cv.cyl(g, 0.18, 0.18, 0.1, 18, _cv.emissive(0xffffcc), x, 1.0, 2.27, Math.PI / 2);
                });
                _cv.box(g, 2.6, 0.35, 0.35, trim, 0, 0.35, 2.35);                  // steel bumpers
                _cv.box(g, 2.5, 0.3, 0.25, trim, 0, 0.35, -2.25);
                _cv.mirrors(g, 2.8, 1.5, 1.0, bodyMat);
                _cv.taillights(g, 0.9, -2.21, 0.8);
                // Spare tyre on the tailgate
                _cv.cyl(g, 0.5, 0.5, 0.3, 18, _cv.trim(0x111114), 0, 1.25, -2.4, Math.PI / 2);
                _cv.cyl(g, 0.2, 0.2, 0.32, 10, chrome, 0, 1.25, -2.4, Math.PI / 2);
            },
            _builtinRaceCar(g, d) {
                const bodyMat = _cv.phong(d.bodyColor, 140);
                const carbon = _cv.trim(0x111114);
                _cv.shell(g, 2.2, 0.45, 4.6, bodyMat, 0, 0.35, 0, { cap: 0.1, inset: 0.1 });
                _cv.box(g, 2.4, 0.08, 0.6, carbon, 0, 0.12, 2.4);                  // splitter
                // Side skirts only BETWEEN the wheels (the old full-length ones ran through the tyres)
                [-1.15, 1.15].forEach(x => _cv.box(g, 0.12, 0.2, 2.1, carbon, x, 0.2, 0));
                _cv.shell(g, 1.6, 0.4, 1.6, bodyMat, 0, 0.78, -0.2, { cap: 0.08, inset: 0.08 });
                _cv.box(g, 1.4, 0.35, 0.08, _cv.glass(), 0, 0.8, 0.6, Math.PI / 4, 0, 0, false);
                _cv.box(g, 1.3, 0.25, 0.08, _cv.glass(), 0, 0.75, -1.0, -Math.PI / 5, 0, 0, false);
                [-1, 1].forEach(sd => _cv.box(g, 0.05, 0.22, 1.1, _cv.glass(), sd * 0.79, 0.8, -0.2, 0, 0, 0, false));
                _cv.box(g, 0.08, 0.14, 0.8, carbon, 0, 1.04, -0.6);                // roof fin
                // Diffuser with fins
                _cv.box(g, 2.0, 0.3, 0.5, carbon, 0, 0.18, -2.4);
                for (let i = -2; i <= 2; i++) _cv.box(g, 0.04, 0.26, 0.52, carbon, i * 0.36, 0.2, -2.42, 0, 0, 0, false);
                // Rear wing: stands now reach down to the deck (they used to float above it)
                [-0.7, 0.7].forEach(x => _cv.box(g, 0.08, 0.72, 0.08, carbon, x, 0.94, -2.0));
                _cv.box(g, 2.0, 0.06, 0.5, carbon, 0, 1.3, -2.0);
                [-1, 1].forEach(sd => _cv.box(g, 0.04, 0.3, 0.6, carbon, sd * 1.0, 1.24, -2.0, 0, 0, 0, false));
                _cv.arches(g, 2.2, bodyMat, { zs: [1.5, -1.5], y: 0.05, r: 0.44 });
                _cv.mirrors(g, 2.0, 0.86, 0.35, bodyMat);
                [-0.7, 0.7].forEach(x => _cv.box(g, 0.5, 0.06, 0.06, _cv.emissive(0xffffff), x, 0.45, 2.3, 0, 0, 0, false));
                _cv.box(g, 1.8, 0.06, 0.06, _cv.emissive(0xff1a1a), 0, 0.45, -2.3, 0, 0, 0, false);
                [-0.6, 0.6].forEach(x => _cv.box(g, 0.5, 0.15, 0.1, carbon, x, 0.3, 2.3));
            }
        };

        const _iv = {
            mat: (c) => new THREE.MeshBasicMaterial({ color: c, depthTest: false }),
            tMat: (c, op) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: op }),
            box(g, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
                m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
                g.add(m); return m;
            },
            cyl(g, rt, rb, h, seg, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
                const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
                m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
                g.add(m); return m;
            },
            torus(g, r, tube, mat, x, y, z, rx = 0) {
                const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 28), mat);
                m.position.set(x, y, z); m.rotation.x = rx;
                g.add(m); return m;
            },
            plane(g, w, h, mat, x, y, z) {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
                m.position.set(x, y, z);
                g.add(m); return m;
            },

            // Instrument cluster: bezel + live dash screen.
            // Default position is driver-left (matches car visual builders' wheel pos).
            cluster(g, dashTex, x = -0.4, y = 0.52, z = 0.5, w = 0.40, h = 0.158, trim = 0x2a2a2a) {
                _iv.box(g, w + 0.04, h + 0.03, 0.015, _iv.mat(trim), x, y, z + 0.01);
                const screenMat = new THREE.MeshBasicMaterial({
                    map: dashTex, depthTest: false, side: THREE.DoubleSide, toneMapped: false
                });
                _iv.plane(g, w, h, screenMat, x, y, z);
            },

            // Tesla-style wide horizontal touch display (center of dash)
            wideScreen(g, dashTex, x = 0, y = 0.55, z = 0.55, w = 0.7, h = 0.28, trim = 0x111111) {
                _iv.box(g, w + 0.04, h + 0.03, 0.015, _iv.mat(trim), x, y, z + 0.01);
                const screenMat = new THREE.MeshBasicMaterial({
                    map: dashTex, depthTest: false, side: THREE.DoubleSide, toneMapped: false
                });
                _iv.plane(g, w, h, screenMat, x, y, z);
            },

            // ---- Steering wheel archetypes. Each returns the spin group. ----
            wheelRound(g, x = -0.4, y = 0.43, z = 0.36, accent = 0x00d9ff, rim = 0x3a3a42, grip = 0x1a1a1f) {
                const wheelGroup = new THREE.Group();
                wheelGroup.position.set(x, y, z);
                wheelGroup.rotation.x = Math.PI / 2.6;
                const spin = new THREE.Group();
                wheelGroup.add(spin);
                _iv.torus(spin, 0.2, 0.035, _iv.mat(rim), 0, 0, 0);
                _iv.cyl(spin, 0.07, 0.07, 0.05, 16, _iv.mat(grip), 0, 0, 0, Math.PI / 2);
                [0, (2 * Math.PI) / 3, -(2 * Math.PI) / 3].forEach(ang => {
                    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.035), _iv.mat(grip));
                    sp.position.set(Math.sin(ang) * 0.09, -Math.cos(ang) * 0.09, 0);
                    sp.rotation.z = -ang;
                    spin.add(sp);
                });
                _iv.box(spin, 0.05, 0.05, 0.05, _iv.mat(accent), 0, 0.2, 0);
                g.add(wheelGroup);
                steeringWheelSpin = spin;
                return spin;
            },
            wheelFlatBottom(g, x = -0.4, y = 0.43, z = 0.36, accent = 0xff2244, rim = 0x222226, grip = 0x111114) {
                const wheelGroup = new THREE.Group();
                wheelGroup.position.set(x, y, z);
                wheelGroup.rotation.x = Math.PI / 2.6;
                const spin = new THREE.Group();
                wheelGroup.add(spin);
                // Half-torus for top + sides; flat bar for bottom
                const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 10, 28, Math.PI * 1.5), _iv.mat(rim));
                ring.rotation.z = -Math.PI / 4;
                spin.add(ring);
                _iv.box(spin, 0.28, 0.04, 0.04, _iv.mat(rim), 0, -0.16, 0);
                _iv.cyl(spin, 0.08, 0.08, 0.05, 16, _iv.mat(grip), 0, 0, 0, Math.PI / 2);
                // 3 spokes
                [-0.5, 0.5].forEach(s => _iv.box(spin, 0.18, 0.025, 0.03, _iv.mat(grip), s * 0.1, -0.06, 0, 0, 0, s * 0.3));
                _iv.box(spin, 0.025, 0.18, 0.025, _iv.mat(grip), 0, 0.1, 0);
                // Accent stripe at top
                _iv.box(spin, 0.06, 0.04, 0.04, _iv.mat(accent), 0, 0.18, 0.01);
                g.add(wheelGroup);
                steeringWheelSpin = spin;
                return spin;
            },
            wheelYoke(g, x = -0.4, y = 0.43, z = 0.36, accent = 0xffffff, rim = 0x1a1a1a, grip = 0x0a0a0a) {
                const wheelGroup = new THREE.Group();
                wheelGroup.position.set(x, y, z);
                wheelGroup.rotation.x = Math.PI / 2.6;
                const spin = new THREE.Group();
                wheelGroup.add(spin);
                // Yoke = two horizontal grips, no top arc
                _iv.box(spin, 0.4, 0.05, 0.05, _iv.mat(rim), 0, 0, 0);
                [-0.18, 0.18].forEach(s => _iv.box(spin, 0.07, 0.13, 0.07, _iv.mat(grip), s, 0, 0));
                _iv.cyl(spin, 0.07, 0.07, 0.04, 12, _iv.mat(rim), 0, 0, 0, Math.PI / 2);
                _iv.box(spin, 0.04, 0.04, 0.04, _iv.mat(accent), 0, 0, 0.04);
                g.add(wheelGroup);
                steeringWheelSpin = spin;
                return spin;
            },
            wheelHex(g, x = -0.4, y = 0.43, z = 0.36, accent = 0xff00ff, rim = 0x222226, grip = 0x111114) {
                const wheelGroup = new THREE.Group();
                wheelGroup.position.set(x, y, z);
                wheelGroup.rotation.x = Math.PI / 2.6;
                const spin = new THREE.Group();
                wheelGroup.add(spin);
                // Hexagonal rim from 6 box segments
                const r = 0.2;
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.04), _iv.mat(rim));
                    seg.position.set(Math.sin(a) * r, Math.cos(a) * r, 0);
                    seg.rotation.z = -a + Math.PI / 6;
                    spin.add(seg);
                }
                _iv.cyl(spin, 0.075, 0.075, 0.05, 6, _iv.mat(grip), 0, 0, 0, Math.PI / 2);
                _iv.box(spin, 0.06, 0.06, 0.06, _iv.mat(accent), 0, 0, 0.04);
                g.add(wheelGroup);
                steeringWheelSpin = spin;
                return spin;
            },
            wheel2Spoke(g, x = -0.4, y = 0.43, z = 0.36, accent = 0xffaa00, rim = 0x222226, grip = 0x4a3a2a) {
                const wheelGroup = new THREE.Group();
                wheelGroup.position.set(x, y, z);
                wheelGroup.rotation.x = Math.PI / 2.6;
                const spin = new THREE.Group();
                wheelGroup.add(spin);
                _iv.torus(spin, 0.2, 0.035, _iv.mat(rim), 0, 0, 0);
                _iv.cyl(spin, 0.09, 0.09, 0.06, 16, _iv.mat(grip), 0, 0, 0, Math.PI / 2);
                // 2 horizontal spokes (classic 60s/70s look)
                _iv.box(spin, 0.36, 0.025, 0.03, _iv.mat(grip), 0, 0, 0);
                _iv.box(spin, 0.05, 0.05, 0.05, _iv.mat(accent), 0, 0.2, 0);
                g.add(wheelGroup);
                steeringWheelSpin = spin;
                return spin;
            },
            wheelRace(g, x = -0.4, y = 0.43, z = 0.36, accent = 0xffcc00, rim = 0x111111, grip = 0x222226) {
                const wheelGroup = new THREE.Group();
                wheelGroup.position.set(x, y, z);
                wheelGroup.rotation.x = Math.PI / 2.6;
                const spin = new THREE.Group();
                wheelGroup.add(spin);
                // D-shape: half torus + flat bar
                const top = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 10, 28, Math.PI), _iv.mat(rim));
                top.rotation.z = 0;
                spin.add(top);
                _iv.box(spin, 0.36, 0.05, 0.05, _iv.mat(rim), 0, 0, 0);
                _iv.box(spin, 0.18, 0.1, 0.06, _iv.mat(grip), 0, -0.06, 0.01);
                // LED rev strip across top
                _iv.box(spin, 0.14, 0.03, 0.03, _iv.mat(accent), 0, 0.16, 0.02);
                // Side switches
                [-0.13, 0.13].forEach(s => _iv.box(spin, 0.04, 0.04, 0.04, _iv.mat(0x880000), s, -0.04, 0.03));
                g.add(wheelGroup);
                steeringWheelSpin = spin;
                return spin;
            },
            wheelMini(g, x = -0.4, y = 0.43, z = 0.36, accent = 0xffffff, rim = 0x1a1a1a, grip = 0x0a0a0a) {
                const wheelGroup = new THREE.Group();
                wheelGroup.position.set(x, y, z);
                wheelGroup.rotation.x = Math.PI / 2.6;
                const spin = new THREE.Group();
                wheelGroup.add(spin);
                _iv.torus(spin, 0.14, 0.025, _iv.mat(rim), 0, 0, 0);
                _iv.cyl(spin, 0.05, 0.05, 0.04, 16, _iv.mat(grip), 0, 0, 0, Math.PI / 2);
                // 4 thin spokes
                [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach(ang => {
                    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.13, 0.025), _iv.mat(grip));
                    sp.position.set(Math.sin(ang) * 0.06, -Math.cos(ang) * 0.06, 0);
                    sp.rotation.z = -ang;
                    spin.add(sp);
                });
                _iv.box(spin, 0.03, 0.03, 0.03, _iv.mat(accent), 0, 0.14, 0);
                g.add(wheelGroup);
                steeringWheelSpin = spin;
                return spin;
            },

            // ---- Dashboard archetypes ----
            dashStd(g, color = 0x0a0a0a, accent = null) {
                _iv.box(g, 1.8, 0.22, 0.4, _iv.mat(color), 0, 0.55, 0.7);
                if (accent !== null) _iv.box(g, 1.8, 0.02, 0.06, _iv.mat(accent), 0, 0.67, 0.51);
            },
            dashSport(g, color = 0x111111, accent = null) {
                _iv.box(g, 1.9, 0.25, 0.42, _iv.mat(color), 0, 0.55, 0.7);
                _iv.box(g, 1.9, 0.04, 0.05, _iv.mat(0x222226), 0, 0.69, 0.49);
                if (accent !== null) _iv.box(g, 1.9, 0.015, 0.05, _iv.mat(accent), 0, 0.71, 0.49);
            },
            dashTruck(g, color = 0x0a0a0a, accent = null) {
                _iv.box(g, 2.2, 0.3, 0.45, _iv.mat(color), 0, 0.6, 0.75);
                if (accent !== null) _iv.box(g, 2.2, 0.02, 0.06, _iv.mat(accent), 0, 0.78, 0.53);
            },
            dashMinimal(g, color = 0x0a0a0a, accent = null) {
                _iv.box(g, 1.85, 0.12, 0.38, _iv.mat(color), 0, 0.5, 0.7);
                if (accent !== null) _iv.box(g, 1.85, 0.02, 0.04, _iv.mat(accent), 0, 0.57, 0.52);
            },
            dashFuturistic(g, color = 0x0a0a14, accent = 0x00d9ff) {
                _iv.box(g, 1.9, 0.18, 0.4, _iv.mat(color), 0, 0.55, 0.7);
                // Holo-style accent strips
                _iv.box(g, 1.9, 0.015, 0.04, _iv.mat(accent), 0, 0.66, 0.51);
                _iv.box(g, 1.9, 0.015, 0.04, _iv.mat(accent), 0, 0.46, 0.51);
            },
            dashLuxury(g, color = 0x1a0f0a, accent = 0xc4a878) {
                _iv.box(g, 1.9, 0.22, 0.4, _iv.mat(color), 0, 0.55, 0.7);
                // Wood/metal trim strip
                _iv.box(g, 1.9, 0.04, 0.04, _iv.mat(accent), 0, 0.6, 0.51);
                _iv.box(g, 1.9, 0.015, 0.03, _iv.mat(0x886644), 0, 0.62, 0.51);
            },
            dashRace(g, color = 0x0a0a0a, accent = 0xff0000) {
                _iv.box(g, 1.7, 0.15, 0.32, _iv.mat(color), 0, 0.5, 0.65);
                // Switch panel
                for (let i = 0; i < 6; i++) {
                    _iv.box(g, 0.05, 0.05, 0.04, _iv.mat(i % 2 === 0 ? 0xff0000 : 0x222226), -0.3 + i * 0.12, 0.5, 0.51);
                }
                if (accent !== null) _iv.box(g, 1.7, 0.015, 0.04, _iv.mat(accent), 0, 0.58, 0.51);
            },
        };

        const interiorVisuals = {
            starter: (g, dt) => {
                _iv.dashStd(g, 0x0a0a0a);
                _iv.cluster(g, dt);
                _iv.wheelRound(g);
            },
            sport: (g, dt) => {
                _iv.dashSport(g, 0x111111, 0xff2244);
                _iv.cluster(g, dt);
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0xff2244);
            },
            muscle: (g, dt) => {
                _iv.dashStd(g, 0x1a1a1a, 0x44aa44);
                _iv.cluster(g, dt);
                _iv.wheel2Spoke(g, -0.4, 0.43, 0.36, 0x44ff44, 0x888888, 0x4a3a2a);
            },
            super: (g, dt) => {
                _iv.dashSport(g, 0x0a0a0a, 0xffcc00);
                _iv.cluster(g, dt);
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0xffcc00, 0x111111, 0x0a0a0a);
            },
            hyper: (g, dt) => {
                _iv.dashFuturistic(g, 0x1a0a1a, 0xff00ff);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.5, 0.18, 0xff00ff);
                _iv.wheelHex(g, -0.4, 0.43, 0.36, 0xff00ff);
            },
            legend: (g, dt) => {
                _iv.dashFuturistic(g, 0x0a1a1a, 0x00ffff);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.5, 0.18, 0x00ffff);
                // Tron-style cyan glowing rim
                _iv.wheelRound(g, -0.4, 0.43, 0.36, 0x00ffff, 0x00ffff, 0x002a3a);
            },
            electric: (g, dt) => {
                _iv.dashMinimal(g, 0x0a0a0a, 0x00ff88);
                _iv.cluster(g, dt);
                _iv.wideScreen(g, dt, 0.0, 0.5, 0.52, 0.4, 0.16);
                _iv.wheelMini(g, -0.4, 0.43, 0.36, 0x00ff88);
            },
            trailer: (g, dt) => {
                _iv.dashTruck(g, 0x1a1a1a, 0xff4400);
                _iv.cluster(g, dt, -0.4, 0.55, 0.5, 0.46, 0.2);
                // Very large round wheel
                const ws = _iv.wheelRound(g, -0.4, 0.43, 0.36, 0xff4400, 0x111111, 0x0a0a0a);
                ws.scale.set(1.3, 1.3, 1.3);
            },
            gtbh: (g, dt) => {
                _iv.dashTruck(g, 0x222226, 0xffaa00);
                _iv.cluster(g, dt);
                _iv.wheel2Spoke(g, -0.4, 0.43, 0.36, 0x8b4513);
            },
            supra: (g, dt) => {
                // JDM coupe: red ambient, 3-spoke Momo-style
                _iv.dashSport(g, 0x0a0a0a, 0xff3300);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.42, 0.16, 0xff3300);
                _iv.wheelRound(g, -0.4, 0.43, 0.36, 0xff6600, 0x444444, 0x222222);
            },
            ferrari: (g, dt) => {
                // Italian: yellow accent + manettino-style dial
                _iv.dashSport(g, 0x1a0000, 0xffff00);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.42, 0.16, 0xffff00);
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0xffff00, 0x330000, 0x110000);
                // Manettino dial on dash
                _iv.cyl(g, 0.04, 0.04, 0.04, 16, _iv.mat(0xffff00), -0.15, 0.55, 0.51, Math.PI / 2);
            },
            mclaren: (g, dt) => {
                // McLaren orange/black + flat-bottom
                _iv.dashSport(g, 0x000000, 0xff8800);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.46, 0.18, 0xff8800);
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0xff8800);
                // Roof-mounted switch panel hint (above cluster)
                _iv.box(g, 0.5, 0.04, 0.06, _iv.mat(0x222226), 0, 0.75, 0.5);
            },
            m4supra: (g, dt) => {
                // M-tricolor accent
                _iv.dashSport(g, 0x0a0a0a);
                _iv.box(g, 0.6, 0.03, 0.04, _iv.mat(0x0066ff), -0.7, 0.69, 0.49);
                _iv.box(g, 0.6, 0.03, 0.04, _iv.mat(0x4f00ff), 0.0, 0.69, 0.49);
                _iv.box(g, 0.6, 0.03, 0.04, _iv.mat(0xff0000), 0.7, 0.69, 0.49);
                _iv.cluster(g, dt);
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0x0066ff);
            },
            lec: (g, dt) => {
                _iv.dashRace(g, 0x0a0a0a, 0xaa00ff);
                _iv.cluster(g, dt, -0.4, 0.5, 0.5, 0.44, 0.16, 0xaa00ff);
                _iv.wheelRace(g, -0.4, 0.43, 0.36, 0xaa00ff);
            },
            f550: (g, dt) => {
                _iv.dashTruck(g, 0x111111, 0xffaa00);
                _iv.cluster(g, dt, -0.4, 0.6, 0.55, 0.44, 0.18);
                _iv.wheelRound(g, -0.4, 0.5, 0.4, 0xffaa00, 0x222222, 0x111111);
            },
            wrangler: (g, dt) => {
                _iv.dashTruck(g, 0x222a1a, 0x88aa44);
                _iv.cluster(g, dt, -0.4, 0.62, 0.55, 0.4, 0.18);
                // Round military-style wheel
                _iv.wheelRound(g, -0.4, 0.5, 0.4, 0x88aa44, 0x3a3a2a, 0x222a1a);
                // Grab handle hint above dash
                _iv.box(g, 0.5, 0.04, 0.04, _iv.mat(0x444444), 0.5, 0.85, 0.5);
            },
            porsche: (g, dt) => {
                // Classic 911 round wheel + 5-gauge cluster hint
                _iv.dashStd(g, 0x111111, 0x2266ff);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.42, 0.16);
                // 5 round gauge bezels next to cluster
                for (let i = 0; i < 5; i++) {
                    _iv.cyl(g, 0.05, 0.05, 0.015, 16, _iv.mat(0x222226), -0.2 + i * 0.1, 0.52, 0.51, Math.PI / 2);
                }
                _iv.wheelRound(g, -0.4, 0.43, 0.36, 0x2266ff);
            },
            gv60: (g, dt) => {
                // Genesis: floating crystal sphere + twin curved displays
                _iv.dashLuxury(g, 0x1a1a1a, 0xc4a878);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.46, 0.18);
                _iv.wideScreen(g, dt, 0.15, 0.5, 0.52, 0.34, 0.16);
                // Crystal sphere (rotates with steering? no — center console)
                _iv.cyl(g, 0.06, 0.06, 0.04, 16, _iv.mat(0xc8a878), 0.0, 0.28, 0.6, Math.PI / 2);
                _iv.wheelRound(g, -0.4, 0.43, 0.36, 0x4a6741);
            },
            sonata: (g, dt) => {
                _iv.dashMinimal(g, 0x0a0a0a, 0xc0c8d0);
                _iv.cluster(g, dt);
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0xc0c8d0);
            },
            mustangev: (g, dt) => {
                _iv.dashSport(g, 0x0a0a0a, 0xff4400);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.44, 0.18);
                _iv.wideScreen(g, dt, 0.1, 0.5, 0.52, 0.32, 0.4);  // Mustang Mach-E vertical-ish
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0xff4400);
            },
            genesisveet: (g, dt) => {
                _iv.dashLuxury(g, 0x14101a, 0xc4a878);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.46, 0.18);
                _iv.wideScreen(g, dt, 0.15, 0.52, 0.52, 0.36, 0.18);
                // Ambient light strip across dash
                _iv.box(g, 1.9, 0.01, 0.02, _iv.mat(0xffd700), 0, 0.5, 0.51);
                _iv.wheelRound(g, -0.4, 0.43, 0.36, 0xc4a878, 0x3a2a1a, 0x1a1a14);
            },
            gv70veet: (g, dt) => {
                _iv.dashSport(g, 0x1a1a1a, 0x8b0000);
                _iv.cluster(g, dt, -0.4, 0.55, 0.5, 0.46, 0.18);
                _iv.wheelFlatBottom(g, -0.4, 0.46, 0.4, 0x8b0000);
            },
            nes2451: (g, dt) => {
                _iv.dashFuturistic(g, 0x0a0a14, 0x00ccff);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.52, 0.2, 0x00ccff);
                _iv.wideScreen(g, dt, 0.15, 0.5, 0.52, 0.38, 0.2);
                _iv.wheelYoke(g, -0.4, 0.43, 0.36, 0x00ccff);
            },
            gr4: (g, dt) => {
                _iv.dashRace(g, 0x0a0a0a, 0xff0000);
                _iv.cluster(g, dt, -0.4, 0.5, 0.5, 0.5, 0.16, 0xff0000);
                _iv.wheelRace(g, -0.4, 0.43, 0.36, 0xff0000);
            },
            genesisi5: (g, dt) => {
                _iv.dashMinimal(g, 0x0a0a14, 0x1a6dff);
                _iv.cluster(g, dt, -0.4, 0.5, 0.5, 0.42, 0.16);
                _iv.wheelFlatBottom(g, -0.4, 0.43, 0.36, 0x1a6dff);
            },
            aventador: (g, dt) => {
                _iv.dashFuturistic(g, 0x0a0a0a, 0x00cc00);
                _iv.cluster(g, dt, -0.4, 0.52, 0.5, 0.5, 0.18, 0x00cc00);
                _iv.wheelHex(g, -0.4, 0.43, 0.36, 0x00cc00);
                // Fighter-jet-style start button cap
                _iv.cyl(g, 0.04, 0.04, 0.03, 12, _iv.mat(0xcc0000), 0.0, 0.55, 0.55, Math.PI / 2);
            },
            raptor: (g, dt) => {
                _iv.dashTruck(g, 0x1a1a1a, 0xd35400);
                _iv.cluster(g, dt, -0.4, 0.58, 0.55, 0.46, 0.2);
                _iv.wideScreen(g, dt, 0.15, 0.55, 0.55, 0.34, 0.18);
                _iv.wheelFlatBottom(g, -0.4, 0.5, 0.4, 0xd35400);
                // Roof-mounted switch panel
                _iv.box(g, 0.5, 0.04, 0.06, _iv.mat(0x222226), 0, 0.95, 0.55);
                for (let i = 0; i < 4; i++) {
                    _iv.box(g, 0.04, 0.025, 0.04, _iv.mat(0xff8800), -0.18 + i * 0.12, 0.95, 0.58);
                }
            },
            // -- Tesla lineup: yoke or minimal wheel + big horizontal screen --
            tesla: (g, dt) => {
                _iv.dashMinimal(g, 0x0a0a0a);
                _iv.wideScreen(g, dt, 0.1, 0.5, 0.52, 0.52, 0.26);  // Landscape center display
                _iv.cluster(g, dt, -0.4, 0.5, 0.5, 0.36, 0.12);  // Small driver cluster
                _iv.wheelYoke(g, -0.4, 0.43, 0.36, 0xffffff);
            },
            model3: (g, dt) => {
                // Model 3: no instrument cluster, just big center screen
                _iv.dashMinimal(g, 0x0a0a0a);
                _iv.wideScreen(g, dt, 0.1, 0.5, 0.52, 0.5, 0.28);
                _iv.wheelMini(g, -0.4, 0.43, 0.36, 0xffffff);
            },
            modely: (g, dt) => {
                _iv.dashMinimal(g, 0x0a0a0a);
                _iv.wideScreen(g, dt, 0.1, 0.55, 0.55, 0.5, 0.28);
                _iv.wheelMini(g, -0.4, 0.46, 0.38, 0xffffff);
            },
            modelx: (g, dt) => {
                _iv.dashMinimal(g, 0x0a0a0a, 0xaa0000);
                _iv.wideScreen(g, dt, 0.1, 0.55, 0.55, 0.52, 0.28);
                _iv.wheelYoke(g, -0.4, 0.46, 0.38, 0xffffff);
                // Falcon-wing seam hint above
                _iv.box(g, 0.04, 0.08, 0.6, _iv.mat(0x222226), 0, 1.0, 0.3);
            },
            cybertruck: (g, dt) => {
                // Sparse angular: yoke + single rectangular screen
                _iv.box(g, 1.9, 0.1, 0.4, _iv.mat(0x111111), 0, 0.5, 0.7);
                _iv.wideScreen(g, dt, 0.1, 0.5, 0.52, 0.6, 0.24, 0x080808);
                _iv.wheelYoke(g, -0.4, 0.43, 0.36, 0xb0b4b8, 0x080808, 0x000000);
            },
        };

    // The old table had no id field; add one so callers can iterate.
    Object.keys(cars).forEach(id => { cars[id].id = id; });

    function carData(id) { return cars[id] || cars.starter; }
    function builderKey(id) { return cars[id] ? id : 'starter'; }

    function variant(d) {
        return d.isRaceCar ? 'race' : d.isOffroad ? 'offroad' : d.isPickup ? 'pickup' : d.isTruck ? 'truck' : 'default';
    }

    const LAYOUTS = {
        race:    { radius: 0.35, width: 0.35, rest: 0.3, travel: 0.3, points: [[-1.0, 0.2, 1.5], [1.0, 0.2, 1.5], [-1.0, 0.2, -1.5], [1.0, 0.2, -1.5]] },
        offroad: { radius: 0.55, width: 0.45, rest: 0.5, travel: 0.5, points: [[-1.2, 0.5, 1.6], [1.2, 0.5, 1.6], [-1.2, 0.5, -1.6], [1.2, 0.5, -1.6]] },
        pickup:  { radius: 0.5,  width: 0.4,  rest: 0.4, travel: 0.4, points: [[-1.1, 0.4, 2.0], [1.1, 0.4, 2.0], [-1.1, 0.4, -2.0], [1.1, 0.4, -2.0]] },
        truck:   { radius: 0.5,  width: 0.4,  rest: 0.4, travel: 0.4, points: [[-1.1, 0.4, 2.8], [1.1, 0.4, 2.8], [-1.1, 0.4, -4.0], [1.1, 0.4, -4.0]] },
        default: { radius: 0.4,  width: 0.3,  rest: 0.3, travel: 0.3, points: [[-0.9, 0.3, 1.3], [0.9, 0.3, 1.3], [-0.9, 0.3, -1.3], [0.9, 0.3, -1.3]] }
    };

    const CHASSIS = {
        race:    { half: [1.1, 0.25, 2.3], offset: [0, 0.35, 0] },
        offroad: { half: [1.2, 0.5, 2.2],  offset: [0, 0.8, 0] },
        pickup:  { half: [1.2, 0.5, 2.5],  offset: [0, 0.7, 0] },
        truck:   { half: [1.3, 0.7, 4.5],  offset: [0, 0.9, -0.8] },
        default: { half: [1, 0.4, 2],      offset: [0, 0.6, 0] }
    };

    function buildBody(id) {
        const d = carData(id);
        const isTruck = d.isTruck, isPickup = d.isPickup, isOffroad = d.isOffroad, isRaceCar = d.isRaceCar;
        const carGroup = new THREE.Group();
        carVisuals[builderKey(id)](carGroup, d);

        // Turn signal lights (amber indicators at four corners)
        const hazardLights = [];
        const hazardMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0 });
        const hazardSize = isRaceCar ? [0.15, 0.08, 0.06] : isOffroad ? [0.25, 0.2, 0.08] : isPickup ? [0.25, 0.2, 0.08] : isTruck ? [0.3, 0.25, 0.08] : [0.2, 0.15, 0.08];
        const hazardGeom = new THREE.BoxGeometry(...hazardSize);
        const hazardPositions = isRaceCar ? [
            { x: -1.1, y: 0.4, z: 2.3, side: 'left' },
            { x: 1.1, y: 0.4, z: 2.3, side: 'right' },
            { x: -1.1, y: 0.4, z: -2.3, side: 'left' },
            { x: 1.1, y: 0.4, z: -2.3, side: 'right' }
        ] : isOffroad ? [
            { x: -1.2, y: 0.9, z: 2.2, side: 'left' },
            { x: 1.2, y: 0.9, z: 2.2, side: 'right' },
            { x: -1.2, y: 0.9, z: -2.2, side: 'left' },
            { x: 1.2, y: 0.9, z: -2.2, side: 'right' }
        ] : isPickup ? [
            { x: -1.2, y: 0.7, z: 2.5, side: 'left' },
            { x: 1.2, y: 0.7, z: 2.5, side: 'right' },
            { x: -1.2, y: 0.7, z: -2.5, side: 'left' },
            { x: 1.2, y: 0.7, z: -2.5, side: 'right' }
        ] : isTruck ? [
            { x: -1.3, y: 0.6, z: 3.8, side: 'left' },
            { x: 1.3, y: 0.6, z: 3.8, side: 'right' },
            { x: -1.3, y: 1.0, z: -5.8, side: 'left' },
            { x: 1.3, y: 1.0, z: -5.8, side: 'right' }
        ] : [
            { x: -1.0, y: 0.6, z: 2.0, side: 'left' },
            { x: 1.0, y: 0.6, z: 2.0, side: 'right' },
            { x: -1.0, y: 0.6, z: -2.0, side: 'left' },
            { x: 1.0, y: 0.6, z: -2.0, side: 'right' }
        ];
        hazardPositions.forEach(pos => {
            const light = new THREE.Mesh(hazardGeom.clone(), hazardMat.clone());
            light.position.set(pos.x, pos.y, pos.z);
            light.userData.side = pos.side;
            carGroup.add(light);
            hazardLights.push(light);
        });

        // Brake lights (bright red at rear)
        const brakeLights = [];
        const brakeMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3 });
        const brakePositions = isRaceCar ? [
            { x: -0.6, y: 0.4, z: -2.31 },
            { x: 0.6, y: 0.4, z: -2.31 }
        ] : isOffroad ? [
            { x: -0.8, y: 0.9, z: -2.22 },
            { x: 0.8, y: 0.9, z: -2.22 }
        ] : isPickup ? [
            { x: -0.9, y: 0.7, z: -2.51 },
            { x: 0.9, y: 0.7, z: -2.51 }
        ] : isTruck ? [
            { x: -0.9, y: 1.0, z: -5.81 },
            { x: 0.9, y: 1.0, z: -5.81 }
        ] : [
            { x: -0.6, y: 0.6, z: -2.01 },
            { x: 0.6, y: 0.6, z: -2.01 }
        ];
        const brakeSize = isRaceCar ? [0.25, 0.06, 0.06] : isOffroad ? [0.35, 0.3, 0.08] : isPickup ? [0.35, 0.25, 0.08] : isTruck ? [0.4, 0.3, 0.08] : [0.3, 0.2, 0.08];
        const brakeGeom = new THREE.BoxGeometry(...brakeSize);
        brakePositions.forEach(pos => {
            const light = new THREE.Mesh(brakeGeom.clone(), brakeMat.clone());
            light.position.set(pos.x, pos.y, pos.z);
            carGroup.add(light);
            brakeLights.push(light);
        });

        carGroup.userData.hazardLights = hazardLights;
        carGroup.userData.brakeLights = brakeLights;
        carGroup.userData.carId = cars[id] ? id : 'starter';
        return carGroup;
    }

    function wheelLayout(id) {
        const L = LAYOUTS[variant(carData(id))];
        return {
            radius: L.radius,
            width: L.width,
            suspensionRestLength: L.rest,
            maxSuspensionTravel: L.travel,
            points: L.points.map(p => p.slice())
        };
    }

    function chassis(id) {
        const c = CHASSIS[variant(carData(id))];
        return { half: c.half.slice(), offset: c.offset.slice() };
    }

    let _wheelMat = null;
    function buildWheel(id) {
        const L = LAYOUTS[variant(carData(id))];
        const geo = new THREE.CylinderGeometry(L.radius, L.radius, L.width, 16);
        geo.rotateZ(Math.PI / 2);                       // axle along local X
        if (!_wheelMat) _wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const wheel = new THREE.Mesh(geo, _wheelMat);
        wheel.castShadow = true;
        return wheel;
    }

    function buildInterior(id, dashTexture, opts) {
        const interiorGroup = new THREE.Group();
        steeringWheelSpin = null;
        interiorVisuals[builderKey(id)](interiorGroup, dashTexture);
        interiorGroup.userData.steeringWheelSpin = steeringWheelSpin;
        // Right-hand drive: mirror across the centreline (Tokyo style), as old createCar() did.
        if (!opts || opts.rhd !== false) {
            interiorGroup.children.forEach(c => { c.position.x = -c.position.x; });
        }
        interiorGroup.traverse(o => { if (o.isMesh) o.renderOrder = 999; });
        return interiorGroup;
    }

    window.CARS = cars;
    window.CarModels = { buildBody, buildWheel, buildInterior, wheelLayout, chassis, ids: () => Object.keys(cars) };
})();
