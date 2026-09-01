/**
 * The character: a VRM model rendered with three-vrm.
 *
 * Drives four things every frame — idle motion so she is never a statue,
 * automatic blinking, mouth shapes taken from the actual speech waveform, and
 * an expression that follows the mood of the conversation.
 *
 * three.js is ~900 KB, so this module is only ever imported dynamically: the
 * chat and the games never pay for it.
 */

import { store } from './store.js';
import { loadModel } from './idb.js';
import * as tts from './tts.js';

let THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils;

async function loadLibs() {
  if (THREE) return;
  const mod = await import('./vendor/three-vrm.esm.js');
  ({ GLTFLoader, VRMLoaderPlugin, VRMUtils } = mod);
  THREE = mod.THREE;
}

/** Where a character's model should come from. */
export async function avatarSource(character) {
  const char = character || store.activeChar();
  if (char.source === 'url' && char.url) return { kind: 'url', value: char.url };
  if (char.source === 'file') {
    const blob = await loadModel(char.id);
    if (blob) return { kind: 'blob', value: blob };
  }
  return null;
}

export function hasAvatar(character) {
  const char = character || store.activeChar();
  return char.source === 'file' || (char.source === 'url' && Boolean(char.url));
}

/**
 * Mount the avatar into `canvasHost`. Returns a handle with `setMood`,
 * `resize` and `dispose`. Throws if the model cannot be loaded.
 */
