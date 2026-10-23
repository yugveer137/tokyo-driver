// tokyo-driver1 v2 — "Real map" mode. Fetches the actual streets and buildings of the current
// city's downtown from OpenStreetMap (Overpass API, needs internet), builds them as drivable
// draped streets and extruded buildings on a flat plateau far from the route, and teleports
// the player there. EXIT REAL MAP brings you back to where you were.
window.OSM = (function () {
    const O = { active: null, loading: false };
    let scene, world;
    const ORIGIN = { x: 60000, z: 0 };            // where real maps are built (away from the route)
    const RADIUS = 450;                           // metres of real city around the centre (bigger = slower Overpass answers)
    const MAX_BUILDINGS = 700;
    const centres = {
        tokyo: [35.6595, 139.7004], sf: [37.7899, -122.4014], oakland: [37.8044, -122.2712],
        sacramento: [38.5816, -121.4944], reno: [39.5296, -119.8138], vegas: [36.1147, -115.1728], nyc: [40.7549, -73.9840]
    };
    const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

    O.init = function (sc, w) {
        scene = sc; world = w;
        // flat plateau for real maps, registered once
        Terrain.shapers.push((x, z, h) => {
            const d = Math.hypot(x - ORIGIN.x, z - ORIGIN.z);
            if (d > RADIUS + 400) return h;
            const k = Math.min(1, Math.max(0, (d - RADIUS - 100) / 300));
            return 0 * (1 - k) + h * k;
        });
    };

    function query(lat, lon) {
        const dLat = RADIUS / 111320, dLon = RADIUS / (111320 * Math.cos(lat * Math.PI / 180));
        const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
        return `[out:json][timeout:30];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](${bbox});way["building"](${bbox}););out geom;`;
    }
    async function fetchOverpass(q) {
        let lastErr = null;
        for (const url of ENDPOINTS) {
            const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 40000);
            try {
                const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal });
                if (!r.ok) throw new Error('Overpass ' + r.status + (r.status === 502 || r.status === 504 ? ' (server busy)' : ''));
                return await r.json();
            } catch (e) { lastErr = e; UI.toast('Map server busy, trying another…', 2000); }
            finally { clearTimeout(timer); }
        }
        throw lastErr || new Error('Overpass unreachable');
    }
    function project(lat, lon, c) {
        const x = (lon - c[1]) * 111320 * Math.cos(c[0] * Math.PI / 180);
        const z = (lat - c[0]) * 111320;
        return [ORIGIN.x + x, ORIGIN.z - z];              // north = -z on screen? keep north = +z: flip
    }

    O.enter = async function () {
        if (O.loading) return;
        const city = City.at(Car.body.position) || World.cities.find(c => c.loaded) || World.cities[0];
        const c = centres[city.id];
        if (!c) { UI.toast('No real map for ' + city.name); return; }
        O.loading = true;
        UI.toast('Loading the real streets of ' + city.name + ' from OpenStreetMap…', 4000);
        try {
            const data = await fetchOverpass(query(c[0], c[1]));
            build(city, c, data);
        } catch (e) {
            console.warn(e);
            UI.toast('Could not load the map (' + e.message + '). Are you online?', 4000);
            O.loading = false;
            return;
        }
        O.loading = false;
    };

    function build(city, c, data) {
        if (O.active) teardown();
        const A = { city, roads: [], meshes: [], bodies: [], returnPos: Car.body.position.clone(), returnYaw: Car.yaw() };
        Terrain.rebuild(new THREE.Vector3(ORIGIN.x, 0, ORIGIN.z));
        let nRoads = 0, nBuildings = 0;
        const ways = data.elements.filter(e => e.type === 'way' && e.geometry && e.geometry.length > 1);
        ways.forEach(w => {
            const tags = w.tags || {};
            const pts = w.geometry.map(g => project(g.lat, g.lon, c));
            if (tags.highway) {
                const big = /motorway|trunk|primary|secondary/.test(tags.highway);
                // drop nodes closer than 6 m so the spline stays smooth, keep ends
                const kept = [pts[0]];
                for (let i = 1; i < pts.length; i++) { const p = pts[i], q = kept[kept.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 6 || i === pts.length - 1) kept.push(p); }
                if (kept.length < 2) return;
                const points = kept.map(p => [p[0], 0, p[1]]);
                if (points.length === 2) points.splice(1, 0, [(points[0][0] + points[1][0]) / 2, 0, (points[0][2] + points[1][2]) / 2]);
                const r = Road.build({ type: big ? 'avenue' : 'street', name: tags.name || tags.highway, conform: true, points, segLen: 5 });
                A.roads.push(r); nRoads++;
            } else if (tags.building !== undefined) {
                if (nBuildings >= MAX_BUILDINGS) return;
                const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0] - ORIGIN.x, -(p[1] - ORIGIN.z))));
                let h = parseFloat(tags.height) || (parseFloat(tags['building:levels']) || 0) * 3.5 || (8 + Math.random() * 10);
                h = Math.min(h, 250);
                let geom;
                try { geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); } catch (e) { return; }
                geom.rotateX(-Math.PI / 2);
                // extrude UVs are in metres: one facade tile per 8 x 7 m
                if (!O.facadeTex) { O.facadeTex = Tex.facade.clone(); O.facadeTex.repeat.set(1 / 8, 1 / 7); O.facadeTex.needsUpdate = true; }
                const mat = new THREE.MeshStandardMaterial({ color: [0xcfc8bb, 0xb9b2a4, 0x9aa3ad, 0xd8d2c6, 0x7f8792][nBuildings % 5], map: O.facadeTex, roughness: 0.8 });
                const m = new THREE.Mesh(geom, mat);
                m.position.set(ORIGIN.x, 0.05, ORIGIN.z);
                m.castShadow = h > 20; m.receiveShadow = true;
                scene.add(m); A.meshes.push(m); nBuildings++;
                // physics: a box over the footprint's bounds
                let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                pts.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); });
                const body = new CANNON.Body({ mass: 0 });
                body.addShape(new CANNON.Box(new CANNON.Vec3((maxX - minX) / 2, h / 2, (maxZ - minZ) / 2)));
                body.position.set((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2);
                world.addBody(body); A.bodies.push(body);
            }
        });
        O.active = A;
        // drop the player on the longest street near the centre
        const start = A.roads.sort((a, b) => b.length - a.length)[0];
        if (start) { const f = Road.at(start, start.length / 2, start.lanes[0].offset); Terrain.update(f.p); Car.teleport(f.p.x, f.p.y + 1.2, f.p.z, Road.yawOf(f.tan)); }
        else { Terrain.update(new THREE.Vector3(ORIGIN.x, 0, ORIGIN.z)); Car.teleport(ORIGIN.x, 1.5, ORIGIN.z, 0); }
        UI.area = 'Real ' + city.name; UI.limit = 30;
        document.getElementById('osm-exit').style.display = 'block';
        UI.toast(`Real ${city.name}: ${nRoads} streets, ${nBuildings} buildings from OpenStreetMap`, 4000);
    }

    function teardown() {
        const A = O.active; if (!A) return;
        A.roads.forEach(r => Road.remove(r));
        A.meshes.forEach(m => { scene.remove(m); m.geometry.dispose(); });
        A.bodies.forEach(b => world.removeBody(b));
        O.active = null;
        document.getElementById('osm-exit').style.display = 'none';
    }
    O.exit = function () {
        const A = O.active; if (!A) return;
        const p = A.returnPos, yaw = A.returnYaw;
        teardown();
        Terrain.update(p); World.update(p);
        Car.teleport(p.x, p.y + 1, p.z, yaw);
        UI.toast('Back on the route');
    };
    O.isReal = () => !!O.active;
    O.centres = centres;
    O._build = build;          // for console tests with canned Overpass JSON
    return O;
})();
