// tokyo-driver1 v2 — a stand-in for PeerJS, for testing multiplayer between tabs of one
// browser without the public PeerJS service (a developer tool, not loaded by the game).
// The service limits how often a network may connect, and a test session can use that up, so:
//     localStorage.setItem('td_fakepeer', '1')    then reload every tab that takes part
// and multiplayer.js loads this file instead of PeerJS (remove the key to go back). It gives
// `window.Peer` the small part of the PeerJS interface the game uses, and carries everything
// over a BroadcastChannel, which reaches the other tabs of this browser and nothing else.
(function () {
    const CHANNEL = 'td-fakepeer';
    // a tiny event emitter, as PeerJS objects are
    function emitter(o) {
        const handlers = {};
        o.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return o; };
        o.emit = (name, arg) => (handlers[name] || []).slice().forEach(fn => fn(arg));
        return o;
    }

    function Peer(wantedId) {
        const peer = emitter(this);
        const channel = new BroadcastChannel(CHANNEL), conns = {};
        peer.id = null; peer.destroyed = false; peer.disconnected = false;
        const id = wantedId || 'p' + Math.random().toString(36).slice(2, 10);
        const say = (msg) => channel.postMessage(Object.assign({ from: id }, msg));

        function makeConn(cid, remote, metadata) {
            const c = emitter({ peer: remote, metadata, open: false });
            c.send = (data) => { if (c.open) say({ k: 'data', cid, to: remote, data }); };
            c.close = () => { if (!conns[cid]) return; delete conns[cid]; const was = c.open; c.open = false; say({ k: 'close', cid, to: remote }); if (was) c.emit('close'); };
            conns[cid] = c;
            return c;
        }

        let taken = false;
        channel.onmessage = (e) => {
            const m = e.data;
            if (m.k === 'claim' && m.id === peer.id) say({ k: 'taken', id: m.id });           // someone wants the id we hold
            else if (m.k === 'taken' && m.id === id && !peer.id) taken = true;
            else if (m.to !== peer.id || peer.destroyed) return;
            else if (m.k === 'connect') {
                const c = makeConn(m.cid, m.from, m.metadata);
                peer.emit('connection', c);
                say({ k: 'accept', cid: m.cid, to: m.from });
                setTimeout(() => { c.open = true; c.emit('open'); }, 0);
            }
            else if (m.k === 'accept' && conns[m.cid]) { conns[m.cid].open = true; conns[m.cid].emit('open'); }
            else if (m.k === 'data' && conns[m.cid]) conns[m.cid].emit('data', m.data);
            else if (m.k === 'close' && conns[m.cid]) { const c = conns[m.cid]; delete conns[m.cid]; c.open = false; c.emit('close'); }
        };
        // ask whether anyone holds this id; silence for a moment means it is ours
        say({ k: 'claim', id });
        setTimeout(() => {
            if (peer.destroyed) return;
            if (taken) { peer.emit('error', { type: 'unavailable-id', message: 'ID "' + id + '" is taken' }); return; }
            peer.id = id; peer.emit('open', id);
        }, 200);

        peer.connect = function (remote, opts) {
            const cid = 'c' + Math.random().toString(36).slice(2, 10);
            const c = makeConn(cid, remote, opts && opts.metadata);
            say({ k: 'connect', cid, to: remote, metadata: opts && opts.metadata });
            // nobody answered: there is no such peer
            setTimeout(() => { if (!c.open && conns[cid]) { delete conns[cid]; peer.emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer ' + remote }); } }, 400);
            return c;
        };
        peer.reconnect = function () {};
        peer.destroy = function () {
            if (peer.destroyed) return;
            Object.keys(conns).forEach(cid => conns[cid].close());
            peer.destroyed = true; peer.id = null; channel.close();
        };
        window.addEventListener('pagehide', () => peer.destroy());
    }
    window.Peer = Peer;
})();
