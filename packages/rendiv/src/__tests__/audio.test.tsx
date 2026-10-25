import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { Audio } from '../components/Audio';
import { Sequence } from '../components/Sequence';
import { TimelineContext } from '../context/TimelineContext';
import { CompositionContext, type CompositionConfig } from '../context/CompositionContext';
import { RendivEnvironmentContext } from '../context/RendivEnvironmentContext';
import { MediaVolumeContext } from '../context/MediaVolumeContext';
import { _resetPendingHolds, getPendingHoldCount } from '../delay-render';

const compositionConfig: CompositionConfig = {
  id: 'test',
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 150,
  defaultProps: {},
};

function renderAudioInContext(
  ui: React.ReactElement,
  options?: { frame?: number; environment?: 'player' | 'rendering' | 'studio' },
) {
  const { frame = 0, environment = 'player' } = options ?? {};
  return render(
    <CompositionContext.Provider value={compositionConfig}>
      <RendivEnvironmentContext.Provider value={{ environment }}>
        <TimelineContext.Provider
          value={{
            frame,
            playing: false,
            playingRef: { current: false },
          }}
        >
          {ui}
        </TimelineContext.Provider>
      </RendivEnvironmentContext.Provider>
    </CompositionContext.Provider>,
  );
}

describe('Audio', () => {
  it('renders audio element in player mode', () => {
    const { container } = renderAudioInContext(
      <Audio src="/test.mp3" />,
      { environment: 'player' },
    );
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute('src')).toBe('/test.mp3');
  });

  it('renders null in rendering mode', () => {
    const { container } = renderAudioInContext(
      <Audio src="/test.mp3" />,
      { environment: 'rendering' },
    );
    const audio = container.querySelector('audio');
    expect(audio).toBeNull();
  });

  it('renders audio in studio mode', () => {
    const { container } = renderAudioInContext(
      <Audio src="/test.mp3" />,
      { environment: 'studio' },
    );
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
  });

  it('sets preload attribute', () => {
    const { container } = renderAudioInContext(
      <Audio src="/test.mp3" />,
      { environment: 'player' },
    );
    const audio = container.querySelector('audio')!;
    expect(audio.getAttribute('preload')).toBe('auto');
  });
});

interface RegisteredAudio {
  src: string;
  startAtFrame: number;
  durationInFrames: number;
  startFrom: number;
  endAt?: number;
  volume: number;
  volumeCurve?: number[];
  loop?: boolean;
}

const registered = (): RegisteredAudio[] => {
  const map = (window as unknown as { __RENDIV_AUDIO_SOURCES__?: Map<string, RegisteredAudio> }).__RENDIV_AUDIO_SOURCES__;
  return map ? Array.from(map.values()) : [];
};

/** The <audio> elements Audio creates to read the length of its source (jsdom loads nothing: the test answers). */
function captureProbes() {
  const probes: HTMLAudioElement[] = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = create(tag, options);
    if (tag === 'audio') probes.push(element as HTMLAudioElement);
    return element;
  }) as typeof document.createElement);
  return probes;
}

function answer(probe: HTMLAudioElement, durationSec: number) {
  Object.defineProperty(probe, 'duration', { value: durationSec });
  act(() => probe.onloadedmetadata?.(new Event('loadedmetadata')));
}

