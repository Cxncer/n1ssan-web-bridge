import React, { type ComponentPropsWithoutRef, type CSSProperties } from 'react';
import './ShimmerButton.css';

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<'button'> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = '#8fce98',
      shimmerSize = '0.08em',
      shimmerDuration = '3s',
      borderRadius = '8px',
      background = '#050706',
      className,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const shimmerStyle = {
      '--shimmer-color': shimmerColor,
      '--shimmer-size': shimmerSize,
      '--shimmer-duration': shimmerDuration,
      '--shimmer-radius': borderRadius,
      '--shimmer-background': background,
      ...style,
    } as CSSProperties;

    return (
      <button
        ref={ref}
        type="button"
        className={`shimmer-button${className ? ` ${className}` : ''}`}
        style={shimmerStyle}
        {...props}
      >
        <span className="shimmer-button__content">{children}</span>
      </button>
    );
  }
);

ShimmerButton.displayName = 'ShimmerButton';

export default ShimmerButton;
