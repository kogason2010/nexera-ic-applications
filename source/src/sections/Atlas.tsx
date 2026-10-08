import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SectionIndex } from '../components/SectionIndex';
import { IONS } from '../data/apps';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useReveal } from '../hooks/useReveal';
import { useStageScene } from '../hooks/useStageScene';
import { setHydrated, setPaused, setStage, stage, subscribeStage } from '../utils/stage';

const GROUPS = [
  { title: 'Part A · common anions', ids: ['F', 'Cl', 'NO2', 'Br', 'NO3', 'PO4', 'SO4'] },
  { title: 'Part B · disinfection by-products', ids: ['ClO2', 'BrO3', 'ClO3'] },
  { title: 'ASTM D6919-17 · cations', ids: ['Li', 'Na', 'NH4', 'K', 'Mg', 'Ca'] },
];
const ORDER = GROUPS.flatMap((g) => g.ids);

/** Pick any ion: the stage rebuilds it, outlined and labelled, with optional illustrative hydration. */
export function Atlas() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useReveal(ref);
  useStageScene(ref, 'atlas');
  const [, force] = useState(0);
  useEffect(() => subscribeStage(() => force((x) => x + 1)), []);
  useEffect(() => {
    if (reduced) setPaused(true);
  }, [reduced]);
  const chips = useRef<Record<string, HTMLButtonElement | null>>({});
  const sel = stage.ion;
  const ion = IONS.find((i) => i.id === sel) ?? IONS[6];
  const pick = (id: string) => setStage('atlas', id);
  const narrow = typeof window !== 'undefined' && window.innerWidth <= 900;

  const onKey = (e: KeyboardEvent) => {
    const i = ORDER.indexOf(sel);
    let n = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % ORDER.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + ORDER.length) % ORDER.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = ORDER.length - 1;
    else return;
    e.preventDefault();
    pick(ORDER[n]);
    chips.current[ORDER[n]]?.focus();
  };

  return (
    <section id="atlas" className="chapter atlas" ref={ref} aria-labelledby="atlas-title">
      <div className="container chapter__inner">
        <div className="chapter__col atlas__col">
          <SectionIndex num="05" label="Ion atlas" />
          <h2 id="atlas-title" className="h-md atlas__title">
            Meet the ions. <span className="grad-text">All sixteen.</span>
          </h2>

          {/* selected ion: always beside the model and the controls */}
          <div className="atlas__head" style={{ ['--c' as string]: ion.color }} aria-live="polite">
            <p className="mono atlas__kind">Selected ion · {ion.kind}</p>
            <p className="atlas__name display">
              {ion.name} <span className="atlas__formula">{ion.formula}</span>
            </p>
            <p className="atlas__meta">
              Charge {ion.charge} · {ion.shape}
            </p>
          </div>

          <div className="atlas__controls">
            <div className="atlas__seg" role="group" aria-label="Model view">
              <button type="button" aria-pressed={!stage.hydrated} className={!stage.hydrated ? 'is-on' : ''} onClick={() => setHydrated(false)}>
                Ion only
              </button>
              <button type="button" aria-pressed={stage.hydrated} className={stage.hydrated ? 'is-on' : ''} onClick={() => setHydrated(true)}>
                Show hydration
              </button>
            </div>
            <button type="button" className="atlas__pause" aria-pressed={stage.paused} onClick={() => setPaused(!stage.paused)}>
              {stage.paused ? '▶ Rotate' : <>❚❚ Pause<span className="atlas__pause-x"> rotation</span></>}
            </button>
          </div>
          <div className="atlas__scroll" {...(narrow ? { "data-lenis-prevent": "" } : {})}>
          <div className="atlas__picker" role="radiogroup" aria-label="Choose an ion" onKeyDown={onKey}>
            {GROUPS.map((g) => (
              <div key={g.title} className="atlas__group">
                <p className="mono atlas__gtitle" aria-hidden="true">
                  {g.title}
                </p>
                <div className="atlas__chips">
                  {g.ids.map((id) => {
                    const r = IONS.find((x) => x.id === id)!;
                    const on = sel === id;
                    return (
                      <button
                        key={id}
                        ref={(el) => (chips.current[id] = el)}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${r.name}, ${r.formula}`}
                        tabIndex={on ? 0 : -1}
                        className={`atlas__chip ${on ? 'is-on' : ''}`}
                        style={{ ['--c' as string]: r.color }}
                        onClick={() => pick(id)}
                      >
                        <span className="atlas__tick" aria-hidden="true">
                          {on ? '✓' : ''}
                        </span>
                        {r.formula}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <ul className="atlas__legend" aria-label="Legend">
            <li>
              <span className="atlas__key atlas__key--ion" aria-hidden="true" /> Selected ion: solid, outlined and labelled
            </li>
            {stage.hydrated && (
              <li>
                <span className="atlas__key atlas__key--water" aria-hidden="true" /> Water: dimmed, translucent. An illustrative
                first shell, not a fixed structure or exact water count
              </li>
            )}
            <li className="atlas__legend-note">Illustrative model from textbook bond lengths; atoms at ~0.4 × ionic radii.</li>
          </ul>

          <div className="atlas__panel" style={{ ['--c' as string]: ion.color }}>
            <table className="atlas__table">
              <caption className="mono">Where {ion.formula} appears · published data</caption>
              <thead>
                <tr className="mono">
                  <th scope="col">Method</th>
                  <th scope="col">Retention</th>
                  <th scope="col">MDL</th>
                </tr>
              </thead>
              <tbody>
                {ion.methods.map((m) => (
                  <tr key={m.method}>
                    <th scope="row">{m.method}</th>
                    <td>{m.tR}</td>
                    <td>{m.mdl ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="atlas__note">{ion.note}</p>
          </div>
          </div>
        </div>
      </div>
    </section>
  );
}
