// tokyo-driver1 v2 — multiplayer over PeerJS (WebRTC data channels, brokered by the public
// PeerJS cloud; no server of our own).
//
// The lobby: every game that is open joins one lobby, so players can hear about each other.
// There is no server to keep it, so one of the players is the lobby: whoever first takes the
// well-known peer id LOBBY_ID. Everyone else connects to that id; when its owner leaves, the
// rest try again and the first to take the id is the new lobby.
//
// A room: MULTIPLAYER > OPEN A ROOM makes this player the host and tells the lobby, which
// tells everyone: they get a "somebody opened a room" banner with JOIN / NO THANKS. An invite
// link (?room=<the host's peer id>) joins the same room. Guests each talk only to the host,
// who passes everyone's car on to everyone else (20 times a second), so any number can join
// up to MAX_PLAYERS.
window.Multiplayer = (function () {
    const M = { peer: null, role: null, ready: false };
    const MAX_PLAYERS = 16;
    let LOBBY_ID = 'bay-area-driver-lobby-1';
    try { LOBBY_ID += localStorage.getItem('td_lobby') || ''; } catch (e) { /* (a test can use a lobby of its own) */ }

    let scene, sendTimer = 0;
    let hostConn = null, hostHeard = 0;   // guest: the connection to the host, and when it last said anything
    let guests = [];                // host: [{ conn, id, n, d }] (d = that guest's latest car state)
    let nextN = 2, myN = 1;         // player numbers: the host is 1
    const cars = {};                // the other players' cars here: id -> { mesh, d, fresh }
    const lobby = { hub: null, members: [], conn: null, trying: null, timer: 0, rooms: {}, declined: {} };
    const $ = (id) => document.getElementById(id);

    function loadPeerJs() {
        if (window.Peer) return Promise.resolve();
        if (M.loading) return M.loading;
        M.loading = new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
            s.onload = res; s.onerror = () => { M.loading = null; rej(new Error('PeerJS failed to load')); };
            document.head.appendChild(s);
        });
        return M.loading;
    }
    function status(msg, color, ms) {
        const el = $('mp-status'); if (!el) return;
        el.textContent = msg; el.style.background = color || 'rgba(0,114,255,0.85)'; el.style.display = msg ? 'block' : 'none';
        clearTimeout(status.timer);
        if (msg && ms) status.timer = setTimeout(() => status(''), ms);
    }
    const RED = 'rgba(200,0,0,0.85)', GREEN = 'rgba(0,160,60,0.9)';
    // The link a friend opens. Made on this Mac (localhost) or over home Wi-Fi the page's own
    // address is one nobody else can reach, so the invite points at the public site instead.
    function inviteUrl(id) {
        const h = location.hostname;
        const local = location.protocol === 'file:' || h === 'localhost' || h === '[::1]' || h.endsWith('.local') || /^(127|10)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h);
        return (local ? CFG.SITE : location.origin + location.pathname) + '?room=' + encodeURIComponent(id);
    }
    const send = (conn, msg) => { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* (a closing connection) */ } };

    // ---------- this player's own peer (one for the lobby, hosting and joining) ----------
    function getPeer() {
        if (M.peerReady) return M.peerReady;
        M.peerReady = loadPeerJs().then(() => new Promise((res, rej) => {
            const p = new Peer();
            p.on('open', () => { M.peer = p; res(p); });
            p.on('connection', onGuest);
            p.on('disconnected', () => { try { p.reconnect(); } catch (e) { /* (destroyed) */ } });
            p.on('error', (err) => {
                if (!M.peer) { M.peerReady = null; rej(new Error('No connection (' + err.type + ')')); return; }
                if (err.type !== 'peer-unavailable') return;
                // (the message names the peer that is not there)
                if (String(err.message).includes(LOBBY_ID)) { if (lobby.fail) lobby.fail(); }
                else if (joining) joinFailed('That room has closed.');
            });
        }));
        return M.peerReady;
    }

    // ---------- the lobby ----------
    function retryLobby() { clearTimeout(lobby.retry); lobby.retry = setTimeout(joinLobby, 800 + Math.random() * 2500); }
    function joinLobby() {
        if (lobby.hub || lobby.conn || lobby.trying) return;
        getPeer().then(p => {
            const c = p.connect(LOBBY_ID, { reliable: true, metadata: { kind: 'lobby' } });
            lobby.trying = c;
            // nobody is the lobby (or its owner has gone quiet): try to be it
            lobby.fail = () => { if (lobby.trying !== c) return; clearTimeout(lobby.timer); lobby.trying = null; lobby.fail = null; try { c.close(); } catch (e) { /* (never opened) */ } claimLobby(); };
            lobby.timer = setTimeout(lobby.fail, 7000);
            c.on('open', () => {
                clearTimeout(lobby.timer); lobby.trying = null; lobby.fail = null; lobby.conn = c; lobby.heard = Date.now();
                if (M.role === 'host') send(c, { t: 'room', id: M.peer.id });
            });
            c.on('data', (d) => {
                lobby.heard = Date.now();
                if (!d) return;
                if (d.t === 'room') roomOpened(d.id);
                else if (d.t === 'room-close') roomClosed(d.id);
            });
            c.on('close', () => lostLobby(c));
        }).catch(() => retryLobby());
    }
    // the lobby's owner has gone (or gone silent): forget its rooms and find or become the next one
    function lostLobby(c) {
        if (lobby.conn !== c) return;
        lobby.conn = null; try { c.close(); } catch (e) { /* (gone already) */ }
        Object.keys(lobby.rooms).forEach(roomClosed);
        retryLobby();
    }
    function claimLobby() {
        const h = new Peer(LOBBY_ID);
        h.on('open', () => {
            lobby.hub = h; lobby.members = [];
            if (M.role === 'host') lobby.rooms[M.peer.id] = { id: M.peer.id, owner: null };
        });
        h.on('connection', (c) => {
            c.on('open', () => { c.heard = Date.now(); lobby.members.push(c); Object.keys(lobby.rooms).forEach(id => send(c, { t: 'room', id })); });
            c.on('data', (d) => {
                c.heard = Date.now();
                if (!d) return;
                if (d.t === 'room') { lobby.rooms[d.id] = { id: d.id, owner: c }; tellMembers({ t: 'room', id: d.id }, c); roomOpened(d.id); }
                else if (d.t === 'room-close') { tellMembers({ t: 'room-close', id: d.id }, c); roomClosed(d.id); }
            });
            c.on('close', () => memberGone(c));
        });
        h.on('disconnected', () => { try { h.reconnect(); } catch (e) { /* (destroyed) */ } });
        // (unavailable-id: someone else took the lobby first, so go and join theirs)
        h.on('error', () => { if (lobby.hub === h) return; try { h.destroy(); } catch (e) { /* (never opened) */ } retryLobby(); });
    }
    function memberGone(c) {
        if (!lobby.members.includes(c)) return;
        lobby.members = lobby.members.filter(m => m !== c);
        // (a host who has gone takes their room with them)
        Object.values(lobby.rooms).filter(r => r.owner === c).forEach(r => { tellMembers({ t: 'room-close', id: r.id }); roomClosed(r.id); });
    }
    // A closed laptop or a dropped connection gives no goodbye, and WebRTC can take a minute to
    // notice. So everyone says "still here" every 4 seconds (on a timer, which keeps going in a
    // background tab where the game loop stops), and whoever has been silent too long is gone.
    const SILENT = 15000;
    function beat() {
        const now = Date.now(), hb = { t: 'hb' };
        if (lobby.hub) { tellMembers(hb); lobby.members.filter(c => now - c.heard > SILENT).forEach(c => { try { c.close(); } catch (e) { /* (gone already) */ } memberGone(c); }); }
        if (lobby.conn) { send(lobby.conn, hb); if (now - lobby.heard > SILENT) lostLobby(lobby.conn); }
        if (M.role === 'host') { guests.forEach(g => send(g.conn, hb)); guests.filter(g => now - g.heard > SILENT).forEach(guestGone); }
        if (M.role === 'guest') { send(hostConn, hb); if (now - hostHeard > SILENT) leaveRoom('Lost the connection to the host.'); }
    }
    function tellMembers(msg, except) { lobby.members.forEach(c => { if (c !== except) send(c, msg); }); }
    // tell everyone in the lobby that this player's room is open (or closed again)
    function announce(open) {
        const id = M.peer && M.peer.id; if (!id) return;
        const msg = { t: open ? 'room' : 'room-close', id };
        if (lobby.hub) { if (open) lobby.rooms[id] = { id, owner: null }; else delete lobby.rooms[id]; tellMembers(msg); }
        else send(lobby.conn, msg);
    }
    function roomOpened(id) {
        if (!lobby.rooms[id]) lobby.rooms[id] = { id, owner: null };
        refreshMenu();
        if (M.role || joining || lobby.declined[id] || (M.peer && id === M.peer.id)) return;
        showInvite(id);
    }
    function roomClosed(id) {
        delete lobby.rooms[id];
        refreshMenu();
        if (invite === id) hideInvite();
    }
    const openRoom = () => Object.keys(lobby.rooms).find(id => !(M.peer && id === M.peer.id));

    // ---------- the "somebody opened a room" banner ----------
    let invite = null, inviteTimer = 0;
    function showInvite(id) {
        invite = id;
        $('mp-invite').style.display = 'flex';
        clearTimeout(inviteTimer); inviteTimer = setTimeout(hideInvite, 45000);   // (not answered: it goes away, the menu still lists the room)
    }
    function hideInvite() { invite = null; clearTimeout(inviteTimer); $('mp-invite').style.display = 'none'; }
    function refreshMenu() {
        const b = $('mp-join-open'); if (b) b.style.display = openRoom() && !M.role ? 'block' : 'none';
    }
    function refreshChip() {
        const n = M.role === 'host' ? guests.length + 1 : M.role === 'guest' ? Object.keys(cars).length + 1 : 0;
        $('mp-chip').style.display = M.role ? 'flex' : 'none';
        $('mp-count').textContent = 'MULTIPLAYER · ' + n + (n === 1 ? ' player' : ' players');
    }

    // ---------- the other players' cars ----------
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
            wl.points.forEach(p => { const w = CarModels.buildWheel(carId); w.position.set(p[0], p[1], p[2]); g.add(w); wheels.push(w); });
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
    // a player's latest state: make (or swap) their car and remember where it should be
    function placeCar(id, d) {
        let c = cars[id];
        const carId = d.car || 'starter';
        if (!c || c.mesh.userData.carId !== carId) {
            if (c) scene.remove(c.mesh);
            c = cars[id] = { mesh: makePeerCar(carId, d.n === 1 ? 'HOST' : 'PLAYER ' + d.n), d, fresh: true };
        }
        c.d = d;
    }
    function removeCar(id) { if (cars[id]) { scene.remove(cars[id].mesh); delete cars[id]; } }
    function myState() {
        const p = Car.body.position, q = Car.body.quaternion;
        return { t: 'p', x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, car: Car.data.id };
    }
    // the screens before driving, if this player is still on them
    function startDriving() {
        ['mp-waiting', 'mp-join'].forEach(id => { $(id).style.display = 'none'; });
        if (!Game.started) { UI.enterDriveReady(); $('drive-btn').style.display = 'none'; Game.start(); }
    }

    // ---------- hosting ----------
    M.host = function () {
        if (M.role) return;
        hideInvite();
        status('Creating your room…');
        getPeer().then(p => {
            M.role = 'host'; M.ready = true; guests = []; nextN = 2; myN = 1;
            const url = inviteUrl(p.id);
            $('mp-link').value = url;
            $('mp-waiting').style.display = 'flex';
            $('mp-copy').onclick = () => { navigator.clipboard.writeText(url).then(() => { $('mp-copy').textContent = 'COPIED!'; setTimeout(() => $('mp-copy').textContent = 'COPY LINK', 2000); }); };
            $('mp-skip').onclick = () => { $('mp-waiting').style.display = 'none'; };
            if (!Game.started) { UI.enterDriveReady(); $('drive-btn').style.display = 'none'; Game.start(); }
            announce(true);
            status('Room open. Everyone playing has been asked to join.', null, 5000);
            refreshChip(); refreshMenu();
        }).catch(e => status(e.message, RED, 5000));
    };
    // someone connected to this player's peer: a guest, if a room is open here
    function onGuest(conn) {
        const g = { conn, id: conn.peer, n: 0, d: null, heard: Date.now() };
        conn.on('open', () => {
            if (M.role !== 'host' || guests.length + 1 >= MAX_PLAYERS) { send(conn, { t: 'full' }); setTimeout(() => { try { conn.close(); } catch (e) { /* (gone already) */ } }, 500); return; }
            g.n = nextN++; guests.push(g);
            $('mp-waiting').style.display = 'none';
            const p = Car.body.position;
            send(conn, { t: 'hi', n: g.n, x: p.x, y: p.y, z: p.z, yaw: Car.yaw() });
            status('Player ' + g.n + ' joined!', GREEN, 4000);
            refreshChip();
        });
        conn.on('data', (d) => { g.heard = Date.now(); if (d && d.t === 'p' && g.n) { d.n = g.n; g.d = d; placeCar(g.id, d); } });
        conn.on('close', () => guestGone(g));
    }
    function guestGone(g) {
        if (!guests.includes(g)) return;
        guests = guests.filter(x => x !== g); removeCar(g.id);
        try { g.conn.close(); } catch (e) { /* (gone already) */ }
        status('Player ' + g.n + ' left.', RED, 4000);
        refreshChip();
    }

    // ---------- joining ----------
    let joining = null;
    function joinFailed(msg) {
        if (!joining) return;
        clearTimeout(joining.timer); try { joining.conn.close(); } catch (e) { /* (never opened) */ }
        roomClosed(joining.id); joining = null;
        status(msg, RED, 5000);
    }
    M.join = function (roomId) {
        if (M.role || joining) return;
        hideInvite();
        status('Connecting to the room…');
        startDriving();
        getPeer().then(p => {
            const c = p.connect(roomId, { reliable: true, metadata: { kind: 'room' } });
            joining = { id: roomId, conn: c, timer: setTimeout(() => joinFailed('Could not reach that room.'), 12000) };
            c.on('open', () => {
                if (!joining || joining.conn !== c) return;                 // (given up on already)
                clearTimeout(joining.timer); joining = null;
                M.role = 'guest'; M.ready = true; hostConn = c; hostHeard = Date.now();
                status('Connected! Multiplayer active.', GREEN, 4000);
                refreshChip(); refreshMenu();
            });
            c.on('data', onRoomData);
            c.on('close', () => { if (hostConn === c) leaveRoom('The host closed the room.'); });
        }).catch(e => status(e.message, RED, 5000));
    };
    function onRoomData(d) {
        hostHeard = Date.now();
        if (!d) return;
        if (d.t === 'full') { status('That room is full.', RED, 5000); return; }
        if (d.t === 'hi') { myN = d.n; goNear(d); return; }
        if (d.t !== 'all') return;
        const here = {};
        d.ps.forEach(s => { here[s.id] = true; placeCar(s.id, s); });
        Object.keys(cars).forEach(id => { if (!here[id]) removeCar(id); });   // (someone left)
        refreshChip();
    }
    // A new guest far from the host is put on the road just behind them: in a map this big
    // two players would otherwise never meet.
    function goNear(d) {
        const p = Car.body.position;
        if (Math.hypot(p.x - d.x, p.z - d.z) < 150) return;
        try {
            if (window.SelfDrive && SelfDrive.active) SelfDrive.cancel(true);
            if (window.Walk && Walk.active) Walk.getIn();
        } catch (e) { /* (best effort: the teleport below still happens) */ }
        const back = 10 + 8 * Math.max(0, myN - 2);                          // (each guest a car length further back)
        const x = d.x - Math.sin(d.yaw) * back, z = d.z - Math.cos(d.yaw) * back;
        const at = new THREE.Vector3(x, d.y, z);
        Terrain.update(at); World.update(at, true);
        Car.teleport(x, d.y + 1.0, z, d.yaw);
    }

    // ---------- leaving ----------
    function leaveRoom(msg) {
        if (M.role === 'host') { announce(false); guests.forEach(g => { try { g.conn.close(); } catch (e) { /* (gone already) */ } }); guests = []; }
        if (hostConn) { const c = hostConn; hostConn = null; try { c.close(); } catch (e) { /* (gone already) */ } }
        Object.keys(cars).forEach(removeCar);
        M.role = null; M.ready = false;
        $('mp-waiting').style.display = 'none';
        status(msg || 'You left the room.', msg ? RED : null, 4000);
        refreshChip(); refreshMenu();
    }
    M.leave = () => leaveRoom();
    // one line on where this player stands, for tests
    M.debug = () => 'role ' + M.role + ' n' + myN + ' | lobby ' + (lobby.hub ? 'hub with ' + lobby.members.length : lobby.conn ? 'member' : lobby.trying ? 'trying' : 'none') +
        ' | rooms ' + Object.keys(lobby.rooms).length + ' | guests ' + guests.length + ' | cars ' + Object.keys(cars).length + ' | invite ' + (invite ? 'shown' : 'no');

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

    M.showMenu = function () { $('menu-main').style.display = 'none'; $('mp-panel').style.display = 'block'; refreshMenu(); };
    M.hideMenu = function () { $('mp-panel').style.display = 'none'; $('menu-main').style.display = 'block'; };

    M.update = function (dt) {
        if (!Car.body) return;
        if (M.role) {
            sendTimer += dt;
            // (a full room sends half as often: the host's upload grows with the square of the players)
            if (sendTimer >= (guests.length > 6 ? 0.1 : 0.05)) {
                sendTimer = 0;
                const me = myState();
                if (M.role === 'guest') send(hostConn, me);
                else if (guests.length) {
                    // everyone's car to everyone else: the host is 'host', a guest goes by their peer id
                    const all = [Object.assign({ id: 'host', n: 1 }, me)];
                    guests.forEach(g => { if (g.d) all.push(Object.assign({ id: g.id }, g.d)); });
                    guests.forEach(g => send(g.conn, { t: 'all', ps: all.filter(s => s.id !== g.id) }));
                }
            }
        }
        Object.values(cars).forEach(c => {
            const d = c.d, to = new THREE.Vector3(d.x, d.y, d.z), rot = new THREE.Quaternion(d.qx, d.qy, d.qz, d.qw);
            if (c.fresh) { c.mesh.position.copy(to); c.mesh.quaternion.copy(rot); c.fresh = false; }
            else { c.mesh.position.lerp(to, 0.5); c.mesh.quaternion.slerp(rot, 0.5); }
            // (the name tag faces the camera whatever way the car points)
            c.mesh.userData.tag.quaternion.copy(c.mesh.quaternion).invert().multiply(game.camera.quaternion);
        });
    };

    M.init = function (sc) {
        scene = sc;
        $('mp-share').onclick = () => { M.hideMenu(); M.host(); };
        $('mp-join-open').onclick = () => { const id = openRoom(); M.hideMenu(); if (id) M.join(id); };
        $('mp-back').onclick = M.hideMenu;
        $('mp-invite-yes').onclick = (e) => { e.target.blur(); if (invite) M.join(invite); };
        $('mp-invite-no').onclick = (e) => { e.target.blur(); if (invite) lobby.declined[invite] = true; hideInvite(); };
        $('mp-leave').onclick = (e) => { e.target.blur(); leaveRoom(); };
        // join the lobby a moment after the game is up, and leave it cleanly with the page (so
        // the lobby id and any room here are free again at once)
        setTimeout(joinLobby, 1500);
        setInterval(beat, 4000);
        window.addEventListener('pagehide', () => {
            try { if (M.role === 'host') announce(false); if (lobby.hub) lobby.hub.destroy(); if (M.peer) M.peer.destroy(); } catch (e) { /* (closing anyway) */ }
        });
    };
    return M;
})();