describe('Audio while rendering: what the renderer mixes', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__RENDIV_AUDIO_SOURCES__;
    _resetPendingHolds();
  });
  afterEach(() => vi.restoreAllMocks());

  it('registers a fixed volume, clamped, for the rest of the composition', () => {
    renderAudioInContext(<Audio src="/a.mp3" volume={1.5} />, { environment: 'rendering' });
    expect(registered()).toEqual([expect.objectContaining({ src: '/a.mp3', startAtFrame: 0, durationInFrames: 150, volume: 1, volumeCurve: undefined })]);
  });

  it('registers the placement of its Sequence', () => {
    renderAudioInContext(
      <Sequence from={30} durationInFrames={40}><Audio src="/a.mp3" volume={0.5} /></Sequence>,
      { environment: 'rendering', frame: 35 },
    );
    expect(registered()).toEqual([expect.objectContaining({ startAtFrame: 30, durationInFrames: 40, volume: 0.5 })]);
  });

  it('a volume function becomes one value per frame of the placement', () => {
    renderAudioInContext(
      <Sequence from={10} durationInFrames={20}><Audio src="/a.mp3" volume={(f) => f / 10} /></Sequence>,
      { environment: 'rendering', frame: 10 },
    );
    const [entry] = registered();
    expect(entry.volume).toBe(1);
    expect(entry.volumeCurve).toHaveLength(20);
    expect(entry.volumeCurve!.slice(0, 3)).toEqual([0, 0.1, 0.2]);
    // Clamped to [0, 1]
    expect(entry.volumeCurve![15]).toBe(1);
  });

  it('trimBefore and trimAfter are startFrom and endAt', () => {
    renderAudioInContext(<Audio src="/a.mp3" trimBefore={15} trimAfter={45} />, { environment: 'rendering' });
    expect(registered()).toEqual([expect.objectContaining({ startFrom: 15, endAt: 45, durationInFrames: 30 })]);
  });

  it('a loop between startFrom and endAt lasts as long as the composition and restarts its curve', () => {
    renderAudioInContext(
      <Audio src="/a.mp3" loop startFrom={10} endAt={40} volume={(f) => f / 100} />,
      { environment: 'rendering' },
    );
    const [entry] = registered();
    expect(entry).toEqual(expect.objectContaining({ loop: true, startFrom: 10, endAt: 40, durationInFrames: 150 }));
    // Segment of 30 frames: frame 30 of the placement is frame 0 of the curve
    expect(entry.volumeCurve![29]).toBeCloseTo(0.29);
    expect(entry.volumeCurve![30]).toBe(0);
    expect(getPendingHoldCount()).toBe(0);
  });

  it("loopVolumeCurveBehavior 'extend' keeps counting, without reading the length of the file", () => {
    const probes = captureProbes();
    renderAudioInContext(
      <Audio src="/a.wav" loop loopVolumeCurveBehavior="extend" volume={(f) => f / 100} />,
      { environment: 'rendering' },
    );
    expect(probes).toHaveLength(0);
    const [entry] = registered();
    expect(entry.volumeCurve![120]).toBeCloseTo(1);
    expect(entry.volumeCurve![60]).toBeCloseTo(0.6);
  });

  it("a 'repeat' curve over the whole file holds the render until the length of the file is read", () => {
    const probes = captureProbes();
    renderAudioInContext(<Audio src="/a.wav" loop volume={(f) => f / 100} />, { environment: 'rendering' });
    expect(probes).toHaveLength(1);
    expect(getPendingHoldCount()).toBe(1);
    expect(registered()).toHaveLength(0);

    answer(probes[0], 2); // 60 frames at 30 fps
    expect(getPendingHoldCount()).toBe(0);
    const [entry] = registered();
    expect(entry.volumeCurve![59]).toBeCloseTo(0.59);
    expect(entry.volumeCurve![60]).toBe(0);
  });

  it('a file whose length cannot be read is still mixed, with a warning, its curve not restarted', () => {
    const probes = captureProbes();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAudioInContext(<Audio src="/stream.wav" loop volume={(f) => f / 100} />, { environment: 'rendering' });
    answer(probes[0], Infinity);
    expect(getPendingHoldCount()).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/stream.wav'));
    const [entry] = registered();
    expect(entry).toEqual(expect.objectContaining({ src: '/stream.wav', loop: true, durationInFrames: 150 }));
    expect(entry.volumeCurve![90]).toBeCloseTo(0.9);
  });

  it('a muted or silent Audio is not mixed', () => {
    renderAudioInContext(<><Audio src="/a.mp3" muted /><Audio src="/b.mp3" volume={0} /></>, { environment: 'rendering' });
    expect(registered()).toHaveLength(0);
  });
});

describe('Audio in the player: the MediaVolumeContext', () => {
  it("multiplies the element's volume and mutes it", () => {
    const { container, rerender } = render(
      <CompositionContext.Provider value={compositionConfig}>
        <MediaVolumeContext.Provider value={{ muted: false, volume: 0.5 }}>
          <TimelineContext.Provider value={{ frame: 0, playing: false, playingRef: { current: false } }}>
            <Audio src="/a.mp3" volume={0.8} />
          </TimelineContext.Provider>
        </MediaVolumeContext.Provider>
      </CompositionContext.Provider>,
    );
    const audio = container.querySelector('audio')!;
    expect(audio.volume).toBeCloseTo(0.4);
    expect(audio.muted).toBe(false);

    rerender(
      <CompositionContext.Provider value={compositionConfig}>
        <MediaVolumeContext.Provider value={{ muted: true, volume: 0.5 }}>
          <TimelineContext.Provider value={{ frame: 0, playing: false, playingRef: { current: false } }}>
            <Audio src="/a.mp3" volume={0.8} />
          </TimelineContext.Provider>
        </MediaVolumeContext.Provider>
      </CompositionContext.Provider>,
    );
    expect(audio.muted).toBe(true);
  });
});
