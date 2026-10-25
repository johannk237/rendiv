import React, { Children, type ReactNode } from 'react';
import { Sequence, Fill, useFrame, useCompositionConfig, flattenChildren } from '@rendiv/core';
import type { TransitionPresentation, TransitionTiming } from './types';

// --- Marker children ---

export interface TransitionSeriesSequenceProps {
  durationInFrames: number;
  name?: string;
  children: ReactNode;
}

function TransitionSeriesSequence(_props: TransitionSeriesSequenceProps): React.ReactNode {
  throw new Error(
    '<TransitionSeries.Sequence> can only be used as a direct child of <TransitionSeries>.',
  );
}
TransitionSeriesSequence.displayName = 'TransitionSeries.Sequence';

export interface TransitionSeriesTransitionProps<PassedProps = Record<string, unknown>> {
  timing: TransitionTiming;
  presentation?: TransitionPresentation<PassedProps>;
}

function TransitionSeriesTransition<PassedProps>(_props: TransitionSeriesTransitionProps<PassedProps>): React.ReactNode {
  throw new Error(
    '<TransitionSeries.Transition> can only be used as a direct child of <TransitionSeries>.',
  );
}
TransitionSeriesTransition.displayName = 'TransitionSeries.Transition';

// --- Internal types ---

interface SequenceItem {
  type: 'sequence';
  durationInFrames: number;
  name?: string;
  children: ReactNode;
}

interface TransitionItem {
  type: 'transition';
  timing: TransitionTiming;
  presentation: TransitionPresentation;
}

type ParsedChild = SequenceItem | TransitionItem;

interface LayoutEntry {
  from: number;
  durationInFrames: number;
  name?: string;
  children: ReactNode;
  enterTransition?: { timing: TransitionTiming; presentation: TransitionPresentation };
  exitTransition?: { timing: TransitionTiming; presentation: TransitionPresentation };
}

// --- Transition wrapper ---

interface TransitionWrapperProps {
  children: ReactNode;
  durationInFrames: number;
  enterTransition?: { timing: TransitionTiming; presentation: TransitionPresentation };
  exitTransition?: { timing: TransitionTiming; presentation: TransitionPresentation };
}

const noopPresentation: TransitionPresentation = {
  style: () => ({ entering: {}, exiting: {} }),
};

interface PresentedProps {
  presentation: TransitionPresentation;
  direction: 'entering' | 'exiting';
  progress: number;
  durationInFrames: number;
  children: ReactNode;
}

/** The children as a presentation shows them at this progress. */
function Presented({ presentation, direction, progress, durationInFrames, children }: PresentedProps): React.ReactElement {
  if ('component' in presentation) {
    const Presentation = presentation.component;
    return (
      <Presentation
        presentationDirection={direction}
        presentationProgress={progress}
        presentationDurationInFrames={durationInFrames}
        passedProps={presentation.props}
      >
        {children}
      </Presentation>
    );
  }
  const styles = presentation.style(progress);
  return <Fill style={direction === 'entering' ? styles.entering : styles.exiting}>{children}</Fill>;
}

/**
 * A scene with a transition stays inside its presentation for its whole duration, at the progress of the moment
 * (1 once it has entered, 0 until it starts leaving): what a presentation shows at its ends stays on screen (a scale,
 * a filter), and the tree keeps the same shape, so the scene is never remounted when a transition starts or ends.
 * The exit wraps the entrance when a scene has both.
 */
