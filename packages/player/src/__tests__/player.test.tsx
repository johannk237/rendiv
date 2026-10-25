import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { Audio, useFrame } from '@rendiv/core';
import { Player, type PlayerRef } from '../Player';
import { Thumbnail } from '../Thumbnail';
import { fitComposition } from '../composition-stage';

// jsdom has none; the player observes its container to scale the composition
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function FrameDisplay() {
  return <div data-testid="frame">{useFrame()}</div>;
}

function WithAudio() {
  return <Audio src="/music.mp3" volume={0.8} />;
}

const composition = { durationInFrames: 30, fps: 30, compositionWidth: 640, compositionHeight: 360 };

function renderPlayer(props: Partial<React.ComponentProps<typeof Player>> = {}) {
  const ref = createRef<PlayerRef>();
  const result = render(<Player ref={ref} component={FrameDisplay} {...composition} {...props} />);
  return { ref, ...result };
}

/** Every event the player emits, in order. */
function record(ref: React.RefObject<PlayerRef | null>) {
  const events: string[] = [];
  const names = ['play', 'pause', 'ended', 'seeked', 'mutechange', 'volumechange'] as const;
  for (const name of names) {
    ref.current!.addEventListener(name, (data: unknown) => events.push(data ? `${name} ${JSON.stringify(data)}` : name));
  }
  return events;
}

describe('Player: methods and events', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('emits play and pause on changes only', () => {
    const { ref } = renderPlayer();
    const events = record(ref);
    act(() => ref.current!.play());
    act(() => ref.current!.play());
    act(() => ref.current!.pause());
    act(() => ref.current!.pause());
    expect(events).toEqual(['play', 'pause']);
  });

  it('seekTo shows the frame, clamped, and emits seeked', () => {
    const { ref, getByTestId } = renderPlayer();
    const events = record(ref);
    act(() => ref.current!.seekTo(12));
    expect(getByTestId('frame').textContent).toBe('12');
    act(() => ref.current!.seekTo(500));
    expect(ref.current!.getCurrentFrame()).toBe(29);
    expect(events).toEqual(['seeked {"frame":12}', 'seeked {"frame":29}']);
  });

  it('plays to the last frame, then pauses and emits ended', () => {
    const { ref, getByTestId } = renderPlayer();
    const events = record(ref);
    act(() => ref.current!.seekTo(25));
    act(() => ref.current!.play());
    act(() => vi.advanceTimersByTime(1000));
    expect(getByTestId('frame').textContent).toBe('29');
    expect(ref.current!.isPlaying()).toBe(false);
    expect(events).toEqual(['seeked {"frame":25}', 'play', 'pause', 'ended']);
  });

  it('with loop, goes back to the start and never ends', () => {
    const { ref } = renderPlayer({ loop: true });
    const events = record(ref);
    act(() => ref.current!.seekTo(28));
    act(() => ref.current!.play());
    act(() => vi.advanceTimersByTime(200));
    expect(ref.current!.isPlaying()).toBe(true);
    expect(ref.current!.getCurrentFrame()).toBeLessThan(28);
    expect(events).not.toContain('ended');
  });

  it('mute and unmute reach the media, with mutechange', () => {
    const { ref, container } = renderPlayer({ component: WithAudio });
    const events = record(ref);
    const audio = container.querySelector('audio')!;
    expect(audio.muted).toBe(false);
    act(() => ref.current!.mute());
    expect(ref.current!.isMuted()).toBe(true);
    expect(audio.muted).toBe(true);
    act(() => ref.current!.unmute());
    expect(audio.muted).toBe(false);
    expect(events).toEqual(['mutechange {"isMuted":true}', 'mutechange {"isMuted":false}']);
  });

  it('initiallyMuted starts muted without an event', () => {
    const { ref, container } = renderPlayer({ component: WithAudio, initiallyMuted: true });
    expect(ref.current!.isMuted()).toBe(true);
    expect(container.querySelector('audio')!.muted).toBe(true);
  });

  it("setVolume is clamped and multiplies each media's own volume", () => {
    const { ref, container } = renderPlayer({ component: WithAudio });
    const events = record(ref);
    const audio = container.querySelector('audio')!;
    expect(audio.volume).toBeCloseTo(0.8);
    act(() => ref.current!.setVolume(0.5));
    expect(ref.current!.getVolume()).toBe(0.5);
    expect(audio.volume).toBeCloseTo(0.4);
    act(() => ref.current!.setVolume(3));
    expect(ref.current!.getVolume()).toBe(1);
    expect(events).toEqual(['volumechange {"volume":0.5}', 'volumechange {"volume":1}']);
  });

  it('space toggles playback; keyboardShortcuts={false} turns it off', () => {
    const { ref } = renderPlayer();
    fireEvent.keyDown(ref.current!.getContainerNode()!, { key: ' ' });
    expect(ref.current!.isPlaying()).toBe(true);

    const other = renderPlayer({ keyboardShortcuts: false });
    fireEvent.keyDown(other.ref.current!.getContainerNode()!, { key: ' ' });
    expect(other.ref.current!.isPlaying()).toBe(false);
  });

  it('clickToPlay toggles playback on a click', () => {
    const { ref } = renderPlayer({ clickToPlay: true });
    fireEvent.click(ref.current!.getContainerNode()!);
    expect(ref.current!.isPlaying()).toBe(true);
    fireEvent.click(ref.current!.getContainerNode()!);
    expect(ref.current!.isPlaying()).toBe(false);
  });
});

describe('Thumbnail', () => {
  it('shows the frame asked for', () => {
    const { getByTestId } = render(<Thumbnail component={FrameDisplay} frameToDisplay={17} {...composition} />);
    expect(getByTestId('frame').textContent).toBe('17');
  });

  it('plays no sound', () => {
    const { container } = render(<Thumbnail component={WithAudio} frameToDisplay={0} {...composition} />);
    const audio = container.querySelector('audio');
    expect(audio === null || audio.muted).toBe(true);
  });
});

describe('fitComposition', () => {
  const size = { width: 1920, height: 1080 };

  it('without a height of its own, scales to the width', () => {
    expect(fitComposition({ width: 960, height: 2000 }, size, false)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 0 });
  });

  it('with a height of its own, contains the composition and centres it', () => {
    expect(fitComposition({ width: 960, height: 1000 }, size, true)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 230 });
    expect(fitComposition({ width: 2000, height: 540 }, size, true)).toEqual({ scale: 0.5, offsetX: 520, offsetY: 0 });
  });
});
