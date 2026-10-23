// tokyo-driver1 v2 — bootstrap and the game loop.
(function () {
    let scene, camera, renderer, world, clock;
    let fpsSamples = [], fps = 60, pixelRatio = Math.min(window.devicePixelRatio, 2), frameNo = 0;

    function initRenderer() {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        document.getElementById('game').appendChild(renderer.domElement);
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    function initPhysics() {
        // Cannon 0.6.2's Heightfield logs a bogus "faceNormals ... points into the shape" error on
        // every wheel raycast (its pillar winding bug, fixed only in cannon-es). Drop just those.
        const rawError = console.error.bind(console);
        console.error = function (msg) {
            if (typeof msg === 'string' && msg.indexOf('faceNormals') !== -1) return;
            rawError.apply(console, arguments);
        };
        world = new CANNON.World();
        world.gravity.set(0, CFG.GRAVITY, 0);
        world.broadphase = new CANNON.SAPBroadphase(world);
        world.solver.iterations = 10;
        world.defaultContactMaterial.friction = 0.4;
        world.groundMaterial = new CANNON.Material('ground');
        world.wheelMaterial = new CANNON.Material('wheel');
        world.addContactMaterial(new CANNON.ContactMaterial(world.wheelMaterial, world.groundMaterial, { friction: 0.5, restitution: 0.1 }));
    }

    function init() {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1200);
        initRenderer();
        initPhysics();
        Tex.build(renderer);
        Sky.init(scene, renderer);
        Terrain.init(scene, world);
        Road.init(scene, world);
        Signs.init(scene);
        Train.init(scene);
        City.init(scene, world);
        Traffic.init(scene, world);
        Car.init(scene, world, camera);
        Game.initCoins(scene);
        Features.init(scene);
        Races.init(scene);
        UI.init();
        Minimap.init();
        World.build();
        Game.load();

        Terrain.update(World.spawn);
        World.update(World.spawn);
        Car.spawn(Game.carData(), World.spawn, World.spawnYaw);
        UI.showMenu();

        clock = new THREE.Clock();
        window.game = { scene, camera, renderer, world, tick, render: () => renderer.render(scene, camera) };   // for debugging in the console
        requestAnimationFrame(loop);
    }

    function adaptResolution(dt) {
        fpsSamples.push(1 / Math.max(dt, 1e-3));
        if (fpsSamples.length < 60) return;
        fps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
        fpsSamples = [];
        const maxPR = Math.min(window.devicePixelRatio, 2);
        if (fps < 42 && pixelRatio > 0.8) pixelRatio = Math.max(0.8, pixelRatio - 0.2);
        else if (fps > 57 && pixelRatio < maxPR) pixelRatio = Math.min(maxPR, pixelRatio + 0.15);
        if (Math.abs(renderer.getPixelRatio() - pixelRatio) > 0.01) renderer.setPixelRatio(pixelRatio);
    }

    // One simulation step without rendering (also callable from the console for testing)
    function tick(dt) {
        if (dt > 0) world.step(1 / 60, dt, 3);
        if (Car.body) Train.update(dt, Car.body.position);
        Car.update(dt);
        const focus = Car.body ? Car.body.position : { x: 0, y: 0, z: 0 };
        Sky.update(dt, focus);
        Terrain.update(focus);
        World.update(focus);
        City.update(dt);
        if (Car.body) {
            Traffic.update(dt, Car.body.position, Car.mph / CFG.MPH);
            if (Game.started) Game.updateCoins(dt, Car.body.position);
            if (frameNo++ % 15 === 0) {
                UI.area = World.areaAt(Car.body.position);
                UI.limit = World.speedLimitAt(Car.body.position);
            }
            if (Game.started && window.GameAudio) GameAudio.update({ mph: Car.mph, throttle: Car.throttle, lateralVel: Car.lateralVel, drifting: Car.drifting });
            Minimap.update(Car.body.position, Car.yaw());
            Features.update(dt);
            Races.update(dt);
        }
        UI.update(fps);
    }

    function loop() {
        requestAnimationFrame(loop);
        const dt = Math.min(clock.getDelta(), 0.05);
        // A hidden or not-yet-laid-out tab has a 0x0 canvas; rendering then floods WebGL warnings
        if (window.innerWidth === 0 || window.innerHeight === 0) return;
        if (renderer.domElement.width === 0) {
            camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
        tick(dt);
        adaptResolution(dt);
        renderer.render(scene, camera);
    }

    window.addEventListener('load', () => {
        Save.boot().then(init).catch(e => { console.error(e); init(); });
    });
})();
