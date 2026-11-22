// tokyo-driver1 v2 — sky dome, sun, stars and the day/night cycle.
// One full cycle = CFG.CYCLE.day + CFG.CYCLE.night seconds. t = 0 is sunrise, the sun is
// highest a quarter of the way through, sets at the half-way point, and the night half
// follows. Everything that depends on the time of day reads Sky.daylight (0..1) and Sky.night.
// A day is long (config.js), so the time of day is kept in the save ('clock') and the next
// game carries on from it: otherwise every game would start in the morning and never see night.
// Sky.rain (0 dry .. 1 pouring) is set by the weather in features.js.
window.Sky = (function () {
    const S = { daylight: 1, night: 0, t: 0.08, sunDir: new THREE.Vector3(0, 1, 0), speed: 1, rain: 0 };
    let dome, stars, clouds, cloudMat, sun, hemi, ambient, scene, renderer, time = 0, unsaved = 0;
    const moonDir = new THREE.Vector3(0, 1, 0);

    const C = (hex) => new THREE.Color(hex);
    const col = {
        topDay: C(0x2f6fd6), topNight: C(0x05081a),
        horDay: C(0xcfe6ff), horNight: C(0x121833), dusk: C(0xff8a3a),
        botDay: C(0x8fb3d9), botNight: C(0x05060c),
        sunHigh: C(0xfff6e0), sunLow: C(0xffb060),
        hemiSkyDay: C(0x9fc7ff), hemiSkyNight: C(0x1b2240),
        hemiGroundDay: C(0x6b6b5a), hemiGroundNight: C(0x0a0a12),
        moon: C(0x9db4ff), cloudDay: C(0xffffff), cloudNight: C(0x0c1124), cloudWet: C(0x4a5058)
    };
    const tmpA = new THREE.Color(), tmpB = new THREE.Color();
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    S.init = function (sc, r) {
        scene = sc; renderer = r;
        const saved = window.Save ? Number(Save.get('clock', NaN)) : NaN;
        if (saved >= 0 && saved < 1) S.t = saved;                          // carry on from where the last game left the day
        time = S.t * (CFG.CYCLE.day + CFG.CYCLE.night);

        dome = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 16), new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
            uniforms: {
                uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
                uBottom: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
                uSunColor: { value: new THREE.Color() },
                uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: 0 }
            },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: `
                uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uMoonDir;
                uniform float uMoon;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    float h = d.y;
                    vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.5));
                    float s = max(dot(d, uSunDir), 0.0);
                    c += uSunColor * (pow(s, 400.0) * 2.0 + pow(s, 12.0) * 0.22 + pow(s, 2.0) * 0.05);
                    float m = max(dot(d, uMoonDir), 0.0);                 // the moon: a disc and a faint glow round it
                    c += vec3(0.86, 0.9, 1.0) * uMoon * (smoothstep(0.99955, 0.9997, m) * 0.9 + pow(m, 90.0) * 0.07);
                    gl_FragColor = vec4(c, 1.0);
                }`
        }));
        dome.renderOrder = -10;
        dome.frustumCulled = false;
        scene.add(dome);

        // Stars: fixed points on the dome, faded in at night
        const n = 1400, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.98); // upper hemisphere
            pos[i * 3] = Math.sin(v) * Math.cos(u) * 800;
            pos[i * 3 + 1] = Math.cos(v) * 800;
            pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 800;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
        stars.frustumCulled = false;
        stars.renderOrder = -9.5;                                          // (before the clouds, which are see-through too and drawn over them)
        scene.add(stars);

        // Clouds: soft white puffs painted on the sky. Each cloud is a row of soft-edged patches
        // (one fuzzy blob texture) that overlap into a wide shape with a flat grey base and a
        // heaped white top. They were solid lumpy balls at first, and looked like hot air balloons.
        // They are part of the sky, not of the world: they go where the dome goes, so each patch
        // can simply face the middle for good; they are drawn after the dome and the stars without
        // writing depth (the world, drawn first, still hides them), and turn slowly overhead.
        // Nothing lights them: S.update gives them the colour of the hour.
        let seed = 20261121;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };   // (the same sky for every player)
        const blob = Tex.textCanvas(128, 128, (ctx, W) => {                // a big soft ball with smaller ones round it
            for (let k = 0; k < 9; k++) {
                const a = rnd() * 6.283, off = k ? 14 + rnd() * 16 : 0, r = k ? 20 + rnd() * 14 : 40;
                const x = W / 2 + Math.cos(a) * off, y = W / 2 + Math.sin(a) * off;
                const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.55, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
            }
        });
        cloudMat = new THREE.MeshBasicMaterial({ map: blob, vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false });
        const spots = [], uv = [], tone = [], index = [];
        const across = new THREE.Vector3(), up = new THREE.Vector3(), mid = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), at = new THREE.Vector3();
        // one patch: centred `x` along the cloud and `y` up it, `w` by `h` across, turned by `turn`, in a shade of grey
        const patch = (x, y, w, h, turn, grey) => {
            e1.copy(across).multiplyScalar(Math.cos(turn)).addScaledVector(up, Math.sin(turn));
            e2.copy(across).multiplyScalar(-Math.sin(turn)).addScaledVector(up, Math.cos(turn));
            const first = spots.length / 3;
            [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(c => {
                at.copy(mid).addScaledVector(across, x).addScaledVector(up, y).addScaledVector(e1, c[0] * w / 2).addScaledVector(e2, c[1] * h / 2);
                spots.push(at.x, at.y, at.z); uv.push((c[0] + 1) / 2, (c[1] + 1) / 2); tone.push(grey * 0.97, grey * 0.985, grey);
            });
            index.push(first, first + 1, first + 2, first, first + 2, first + 3);
        };
        for (let k = 0; k < 30; k++) {
            const around = rnd() * Math.PI * 2, rise = 0.05 + rnd() * 0.45, far = 760;         // where on the dome: bearing, and how high (radians up from the horizon)
            mid.set(Math.sin(around) * Math.cos(rise) * far, Math.sin(rise) * far, Math.cos(around) * Math.cos(rise) * far);
            across.set(Math.cos(around), 0, -Math.sin(around));                                // sideways as seen from the middle
            up.copy(mid).normalize().cross(across); if (up.y < 0) up.negate();                 // up the sky, square to the line of sight
            const wide = 110 + rnd() * 150, tall = wide * (0.2 + rnd() * 0.1);
            // the base first (it is drawn first, so the white heaps go over it): a flat grey row
            for (let n = 0, row = 5 + Math.floor(rnd() * 3); n < row; n++) {
                const x = (n / (row - 1) - 0.5) * wide * 0.8 + (rnd() - 0.5) * 12;
                patch(x, -tall * 0.12, tall * (1.9 + rnd() * 0.8), tall * (0.95 + rnd() * 0.3), 0, 0.8);
            }
            // then the heaps: tallest in the middle, falling away to the ends
            for (let n = 0, heaps = 7 + Math.floor(rnd() * 5); n < heaps; n++) {
                const u = rnd() * 2 - 1, x = u * wide * 0.4, bulge = 1 - u * u, size = tall * (0.9 + rnd() * 0.7) * (0.6 + 0.4 * bulge);
                patch(x, tall * (0.1 + 0.55 * bulge * rnd()), size * 1.25, size, rnd() * 6.283, 1);
            }
        }
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.Float32BufferAttribute(spots, 3));
        cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        cg.setAttribute('color', new THREE.Float32BufferAttribute(tone, 3));
        cg.setIndex(index);
        clouds = new THREE.Mesh(cg, cloudMat);
        cloudMat.side = THREE.DoubleSide;
        clouds.frustumCulled = false; clouds.renderOrder = -9;
        scene.add(clouds);

        sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);                                // (sharper shadow edges; the game is held back by the processor, not by this)
        const sc2 = sun.shadow.camera;
        sc2.left = -90; sc2.right = 90; sc2.top = 90; sc2.bottom = -90; sc2.near = 1; sc2.far = 600;
        sun.shadow.bias = -0.0006;
        scene.add(sun); scene.add(sun.target);

        hemi = new THREE.HemisphereLight(0x9fc7ff, 0x6b6b5a, 0.45);          // (the sky environment map lights things too now)
        scene.add(hemi);
        ambient = new THREE.AmbientLight(0xffffff, 0.18);
        scene.add(ambient);

        scene.fog = new THREE.FogExp2(0xcfe6ff, 0.0012);
        scene.background = null;
        // Environment maps so metallic paint and glass reflect the sky (day and night versions)
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envFrom = (top, hor, ground, sunX) => {
            const c = document.createElement('canvas'); c.width = 256; c.height = 128;
            const ctx = c.getContext('2d');
            const g = ctx.createLinearGradient(0, 0, 0, 128);
            g.addColorStop(0, top); g.addColorStop(0.5, hor); g.addColorStop(0.55, ground); g.addColorStop(1, ground);
            ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
            if (sunX !== undefined) { const r = ctx.createRadialGradient(sunX, 40, 2, sunX, 40, 30); r.addColorStop(0, 'rgba(255,250,230,1)'); r.addColorStop(1, 'rgba(255,250,230,0)'); ctx.fillStyle = r; ctx.fillRect(0, 0, 256, 128); }
            const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping;
            const env = pmrem.fromEquirectangular(t).texture; t.dispose(); return env;
        };
        S.envDay = envFrom('#5a93e0', '#dbe9ff', '#6f7f66', 190);
        S.envNight = envFrom('#070a1a', '#1a2040', '#0b0d12');
        scene.environment = S.envDay;
        S.update(0, new THREE.Vector3());
    };

    // focus = the player position; the sky follows it and the shadow camera is centred on it
    // The sky as an environment map, so car paint, glass and wet-looking roads reflect it. Made
    // from the dome's own shader (a clone in a private scene), refreshed every few seconds as
    // the day turns; three's standard materials pick it up from scene.environment.
    let pmrem = null, envScene = null, envRT = null, envT = -1e9;
    S.refreshEnv = function () {
        if (!renderer || !dome) return;
        if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(dome.geometry, dome.material)); }
        const rt = pmrem.fromScene(envScene, 0.04);
        scene.environment = rt.texture;
        if (envRT) envRT.dispose();
        envRT = rt;
    };
    S.update = function (dt, focus) {
        // (the reflections are the static day/night maps swapped below: a live PMREM of the dome
        // was rebuilt every 6 s and then overwritten by that swap in the same call)
        time += dt * S.speed;
        const cycle = CFG.CYCLE.day + CFG.CYCLE.night;
        S.t = (time / cycle) % 1;
        const ang = S.t * Math.PI * 2;                 // 0 sunrise, PI/2 noon, PI sunset
        S.sunDir.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
        const elev = S.sunDir.y;
        const dl = smooth(-0.12, 0.22, elev);          // daylight 0..1
        const dusk = Math.exp(-Math.pow(elev / 0.16, 2)) * (elev > -0.2 ? 1 : 0);
        S.daylight = dl; S.night = 1 - dl;

        const u = dome.material.uniforms;
        u.uTop.value.copy(col.topNight).lerp(col.topDay, dl);
        u.uHorizon.value.copy(col.horNight).lerp(col.horDay, dl).lerp(col.dusk, dusk * 0.75);
        u.uBottom.value.copy(col.botNight).lerp(col.botDay, dl);
        u.uSunDir.value.copy(S.sunDir);
        u.uSunColor.value.copy(col.sunLow).lerp(col.sunHigh, smooth(0, 0.5, elev)).multiplyScalar(elev > -0.1 ? 1 : 0);

        dome.position.copy(focus);
        stars.position.copy(focus);
        // keep the dome inside the camera's view distance (it is clipped to black otherwise)
        if (window.game && game.camera) { const k = Math.min(1, game.camera.far * 0.92 / 850); dome.scale.setScalar(k); stars.scale.setScalar(k); clouds.scale.setScalar(k); }
        clouds.position.copy(focus); clouds.rotation.y += dt * 0.004;         // (they drift round, a full turn in half an hour)
        stars.material.opacity = (1 - dl) * 0.9 * (1 - 0.85 * (S.rain || 0));      // (rain clouds hide most of them)

        // The one directional light is the sun by day and the moon by night. The moon stands
        // opposite the sun, and the light is dark at the moment it changes sides (daylight is
        // gone by the time the sun is 0.12 under the horizon, and the moon only starts there).
        const moon = smooth(0.12, 0.3, -elev), rain = S.rain || 0;
        moonDir.set(-S.sunDir.x, -S.sunDir.y, S.sunDir.z);
        u.uMoonDir.value.copy(moonDir); u.uMoon.value = moon * (1 - 0.8 * rain);
        sun.position.copy(focus).addScaledVector(moon > 0 ? moonDir : S.sunDir, 300);
        sun.target.position.copy(focus);
        // Daylight is a strong sun and little fill light, with the exposure held down: bright fill
        // light at full exposure washed every colour out to pale grey (ACES tone mapping brightens
        // by 1/0.6 before it compresses). The night keeps its own softer balance.
        sun.intensity = moon > 0 ? 0.3 * moon : 1.5 * dl;
        if (moon > 0) sun.color.copy(col.moon); else sun.color.copy(col.sunLow).lerp(col.sunHigh, smooth(0, 0.45, elev));
        sun.visible = sun.intensity > 0.02;

        hemi.color.copy(col.hemiSkyNight).lerp(col.hemiSkyDay, dl);
        hemi.groundColor.copy(col.hemiGroundNight).lerp(col.hemiGroundDay, dl);
        hemi.intensity = 0.22 + 0.08 * dl;
        ambient.intensity = 0.1 - 0.04 * dl;

        scene.fog.color.copy(u.uHorizon.value);
        // rain: thicker air, a darker sky, half the sun and grey clouds, all by how hard it is raining
        scene.fog.density = (0.0025 - 0.0017 * dl) * (1 + 0.8 * rain) * (S.fogBoost || 1);
        if (rain > 0) { u.uTop.value.multiplyScalar(1 - 0.45 * rain); u.uHorizon.value.multiplyScalar(1 - 0.3 * rain); sun.intensity *= 1 - 0.5 * rain; }
        // the clouds take the colour of the hour (nothing lights them): white by day, warm at dusk,
        // dark blue-grey at night, and rain-grey in a shower
        cloudMat.color.copy(col.cloudNight).lerp(col.cloudDay, dl).lerp(col.dusk, dusk * 0.4);
        cloudMat.color.lerp(tmpA.copy(col.cloudWet).multiplyScalar(0.25 + 0.75 * dl), rain * 0.85);
        if (renderer) renderer.toneMappingExposure = 0.8 - 0.2 * dl;
        if (S.envDay) { const want = dl > 0.4 ? S.envDay : S.envNight; if (scene.environment !== want) scene.environment = want; }
        unsaved += dt;
        if (unsaved > 20 && window.Save) { unsaved = 0; Save.set('clock', Math.round(S.t * 10000) / 10000); }
    };

    // Put the clock at a time of day (0..1, as S.t). In a multiplayer room the guests keep to the
    // host's time of day this way, so it is night for everyone at once; a guest who has gone to
    // bed and slept till morning keeps their own morning (S.slept) rather than be put back.
    S.setTime = function (t) {
        if (!(t >= 0 && t < 1)) return;
        const cycle = CFG.CYCLE.day + CFG.CYCLE.night;
        time = t * cycle; S.t = t;
    };
    S.follow = function (t) {
        if (S.slept || !(t >= 0 && t < 1)) return;
        const off = Math.abs(t - S.t), apart = Math.min(off, 1 - off);
        if (apart > 0.002) S.setTime(t);                                   // (more than about three minutes on the clock)
    };

    // Clock text for the HUD: 24-hour cycle mapped onto the day/night loop, 6:00 = sunrise
    S.clockText = function () {
        const hours = (6 + S.t * 24) % 24;
        const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
        const ampm = h >= 12 ? 'PM' : 'AM';
        return `${((h + 11) % 12) + 1}:${m < 10 ? '0' : ''}${m} ${ampm}`;
    };

    return S;
})();
