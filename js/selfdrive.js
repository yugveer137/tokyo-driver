// tokyo-driver1 v2 — the route map and self-drive.
// MAP opens a map of the whole route (freeway, cities, train line); clicking sets a destination
// and the car drives itself there: it follows lanes, picks the road that gets closest to the
// destination at each junction, takes city exits when the destination is off the freeway,
// holds the speed limit and brakes for traffic. Any driving key cancels it.
window.SelfDrive = (function () {
    const S = { active: false, dest: null, road: null, dir: 1, laneIndex: 0, cross: null };
    let canvas, ctx;
    const W = 960, H = 420, PAD = 40;

    S.init = function () {
        canvas = document.getElementById('map-canvas');
        canvas.width = W; canvas.height = H;
        ctx = canvas.getContext('2d');
        canvas.addEventListener('click', onClick);
    };

    // ---------- map ----------
    // The route runs along the freeway; the map lays arc length left -> right and lateral
    // offset up -> down (exaggerated 6x so cities are visible beside the road).
    const LAT_SCALE = 6;
    function toMap(p) {
        const n = Road.nearest(World.freeway, p), f = n.frame;
        const dx = p.x - f.p.x, dz = p.z - f.p.z;
        const lat = dx * f.right.x + dz * f.right.z;
        return { x: PAD + n.s / World.freeway.length * (W - 2 * PAD), y: H / 2 + lat * LAT_SCALE * (H / 2 - PAD) / 900, s: n.s, lat };
    }
    function fromMap(mx, my) {
        const s = (mx - PAD) / (W - 2 * PAD) * World.freeway.length;
        const lat = (my - H / 2) / (LAT_SCALE * (H / 2 - PAD) / 900);
        return Road.at(World.freeway, Math.max(0, Math.min(World.freeway.length, s)), lat).p;
    }
    S.draw = function () {
        ctx.fillStyle = '#0f1522'; ctx.fillRect(0, 0, W, H);
        // train line and freeway
        ctx.strokeStyle = '#6b6257'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD, H / 2 + Train.LAT * LAT_SCALE * (H / 2 - PAD) / 900); ctx.lineTo(W - PAD, H / 2 + Train.LAT * LAT_SCALE * (H / 2 - PAD) / 900); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#cfd3d8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(PAD, H / 2); ctx.lineTo(W - PAD, H / 2); ctx.stroke();
        ctx.fillStyle = '#9ab'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('I-80', PAD, H / 2 - 10);
        // cities: box + name + exit number; collector + ramps as thin lines
        World.cities.forEach(c => {
            const m = toMap(new THREE.Vector3(c.center.x, 0, c.center.z));
            const w = c.D / World.freeway.length * (W - 2 * PAD), h = c.W * LAT_SCALE * (H / 2 - PAD) / 900;
            ctx.fillStyle = c.loaded ? 'rgba(124,247,168,0.25)' : 'rgba(90,110,140,0.35)';
            ctx.fillRect(m.x - w / 2, m.y - h / 2, w, h);
            ctx.strokeStyle = '#7cf7a8'; ctx.lineWidth = 1; ctx.strokeRect(m.x - w / 2, m.y - h / 2, w, h);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(c.name, m.x, m.y + h / 2 + 16);
            ctx.fillStyle = '#ffd21e'; ctx.font = '11px sans-serif'; ctx.fillText('Exit ' + c.exitNumber, m.x - w / 2 - 10, H / 2 + 16);
            ctx.textAlign = 'left';
        });
        // player
        if (Car.body) {
            const m = toMap(Car.body.position);
            ctx.fillStyle = '#7cf7a8'; ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, 6.3); ctx.fill();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
        }
        if (S.dest) {
            const m = toMap(S.dest);
            ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m.x - 7, m.y - 7); ctx.lineTo(m.x + 7, m.y + 7); ctx.moveTo(m.x + 7, m.y - 7); ctx.lineTo(m.x - 7, m.y + 7); ctx.stroke();
        }
        ctx.fillStyle = '#9ab'; ctx.font = '12px sans-serif'; ctx.fillText('Click anywhere to self-drive there. Cities are drawn wider than life so you can aim at them.', PAD, H - 12);
    };
    function onClick(e) {
        const r = canvas.getBoundingClientRect();
        const mx = (e.clientX - r.left) * W / r.width, my = (e.clientY - r.top) * H / r.height;
        S.goTo(fromMap(mx, my));
        UI.closeModals();
    }

    // ---------- self-drive ----------
    S.goTo = function (point) {
        // snap to the nearest built road
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, point); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        S.dest = best ? best.n.frame.p.clone() : point.clone();
        S.destRoad = best ? best.r : null;
        S.active = true; S.cross = null;
        const cur = nearestRoad(Car.body.position);
        S.road = cur.r; S.dir = headingDir(cur.r, cur.n);
        S.laneIndex = S.road.lanes.filter(l => l.dir === S.dir).length - 1;
        UI.toast('Self-drive on — ' + Math.round(S.dest.distanceTo(Car.body.position)) + ' m. Touch the wheel to cancel.', 3000);
    };
    S.cancel = function (quiet) {
        if (!S.active) return;
        S.active = false; Car.assistSteer = null; Car.cruise = null; Car.autoBrake = false;
        if (!quiet) UI.toast('Self-drive off');
    };
    function nearestRoad(pos) {
        let best = null, bd = Infinity;
        Road.all.forEach(r => { if (!Object.keys(r.chunks).length) return; const n = Road.nearest(r, pos); if (n.dist < bd) { bd = n.dist; best = { r, n }; } });
        return best;
    }
    function headingDir(road, n) {
        const yaw = Car.yaw(), fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        return fwd.dot(n.frame.tan) >= 0 || !road.typeDef.twoWay ? 1 : -1;
    }
    function laneOf(road, dir, idx) { const ls = road.lanes.filter(l => l.dir === dir); return ls[Math.min(idx, ls.length - 1)] || road.lanes[0]; }
    // at the end of the road: choose the connected road whose far end is closest to the destination
    function chooseNext() {
        const r = S.road, atEnd = S.dir === 1;
        const endP = Road.at(r, atEnd ? r.length : 0, 0).p;
        const opts = [];
        Road.all.forEach(o => {
            if (o === r || !Object.keys(o.chunks).length) return;
            const ps = Road.at(o, 0, 0).p, pe = Road.at(o, o.length, 0).p;
            if (ps.distanceTo(endP) < 36) opts.push({ road: o, dir: 1, far: pe });
            if (pe.distanceTo(endP) < 36 && o.typeDef.twoWay) opts.push({ road: o, dir: -1, far: ps });
        });
        if (!opts.length) return null;
        opts.sort((a, b) => a.far.distanceTo(S.dest) - b.far.distanceTo(S.dest));
        return opts[0];
    }
    S.update = function (dt) {
        if (!S.active || !Car.body) return;
        if (Car.keys.fwd || Car.keys.back || Car.keys.left || Car.keys.right) { S.cancel(); return; }
        const pos = Car.body.position;
        if (pos.distanceTo(S.dest) < 14) { S.cancel(true); Car.cruise = null; UI.toast('You have arrived.', 2500); return; }
        // re-snap to whatever road we're actually on (ramps, lane changes)
        // (only once we've actually left the current road's corridor, so a turn in progress sticks)
        const cur = nearestRoad(pos);
        if (cur && cur.r !== S.road && cur.n.dist < cur.r.width * 0.6 && Road.nearest(S.road, pos).dist > S.road.width * 0.7) { S.road = cur.r; S.dir = headingDir(cur.r, cur.n); S.laneIndex = Math.min(S.laneIndex, S.road.lanes.filter(l => l.dir === S.dir).length - 1); }
        const n = Road.nearest(S.road, pos);
        // take a city exit when the destination is not on the freeway and the exit leads toward it
        if (S.road === World.freeway && S.destRoad !== World.freeway) {
            const link = Traffic.links.find(l => l.from === World.freeway && l.to.isExit && l.sFrom > n.s && l.sFrom < n.s + 400 && Object.keys(l.to.chunks).length);
            if (link) {
                const exitEnd = Road.at(link.to, link.to.length, 0).p;
                if (exitEnd.distanceTo(S.dest) < pos.distanceTo(S.dest)) { S.laneIndex = World.freeway.typeDef.lanes - 1; if (n.s > link.sFrom - 60) { S.road = link.to; S.dir = 1; S.laneIndex = 0; } }
            }
        }
        const toEnd = S.dir === 1 ? S.road.length - n.s : n.s;
        if (toEnd < 10 && S.road !== World.freeway) {
            const nx = chooseNext();
            if (nx) { S.road = nx.road; S.dir = nx.dir; S.laneIndex = Math.min(S.laneIndex, S.road.lanes.filter(l => l.dir === S.dir).length - 1); }
        }
        // side roads joining mid-way (city stubs off the collector): turn onto one if its far
        // end gets us closer to the destination than staying on this road would
        S.scan = (S.scan || 0) + 1;
        if (S.road !== World.freeway && S.scan % 10 === 0) {
            const ourFar = Road.at(S.road, S.dir === 1 ? S.road.length : 0, 0).p.distanceTo(S.dest);
            let best = null;
            Road.all.forEach(o => {
                if (o === S.road || o.type === 'ramp' || !Object.keys(o.chunks).length) return;
                const ps = Road.at(o, 0, 0).p, pe = Road.at(o, o.length, 0).p;
                const cand = [];
                if (ps.distanceTo(pos) < 16) cand.push({ road: o, dir: 1, far: pe, s: 0 });
                if (pe.distanceTo(pos) < 16 && o.typeDef.twoWay) cand.push({ road: o, dir: -1, far: ps, s: o.length });
                cand.forEach(c => { const d = c.far.distanceTo(S.dest); if (d < ourFar - 20 && d < pos.distanceTo(S.dest) && (!best || d < best.d)) best = Object.assign(c, { d }); });
            });
            if (best) { S.road = best.road; S.dir = best.dir; S.laneIndex = 0; }
        }
        // steer toward a point ahead in our lane (further ahead at speed); firm gain like Debug.drive
        const lane = laneOf(S.road, S.dir, S.laneIndex);
        const ahead1 = Math.max(0, Math.min(S.road.length, n.s + S.dir * (10 + Car.mph * 0.12)));
        const look = Road.at(S.road, ahead1, lane.offset).p;
        const yaw = Car.yaw();
        let e = Math.atan2(look.x - pos.x, look.z - pos.z) - yaw;
        while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
        Car.assistSteer = Math.max(-0.5, Math.min(0.5, e * 3));
        // how much the road bends in the next 40 units -> slow down for curves
        const t1 = Road.at(S.road, ahead1, 0).tan, t2 = Road.at(S.road, Math.max(0, Math.min(S.road.length, n.s + S.dir * 40)), 0).tan;
        const bend = Math.acos(Math.max(-1, Math.min(1, t1.dot(t2))));
        const limit = S.road.type === 'freeway' ? 62 : S.road.type === 'ramp' ? 26 : 26;
        let target = limit;
        if (bend > 0.12) target = Math.min(target, 16);
        if (Math.abs(e) > 0.25) target = Math.min(target, 12);
        if (toEnd < 30 && S.road !== World.freeway) target = Math.min(target, 14);
        if (pos.distanceTo(S.dest) < 60) target = Math.min(target, 12);
        Car.cruise = target;
        // stuck watchdog: 4 s without moving -> give up rather than sit there
        S.stuck = Car.mph < 1 ? (S.stuck || 0) + dt : 0;
        if (S.stuck > 4) { S.cancel(true); UI.toast('Self-drive got stuck — you have the wheel', 3000); return; }
        // traffic ahead in our lane on this road
        let ahead = null;
        Traffic.cars.forEach(c => { if (c.road !== S.road || c.dir !== S.dir || c.lane.index !== lane.index) return; const gap = (c.s - n.s) * S.dir; if (gap > 0 && gap < 30 && (!ahead || gap < ahead)) ahead = gap; });
        Car.autoBrake = !!(ahead && ahead < 18 && Car.mph > 6);
        if (Car.mph > target + 6) Car.autoBrake = true;
    };
    return S;
})();
