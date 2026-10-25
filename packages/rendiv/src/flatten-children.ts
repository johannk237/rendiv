import React, { Children, Fragment, type ReactNode } from 'react';

/** The children as a flat list, with the content of fragments in place of the fragments (keys preserved). */
export function flattenChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flattenChildren(child.props.children)
      : [child],
  );
}
