// tokyo-driver1 v2 — solids: the small standing things the car can hit (tree trunks, lamp posts,
// traffic lights, sign posts, cones). There are tens of thousands of them and a physics body
// for each would cost far too much, so a thing only says where it stands:
//
//   Solids.add(owner, x, y, z, half, height, opts)   a post standing on (x, y, z), `half` wide
//                                                    each way and `height` tall; opts.deep makes
//                                                    it a slab (half its depth), opts.yaw turns it
//   Solids.drop(owner)                               everything that owner put up is gone
//
// and Solids.update, before every physics step, moves a handful of real bodies (the pool) onto
// the spots nearest the car. The spots are kept in a grid of 40 m cells, so finding the near
// ones is a look into nine cells.
window.Solids = (function () {
    const S = { spots: 0 };
    const CELL = 40, REACH = 38, POOL = 28;
    let world = null, frame = 0;
    const cells = new Map();            // 'cx,cz' -> the spots in that cell
    const owned = new Map();            // owner -> the cells it has spots in
    const pool = [];

    const keyOf = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);

    S.add = function (owner, x, y, z, half, height, opts) {
        const key = keyOf(x, z);
        const spot = { owner, x, y, z, half, deep: opts && opts.deep || half, height, yaw: opts && opts.yaw || 0, live: opts && opts.live, body: null, seen: 0 };
        let list = cells.get(key); if (!list) cells.set(key, list = []);
        list.push(spot);
        let keys = owned.get(owner); if (!keys) owned.set(owner, keys = new Set());
        keys.add(key);
        S.spots++;
    };
    S.drop = function (owner) {
        const keys = owned.get(owner); if (!keys) return;
        keys.forEach(key => {
            const list = cells.get(key); if (!list) return;
            const kept = list.filter(s => { if (s.owner !== owner) return true; if (s.body) rest(s.body); S.spots--; return false; });
            if (kept.length) cells.set(key, kept); else cells.delete(key);
        });
        owned.delete(owner);
    };

    // a pool body with nothing to stand for waits far under the world
    function rest(body) {
        if (body.spot) body.spot.body = null;
        body.spot = null;
        body.position.set(0, -9000, 0); body.aabbNeedsUpdate = true;
    }
    // ...and takes the place and the size of the spot it is given
    function stand(body, spot) {
        const box = body.shapes[0];
        box.halfExtents.set(spot.half, spot.height / 2, spot.deep);
        box.updateConvexPolyhedronRepresentation(); box.updateBoundingSphereRadius();
        body.position.set(spot.x, spot.y + spot.height / 2, spot.z);
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spot.yaw);
        body.updateBoundingRadius(); body.aabbNeedsUpdate = true;
        body.spot = spot; spot.body = body;
    }

    S.init = function (w) {
        world = w;
        for (let i = 0; i < POOL; i++) {
            const body = new CANNON.Body({ mass: 0, material: world.groundMaterial });
            body.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 1, 0.2)));
            body.spot = null; body.position.set(0, -9000, 0);
            world.addBody(body); pool.push(body);
        }
    };

    const near = [], dead = [];
    S.update = function (pos) {
        if (!world) return;
        frame++;
        near.length = 0; dead.length = 0;
        const cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            const list = cells.get((cx + i) + ',' + (cz + j)); if (!list) continue;
            for (let k = 0; k < list.length; k++) {
                const s = list[k];
                if (s.live && !s.live()) { dead.push(s.owner); continue; }        // (a sign that was taken down without a word)
                const dx = s.x - pos.x, dz = s.z - pos.z;
                s.far = dx * dx + dz * dz;
                // (not the ones far below a viaduct or far above the car: it cannot reach them)
                if (s.far < REACH * REACH && pos.y > s.y - 4 && pos.y < s.y + s.height + 6) near.push(s);
            }
        }
        dead.forEach(S.drop);
        if (near.length > POOL) { near.sort((a, b) => a.far - b.far); near.length = POOL; }
        near.forEach(s => { s.seen = frame; });
        const free = pool.filter(b => { if (b.spot && b.spot.seen !== frame) rest(b); return !b.spot; });
        near.forEach(s => { if (!s.body && free.length) stand(free.pop(), s); });
    };

    return S;
})();
