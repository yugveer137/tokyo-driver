// tokyo-driver1 v2 — batching: many small still parts drawn as one mesh.
// What holds the game back is the number of separate meshes, not the number of triangles: a
// city was 3,000 of them (every house 17, every traffic light 6) and each one is walked, tested
// against the view and drawn on its own, every frame. So the builders go on making their small
// parts as before, and when a thing is finished Batch.merge joins all the parts that share a
// material into one mesh.
//
//   Batch.merge(root)   joins the plain meshes under `root` (a Group), in root's own space, so
//                       root can still be moved or removed as a whole.
//
// A part is left alone if it is hidden, has `userData.keep` (it moves on its own: a train's
// wheels), carries several materials, or is not a plain mesh. A material made with
// `vertexColors: true` is shared by parts of different colours: each part says its own colour in
// `userData.color` (a hex number) and the merge writes it into the vertices.
window.Batch = (function () {
    const B = {};
    const v = new THREE.Vector3(), normalMatrix = new THREE.Matrix3(), white = new THREE.Color(0xffffff), tint = new THREE.Color();

    const plain = (o) => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material)
        && o.renderOrder === 0 && o.children.length === 0 && o.geometry && o.geometry.attributes.position;

    // every part under `o` that can be merged, each with its matrix in root's space
    function collect(o, parentMatrix, parts) {
        if (!o.visible || o.userData.keep) return;
        o.updateMatrix();
        const matrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, o.matrix);
        if (plain(o)) { parts.push({ mesh: o, matrix }); return; }
        o.children.forEach(c => collect(c, matrix, parts));
    }

    // one geometry out of the parts of one material
    function join(parts, colored) {
        let verts = 0, indices = 0;
        parts.forEach(p => {
            const g = p.mesh.geometry;
            if (!g.attributes.normal) g.computeVertexNormals();
            verts += g.attributes.position.count;
            indices += g.index ? g.index.count : g.attributes.position.count;
        });
        const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
        const col = colored ? new Float32Array(verts * 3) : null;
        const idx = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
        let at = 0, iAt = 0;
        parts.forEach(p => {
            const g = p.mesh.geometry, gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv, n = gp.count;
            normalMatrix.getNormalMatrix(p.matrix);
            if (col) { if (p.mesh.userData.color === undefined) tint.copy(white); else tint.set(p.mesh.userData.color); }
            for (let i = 0; i < n; i++) {
                v.fromBufferAttribute(gp, i).applyMatrix4(p.matrix); pos.set([v.x, v.y, v.z], (at + i) * 3);
                v.fromBufferAttribute(gn, i).applyMatrix3(normalMatrix).normalize(); nor.set([v.x, v.y, v.z], (at + i) * 3);
                if (gu) { uv[(at + i) * 2] = gu.getX(i); uv[(at + i) * 2 + 1] = gu.getY(i); }
                if (col) col.set([tint.r, tint.g, tint.b], (at + i) * 3);
            }
            // a mirrored part (negative scale) has its triangles wound the other way: turn them back
            const mirrored = p.matrix.determinant() < 0, count = g.index ? g.index.count : n;
            for (let k = 0; k < count; k += 3) {
                const a = g.index ? g.index.getX(k) : k, b = g.index ? g.index.getX(k + 1) : k + 1, c = g.index ? g.index.getX(k + 2) : k + 2;
                idx[iAt++] = at + a; idx[iAt++] = at + (mirrored ? c : b); idx[iAt++] = at + (mirrored ? b : c);
            }
            at += n;
        });
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
        out.setIndex(new THREE.BufferAttribute(idx, 1));
        return out;
    }

    // an emptied group is still walked every frame: take it out, and its parent if that empties too
    function prune(o, root) {
        while (o && o !== root && o.children.length === 0 && !o.isMesh) { const up = o.parent; if (up) up.remove(o); o = up; }
    }

    B.merge = function (root) {
        const parts = [];
        root.children.slice().forEach(c => collect(c, new THREE.Matrix4(), parts));
        // sort the parts by material (and by whether they cast a shadow)
        const buckets = {};
        parts.forEach(p => {
            const m = p.mesh, key = m.material.uuid + (m.castShadow ? 's' : '-') + (m.receiveShadow ? 'r' : '-');
            (buckets[key] = buckets[key] || []).push(p);
        });
        Object.values(buckets).forEach(list => {
            const first = list[0].mesh, colored = !!first.material.vertexColors;
            if (list.length < 2 && !colored) return;                      // nothing to join it with
            const merged = new THREE.Mesh(join(list, colored), first.material);
            merged.castShadow = first.castShadow; merged.receiveShadow = first.receiveShadow;
            list.forEach(p => { const up = p.mesh.parent; up.remove(p.mesh); p.mesh.geometry.dispose(); prune(up, root); });
            root.add(merged);
        });
        return root;
    };

    return B;
})();
