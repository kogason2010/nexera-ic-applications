import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getQuality } from '../utils/quality';
import { rng, smoothstep } from '../utils/math';
import { atlasCallout, pointer, stage, stageLabelEls } from '../utils/stage';
import { AdaptiveDpr } from './shared/AdaptiveDpr';
import { StudioEnvironment } from './shared/StudioEnvironment';
import { ELEMENT_STYLE, carbonate, chloride, fluoride, nitrate, sodium, waterMolecule, type Molecule } from './molecular/molecules';
import { atomGeometry, bondGeometry, bondInstanceCount, buildField, writeBond } from './molecular/MoleculeBuilder';
import { buildScene, type Scene } from './scenes';

const POOL = 130;
const BOND_POOL = 110;
const DUR = 1.5;

function radius(m: Molecule) {
  let r = 0.5;
  for (const a of m.atoms) r = Math.max(r, Math.hypot(...a.p) + ELEMENT_STYLE[a.el].r);
  return r;
}

interface Flat {
  scene: Scene;
  atoms: { item: number; local: THREE.Vector3; r: number; color: THREE.Color; water: boolean }[];
  bonds: { a: number; b: number; order: 1 | 2; water: boolean }[];
  itemR: number[];
  coreR: number[];
  fit: number;
}

function flatten(scene: Scene, target: number): Flat {
  const atoms: Flat['atoms'] = [];
  const bonds: Flat['bonds'] = [];
  const itemR: number[] = [];
  const coreR: number[] = [];
  let R = 1;
  scene.items.forEach((it, i) => {
    const base = atoms.length;
    const r = radius(it.mol);
    const core = scene.focus ? (it.mol.core ?? it.mol.atoms.length) : it.mol.atoms.length;
    itemR.push(r);
    coreR.push(radius({ ...it.mol, atoms: it.mol.atoms.slice(0, core) }));
    R = Math.max(R, Math.hypot(...it.pos) + r * it.scale);
    it.mol.atoms.forEach((a, k) => {
      if (atoms.length >= POOL) return;
      const water = k >= core;
      const color = new THREE.Color(ELEMENT_STYLE[a.el].color);
      if (water) color.lerp(new THREE.Color('#2a3442'), 0.45);
      atoms.push({ item: i, local: new THREE.Vector3(...a.p).multiplyScalar(it.scale), r: ELEMENT_STYLE[a.el].r * it.scale, color, water });
    });
    for (const bd of it.mol.bonds) if (base + bd.b < POOL) bonds.push({ a: base + bd.a, b: base + bd.b, order: bd.order, water: bd.b >= core || bd.a >= core });
  });
  // the atlas uses a fixed magnification per view so ions keep their true relative size
  return { scene, atoms, bonds, itemR, coreR, fit: target / (scene.refRadius ?? R) };
}

