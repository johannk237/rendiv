import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { CompositionContext, TimelineContext, type CompositionConfig } from '@rendiv/core';
import { TransitionSeries } from '../TransitionSeries';
import { linearTiming } from '../timings/linear-timing';
import { iris } from '../presentations/iris';
import { pushCut } from '../presentations/push-cut';
import { none } from '../presentations/none';
import type { TransitionPresentation } from '../types';

const compositionConfig: CompositionConfig = { id: 'test', width: 200, height: 100, fps: 30, durationInFrames: 100, defaultProps: {} };

/** Two scenes with a 10-frame transition starting at frame 20, rendered at `frame`. */
function renderAt<P>(frame: number, presentation: TransitionPresentation<P>) {
  return render(
    <CompositionContext.Provider value={compositionConfig}>
      <TimelineContext.Provider value={{ frame, playing: false, playingRef: { current: false } }}>
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={30}><i data-scene="a" /></TransitionSeries.Sequence>
          <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} presentation={presentation} />
          <TransitionSeries.Sequence durationInFrames={30}><i data-scene="b" /></TransitionSeries.Sequence>
        </TransitionSeries>
      </TimelineContext.Provider>
    </CompositionContext.Provider>,
  ).container;
}

/** The style of the closest element around a scene that sets `property`. */
function styleAround(container: HTMLElement, scene: string, property: string): string {
  let el = container.querySelector(`[data-scene="${scene}"]`)?.parentElement ?? null;
  while (el && !el.style.getPropertyValue(property)) el = el.parentElement;
  return el?.style.getPropertyValue(property) ?? '';
}

describe('component presentations', () => {
  it('iris: the arriving scene is clipped to a circle growing from the centre', () => {
    const container = renderAt(25, iris({ width: 200, height: 100 }));
    const radius = (Math.sqrt(200 ** 2 + 100 ** 2) / 2) * 0.5;
    expect(styleAround(container, 'b', 'clip-path')).toBe(`circle(${radius}px at 100px 50px)`);
    expect(styleAround(container, 'a', 'clip-path')).toBe('');
  });

  it('pushCut: the arriving scene is hidden before the cut, shown after it', () => {
    expect(styleAround(renderAt(22, pushCut()), 'b', 'opacity')).toBe('0');
    expect(styleAround(renderAt(28, pushCut()), 'b', 'opacity')).toBe('1');
    expect(styleAround(renderAt(22, pushCut()), 'a', 'transform')).toMatch(/^scale\(1\.0\d*\)$/);
  });

  it('pushCut: rejects a cut outside the transition', () => {
    expect(() => pushCut({ cutProgress: 1 })).toThrow();
  });

  it('none: both scenes are shown, untouched', () => {
    const container = renderAt(25, none());
    expect(container.querySelector('[data-scene="a"]')).not.toBeNull();
    expect(container.querySelector('[data-scene="b"]')).not.toBeNull();
  });
});