export async function mountAvatar(canvasHost, { onProgress, character } = {}) {
  const char = character || store.activeChar();
  const source = await avatarSource(char);
  if (!source) throw new Error('No character model set. Add a .vrm under “You”.');

  onProgress?.('Loading 3D engine…');
  await loadLibs();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasHost.append(renderer.domElement);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);

  // Soft key light from the front-left plus fill, which is what keeps a toon
  // model from reading flat.
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(-0.7, 1.4, 1.6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6);
  fill.position.set(1.1, 0.5, -0.9);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));

  onProgress?.('Loading character…');

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  let objectUrl = null;
  const url = source.kind === 'blob'
    ? (objectUrl = URL.createObjectURL(source.value))
    : source.value;

  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('That file loaded, but it is not a VRM character model.');

  // Frustum culling fights with spring bones and skinned meshes that move
  // outside their original bounds.
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });

  // VRM 0.x models face away from the camera; 1.0 face towards it.
  VRMUtils.rotateVRM0(vrm);

  scene.add(vrm.scene);

  const humanoid = vrm.humanoid;
  const expr = vrm.expressionManager;
  const lookAt = vrm.lookAt;

  const bone = (name) => humanoid?.getNormalizedBoneNode(name) || null;
  const head = bone('head');
  const neck = bone('neck');
  const chest = bone('chest') || bone('upperChest') || bone('spine');

  // VRM rest pose is a T-pose, which reads as a scarecrow. Rotating the upper
  // arm about its local Z swings it in the coronal plane — but which sign goes
  // *down* flips between VRM 1.0 and 0.x, because rotateVRM0 turns the rig
  // 180°. Rather than guess, try both and keep whichever actually lowers the
  // hand. A Y rotation cannot change world height, so this reads true on both.
  function relaxArm(upperName, tipNames) {
    const upper = bone(upperName);
    if (!upper) return;
    const tip = tipNames.map(bone).find(Boolean) || upper;
    const restY = upper.rotation.z;

    const handHeight = (z) => {
      upper.rotation.z = z;
      // getWorldPosition refreshes ancestor matrices for us.
      return tip.getWorldPosition(new THREE.Vector3()).y;
    };

    const swing = 1.25;
    const down = handHeight(swing) < handHeight(-swing) ? swing : -swing;
    upper.rotation.z = Number.isFinite(down) ? down : restY;
  }

  relaxArm('leftUpperArm', ['leftHand', 'leftLowerArm']);
  relaxArm('rightUpperArm', ['rightHand', 'rightLowerArm']);

  /* ------------------------------------------------------------- framing */

  // Scale everything to the model's own proportions. The mesh bounding box is
  // the wrong ruler — wings, tails, props and floor-length hair inflate it, and
  // a model with wings would get framed as a distant full-body shot. The
  // skeleton is stable, so measure head-bone to floor instead.
  vrm.scene.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(vrm.scene);

  const worldY = (b) => (b ? b.getWorldPosition(new THREE.Vector3()).y : null);
  const headY = worldY(head) ?? box.min.y + (box.max.y - box.min.y) * 0.88;
  const footY = Math.min(
    worldY(bone('leftFoot')) ?? Infinity,
    worldY(bone('rightFoot')) ?? Infinity,
  );

  // Head bone to floor is ~0.86 of a humanoid's total height; scale back up so
  // `height` means roughly what a tape measure would say.
  const spanToFloor = Number.isFinite(footY) ? headY - footY : null;
  const height = Math.max(0.5, spanToFloor ? spanToFloor / 0.86 : box.max.y - box.min.y);

  // The head bone sits at the base of the skull, so aiming at it alone crops
  // the top of her head. Lift the target to roughly eye level.
  const faceY = headY + height * 0.06;

  // The controls sit over the bottom of the canvas. Framing her dead centre
  // would hide her mouth behind them — which is the one part that has to stay
  // visible — so reserve that strip and compose in what is left.
  const HUD_FRACTION = 0.22;

  function frame() {
    const zoom = Math.max(1, Math.min(3, (store.get().characters[char.id] || char).zoom || 2));
    // zoom 1 = face, 2 = head and shoulders, 3 = half body.
    const subjectH = height * (0.22 + (zoom - 1) * 0.29);

    // As the shot widens, drop the aim so the extra room goes to her body
    // rather than to empty space above her head.
    const subjectY = faceY - (subjectH - height * 0.22) * 0.34;

    // Render a taller slice than the subject needs, with the surplus entirely
    // below her, so she lands above the controls.
    const viewH = subjectH / (1 - HUD_FRACTION);
    const targetY = subjectY - (viewH - subjectH) / 2;

    const dist = (viewH / 2) / Math.tan((camera.fov * Math.PI) / 360);

    camera.position.set(0, targetY, dist);
    camera.lookAt(0, targetY, 0);
    if (lookAt) lookAt.target = camera;
  }
  frame();

  function resize() {
    const w = canvasHost.clientWidth || 1;
    const h = canvasHost.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frame();
  }
  resize();

  const ro = new ResizeObserver(resize);
  ro.observe(canvasHost);

  /* ----------------------------------------------------------- animation */

  const clock = new THREE.Clock();

  let blinkTimer = 1 + Math.random() * 3;
  let blinkValue = 0;

  let mouth = 0;             // smoothed speech level
  let viseme = 'aa';
  let visemeTimer = 0;

  let mood = 'neutral';      // neutral | happy | sad | surprised | relaxed | angry
  let moodValue = 0;

  // Small, slow head drift so she looks alive between turns.
  let driftX = 0, driftY = 0, driftTargetX = 0, driftTargetY = 0, driftTimer = 0;

  const MOODS = ['happy', 'sad', 'angry', 'relaxed', 'surprised'];
  const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

  // three-vrm remaps VRM 0.x presets to the 1.0 names (a -> aa, joy -> happy,
  // sorrow -> sad, fun -> relaxed), so the canonical names work on both. What
  // it does not remap is 0.x's "unknown" slot, which VRoid exports as a custom
  // expression — often literally "Surprised". Fall back to a case-insensitive
  // match so those still animate.
  const expressionNames = expr ? Object.keys(expr.expressionMap ?? {}) : [];
  const trackCache = new Map();

  function trackFor(name) {
    if (trackCache.has(name)) return trackCache.get(name);
    let found = null;
    if (expr?.getExpressionTrackName?.(name)) {
      found = name;
    } else {
      const lower = name.toLowerCase();
      found = expressionNames.find((n) => n.toLowerCase() === lower) ?? null;
    }
    trackCache.set(name, found);
    return found;
  }

  function setExpr(name, value) {
    const track = trackFor(name);
    if (track) expr.setValue(track, value);
  }

  let stopped = false;

  function tick() {
    if (stopped) return;
    requestAnimationFrame(tick);

    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    /* breathing + idle sway */
    if (chest) {
      chest.rotation.x = Math.sin(t * 1.1) * 0.022;
      chest.position.y = Math.sin(t * 1.1) * 0.004;
    }

    /* head drift */
    driftTimer -= dt;
    if (driftTimer <= 0) {
      driftTimer = 2 + Math.random() * 3;
      driftTargetX = (Math.random() - 0.5) * 0.16;
      driftTargetY = (Math.random() - 0.5) * 0.10;
    }
    driftX += (driftTargetX - driftX) * dt * 1.6;
    driftY += (driftTargetY - driftY) * dt * 1.6;
    if (head) {
      head.rotation.y = driftX + Math.sin(t * 0.7) * 0.02;
      head.rotation.x = driftY + Math.sin(t * 0.9) * 0.015;
    }
    if (neck) {
      neck.rotation.y = driftX * 0.4;
    }

    /* blinking */
    blinkTimer -= dt;
    if (blinkTimer <= 0) {
      blinkTimer = 1.6 + Math.random() * 4.2;
      blinkValue = 1;
    }
    if (blinkValue > 0) {
      // ~120 ms close-and-open.
      blinkValue = Math.max(0, blinkValue - dt * 8.5);
      setExpr('blink', Math.sin(Math.min(1, 1 - blinkValue) * Math.PI));
    } else {
      setExpr('blink', 0);
    }

    /* lip sync */
    const target = tts.level();
    // Attack fast, release slower — a mouth that snaps shut looks robotic.
    mouth += (target - mouth) * dt * (target > mouth ? 26 : 12);

    visemeTimer -= dt;
    if (visemeTimer <= 0 && mouth > 0.12) {
      visemeTimer = 0.07 + Math.random() * 0.08;
      viseme = VISEMES[Math.floor(Math.random() * VISEMES.length)];
    }
    for (const v of VISEMES) {
      setExpr(v, v === viseme ? Math.min(0.95, mouth * 1.1) : 0);
    }

    /* mood */
    moodValue += ((mood === 'neutral' ? 0 : 0.7) - moodValue) * dt * 2.2;
    for (const m of MOODS) {
      setExpr(m, m === mood ? moodValue : 0);
    }

    vrm.update(dt);
    renderer.render(scene, camera);
  }
  tick();

  return {
    /** neutral | happy | sad | surprised | relaxed | angry */
    setMood(next) { mood = MOODS.includes(next) ? next : 'neutral'; },
    refocus: frame,
    resize,
    dispose() {
      stopped = true;
      ro.disconnect();
      scene.remove(vrm.scene);
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * A crude read of the mood of a reply. Good enough to make her face move with
 * the conversation, and it costs nothing — no extra model call.
 */
export function moodOf(text) {
  const t = text.toLowerCase();
  if (/\b(sorry|afraid|unfortunately|sad|terrible|awful|worried)\b/.test(t)) return 'sad';
  if (/\b(wow|whoa|really\?|no way|amazing|incredible|surprising)\b/.test(t) || /!\s*$/.test(text)) return 'surprised';
  if (/\b(ha|haha|lol|funny|love|great|brilliant|nice|glad|delighted|excellent)\b/.test(t)) return 'happy';
  if (/\b(calm|relax|gently|of course|sure thing|no problem)\b/.test(t)) return 'relaxed';
  return 'neutral';
}
