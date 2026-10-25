export interface CompositionInfo {
  id: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, unknown>;
  /** The props the composition renders with, once its resolveConfig has run (selectComposition). */
  props?: Record<string, unknown>;
  type: 'composition' | 'still';
}

export interface AudioSourceInfo {
  /** 'audio' for <Audio>, 'video' for <Video>/<OffthreadVideo> */
  type: 'audio' | 'video';
  /** Source URL (e.g. "/01_hook_intro.wav") */
  src: string;
  /** Absolute frame where this audio starts in the composition timeline */
  startAtFrame: number;
  /** How many frames this audio plays for */
  durationInFrames: number;
  /** Frame offset into the source file to start from */
  startFrom: number;
  /** Volume 0–1 */
  volume: number;
  /** Playback speed multiplier */
  playbackRate: number;
  /** Volume of each frame of the placement (0–1), when it changes over time; `volume` is then 1. */
  volumeCurve?: number[];
  /** Repeat the source range (startFrom to endAt, or to the end of the file) for the whole duration. */
  loop?: boolean;
  /** Frame of the source where it stops (or loops back to `startFrom`). */
  endAt?: number;
}
