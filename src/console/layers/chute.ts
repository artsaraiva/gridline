// #130: a Soldier coming down on a parachute is drawn as a chevron at 70% size, growing evenly to full size as it lands.

/** The chevron's size factor for a descent `progress` (0..1; undefined on the ground). */
export const chuteScale = (progress: number | undefined) => (progress === undefined ? 1 : 0.7 + 0.3 * progress);
