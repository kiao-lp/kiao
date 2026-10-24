import { useRef } from 'react';

export class MovementAccumulator {

  public totalDistance = 0;
  private intervalCumulativeMovement: number[] = [0, 0];
  private interval: NodeJS.Timeout | null = null;

  private isEnabled() {
    return !!this.interval;
  }

  public onFlush: (cumulativeMovement: number[]) => void = () => undefined;

  public start = () => {
    if (!this.isEnabled()) {
      this.intervalCumulativeMovement = [0, 0];
      this.interval = setInterval(() => this.flush(), 50);
      this.totalDistance = 0;
    }
  }

  public stop = () => {
    if (this.isEnabled()) {
      clearInterval(this.interval!);
      this.interval = null;
    }
  }

  public accumulateMovement = (mvt: number[]) => {
    if (this.isEnabled()) {
      const [currX, currY] = this.intervalCumulativeMovement;
      const [nextX, nextY] = mvt;
      this.intervalCumulativeMovement = [currX + nextX, currY + nextY];
    }
  }

  private flush = () => {
    const [dX, dY] = this.intervalCumulativeMovement;
    if (dX !== 0 || dY !== 0) {
      this.intervalCumulativeMovement = [0, 0];
      this.totalDistance += Math.sqrt(Math.pow(dX, 2) + Math.pow(dY, 2));
      this.onFlush([dX, dY]);
    }
  }
}

export const useMovementAccumulator = (onFlush: (cumulativeMovement: number[]) => void) => {
  const ref = useRef<MovementAccumulator>(new MovementAccumulator());
  ref.current.onFlush = onFlush;
  return ref;
}