/** The persistent stage: one pool of atoms that flies between each chapter's arrangement of ions. */
function Ions({ reducedMotion }: { reducedMotion: boolean }) {
  const { camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const meshes = useMemo(() => {
    const am = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.15, envMapIntensity: 1.1 });
    const bm = new THREE.MeshStandardMaterial({ color: '#8a96a8', roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0 });
    const atoms = new THREE.InstancedMesh(atomGeometry(), am, POOL);
    const bonds = new THREE.InstancedMesh(bondGeometry(), bm, BOND_POOL);
    // hydration water: same geometry, dimmed and translucent so it never competes with the ion
    const wm = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
    const water = new THREE.InstancedMesh(atomGeometry(), wm, POOL);
    const wbm = new THREE.MeshStandardMaterial({ color: '#56637a', roughness: 0.6, transparent: true, opacity: 0, depthWrite: false });
    const waterBonds = new THREE.InstancedMesh(bondGeometry(), wbm, BOND_POOL);
    // outline: inverted hulls around every atom and bond of the selected ion
    const om = new THREE.MeshBasicMaterial({ color: '#7fe3ff', side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false });
    const outline = new THREE.InstancedMesh(atomGeometry(), om, POOL);
    const outlineBonds = new THREE.InstancedMesh(bondGeometry(), om, BOND_POOL);
    for (const m of [atoms, bonds, water, waterBonds, outline, outlineBonds]) m.frustumCulled = false;
    const c = new THREE.Color('#8a96a8');
    for (let i = 0; i < POOL; i++) {
      atoms.setColorAt(i, c);
      water.setColorAt(i, c);
    }
    // soft halo behind the selected ion
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(110,210,255,0.55)');
    grd.addColorStop(0.45, 'rgba(110,170,255,0.18)');
    grd.addColorStop(1, 'rgba(110,170,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.renderOrder = -1;
    return { atoms, bonds, water, waterBonds, outline, outlineBonds, halo };
  }, []);
  const { water, waterBonds, outline, outlineBonds, halo } = meshes;
  const { atoms, bonds } = meshes;
  useEffect(
    () => () => {
      for (const m of [meshes.atoms, meshes.bonds, meshes.water, meshes.waterBonds, meshes.outline, meshes.outlineBonds]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      meshes.halo.material.map?.dispose();
      meshes.halo.material.dispose();
    },
    [meshes],
  );

  const st = useMemo(() => {
    const rand = rng(9);
    const scatter = Array.from({ length: POOL }, () => new THREE.Vector3((rand() - 0.5) * 30, (rand() - 0.5) * 18, -6 - rand() * 14));
    return {
      version: -1,
      t0: 0,
      flat: null as Flat | null,
      bondList: [] as Flat['bonds'],
      cur: scatter.map((v) => v.clone()),
      from: scatter.map((v) => v.clone()),
      curS: new Array(POOL).fill(0) as number[],
      fromS: new Array(POOL).fill(0) as number[],
      curC: Array.from({ length: POOL }, () => new THREE.Color('#8a96a8')),
      fromC: Array.from({ length: POOL }, () => new THREE.Color('#8a96a8')),
      delay: Array.from({ length: POOL }, () => rand() * 0.35),
      swirl: Array.from({ length: POOL }, () => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(3)),
      fit: 1,
      fitFrom: 1,
      spinT: 0,
      focusFrom: 0,
      focus: 0,
    };
  }, []);

  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const view = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const gpos = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const portrait = size.width / size.height < 0.9;
    // scene change → snapshot current state as the starting point of the morph
    if (st.version !== stage.version) {
      st.version = stage.version;
      st.t0 = now;
      for (let i = 0; i < POOL; i++) {
        st.from[i].copy(st.cur[i]);
        st.fromS[i] = st.curS[i];
        st.fromC[i].copy(st.curC[i]);
      }
      st.fitFrom = st.fit;
      st.focusFrom = st.focus;
      const sc = buildScene(stage.scene, stage.ion, stage.hydrated);
      const target = sc.focus ? (portrait ? 2.2 : 3.2) : (portrait ? 2.5 : 3.9) * (stage.scene === 'hero' ? 1.15 : 1);
      st.flat = flatten(sc, target);
    }
    const flat = st.flat;
    if (!flat) return;
    const el = now - st.t0;
    const dur = reducedMotion ? 0.001 : DUR;
    const gfit = THREE.MathUtils.lerp(st.fitFrom, flat.fit, smoothstep(0, dur, el));
    st.fit = gfit;
    if (!stage.paused && !reducedMotion) st.spinT += dt;
    st.focus = THREE.MathUtils.lerp(st.focusFrom, flat.scene.focus ? 1 : 0, smoothstep(dur * 0.5, dur + 0.3, el));

    for (let i = 0; i < POOL; i++) {
      const a = flat.atoms[i];
      const k = reducedMotion ? 1 : smoothstep(0, 1, (el - st.delay[i]) / dur);
      const ez = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      if (a) {
        const it = flat.scene.items[a.item];
        e.set(it.tilt, 0.6 + st.spinT * it.spin + a.item, 0);
        q.setFromEuler(e);
        tgt.copy(a.local).applyQuaternion(q).add(v.set(...it.pos));
        st.cur[i].lerpVectors(st.from[i], tgt, ez).addScaledVector(st.swirl[i], Math.sin(Math.PI * ez) * (reducedMotion ? 0 : 1));
        st.curS[i] = THREE.MathUtils.lerp(st.fromS[i], a.r, ez);
        st.curC[i].copy(st.fromC[i]).lerp(a.color, ez);
      } else {
        st.cur[i].copy(st.from[i]).addScaledVector(st.swirl[i], ez * 1.5);
        st.curS[i] = THREE.MathUtils.lerp(st.fromS[i], 0, ez);
      }
      const isWater = !!a?.water && ez > 0.5;
      const sz = Math.max(0.0001, st.curS[i]);
      q.identity();
      s.setScalar(isWater ? 0.0001 : sz);
      m4.compose(st.cur[i], q, s);
      atoms.setMatrixAt(i, m4);
      atoms.setColorAt(i, st.curC[i]);
      s.setScalar(isWater ? sz : 0.0001);
      m4.compose(st.cur[i], q, s);
      water.setMatrixAt(i, m4);
      water.setColorAt(i, st.curC[i]);
      s.setScalar(!isWater && a && flat.scene.focus ? sz + 0.07 / Math.max(0.2, gfit) : 0.0001);
      m4.compose(st.cur[i], q, s);
      outline.setMatrixAt(i, m4);
    }
    for (const m of [atoms, water, outline]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    (outline.material as THREE.MeshBasicMaterial).opacity = 0.75 * st.focus;

    // bonds fade out, swap to the new topology, then fade back in once atoms have settled
    const bm = bonds.material as THREE.MeshStandardMaterial;
    if (el < 0.25 && st.bondList !== flat.bonds) bm.opacity = Math.max(0, bm.opacity - dt * 6);
    else {
      st.bondList = flat.bonds;
      bm.opacity = reducedMotion ? 1 : smoothstep(dur * 0.85, dur + 0.45, el);
    }
    (waterBonds.material as THREE.MeshStandardMaterial).opacity = bm.opacity * 0.3;
    let bi = 0;
    let wi = 0;
    let oi = 0;
    for (const b of st.bondList) {
      if (b.water) {
        if (wi + b.order <= BOND_POOL) wi = writeBond(waterBonds, wi, st.cur[b.a], st.cur[b.b], b.order, 0.05, null, view);
        continue;
      }
      if (bi + b.order > BOND_POOL) break;
      bi = writeBond(bonds, bi, st.cur[b.a], st.cur[b.b], b.order, 0.07, null, view);
      if (flat.scene.focus) oi = writeBond(outlineBonds, oi, st.cur[b.a], st.cur[b.b], 1, 0.07 + 0.06 / Math.max(0.2, gfit), null, view);
    }
    bonds.count = bi;
    waterBonds.count = wi;
    outlineBonds.count = oi;
    for (const m of [bonds, waterBonds, outlineBonds]) m.instanceMatrix.needsUpdate = true;

    // halo behind the selected ion (atlas)
    const it0 = flat.scene.items[0];
    if (flat.scene.focus && it0) {
      halo.position.set(...it0.pos);
      halo.scale.setScalar((flat.coreR[0] * it0.scale + 1.2) * 2.6);
    }
    halo.material.opacity = 0.9 * st.focus;
    halo.visible = st.focus > 0.01;

    // placement: right half on wide screens, upper band on phones
    if (group.current) {
      const g = group.current;
      g.scale.setScalar(gfit);
      gpos.set(portrait ? 0 : 4.6, portrait ? 3.1 : 0, 0);
      g.position.lerp(gpos, 1 - Math.exp(-dt * 3));
      g.rotation.y += (pointer.x * 0.25 - g.rotation.y) * (1 - Math.exp(-dt * 2));
      g.rotation.x += (-pointer.y * 0.15 - g.rotation.x) * (1 - Math.exp(-dt * 2));
    }

    // labels (formula + retention) above each labelled ion, and group tags
    const labelled = flat.scene.items.map((it, i) => ({ it, i })).filter((x) => x.it.label);
    const lo = reducedMotion ? 1 : smoothstep(dur * 0.9, dur + 0.5, el);
    let li = 0;
    const g = group.current;
    g?.updateMatrixWorld();
    const place = (local: THREE.Vector3) => {
      const node = stageLabelEls[li++];
      if (!node || !g) return;
      v.copy(local).applyMatrix4(g.matrixWorld).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      node.style.opacity = lo.toFixed(3);
      node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    };
    for (const { it, i } of labelled) place(tgt.set(it.pos[0], it.pos[1] + flat.itemR[i] * it.scale + 0.35, it.pos[2]));
    for (const t of flat.scene.tags ?? []) place(tgt.set(...t.pos));
    for (; li < stageLabelEls.length; li++) if (stageLabelEls[li]) stageLabelEls[li]!.style.opacity = '0';

    // atlas callout: anchored at the upper-right edge of the selected ion, leader line outward
    const co = atlasCallout.el;
    if (co && g) {
      const on = flat.scene.focus ? st.focus : 0;
      co.style.opacity = on.toFixed(3);
      co.style.visibility = on < 0.01 ? 'hidden' : 'visible';
      if (on > 0.01) {
        const r = flat.coreR[0] * flat.scene.items[0].scale + 0.25;
        v.set(r * 0.72, r * 0.72, 0).applyMatrix4(g.matrixWorld).project(camera);
        const x = (v.x * 0.5 + 0.5) * size.width;
        const y = (-v.y * 0.5 + 0.5) * size.height;
        co.classList.toggle('is-left', x > size.width - 250);
        // keep the label clear of the nav: drop it below the anchor near the top edge
        co.classList.toggle('is-down', y < 128);
        co.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    }
  });

  return (
    <group ref={group}>
      <primitive object={halo} />
      <primitive object={atoms} />
      <primitive object={bonds} />
      <primitive object={outline} />
      <primitive object={outlineBonds} />
      <primitive object={water} />
      <primitive object={waterBonds} />
      <ElutionPath group={group} />
    </group>
  );
}

/** Subtle directional path through the Part A ions, in elution order (1 → 7). */
function ElutionPath({ group }: { group: React.RefObject<THREE.Group> }) {
  const { line, arrow } = useMemo(() => {
    const sc = buildScene('partA');
    const pts = sc.items.map((i) => new THREE.Vector3(...i.pos));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const g = new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(160));
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: '#7fd4ff', dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0 }));
    line.computeLineDistances();
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 16), new THREE.MeshBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0 }));
    const end = curve.getPointAt(0.97);
    const tan = curve.getTangentAt(0.97);
    arrow.position.copy(end);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    return { line, arrow };
  }, []);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      arrow.geometry.dispose();
      (arrow.material as THREE.Material).dispose();
    },
    [line, arrow],
  );
  const shown = useRef(0);
  useFrame((_, dt) => {
    const on = stage.scene === 'partA' ? 1 : 0;
    shown.current += (on - shown.current) * (1 - Math.exp(-dt * (on ? 1.2 : 6)));
    (line.material as THREE.LineDashedMaterial).opacity = 0.55 * shown.current;
    (arrow.material as THREE.MeshBasicMaterial).opacity = 0.7 * shown.current;
    line.visible = arrow.visible = shown.current > 0.01;
    void group;
  });
  return (
    <group>
      <primitive object={line} />
      <primitive object={arrow} />
    </group>
  );
}