function TransitionWrapper({
  children,
  durationInFrames,
  enterTransition,
  exitTransition,
}: TransitionWrapperProps): React.ReactElement {
  const frame = useFrame();
  const { fps } = useCompositionConfig();

  if (!enterTransition && !exitTransition) return <Fill>{children}</Fill>;

  let content = <>{children}</>;
  if (enterTransition) {
    content = (
      <Presented
        presentation={enterTransition.presentation}
        direction="entering"
        progress={enterTransition.timing.progress(frame, fps)}
        durationInFrames={enterTransition.timing.durationInFrames}
      >
        {content}
      </Presented>
    );
  }
  if (exitTransition) {
    const exitStart = durationInFrames - exitTransition.timing.durationInFrames;
    content = (
      <Presented
        presentation={exitTransition.presentation}
        direction="exiting"
        progress={exitTransition.timing.progress(frame - exitStart, fps)}
        durationInFrames={exitTransition.timing.durationInFrames}
      >
        {content}
      </Presented>
    );
  }
  return content;
}

// --- Main component ---

export interface TransitionSeriesProps {
  children: ReactNode;
}

function TransitionSeriesRoot({ children }: TransitionSeriesProps): React.ReactElement {
  const childArray = flattenChildren(children);

  // Parse children into sequence/transition items
  const parsed: ParsedChild[] = [];
  for (const child of childArray) {
    if (!React.isValidElement(child)) continue;

    if (child.type === TransitionSeriesSequence) {
      const props = child.props as TransitionSeriesSequenceProps;
      parsed.push({
        type: 'sequence',
        durationInFrames: props.durationInFrames,
        name: props.name,
        children: props.children,
      });
    } else if (child.type === TransitionSeriesTransition) {
      const props = child.props as TransitionSeriesTransitionProps;
      parsed.push({
        type: 'transition',
        timing: props.timing,
        presentation: props.presentation ?? noopPresentation,
      });
    } else {
      throw new Error(
        'Only <TransitionSeries.Sequence> and <TransitionSeries.Transition> are allowed as children of <TransitionSeries>.',
      );
    }
  }

  // Calculate frame layout with overlaps
  const layout: LayoutEntry[] = [];
  let accumulatedFrom = 0;

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (item.type !== 'sequence') continue;

    // Derive name from child component if not explicitly provided
    let sequenceName = item.name;
    if (!sequenceName) {
      const childElements = Children.toArray(item.children);
      if (childElements.length > 0) {
        const first = childElements[0];
        if (React.isValidElement(first) && typeof first.type !== 'string') {
          const type = first.type as { displayName?: string; name?: string };
          sequenceName = type.displayName || type.name;
        }
      }
    }

    const entry: LayoutEntry = {
      from: accumulatedFrom,
      durationInFrames: item.durationInFrames,
      name: sequenceName,
      children: item.children,
    };

    // Check for transition before this sequence (pull start back to create overlap)
    if (i > 0 && parsed[i - 1].type === 'transition') {
      const transition = parsed[i - 1] as TransitionItem;
      entry.enterTransition = {
        timing: transition.timing,
        presentation: transition.presentation,
      };
      accumulatedFrom -= transition.timing.durationInFrames;
      entry.from = accumulatedFrom;
    }

    // Check for transition after this sequence
    if (i + 1 < parsed.length && parsed[i + 1].type === 'transition') {
      const transition = parsed[i + 1] as TransitionItem;
      entry.exitTransition = {
        timing: transition.timing,
        presentation: transition.presentation,
      };
    }

    layout.push(entry);
    accumulatedFrom += item.durationInFrames;
  }

  return (
    <>
      {layout.map((entry, index) => (
        <Sequence
          key={index}
          from={entry.from}
          durationInFrames={entry.durationInFrames}
          name={entry.name}
          layout="none"
        >
          <TransitionWrapper
            durationInFrames={entry.durationInFrames}
            enterTransition={entry.enterTransition}
            exitTransition={entry.exitTransition}
          >
            {entry.children}
          </TransitionWrapper>
        </Sequence>
      ))}
    </>
  );
}

TransitionSeriesRoot.displayName = 'TransitionSeries';

export const TransitionSeries = Object.assign(TransitionSeriesRoot, {
  Sequence: TransitionSeriesSequence,
  Transition: TransitionSeriesTransition,
});
