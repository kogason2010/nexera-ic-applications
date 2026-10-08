import { useEffect, useState } from 'react';
import { buildScene } from '../three/scenes';
import { atlasCallout, stage, stageLabelEls, subscribeStage } from '../utils/stage';
import { IONS } from '../data/apps';

/** Formula / retention labels that the WebGL stage positions over each ion. */
export function StageLabels() {
  const [v, setV] = useState(0);
  useEffect(() => subscribeStage(() => setV((x) => x + 1)), []);
  const scene = buildScene(stage.scene, stage.ion, stage.hydrated);
  const ion = IONS.find((i) => i.id === stage.ion);
  const labels = [
    ...scene.items.filter((i) => i.label).map((i) => ({ t: i.label!, s: i.sub, tag: false })),
    ...(scene.tags ?? []).map((t) => ({ t: t.text, s: t.sub, tag: true })),
  ];
  return (
    <div className="stage__labels" aria-hidden="true" data-v={v}>
      {Array.from({ length: 10 }, (_, i) => {
        const l = labels[i];
        return (
          <div key={i} className={`ion-label ${l?.tag ? 'ion-label--tag' : ''}`} ref={(el) => (stageLabelEls[i] = el)} style={{ opacity: 0 }}>
            {l && (
              <>
                <span className="ion-label__t">{l.t}</span>
                {l.s && <span className="ion-label__s">{l.s}</span>}
              </>
            )}
          </div>
        );
      })}
      <div className="ion-callout" ref={(el) => (atlasCallout.el = el)} style={{ opacity: 0, ['--c' as string]: ion?.color }}>
        <span className="ion-callout__dot" />
        <span className="ion-callout__line" />
        <span className="ion-callout__box">
          <span className="ion-callout__t">
            {ion?.name} · {ion?.formula}
          </span>
          <span className="ion-callout__s">Selected ion</span>
        </span>
      </div>
    </div>
  );
}
