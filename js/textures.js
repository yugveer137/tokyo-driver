// tokyo-driver1 v2 — procedural canvas textures (no image files to host).
// Every road, sidewalk and building shares these; per-mesh scale comes from stretching
// geometry UVs (Tex.scaleBoxUVs / Tex.scalePlaneUVs) so each texture uploads once.
// Canvases are treated as linear colour so hex tints behave like the old flat materials.
window.Tex = (function () {
    const T = {};
    let renderer = null;

    function noiseCanvas(size, base, spread, decorate) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(size, size);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const v = base + (Math.random() - 0.5) * spread;
            d[i] = d[i + 1] = d[i + 2] = v;
            d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        if (decorate) decorate(ctx, size);
        return c;
    }

    function finishTex(canvas) {
        const t = new THREE.CanvasTexture(canvas);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        // 4x keeps road grain sharp at grazing angles; 16x costs real frame rate on laptops
        t.anisotropy = Math.min(4, renderer ? renderer.capabilities.getMaxAnisotropy() : 1);
        return t;
    }

    T.build = function (r) {
        renderer = r;
        // Asphalt: dark grain, light aggregate specks, hairline cracks. One tile = 10 world units.
        T.asphalt = finishTex(noiseCanvas(512, 40, 44, (ctx, s) => {
            for (let i = 0; i < 16000; i++) {
                const g = 140 + Math.random() * 100 | 0;
                ctx.fillStyle = `rgba(${g},${g},${g + 12},${0.14 + Math.random() * 0.22})`;
                ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
            }
            for (let i = 0; i < 12; i++) {
                ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.07)';
                ctx.fillRect(Math.random() * s, Math.random() * s, 40 + Math.random() * 140, 20 + Math.random() * 100);
            }
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 7; i++) {
                let px = s * (0.2 + Math.random() * 0.6), py = s * (0.2 + Math.random() * 0.6);
                ctx.beginPath(); ctx.moveTo(px, py);
                for (let k = 0; k < 10; k++) {
                    px = Math.min(s * 0.9, Math.max(s * 0.1, px + (Math.random() - 0.5) * 30));
                    py = Math.min(s * 0.9, Math.max(s * 0.1, py + (Math.random() - 0.5) * 30));
                    ctx.lineTo(px, py);
                }
                ctx.stroke();
            }
        }));

        // Asphalt roughness: mostly matte, with dark (= smooth, wet) puddles that catch the lights
        T.asphaltRough = finishTex(noiseCanvas(256, 200, 50, (ctx, s) => {
            for (let i = 0; i < 9; i++) {
                ctx.fillStyle = 'rgba(40,40,40,0.55)';
                ctx.beginPath();
                ctx.ellipse(s * (0.15 + Math.random() * 0.7), s * (0.15 + Math.random() * 0.7),
                    10 + Math.random() * 30, 6 + Math.random() * 18, Math.random() * Math.PI, 0, Math.PI * 2);
                ctx.fill();
            }
        }));

        // Sidewalk concrete: speckled slabs with a seam grid. One tile = 4 world units (2x2 slabs).
        T.concrete = finishTex(noiseCanvas(256, 150, 34, (ctx, s) => {
            for (let i = 0; i < 2500; i++) {
                ctx.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.2})`;
                ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
            }
            ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3;
            [1, s / 2].forEach(p => {
                ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
            });
            ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
            [4, s / 2 + 3].forEach(p => {
                ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
            });
        }));

        // Building facade: panels, floor bands, rain streaks. Tinted per building. One tile = 8 units.
        T.facade = finishTex(noiseCanvas(256, 225, 22, (ctx, s) => {
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            for (let x = 0; x < s; x += 64) ctx.fillRect(x, 0, 2, s);
            for (let y = 0; y < s; y += 128) ctx.fillRect(0, y, s, 3);
            for (let i = 0; i < 14; i++) {
                ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.08})`;
                ctx.fillRect(Math.random() * s, 0, 2 + Math.random() * 10, s);
            }
        }));

        // Plain seamless grain for grass, sand and dirt; tinted by the material colour.
        T.grain = finishTex(noiseCanvas(256, 205, 60, (ctx, s) => {
            for (let i = 0; i < 1200; i++) {
                ctx.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.15})`;
                ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3);
            }
        }));

        // Grass: grain plus darker blotches and a few light blades, tinted green by the material.
        T.grass = finishTex(noiseCanvas(256, 190, 70, (ctx, s) => {
            for (let i = 0; i < 90; i++) {
                ctx.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`;
                ctx.beginPath();
                ctx.ellipse(Math.random() * s, Math.random() * s, 4 + Math.random() * 12, 3 + Math.random() * 8, Math.random() * 3, 0, 6.3);
                ctx.fill();
            }
            for (let i = 0; i < 6000; i++) {
                ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${0.05 + Math.random() * 0.12})` : `rgba(0,0,0,${0.05 + Math.random() * 0.1})`;
                ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1 + Math.random() * 3);
            }
        }));
    };

    T.asphaltMaterial = function (tint) {
        return new THREE.MeshStandardMaterial({
            color: tint, map: T.asphalt, roughnessMap: T.asphaltRough, roughness: 1, metalness: 0.25
        });
    };

    // Stretch a BoxGeometry's per-face 0..1 UVs so one texture tile covers `unit` world units.
    // r128 BoxGeometry face order: +x, -x, +y, -y, +z, -z, four vertices each.
    T.scaleBoxUVs = function (geom, w, h, d, unit) {
        const uv = geom.attributes.uv;
        const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
        for (let f = 0; f < 6; f++) {
            for (let v = 0; v < 4; v++) {
                const i = f * 4 + v;
                uv.setXY(i, uv.getX(i) * faceSize[f][0] / unit, uv.getY(i) * faceSize[f][1] / unit);
            }
        }
        uv.needsUpdate = true;
        return geom;
    };

    T.scalePlaneUVs = function (geom, w, h, unit) {
        const uv = geom.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / unit, uv.getY(i) * h / unit);
        uv.needsUpdate = true;
        return geom;
    };

    // Draw text onto a canvas and return a texture (signs, name plates).
    T.textCanvas = function (w, h, draw) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        draw(c.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(c);
        t.anisotropy = Math.min(4, renderer ? renderer.capabilities.getMaxAnisotropy() : 1);
        return t;
    };

    return T;
})();