/** Dim background population of small molecules: the sample matrix. */
function Field({ count }: { count: number }) {
  const group = useRef<THREE.Group>(null);
  const meshes = useMemo(() => {
    const ag = atomGeometry();
    const bg = bondGeometry();
    const am = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 });
    const bm = new THREE.MeshStandardMaterial({ color: '#566273', roughness: 0.6 });
    const rand = rng(31);
    const kinds = [nitrate(), carbonate(), chloride(), waterMolecule(), sodium(), fluoride()];
    const per: THREE.Matrix4[][] = kinds.map(() => []);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Vector3((rand() - 0.5) * 60, (rand() - 0.5) * 34, -8 - rand() * 30);
      const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
      const sc = new THREE.Vector3().setScalar(0.6 + rand() * 0.4);
      per[i % kinds.length].push(new THREE.Matrix4().compose(p, qq, sc));
    }
    const out = kinds.map((k, i) => buildField(k, per[i], ag, bg, am, bm));
    void bondInstanceCount;
    return { out, ag, bg, am, bm };
  }, [count]);
  useEffect(
    () => () => {
      meshes.ag.dispose();
      meshes.bg.dispose();
      meshes.am.dispose();
      meshes.bm.dispose();
      meshes.out.forEach((o) => {
        o.atoms.dispose();
        o.bonds.dispose();
      });
    },
    [meshes],
  );
  useFrame((state) => {
    if (group.current) group.current.rotation.y = state.clock.elapsedTime * 0.012;
  });
  return (
    <group ref={group}>
      {meshes.out.map((o, i) => (
        <group key={i}>
          <primitive object={o.atoms} />
          <primitive object={o.bonds} />
        </group>
      ))}
    </group>
  );
}

