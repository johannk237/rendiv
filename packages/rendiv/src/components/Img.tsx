import React, { useCallback, useContext, useEffect, useRef, type ImgHTMLAttributes } from 'react';
import { holdRender, releaseRender } from '../delay-render';
import { RendivEnvironmentContext } from '../context/RendivEnvironmentContext';

export interface ImgProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** Timeout for holdRender in milliseconds. Default: 30000 */
  holdRenderTimeout?: number;
}

export function Img({
  holdRenderTimeout = 30000,
  onLoad: userOnLoad,
  onError: userOnError,
  ...imgProps
}: ImgProps): React.ReactElement {
  const holdHandleRef = useRef<number | null>(null);
  const { environment } = useContext(RendivEnvironmentContext);

  useEffect(() => {
    const handle = holdRender(
      `Loading <Img> with src="${imgProps.src}"`,
      { timeoutInMilliseconds: holdRenderTimeout },
    );
    holdHandleRef.current = handle;

    return () => {
      if (holdHandleRef.current !== null) {
        releaseRender(holdHandleRef.current);
        holdHandleRef.current = null;
      }
    };
  }, [imgProps.src, holdRenderTimeout]);

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (holdHandleRef.current !== null) {
        releaseRender(holdHandleRef.current);
        holdHandleRef.current = null;
      }
      userOnLoad?.(e);
    },
    [userOnLoad],
  );

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (holdHandleRef.current !== null) {
        releaseRender(holdHandleRef.current);
        holdHandleRef.current = null;
      }
      if (userOnError) {
        userOnError(e);
      } else if (environment === 'rendering') {
        // A frame with a missing image must not be captured: without an onError of its own, the render fails.
        throw new Error(`<Img> could not load "${imgProps.src}". Pass onError to handle the failure yourself.`);
      }
    },
    [userOnError, environment, imgProps.src],
  );

  return (
    <img
      {...imgProps}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}

Img.displayName = 'Img';
