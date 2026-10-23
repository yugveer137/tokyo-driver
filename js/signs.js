// tokyo-driver1 v2 — road signs drawn on canvases: freeway exit boards, gore signs,
// city-limit signs, street-name blades. A sign's face is its local +z; `facing` is the yaw
// of that face (use Signs.facingFrom(tangent) so drivers travelling along `tangent` see it).
window.Signs = (function () {
    const S = {};
    let scene;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6d6d6d, roughness: 0.6, metalness: 0.6 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 });

    S.init = function (sc) { scene = sc; };
    S.facingFrom = (tan) => Math.atan2(-tan.x, -tan.z);

    function board(w, h, draw) {
        const tex = Tex.textCanvas(Math.round(w * 64), Math.round(h * 64), draw);
        const front = new THREE.MeshBasicMaterial({ map: tex });
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), [backMat, backMat, backMat, backMat, front, backMat]));
        return g;
    }

    function post(g, x, y, height, r) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), postMat);
        p.scale.y = height; p.position.set(x, y, 0); g.add(p);
    }

    function place(g, pos, facing, lift) {
        g.position.copy(pos); g.position.y += lift;
        g.rotation.y = facing;
        scene.add(g);
        return g;
    }

    // Big green sign on two posts. lines: [{text, size}], exitTab e.g. "EXIT 12", sub e.g. "1/2 MILE"
    S.exitBoard = function (pos, facing, exitTab, lines, sub) {
        const w = 11, h = 4.2;
        const g = board(w, h, (ctx, W, H) => {
            ctx.fillStyle = '#0d6b2f'; ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, W - 20, H - 20);
            ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            let y = 70;
            lines.forEach(l => { const sz = l.size || 58; ctx.font = `bold ${sz}px Helvetica, Arial, sans-serif`; ctx.fillText(l.text, W / 2, y); y += sz + 18; });
            if (sub) { ctx.font = 'bold 48px Helvetica, Arial, sans-serif'; ctx.fillText(sub, W / 2, H - 50); }
        });
        if (exitTab) {
            const tab = board(3.4, 1.1, (ctx, W, H) => {
                ctx.fillStyle = '#0d6b2f'; ctx.fillRect(0, 0, W, H);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, W - 12, H - 12);
                ctx.fillStyle = '#fff'; ctx.font = 'bold 44px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(exitTab, W / 2, H / 2 + 2);
            });
            tab.position.set(w / 2 - 1.9, h / 2 + 0.6, 0);
            g.add(tab);
        }
        post(g, -w / 2 + 0.6, -h / 2 - 2.8, 5.6, 0.12);
        post(g, w / 2 - 0.6, -h / 2 - 2.8, 5.6, 0.12);
        return place(g, pos, facing, 5.6 + h / 2);
    };

    // Yellow gore sign with an arrow
    S.goreSign = function (pos, facing, text) {
        const g = board(2.2, 2.6, (ctx, W, H) => {
            ctx.fillStyle = '#f2c200'; ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, W - 12, H - 12);
            ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = 'bold 40px Helvetica, Arial, sans-serif'; ctx.fillText(text || 'EXIT', W / 2, H * 0.3);
            ctx.font = 'bold 90px Helvetica, Arial, sans-serif'; ctx.fillText('➚', W / 2, H * 0.7);
        });
        post(g, 0, -1.3 - 1.2, 2.4, 0.08);
        return place(g, pos, facing, 2.4 + 1.3);
    };

    // White rectangular sign: city limit / speed limit / plain text
    S.plain = function (pos, facing, title, body, w, h) {
        w = w || 4; h = h || 2.2;
        const g = board(w, h, (ctx, W, H) => {
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, W - 12, H - 12);
            ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = 'bold 34px Helvetica, Arial, sans-serif'; ctx.fillText(title, W / 2, body ? H * 0.32 : H / 2);
            if (body) { ctx.font = 'bold 60px Helvetica, Arial, sans-serif'; ctx.fillText(body, W / 2, H * 0.7); }
        });
        post(g, 0, -h / 2 - 1.1, 2.2, 0.08);
        return place(g, pos, facing, 2.2 + h / 2);
    };

    // Green street-name blade on a pole
    S.streetBlade = function (pos, facing, name) {
        const g = board(2.6, 0.5, (ctx, W, H) => {
            ctx.fillStyle = '#0d6b2f'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = 'bold 22px Helvetica, Arial, sans-serif'; ctx.fillText(name.toUpperCase(), W / 2, H / 2 + 1);
        });
        post(g, 0, -0.25 - 1.6, 3.2, 0.06);
        return place(g, pos, facing, 3.2 + 0.25);
    };

    return S;
})();
