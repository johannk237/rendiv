import { createContext } from 'react';

/** Volume and mute applied on top of every media element's own (set by the Player's mute / setVolume). */
export interface MediaVolumeContextValue {
  muted: boolean;
  /** 0 to 1, multiplied with each element's volume. */
  volume: number;
}

export const MediaVolumeContext = createContext<MediaVolumeContextValue>({
  muted: false,
  volume: 1,
});
