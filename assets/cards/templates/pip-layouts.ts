export type Pip = { x: number; y: number; rotation: 0 | 180 };
const pip = (x: number, y: number): Pip => ({ x, y, rotation: y > 168 ? 180 : 0 });
const paired = (ys: number[]) => ys.flatMap((y) => [pip(81, y), pip(159, y)]);
export const pipLayouts = {
  '2': [pip(120, 116), pip(120, 220)],
  '3': [pip(120, 110), pip(120, 168), pip(120, 226)],
  '4': paired([110, 226]),
  '5': [...paired([110, 226]), pip(120, 168)],
  '6': paired([110, 168, 226]),
  '7': [...paired([110, 168, 226]), pip(120, 139)],
  '8': [...paired([110, 168, 226]), pip(120, 139), pip(120, 197)],
  '9': [...paired([110, 148, 188, 226]), pip(120, 168)],
  '10': [...paired([110, 148, 188, 226]), pip(120, 129), pip(120, 207)],
} satisfies Record<string, readonly Pip[]>;
