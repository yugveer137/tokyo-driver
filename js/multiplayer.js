// tokyo-driver1 v2 — two-player multiplayer over PeerJS (WebRTC data channel, brokered by the
// public PeerJS cloud; no server of our own). The host shares an invite link
// (?room=<peer id>); the guest opens it and both see each other's car at 20 Hz.
window.Multiplayer = (function () {
    const M = { peer: null, conn: null, role: null, peerCar: null, ready: false };
    let scene, sendTimer = 0, lastRemote = null;
    const $ = (id) => document.getElementById(id);

    function loadPeerJs() {
        if (window.Peer) return Promise.resolve();
        if (M.loading) return M.loading;
        M.loading = new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('PeerJS failed to load'));
            document.head.appendChild(s);
        });
        return M.loading;
    }
    function status(msg, color) {
        const el = $('mp-status'); if (!el) return;
        el.textContent = msg; el.style.background = color || 'rgba(0,114,255,0.85)'; el.style.display = msg ? 'block' : 'none';
    }
    function inviteUrl(id) { return location.origin + location.pathname + '?room=' + encodeURIComponent(id); }

    function makePeerCar(carId, label) {
        const g = new THREE.Group();
        let body = null;
        try { if (window.CarModels && CARS[carId]) body = CarModels.buildBody(carId); } catch (e) { body = null; }
        if (!body) {
            body = new THREE.Group();
            const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4), new THREE.MeshStandardMaterial({ color: 0x00e5ff })); b.position.y = 0.6; body.add(b);
            const r = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 2.2), new THREE.MeshStandardMaterial({ color: 0x222222 })); r.position.y = 1.3; body.add(r);
        }
        g.add(body);
        const wheels = [];
        if (window.CarModels && CARS[carId]) {
            const wl = CarModels.wheelLayout(carId);
            wl.points.forEach(p => { const w = CarModels.buildWheel(carId); w.position.set(p[0], p[1] - (wl.radius > 0.4 ? 0 : 0.0), p[2]); g.add(w); wheels.push(w); });
        }
        const tag = Tex.textCanvas(256, 64, (ctx, W, H) => {
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.roundRect(4, 4, W - 8, H - 8, 8); ctx.fill();
            ctx.fillStyle = '#00e5ff'; ctx.font = 'bold 30px monospace'; ctx.textAlign = 'center'; ctx.fillText(label, W / 2, 42);
        });
        const tagMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 0.9), new THREE.MeshBasicMaterial({ map: tag, transparent: true, depthTest: false }));
        tagMesh.position.set(0, 2.4, 0); g.add(tagMesh);
        g.userData.tag = tagMesh; g.userData.carId = carId; g.userData.wheels = wheels;
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        scene.add(g);
        return g;
    }

    function onConnected(conn, role) {
        M.conn = conn; M.role = role; M.ready = true;
        $('mp-waiting').style.display = 'none';
        UI.enterDriveReady(); $('drive-btn').style.display = 'none'; Game.start();
        const label = role === 'host' ? 'PLAYER 2' : 'HOST';
        M.peerCar = makePeerCar('starter', label);
        status(role === 'host' ? 'Player 2 joined! Multiplayer active.' : 'Connected to the host! Multiplayer active.', 'rgba(0,160,60,0.9)');
        setTimeout(() => status(''), 4000);
        conn.on('data', onData);
        conn.on('close', () => { status(label + ' disconnected.', 'rgba(200,0,0,0.85)'); if (M.peerCar) { scene.remove(M.peerCar); M.peerCar = null; } M.conn = null; M.ready = false; });
    }
    function onData(d) {
        if (!d || d.t !== 'p' || !M.peerCar) return;
        if (d.car && d.car !== M.peerCar.userData.carId) { const lbl = M.role === 'host' ? 'PLAYER 2' : 'HOST'; scene.remove(M.peerCar); M.peerCar = makePeerCar(d.car, lbl); }
        lastRemote = d;
    }

    M.host = function () {
        loadPeerJs().then(() => {
            status('Creating your room…');
            M.peer = new Peer();
            M.peer.on('open', (id) => {
                const url = inviteUrl(id);
                $('mp-link').value = url;
                $('mp-waiting').style.display = 'flex';
                $('mp-copy').onclick = () => { navigator.clipboard.writeText(url).then(() => { $('mp-copy').textContent = 'COPIED!'; setTimeout(() => $('mp-copy').textContent = 'COPY LINK', 2000); }); };
                $('mp-skip').onclick = () => { $('mp-waiting').style.display = 'none'; status('Waiting for a player in the background…'); };
                UI.enterDriveReady(); $('drive-btn').style.display = 'none'; Game.start();
                status('Room ready. Send the link to a friend.');
                M.peer.on('connection', (conn) => conn.on('open', () => onConnected(conn, 'host')));
            });
            M.peer.on('error', (err) => status('Connection error: ' + err.type, 'rgba(200,0,0,0.85)'));
        }).catch(e => status(e.message, 'rgba(200,0,0,0.85)'));
    };

    M.join = function (roomId) {
        loadPeerJs().then(() => {
            status('Connecting to the host…');
            UI.enterDriveReady(); $('drive-btn').style.display = 'none'; Game.start();
            M.peer = new Peer();
            M.peer.on('open', () => {
                const conn = M.peer.connect(roomId, { reliable: true });
                conn.on('open', () => onConnected(conn, 'guest'));
                conn.on('error', (e) => status('Could not connect: ' + e, 'rgba(200,0,0,0.85)'));
            });
            M.peer.on('error', (err) => status('Peer error: ' + err.type, 'rgba(200,0,0,0.85)'));
        }).catch(e => status(e.message, 'rgba(200,0,0,0.85)'));
    };

    // ?room=<id> in the URL: ask before joining
    M.checkInvite = function () {
        const room = new URLSearchParams(location.search).get('room');
        if (!room) return false;
        $('start-screen').style.display = 'none';
        $('mp-join').style.display = 'flex';
        $('mp-join-yes').onclick = () => { $('mp-join').style.display = 'none'; M.join(room); };
        $('mp-join-no').onclick = () => { $('mp-join').style.display = 'none'; $('start-screen').style.display = 'flex'; history.replaceState(null, '', location.pathname); };
        return true;
    };

    M.showMenu = function () { $('menu-main').style.display = 'none'; $('mp-panel').style.display = 'block'; };
    M.hideMenu = function () { $('mp-panel').style.display = 'none'; $('menu-main').style.display = 'block'; };

    M.update = function (dt) {
        if (!M.ready || !M.conn || !M.conn.open || !Car.body) return;
        sendTimer += dt;
        if (sendTimer >= 0.05) {
            sendTimer = 0;
            const p = Car.body.position, q = Car.body.quaternion;
            try { M.conn.send({ t: 'p', x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, car: Car.data.id }); } catch (e) {}
        }
        if (lastRemote && M.peerCar) {
            const d = lastRemote;
            M.peerCar.position.lerp(new THREE.Vector3(d.x, d.y, d.z), 0.5);
            M.peerCar.quaternion.slerp(new THREE.Quaternion(d.qx, d.qy, d.qz, d.qw), 0.5);
            M.peerCar.userData.tag.quaternion.copy(game.camera.quaternion);
        }
    };

    M.init = function (sc) {
        scene = sc;
        $('mp-share').onclick = () => { M.hideMenu(); M.host(); };
        $('mp-back').onclick = M.hideMenu;
    };
    return M;
})();
