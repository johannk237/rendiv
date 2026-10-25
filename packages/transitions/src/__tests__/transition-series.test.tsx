import { describe, it, expect } from 'vitest';
import React, { useEffect, useRef } from 'react';
import { render } from '@testing-library/react';
import { CompositionContext, TimelineContext, useFrame, type CompositionConfig } from '@rendiv/core';
import { TransitionSeries } from '../TransitionSeries';
import { linearTiming } from '../timings/linear-timing';
import { fade } from '../presentations/fade';
import type { TransitionPresentationComponentProps } from '../types';

const compositionConfig: CompositionConfig = {
  id: 'test',
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 300,
  defaultProps: {},
};

function renderAtFrame(frame: number, ui: React.ReactElement) {
  return render(
    <CompositionContext.Provider value={compositionConfig}>
      <TimelineContext.Provider value={{ frame, playing: false, playingRef: { current: false } }}>{ui}</TimelineContext.Provider>
    </CompositionContext.Provider>,
  );
}

function Scene({ name }: { name: string }) {
  return <i data-scene={name}>{`${name}:${useFrame()}`}</i>;
}

/** What each scene shows, with the presentations around it (outermost first). */
function seen(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-scene], [data-presented]')).map((e) => e.getAttribute('data-presented') ?? e.textContent);
}

function Shown({ children, presentationDirection, presentationProgress, presentationDurationInFrames, passedProps }: TransitionPresentationComponentProps<{ name: string }>) {
  return (
    <div data-presented={`${passedProps.name} ${presentationDirection} ${presentationProgress.toFixed(2)} /${presentationDurationInFrames}`}>
      {children}
    </div>
  );
}
const shown = (name: string) => ({ component: Shown, props: { name } });

const series = (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={30}><Scene name="a" /></TransitionSeries.Sequence>
    <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} presentation={shown('ab')} />
    <TransitionSeries.Sequence durationInFrames={30}><Scene name="b" /></TransitionSeries.Sequence>
    <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} presentation={shown('bc')} />
    <TransitionSeries.Sequence durationInFrames={30}><Scene name="c" /></TransitionSeries.Sequence>
  </TransitionSeries>
);

describe('TransitionSeries with component presentations', () => {
  it('during a transition, wraps both scenes', () => {
    expect(seen(renderAtFrame(25, series).container)).toEqual(['ab exiting 0.50 /10', 'a:25', 'bc exiting 0.00 /10', 'ab entering 0.50 /10', 'b:5']);
  });

  it('keeps a scene in its presentations between transitions: entered (1), not yet leaving (0)', () => {
    expect(seen(renderAtFrame(35, series).container)).toEqual(['bc exiting 0.00 /10', 'ab entering 1.00 /10', 'b:15']);
  });

  it('a scene that leaves while still entering has the exit around the entrance', () => {
    const short = (
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={20}><Scene name="a" /></TransitionSeries.Sequence>
        <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} presentation={shown('ab')} />
        <TransitionSeries.Sequence durationInFrames={12}><Scene name="b" /></TransitionSeries.Sequence>
        <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} presentation={shown('bc')} />
        <TransitionSeries.Sequence durationInFrames={20}><Scene name="c" /></TransitionSeries.Sequence>
      </TransitionSeries>
    );
    // b runs from 10 to 22, leaves from 12: at 15 it is entering (0.5) and leaving (0.3)
    expect(seen(renderAtFrame(15, short).container)).toContain('bc exiting 0.30 /10');
    expect(seen(renderAtFrame(15, short).container).slice(0, 3)).toEqual(['ab exiting 0.50 /10', 'a:15', 'bc exiting 0.30 /10']);
  });

  it('a scene is not remounted when its transition starts or ends', () => {
    const mounts: string[] = [];
    function Counted({ name }: { name: string }) {
      const id = useRef(Math.random().toString(36).slice(2));
      useEffect(() => {
        mounts.push(`${name} ${id.current}`);
      }, [name]);
      return <Scene name={name} />;
    }
    const ui = (frame: number) => (
      <CompositionContext.Provider value={compositionConfig}>
        <TimelineContext.Provider value={{ frame, playing: false, playingRef: { current: false } }}>
          <TransitionSeries>
            <TransitionSeries.Sequence durationInFrames={30}><Counted name="a" /></TransitionSeries.Sequence>
            <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} presentation={fade()} />
            <TransitionSeries.Sequence durationInFrames={30}><Counted name="b" /></TransitionSeries.Sequence>
          </TransitionSeries>
        </TimelineContext.Provider>
      </CompositionContext.Provider>
    );
    const { rerender } = render(ui(15));
    for (const frame of [19, 20, 25, 29, 30, 35, 45]) rerender(ui(frame));
    expect(mounts.filter((m) => m.startsWith('a'))).toHaveLength(1);
    expect(mounts.filter((m) => m.startsWith('b'))).toHaveLength(1);
  });

  it('Fragments and arrays of scenes are laid out like direct children', () => {
    const ui = (
      <TransitionSeries>
        <>
          <TransitionSeries.Sequence durationInFrames={30}><Scene name="a" /></TransitionSeries.Sequence>
          <TransitionSeries.Transition timing={linearTiming({ durationInFrames: 10 })} presentation={fade()} />
        </>
        {[<TransitionSeries.Sequence key="b" durationInFrames={30}><Scene name="b" /></TransitionSeries.Sequence>]}
      </TransitionSeries>
    );
    expect(seen(renderAtFrame(25, ui).container)).toEqual(['a:25', 'b:5']);
    expect(seen(renderAtFrame(45, ui).container)).toEqual(['b:25']);
  });
});

describe('linearTiming', () => {
  it('is clamped to [0, 1]', () => {
    const timing = linearTiming({ durationInFrames: 10 });
    expect([-5, 0, 5, 10, 15].map((f) => timing.progress(f, 30))).toEqual([0, 0, 0.5, 1, 1]);
  });
});
