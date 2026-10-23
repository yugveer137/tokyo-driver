// tokyo-driver1 v2 — sky dome, sun, stars and the day/night cycle.
// One full cycle = CFG.CYCLE.day + CFG.CYCLE.night seconds. t = 0 is sunrise, the sun is
// highest a quarter of the way through, sets at the half-way point, and the night half
// follows. Everything that depends on the time of day reads Sky.daylight (0..1) and Sky.night.
window.Sky = (function () {
    const S = { daylight: 1, night: 0, t: 0.08, sunDir: new THREE.Vector3(0, 1, 0), speed: 1 };
    let dome, stars, sun, hemi, ambient, scene, renderer, time = 0;

    const C = (hex) => new THREE.Color(hex);
    const col = {
        topDay: C(0x2f6fd6), topNight: C(0x05081a),
        horDay: C(0xcfe6ff), horNight: C(0x121833), dusk: C(0xff8a3a),
        botDay: C(0x8fb3d9), botNight: C(0x05060c),
        sunHigh: C(0xfff6e0), sunLow: C(0xffb060),
        hemiSkyDay: C(0x9fc7ff), hemiSkyNight: C(0x1b2240),
        hemiGroundDay: C(0x6b6b5a), hemiGroundNight: C(0x0a0a12)
    };
    const tmpA = new THREE.Color(), tmpB = new THREE.Color();
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    S.init = function (sc, r) {
        scene = sc; renderer = r;
        time = S.t * (CFG.CYCLE.day + CFG.CYCLE.night);

        dome = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 16), new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
            uniforms: {
                uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
                uBottom: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
                uSunColor: { value: new THREE.Color() }
            },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: `
                uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    float h = d.y;
                    vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.5));
                    float s = max(dot(d, uSunDir), 0.0);
                    c += uSunColor * (pow(s, 400.0) * 2.0 + pow(s, 12.0) * 0.22 + pow(s, 2.0) * 0.05);
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
        scene.add(stars);

        sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1536, 1536);
        const sc2 = sun.shadow.camera;
        sc2.left = -90; sc2.right = 90; sc2.top = 90; sc2.bottom = -90; sc2.near = 1; sc2.far = 600;
        sun.shadow.bias = -0.0006;
        scene.add(sun); scene.add(sun.target);

        hemi = new THREE.HemisphereLight(0x9fc7ff, 0x6b6b5a, 0.6);
        scene.add(hemi);
        ambient = new THREE.AmbientLight(0xffffff, 0.3);
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
    S.update = function (dt, focus) {
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
        if (window.game && game.camera) { const k = Math.min(1, game.camera.far * 0.92 / 850); dome.scale.setScalar(k); stars.scale.setScalar(k); }
        stars.material.opacity = (1 - dl) * 0.9;

        sun.position.copy(focus).addScaledVector(S.sunDir, 300);
        sun.target.position.copy(focus);
        sun.intensity = 1.1 * dl;
        sun.color.copy(col.sunLow).lerp(col.sunHigh, smooth(0, 0.45, elev));
        sun.visible = dl > 0.02;

        hemi.color.copy(col.hemiSkyNight).lerp(col.hemiSkyDay, dl);
        hemi.groundColor.copy(col.hemiGroundNight).lerp(col.hemiGroundDay, dl);
        hemi.intensity = 0.22 + 0.28 * dl;
        ambient.intensity = 0.1 + 0.12 * dl;

        scene.fog.color.copy(u.uHorizon.value);
        scene.fog.density = (0.0025 - 0.0013 * dl) * (S.rain ? 1.8 : 1) * (S.fogBoost || 1);
        if (S.rain) { u.uTop.value.multiplyScalar(0.55); u.uHorizon.value.multiplyScalar(0.7); sun.intensity *= 0.5; }
        if (renderer) renderer.toneMappingExposure = 0.8 + 0.25 * dl;
        if (S.envDay) { const want = dl > 0.4 ? S.envDay : S.envNight; if (scene.environment !== want) scene.environment = want; }
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