function Rig() {
  const { camera, size } = useThree();
  useFrame(() => {
    const portrait = size.width / size.height < 0.9;
    camera.position.set(pointer.x * 0.5, 0.3 + pointer.y * 0.3, portrait ? 21 : 18);
    camera.lookAt(0, 0, 0);
  });
  return <spotLight position={[6, 7, 10]} angle={0.5} penumbra={0.8} intensity={260} color="#eaf2ff" />;
}

export default function IonStage({ reducedMotion, onReady }: { reducedMotion: boolean; onReady?: () => void }) {
  const q = getQuality();
  return (
    <Canvas
      className="ion-stage"
      dpr={q.dpr}
      camera={{ fov: 35, near: 0.1, far: 90, position: [0, 0.3, 18] }}
      gl={{ antialias: q.tier !== 'low', alpha: true }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        requestAnimationFrame(() => onReady?.());
      }}
      aria-hidden="true"
    >
      <fog attach="fog" args={['#06080c', 16, 46]} />
      <StudioEnvironment intensity={0.35} />
      <ambientLight intensity={0.14} />
      <directionalLight position={[-6, 2, -4]} intensity={1.2} color="#8fb0ff" />
      <directionalLight position={[6, -3, 2]} intensity={0.35} color="#ffc59a" />
      <Rig />
      <Ions reducedMotion={reducedMotion} />
      <Field count={q.moleculeField} />
      <AdaptiveDpr min={q.dpr[0]} max={q.dpr[1]} />
    </Canvas>
  );
}
