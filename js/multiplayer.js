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
            // (tools/fakepeer.js stands in for PeerJS in tests between tabs: see that file)
            let fake = false; try { fake = !!localStorage.getItem('td_fakepeer'); } catch (e) { /* (no storage: the real thing) */ }
            s.src = fake ? 'tools/fakepeer.js' : 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
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
    // The name a player picks in the Multiplayer menu: kept on this device, shown over their car
    // in other players' games, in the "opened a room" banner and when they join or leave.
    // Letters, digits, spaces and . ' _ - only, 16 at most.
    const cleanName = (v) => String(v || '').replace(/[^\p{L}\p{N} .'_-]/gu, '').trim().slice(0, 16);
    function myName() { try { return cleanName(localStorage.getItem('td_mp_name')); } catch (e) { return ''; } }
    function setName(v) { try { localStorage.setItem('td_mp_name', cleanName(v)); } catch (e) { /* (private window: the name lasts until the page closes) */ } }
    const send = (conn, msg) => { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* (a closing connection) */ } };

    // How long to wait before trying the PeerJS service again: about 2 seconds, doubling every
    // time up to a minute, and back to 2 once something works. Trying again at once, as this
    // used to, is thousands of connections an hour whenever the service is down or refusing us,
    // from every open tab, and the service answers that by blocking the whole network for half
    // an hour (HTTP 429), which takes multiplayer away from everyone in the house.
    let wait = 2000, calm = 0;
    function backoff() { clearTimeout(calm); const w = wait * (0.75 + Math.random() * 0.5); wait = Math.min(wait * 2, 60000); return w; }
    // (only a connection that has held for half a minute counts as working: one that opens and
    // drops straight away, over and over, must keep slowing down too)
    function settled() { clearTimeout(calm); calm = setTimeout(() => { wait = 2000; }, 30000); }
    function reconnectLater(peer) { setTimeout(() => { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch (e) { /* (destroyed meanwhile) */ } }, backoff()); }

    // ---------- this player's own peer (one for the lobby, hosting and joining) ----------
    function getPeer() {
        if (M.peerReady) return M.peerReady;
        M.peerReady = loadPeerJs().then(() => new Promise((res, rej) => {
            const p = new Peer();
            p.on('open', () => { M.peer = p; settled(); res(p); });
            p.on('connection', onGuest);
            p.on('disconnected', () => reconnectLater(p));
            p.on('error', (err) => {
                if (!M.peer) { M.peerReady = null; rej(new Error(SERVICE_DOWN)); return; }
                if (err.type !== 'peer-unavailable') return;
                // (the message names the peer that is not there)
                if (String(err.message).includes(LOBBY_ID)) { if (lobby.fail) lobby.fail(); }
                else if (joining) joinFailed('That room has closed.');
            });
        }));
        return M.peerReady;
    }

    // The peer for opening or joining a room: it has to be talking to the service right now. If
    // the service has dropped us since (it does when it is busy or blocking the network), try
    // once to get back before saying so, rather than "opening" a room nobody can be told about.
    const SERVICE_DOWN = 'The multiplayer service is not answering right now. Wait a minute and try again.';
    function connected() {
        return getPeer().then(p => {
            if (!p.disconnected) return p;
            return new Promise((res, rej) => {
                const giveUp = setTimeout(() => rej(new Error(SERVICE_DOWN)), 8000);
                p.on('open', function back() { clearTimeout(giveUp); if (p.off) p.off('open', back); res(p); });
                try { p.reconnect(); } catch (e) { clearTimeout(giveUp); rej(new Error(SERVICE_DOWN)); }
            });
        });
    }

    // ---------- the lobby ----------
    function retryLobby() { clearTimeout(lobby.retry); lobby.retry = setTimeout(joinLobby, backoff()); }
    function joinLobby() {
        if (lobby.hub || lobby.conn || lobby.trying) return;
        getPeer().then(p => {
            const c = p.connect(LOBBY_ID, { reliable: true, metadata: { kind: 'lobby' } });
            lobby.trying = c;
            // nobody is the lobby (or its owner has gone quiet): try to be it
            lobby.fail = () => { if (lobby.trying !== c) return; clearTimeout(lobby.timer); lobby.trying = null; lobby.fail = null; try { c.close(); } catch (e) { /* (never opened) */ } claimLobby(); };
            lobby.timer = setTimeout(lobby.fail, 7000);
            c.on('open', () => {
                clearTimeout(lobby.timer); lobby.trying = null; lobby.fail = null; lobby.conn = c; lobby.heard = Date.now(); settled();
                if (M.role === 'host') send(c, { t: 'room', id: M.peer.id, by: myName() });
            });
            c.on('data', (d) => {
                lobby.heard = Date.now();
                if (!d) return;
                if (d.t === 'room') roomOpened(d.id, d.by);
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
            lobby.hub = h; lobby.members = []; settled();
            if (M.role === 'host') lobby.rooms[M.peer.id] = { id: M.peer.id, owner: null, by: myName() };
        });
        h.on('connection', (c) => {
            c.on('open', () => { c.heard = Date.now(); lobby.members.push(c); Object.values(lobby.rooms).forEach(r => send(c, { t: 'room', id: r.id, by: r.by })); });
            c.on('data', (d) => {
                c.heard = Date.now();
                if (!d) return;
                if (d.t === 'room') { const by = cleanName(d.by); lobby.rooms[d.id] = { id: d.id, owner: c, by }; tellMembers({ t: 'room', id: d.id, by }, c); roomOpened(d.id, by); }
                else if (d.t === 'room-close') { tellMembers({ t: 'room-close', id: d.id }, c); roomClosed(d.id); }
            });
            c.on('close', () => memberGone(c));
        });
        h.on('disconnected', () => { if (lobby.hub === h) reconnectLater(h); });
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
        const msg = { t: open ? 'room' : 'room-close', id, by: myName() };
        if (lobby.hub) { if (open) lobby.rooms[id] = { id, owner: null, by: msg.by }; else delete lobby.rooms[id]; tellMembers(msg); }
        else send(lobby.conn, msg);
    }
    function roomOpened(id, by) {
        if (!lobby.rooms[id]) lobby.rooms[id] = { id, owner: null, by: cleanName(by) };
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
        const by = lobby.rooms[id] && lobby.rooms[id].by;
        $('mp-invite-text').textContent = (by || 'Somebody') + ' opened a multiplayer room. Want to play together?';
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
        if (!M.role) { $('mp-chat').style.display = 'none'; $('mp-give').style.display = 'none'; $('mp-pop').style.display = 'none'; }
        refreshPeople();
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
            ctx.fillStyle = '#00e5ff'; ctx.font = 'bold ' + Math.min(30, Math.floor(380 / Math.max(label.length, 1))) + 'px monospace'; ctx.textAlign = 'center'; ctx.fillText(label, W / 2, 42);   // (a long name gets smaller letters)
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
        const carId = d.car || 'starter', label = labelOf(d);
        if (!c || c.mesh.userData.carId !== carId || c.label !== label) {       // (a new car, or they changed their name)
            const fresh = !c;
            if (c) scene.remove(c.mesh);
            const was = c && { p: c.mesh.position.clone(), q: c.mesh.quaternion.clone(), at: c.at, speed: c.speed };
            c = cars[id] = { mesh: makePeerCar(carId, label), label, d, fresh };
            if (was) { c.mesh.position.copy(was.p); c.mesh.quaternion.copy(was.q); c.at = was.at; c.speed = was.speed; }   // (the new car stands where the old one did)
        }
        // (their speed, from how far they moved between the last two reports: front lock uses it)
        const now = performance.now();
        if (c.at && now - c.at > 20) c.speed = (c.speed || 0) * 0.7 + 0.3 * Math.hypot(d.x - c.d.x, d.z - c.d.z) / ((now - c.at) / 1000);   // (smoothed: reports arrive unevenly)
        c.at = now;
        c.d = d;
    }
    // where the other players are, for the driving aids
    M.others = () => Object.values(cars).map(c => ({ x: c.d.x, z: c.d.z, speed: c.speed || 0 }));
    // what to call a player: the name they picked, else HOST or PLAYER 2, 3...
    const labelOf = (d) => cleanName(d.name) || (d.n === 1 ? 'HOST' : 'PLAYER ' + d.n);
    function removeCar(id) { if (cars[id]) { scene.remove(cars[id].mesh); delete cars[id]; } }
    function myState() {
        const p = Car.body.position, q = Car.body.quaternion;
        return { t: 'p', x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, car: Car.data.id, name: myName() };
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
        connected().then(p => {
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
        const g = { conn, id: conn.peer, n: 0, d: null, heard: Date.now(), name: cleanName(conn.metadata && conn.metadata.name) };
        conn.on('open', () => {
            if (M.role !== 'host' || guests.length + 1 >= MAX_PLAYERS) { send(conn, { t: 'full' }); setTimeout(() => { try { conn.close(); } catch (e) { /* (gone already) */ } }, 500); return; }
            g.n = nextN++; guests.push(g);
            $('mp-waiting').style.display = 'none';
            const p = Car.body.position;
            send(conn, { t: 'hi', n: g.n, x: p.x, y: p.y, z: p.z, yaw: Car.yaw(), host: myName() });
            status((g.name || 'Player ' + g.n) + ' joined!', GREEN, 4000);
            refreshChip();
        });
        conn.on('data', (d) => {
            g.heard = Date.now();
            if (!d || !g.n) return;
            if (d.t === 'p') { d.n = g.n; g.d = d; placeCar(g.id, d); }
            else if (d.t === 'msg' || d.t === 'coins') passOn(g, d);
        });
        conn.on('close', () => guestGone(g));
    }
    function guestGone(g) {
        if (!guests.includes(g)) return;
        guests = guests.filter(x => x !== g); removeCar(g.id);
        try { g.conn.close(); } catch (e) { /* (gone already) */ }
        status((g.name || 'Player ' + g.n) + ' left.', RED, 4000);
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
        connected().then(p => {
            const c = p.connect(roomId, { reliable: true, metadata: { kind: 'room', name: myName() } });
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
        if (d.t === 'hi') { myN = d.n; if (cleanName(d.host)) status('You are in ' + cleanName(d.host) + "'s room.", GREEN, 4000); goNear(d); return; }
        if (d.t === 'msg' || d.t === 'coins') { receive(d); return; }
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

    // ---------- messages and coins between players ----------
    // Both travel like the cars do, through the host: a guest hands the host a note for someone
    // ('all', 'host' or a guest's id), the host stamps who it is from and passes it on, or
    // keeps it if it is the host's own. A message is { t: 'msg', to, text }, a gift of coins
    // { t: 'coins', to, amount }: the giver takes the coins off their own count as they send,
    // the receiver adds them on arrival.
    const myLabel = () => myName() || (M.role === 'host' ? 'HOST' : 'PLAYER ' + myN);
    const people = () => Object.keys(cars).map(id => ({ id, label: cars[id].label }));
    const labelFor = (id) => id === 'all' ? 'everyone' : (cars[id] ? cars[id].label : 'a player who left');
    function post(note) {
        if (M.role === 'guest') send(hostConn, note);
        else if (M.role === 'host') deliver(Object.assign({ from: 'host', name: myLabel() }, note));
    }
    // (host) a guest's note: checked, stamped with who sent it, and sent on
    function passOn(g, d) {
        const to = d.to === 'all' || d.to === 'host' || guests.some(x => x.id === d.to) ? d.to : null;
        if (!to || to === g.id) return;
        const note = { t: d.t, to, from: g.id, name: g.name || 'Player ' + g.n };
        if (d.t === 'msg') { note.text = String(d.text || '').trim().slice(0, 200); if (!note.text) return; }
        else { note.amount = Math.floor(Number(d.amount)); if (!(note.amount >= 1 && note.amount <= 1000000) || to === 'all') return; }
        deliver(note);
    }
    // (host) to the guests it is for, and to the host if it is for the host
    function deliver(note) {
        guests.forEach(g => { if (g.id !== note.from && (note.to === 'all' || note.to === g.id)) send(g.conn, note); });
        if (note.from !== 'host' && (note.to === 'all' || note.to === 'host')) receive(note);
    }
    // a note has arrived for this player
    let unread = 0;
    function receive(note) {
        const who = cleanName(note.name) || 'A player';
        if (note.t === 'coins') {
            const n = Math.floor(Number(note.amount)); if (!(n >= 1 && n <= 1000000)) return;
            Game.addCoins(n);
            log(who + ' gave you ' + n + ' coins', 'gift'); pop(who + ' gave you ' + n + ' coins!');
        } else {
            const text = String(note.text || '').slice(0, 200);
            log(who + (note.to === 'all' ? ' (to everyone)' : '') + ': ' + text); pop(who + ': ' + text);
            if ($('mp-chat').style.display !== 'flex') { unread++; $('mp-chat-btn').textContent = 'CHAT (' + unread + ')'; }
        }
    }
    function sendMessage() {
        const box = $('mp-chat-text'), text = box.value.trim().slice(0, 200), to = $('mp-chat-to').value;
        if (!text || !M.role) return;
        if (to !== 'all' && !cars[to]) { log('That player has left.'); refreshPeople(); return; }
        post({ t: 'msg', to, text });
        log('You' + (to === 'all' ? ' (to everyone)' : ' to ' + labelFor(to)) + ': ' + text, 'mine');
        box.value = '';
    }
    function giveCoins() {
        const to = $('mp-give-to').value, n = Math.floor(Number($('mp-give-amount').value)), note = $('mp-give-note');
        if (!M.role || !cars[to]) { note.textContent = 'Pick a player who is in the room.'; refreshPeople(); return; }
        if (!(n >= 1)) { note.textContent = 'Type how many coins to give.'; return; }
        if (n > Game.state.coins) { note.textContent = 'You only have ' + Game.state.coins + ' coins.'; return; }
        Game.addCoins(-n);
        post({ t: 'coins', to, amount: n });
        note.textContent = 'You gave ' + n + ' coins to ' + labelFor(to) + '.';
        log('You gave ' + n + ' coins to ' + labelFor(to), 'gift');
        $('mp-give-amount').value = ''; $('mp-give-have').textContent = 'You have ' + Game.state.coins + ' coins.';
    }
    // the chat's list of what was said, newest at the bottom
    function log(text, kind) {
        const line = document.createElement('div'); line.textContent = text; if (kind) line.className = kind;
        const box = $('mp-chat-log'); box.appendChild(line);
        while (box.children.length > 60) box.removeChild(box.firstChild);
        box.scrollTop = box.scrollHeight;
    }
    // a note that just arrived, shown on screen for a few seconds (click it to open the chat)
    function pop(text) {
        const el = $('mp-pop'); el.textContent = text; el.style.display = 'block';
        clearTimeout(pop.timer); pop.timer = setTimeout(() => { el.style.display = 'none'; }, 7000);
    }
    // the "who to" pickers follow who is in the room
    let peopleShown = null;
    function refreshPeople() {
        const list = people(), now = list.map(p => p.id + ':' + p.label).join('|');
        if (now === peopleShown) return;                                    // (nobody came, went or changed name: leave an open picker alone)
        peopleShown = now;
        [['mp-chat-to', true], ['mp-give-to', false]].forEach(([id, withAll]) => {
            const sel = $(id), keep = sel.value;
            sel.innerHTML = '';
            if (withAll) sel.appendChild(new Option('Everyone', 'all'));
            list.forEach(p => sel.appendChild(new Option(p.label, p.id)));
            if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
        });
    }
    function openPanel(id) {
        ['mp-chat', 'mp-give'].forEach(p => { $(p).style.display = p === id && $(p).style.display !== 'flex' ? 'flex' : 'none'; });
        refreshPeople();
        if ($('mp-chat').style.display === 'flex') { unread = 0; $('mp-chat-btn').textContent = 'CHAT'; $('mp-chat-text').focus(); }
        if ($('mp-give').style.display === 'flex') { $('mp-give-have').textContent = 'You have ' + Game.state.coins + ' coins.'; $('mp-give-note').textContent = ''; }
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
        ' | rooms ' + Object.keys(lobby.rooms).length + ' | guests ' + guests.length + ' | cars ' + Object.keys(cars).length + ' [' + Object.values(cars).map(c => c.label).join(', ') + '] | invite ' + (invite ? 'shown' : 'no');

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

    M.showMenu = function () { $('menu-main').style.display = 'none'; $('mp-panel').style.display = 'block'; $('mp-name').value = myName(); refreshMenu(); };
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
        $('mp-name').oninput = (e) => setName(e.target.value);
        $('mp-invite-yes').onclick = (e) => { e.target.blur(); if (invite) M.join(invite); };
        $('mp-invite-no').onclick = (e) => { e.target.blur(); if (invite) lobby.declined[invite] = true; hideInvite(); };
        $('mp-leave').onclick = (e) => { e.target.blur(); leaveRoom(); };
        $('mp-chat-btn').onclick = (e) => { e.target.blur(); openPanel('mp-chat'); };
        $('mp-give-btn').onclick = (e) => { e.target.blur(); openPanel('mp-give'); };
        $('mp-chat-close').onclick = $('mp-give-close').onclick = () => { $('mp-chat').style.display = 'none'; $('mp-give').style.display = 'none'; document.activeElement.blur(); };
        $('mp-chat-send').onclick = sendMessage;
        $('mp-chat-text').onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };
        $('mp-give-send').onclick = giveCoins;
        $('mp-pop').onclick = () => { $('mp-pop').style.display = 'none'; if ($('mp-chat').style.display !== 'flex') openPanel('mp-chat'); };
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
