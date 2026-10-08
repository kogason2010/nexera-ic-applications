import type { SceneId } from '../three/scenes';

/** Which arrangement the ion stage shows. Sections write it; the WebGL stage and labels read it. */
export const stage = { scene: 'hero' as SceneId, ion: 'SO4', hydrated: false, paused: false, version: 0, uiVersion: 0 };
type L = () => void;
const listeners = new Set<L>();
const emit = () => listeners.forEach((l) => l());

export function setStage(scene: SceneId, ion = stage.ion) {
  if (scene === stage.scene && ion === stage.ion) return;
  stage.scene = scene;
  stage.ion = ion;
  stage.version++;
  emit();
}

/** Atlas view: ion only (default) or with an illustrative hydration shell. */
export function setHydrated(on: boolean) {
  if (stage.hydrated === on) return;
  stage.hydrated = on;
  stage.version++;
  emit();
}

export function setPaused(on: boolean) {
  stage.paused = on;
  stage.uiVersion++;
  emit();
}

export function subscribeStage(l: L) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const pointer = { x: 0, y: 0 };
/** DOM nodes for the stage labels, positioned every frame by the WebGL stage. */
export const stageLabelEls: (HTMLElement | null)[] = [];
/** The atlas callout (selected-ion label with leader line). */
export const atlasCallout: { el: HTMLElement | null } = { el: null };
