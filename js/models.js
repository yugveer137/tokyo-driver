// tokyo-driver1 v2 — real car shapes. Loads Kenney's CC0 "Car Kit" models (assets/cars/*.glb)
// with THREE.GLTFLoader and hands out tinted copies for the player's car and the traffic.
// Models load in the background: you get an empty group straight away that fills in when
// the file arrives, so nothing waits on the network.
window.Models = (function () {
    const M = { ready: !!window.THREE && !!THREE.GLTFLoader, cache: {}, pending: {} };
    const loader = M.ready ? new THREE.GLTFLoader() : null;

    // which Kenney model stands in for each of the game's cars
    // chosen to match the real car's body style (a Mach-E is a crossover, a Cybertruck a pickup)
    const BY_ID = {
        starter: 'sedan', sport: 'sedan-sports', muscle: 'sedan-sports', super: 'race', hyper: 'race-future', legend: 'race-future', electric: 'sedan-sports',
        trailer: 'truck', gtbh: 'truck', robber: 'delivery',
        supra: 'hatchback-sports', ferrari: 'race', mclaren: 'race', m4supra: 'sedan-sports', lec: 'race-future', f550: 'truck-flat', wrangler: 'suv',
        porsche: 'sedan-sports', gv60: 'suv-luxury', sonata: 'sedan', mustangev: 'suv', genesisveet: 'sedan', gv70veet: 'suv-luxury', nes2451: 'race-future',
        gr4: 'race', genesisi5: 'sedan', aventador: 'race', raptor: 'truck-flat',
        tesla: 'sedan-sports', model3: 'sedan', modely: 'suv', modelx: 'suv-luxury', cybertruck: 'truck-flat', waymo: 'suv-luxury'
    };
    M.nameFor = function (d) {
        if (BY_ID[d.id]) return BY_ID[d.id];
        if (d.isTruck) return 'truck';
        if (d.isPickup) return 'truck-flat';
        if (d.isRaceCar || d.maxSpeed >= 200) return 'race';
        if (d.isOffroad) return 'suv';
        if (d.maxSpeed >= 130) return 'sedan-sports';
        return 'sedan';
    };

    // fetch a model once; callbacks get the loaded scene (shared, never added to the world directly)
    function load(name, cb) {
        if (M.cache[name]) { cb(M.cache[name]); return; }
        if (!loader) return;
        (M.pending[name] = M.pending[name] || []).push(cb);
        if (M.pending[name].length > 1) return;
        loader.load('assets/cars/' + name + '.glb', (gltf) => {
            const src = gltf.scene;
            src.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material.metalness = 0.5; o.material.roughness = 0.3; o.material.envMapIntensity = 1.0; } });   // car paint: glossy, reflecting the sky
            src.traverse(o => { if (o.isMesh && !(/wheel/i.test(o.name) || /wheel/i.test(o.parent.name))) markPaint(o, name); });
            M.cache[name] = src;
            M.pending[name].forEach(f => f(src)); delete M.pending[name];
        }, undefined, (err) => { console.warn('car model failed: ' + name, err); delete M.pending[name]; });
    }

    // The kit paints every part from one palette texture, so a plain colour tint would just
    // darken the paint. Instead each vertex is marked as paintwork or not (once per model), and
    // the shader repaints the marked panels in the car's colour while glass, lights and trim keep
    // the kit's colours. A panel's swatch is found by sampling the palette under its UVs: every
    // saturated colour is a swatch, swatches of one hue make a cluster (the kit shades panels
    // with lighter and darker swatches of the same hue), and the clusters covering most of the
    // painted area are the paintwork. Tail and head lights are saturated too but tiny, so they
    // fall below the area cut.
    let palette = null;
    // A box truck is drawn mostly white, so on these models the white bodywork is paintwork too
    // (the Robber's Car is one of them, all black; the delivery vans in traffic keep the kit's colours).
    const WHITE_IS_PAINT = { delivery: true };
    function markPaint(mesh, name) {
        const img = mesh.material.map && mesh.material.map.image;
        if (!img || !img.width) return;
        if (!palette) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); palette = c.getContext('2d'); }
        const geo = mesh.geometry, uv = geo.attributes.uv, pos = geo.attributes.position, idx = geo.index;
        if (!uv) return;
        if (idx) { mesh.geometry = geo.toNonIndexed(); return markPaint(mesh, name); }   // one vertex per corner, so a flag per vertex is a flag per face
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const tris = pos.count / 3, texel = [], area = {}, colours = {};
        const sampled = {};
        for (let t = 0; t < tris; t++) {
            a.fromBufferAttribute(pos, t * 3); b.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2);
            const ar = b.sub(a).cross(c.sub(a)).length() / 2;
            const px = Math.floor(uv.getX(t * 3) * (img.width - 1)), py = Math.floor(uv.getY(t * 3) * (img.height - 1));   // glTF textures are not flipped
            const pk = px + ',' + py;
            if (!sampled[pk]) { const d = palette.getImageData(px, py, 1, 1).data; sampled[pk] = d[0] + ',' + d[1] + ',' + d[2]; }
            const k = sampled[pk]; texel.push(k); area[k] = (area[k] || 0) + ar;
            if (!colours[k]) { const [r, g, bl] = k.split(',').map(Number); colours[k] = new THREE.Color(r / 255, g / 255, bl / 255); }
        }
        const hsl = {}; Object.keys(colours).forEach(k => { hsl[k] = colours[k].getHSL({}); });
        // saturated = chroma, (max - min) / max: HSL saturation calls pale glass blue "saturated"
        const chroma = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx > 0 ? (mx - mn) / mx : 0; };
        const sat = Object.keys(area).filter(k => chroma(colours[k]) > 0.25 && hsl[k].l > 0.08).sort((x, y) => area[y] - area[x]);
        if (!sat.length) return;
        // cluster the swatches by hue, biggest first
        const clusters = [];
        sat.forEach(k => {
            let cl = clusters.find(q => { let d = Math.abs(hsl[k].h - hsl[q.seed].h); d = Math.min(d, 1 - d); return d < 0.045; });
            if (!cl) { cl = { seed: k, keys: [], area: 0 }; clusters.push(cl); }
            cl.keys.push(k); cl.area += area[k];
        });
        const total = clusters.reduce((s, q) => s + q.area, 0);
        const paintKeys = {};
        clusters.filter(q => q.area > total * 0.08).forEach(q => q.keys.forEach(k => { paintKeys[k] = true; }));
        if (WHITE_IS_PAINT[name]) Object.keys(area).forEach(k => { if (chroma(colours[k]) < 0.12 && hsl[k].l > 0.7) paintKeys[k] = true; });
        const flags = new Float32Array(pos.count);
        texel.forEach((k, t) => { if (paintKeys[k]) flags[t * 3] = flags[t * 3 + 1] = flags[t * 3 + 2] = 1; });
        mesh.geometry.setAttribute('paint', new THREE.BufferAttribute(flags, 1));
        mesh.userData.key = colours[clusters[0].seed].clone().convertSRGBToLinear();   // the main swatch: shading is measured against it
    }
    // The paint rides in the material's colour slot and the main swatch in its emissive slot:
    // both are built-in uniforms uploaded for every material, which custom uniforms added in
    // onBeforeCompile are not once the program is shared. Marked panels take the paint scaled by
    // how much lighter or darker the kit drew that panel than its main swatch.
    function paintMaterial(mat, key, tint) {
        mat.color.copy(tint).convertSRGBToLinear();
        mat.emissive.copy(key); mat.emissiveIntensity = 1;
        mat.userData.key = key; mat.userData.paint = mat.color.clone();
        mat.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float paint; varying float vPaint;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = paint;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vPaint;')
                .replace('#include <map_fragment>', `
                    #ifdef USE_MAP
                    vec4 texelColor = texture2D( map, vUv );
                    texelColor = mapTexelToLinear( texelColor );
                    if (vPaint > 0.5) {
                        float shade = dot(texelColor.rgb, vec3(0.3, 0.59, 0.11)) / max(dot(emissive, vec3(0.3, 0.59, 0.11)), 0.02);
                        texelColor.rgb = diffuse * clamp(shade, 0.45, 1.7);
                    }
                    diffuseColor = vec4(texelColor.rgb, diffuseColor.a * texelColor.a);   // glass, trim and lights stay as drawn
                    #endif`)
                .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vec3(0.0);');   // the swatch must not glow
        };
        mat.needsUpdate = true;
    }

    // A car body ready to drop in the world: `length` is the physics chassis length it has to
    // match, `color` is the paintwork, the model's own wheels are hidden (the game has its own).
    // group.userData gets hazardLights / brakeLights boxes like the old built-in bodies.
    // `wheels: true` adds four plain black wheels (for cars that are not a RaycastVehicle:
    // traffic, the robber friends' cars) sitting on the ground line.
    M.car = function (name, color, length, opts) {
        opts = opts || {};
        const g = new THREE.Group();
        g.userData.hazardLights = []; g.userData.brakeLights = [];
        if (opts.wheels) M.addWheels(g, length);
        // a plain body until the model arrives (a slow connection, or a file that never comes):
        // a car is never just four wheels
        const stub = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, length * 0.9), new THREE.MeshStandardMaterial({ color: color, metalness: 0.3, roughness: 0.6 }));
        stub.position.y = (opts.lift || 0) + 0.85; stub.castShadow = true; g.add(stub);
        load(name, (src) => {
            g.remove(stub); stub.geometry.dispose(); stub.material.dispose();
            const body = src.clone(true);
            const tint = new THREE.Color(color);
            body.traverse(o => {
                if (!o.isMesh) return;
                if (/wheel/i.test(o.name) || /wheel/i.test(o.parent.name)) { o.visible = false; return; }
                o.material = o.material.clone();
                if (opts.keepColors || !o.userData.key) return;
                paintMaterial(o.material, new THREE.Color(o.userData.key), tint);   // (clone() turns userData's Color into a hex number: rebuild it)
            });
            // scale to the chassis length and sit the shell just above the wheel contact line. The
            // box is taken over the visible parts only: the kit's own (hidden) wheels are bigger
            // than the game's, and measuring them left the body floating above its wheels.
            const box = new THREE.Box3(), tmp = new THREE.Box3();
            body.updateMatrixWorld(true);
            body.traverse(o => { if (o.isMesh && o.visible && o.parent.visible !== false) { o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); } });
            const size = box.getSize(new THREE.Vector3());
            const s = length / Math.max(size.z, 0.01);
            const sx = opts.width ? Math.min(s, opts.width * 1.1 / Math.max(size.x, 0.01)) : s;   // (a long lorry scaled to its length came out twice as wide as its chassis)
            body.scale.set(sx, s, s);
            body.position.set(-(box.min.x + box.max.x) / 2 * sx, -box.min.y * s + (opts.lift || 0) + 0.30, -(box.min.z + box.max.z) / 2 * s);   // 30 cm of ground clearance: the shell rides above the wheel tops
            g.add(body);
            // signal and brake lights at the corners, driven by Features like the built-in bodies
            const w = size.x * sx, h = size.y * s, L = size.z * s, y = (opts.lift || 0) + h * 0.42;
            const amber = () => new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0 });
            const red = () => new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.3 });
            [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), amber());
                m.position.set(sx * (w / 2 - 0.15), y, sz * (L / 2 + 0.02)); m.userData.side = sx < 0 ? 'right' : 'left';
                g.add(m); g.userData.hazardLights.push(m);
            });
            [-1, 1].forEach(sx => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), red()); m.position.set(sx * (w / 2 - 0.4), y + 0.05, -L / 2 - 0.02); g.add(m); g.userData.brakeLights.push(m); });
        });
        return g;
    };
    // four simple wheels on a car group whose body sits on the ground line
    M.addWheels = function (g, length) {
        const geom = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12); geom.rotateZ(Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
        [[0.85, 1], [-0.85, 1], [0.85, -1], [-0.85, -1]].forEach(([x, z]) => { const w = new THREE.Mesh(geom, mat); w.position.set(x, 0.36, z * length * 0.32); g.add(w); });
    };
    return M;
})();
