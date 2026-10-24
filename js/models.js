// tokyo-driver1 v2 — real car shapes. Loads Kenney's CC0 "Car Kit" models (assets/cars/*.glb)
// with THREE.GLTFLoader and hands out tinted copies for the player's car and the traffic.
// Models load in the background: you get an empty group straight away that fills in when
// the file arrives, so nothing waits on the network.
window.Models = (function () {
    const M = { ready: !!window.THREE && !!THREE.GLTFLoader, cache: {}, pending: {} };
    const loader = M.ready ? new THREE.GLTFLoader() : null;

    // which Kenney model stands in for each of the game's cars
    const BY_ID = {
        electric: 'race-future', hyper: 'race-future', gv60: 'suv-luxury', genesisveet: 'suv-luxury', modelx: 'suv-luxury',
        modely: 'suv', gv70veet: 'suv', wrangler: 'suv', raptor: 'truck-flat', cybertruck: 'delivery-flat', f550: 'truck-flat',
        tesla: 'sedan', model3: 'sedan', sonata: 'sedan', genesisi5: 'sedan', lec: 'sedan', starter: 'sedan',
        trailer: 'truck', gtbh: 'truck'
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
            src.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material.metalness = 0.15; o.material.roughness = 0.6; } });
            M.cache[name] = src;
            M.pending[name].forEach(f => f(src)); delete M.pending[name];
        }, undefined, (err) => { console.warn('car model failed: ' + name, err); delete M.pending[name]; });
    }

    // The kit paints every part from one palette texture, so a plain colour tint would just
    // darken the paint. Instead the shader swaps the body's palette colour for ours: we find
    // that colour by sampling the texture under the body mesh's UVs.
    let palette = null;
    function paletteColorAt(mesh) {
        const img = mesh.material.map && mesh.material.map.image;
        if (!img || !img.width) return null;
        if (!palette) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); palette = c.getContext('2d'); }
        const geo = mesh.geometry, uv = geo.attributes.uv, pos = geo.attributes.position, idx = geo.index;
        if (!uv) return null;
        // weigh each triangle by its area so the big painted panels win over trim and glass,
        // and ignore greys (paint is saturated; windows, lights and chrome are not)
        const area = {}, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const tris = idx ? idx.count / 3 : pos.count / 3;
        for (let t = 0; t < tris; t++) {
            const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
            a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
            const ar = b.sub(a).cross(c.sub(a)).length() / 2;
            const px = Math.floor(uv.getX(i0) * (img.width - 1)), py = Math.floor(uv.getY(i0) * (img.height - 1));   // glTF textures are not flipped
            const d = palette.getImageData(px, py, 1, 1).data; const k = d[0] + ',' + d[1] + ',' + d[2];
            area[k] = (area[k] || 0) + ar;
        }
        const sat = (k) => { const [r, g, bl] = k.split(',').map(Number); const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return mx === 0 ? 0 : (mx - mn) / mx; };
        const keys = Object.keys(area).sort((x, y) => area[y] - area[x]);
        const best = keys.find(k => sat(k) > 0.25) || keys[0];
        if (!best) return null;
        const [r, g, bl] = best.split(',').map(Number);
        return new THREE.Color(r / 255, g / 255, bl / 255).convertSRGBToLinear();
    }
    function paintMaterial(mat, key, tint) {
        mat.userData.key = key; mat.userData.paint = tint.clone().convertSRGBToLinear();
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uPaintKey = { value: mat.userData.key };
            shader.uniforms.uPaint = { value: mat.userData.paint };
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform vec3 uPaintKey; uniform vec3 uPaint;')
                .replace('#include <map_fragment>', `
                    #ifdef USE_MAP
                    vec4 texelColor = texture2D( map, vUv );
                    texelColor = mapTexelToLinear( texelColor );
                    if (distance(texelColor.rgb, uPaintKey) < 0.06) texelColor.rgb = uPaint;
                    diffuseColor *= texelColor;
                    #endif`);
        };
        mat.needsUpdate = true;
    }

    // A car body ready to drop in the world: `length` is the physics chassis length it has to
    // match, `color` is the paintwork, the model's own wheels are hidden (the game has its own).
    // group.userData gets hazardLights / brakeLights boxes like the old built-in bodies.
    M.car = function (name, color, length, opts) {
        opts = opts || {};
        const g = new THREE.Group();
        g.userData.hazardLights = []; g.userData.brakeLights = [];
        load(name, (src) => {
            const body = src.clone(true);
            const tint = new THREE.Color(color);
            body.traverse(o => {
                if (!o.isMesh) return;
                if (/wheel/i.test(o.name) || /wheel/i.test(o.parent.name)) { o.visible = false; return; }
                o.material = o.material.clone();
                if (opts.keepColors) return;
                const key = paletteColorAt(o);
                if (key) paintMaterial(o.material, key, tint);
            });
            // scale to the chassis length and sit the model on its wheels
            const box = new THREE.Box3().setFromObject(body);
            const size = box.getSize(new THREE.Vector3());
            const s = length / Math.max(size.z, 0.01);
            body.scale.setScalar(s);
            body.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s + (opts.lift || 0), -(box.min.z + box.max.z) / 2 * s);
            g.add(body);
            // signal and brake lights at the corners, driven by Features like the built-in bodies
            const w = size.x * s, h = size.y * s, L = size.z * s, y = (opts.lift || 0) + h * 0.42;
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
    return M;
})();
