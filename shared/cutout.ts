/** Pixel coordinates in the uploaded original, not the scaled preview. */
export type CutoutBox = [[number, number], [number, number]]
export function isCutoutBox(value: unknown): value is CutoutBox {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isSafeInteger))) return false
  const [[x1, y1], [x2, y2]] = value as CutoutBox
  return x1 > 0 && y1 > 0 && x2 - x1 >= 10 && y2 - y1 >= 10
}
export function boxInside(box: CutoutBox, width: number, height: number): boolean {
  return isCutoutBox(box) && box[1][0] < width && box[1][1] < height
}
export function selectionFromDrag(start: [number, number], end: [number, number]): CutoutBox {
  return [[Math.min(start[0], end[0]), Math.min(start[1], end[1])],
    [Math.max(start[0], end[0]), Math.max(start[1], end[1])]]
}
export function imagePoint(x: number, y: number, rect: { left: number; top: number; width: number; height: number },
  width: number, height: number): [number, number] {
  return [Math.max(1, Math.min(width - 1, Math.round((x - rect.left) / rect.width * width))),
    Math.max(1, Math.min(height - 1, Math.round((y - rect.top) / rect.height * height)))]
}
