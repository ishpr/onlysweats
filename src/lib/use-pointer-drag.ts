import { useCallback, useRef, type PointerEvent } from "react";

export function usePointerDrag(
  onMove: (x: number, y: number) => void,
) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const point = useCallback(
    (e: PointerEvent<SVGCircleElement>) => {
      const svg = (e.currentTarget.ownerSVGElement ?? svgRef.current) as SVGSVGElement | null;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const loc = pt.matrixTransform(ctm.inverse());
      onMove(loc.x, loc.y);
    },
    [onMove],
  );

  const onPointerDown = (e: PointerEvent<SVGCircleElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    point(e);
  };
  const onPointerMove = (e: PointerEvent<SVGCircleElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    point(e);
  };

  return { onPointerDown, onPointerMove };
}
