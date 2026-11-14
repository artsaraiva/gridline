import { describe, expect, it } from 'vitest';
import type { VehicleView } from '../../sim/types';
import { iconDim, vehicleIcon } from './vehicle-icon';

const tank = (o: Partial<VehicleView> = {}): VehicleView => ({ id: 9, side: 'nato', kind: 'tank', x: 10, y: -4, fx: 1, fy: 0, tx: 1, ty: 0, ...o });

describe('vehicle icon', () => {
  it('marks a tank with a tactical icon in its Side\'s colour, grey-white while nobody is aboard, none on a Wreck', () => {
    expect(vehicleIcon(tank(), 'nato')).toBe('friendly');
    expect(vehicleIcon(tank({ side: 'pact' }), 'nato')).toBe('hostile');
    expect(vehicleIcon(tank({ empty: true }), 'nato')).toBe('empty');
    expect(vehicleIcon(tank({ side: 'pact', empty: true }), 'nato')).toBe('empty');
    expect(vehicleIcon(tank({ wreck: true }), 'nato')).toBeNull();
  });

  it('lights its icon amber while a Squad with anyone aboard is selected, driver or passenger', () => {
    const own = tank({ seats: [4, 9] });
    expect(vehicleIcon(own, 'nato', [4, 5, 6, 7])).toBe('selected');
    expect(vehicleIcon(own, 'nato', [8, 9, 10, 11])).toBe('selected');
    expect(vehicleIcon(own, 'nato', [0, 1, 2, 3])).toBe('friendly');
    expect(vehicleIcon(tank({ side: 'pact' }), 'nato', [4])).toBe('hostile'); // an enemy tank shows no seats
  });

  it('colours a jeep by the same rule', () => {
    expect(vehicleIcon(tank({ kind: 'jeep', seats: [4, -1, -1, -1] }), 'nato', [4])).toBe('selected');
    expect(vehicleIcon(tank({ kind: 'jeep', wreck: true }), 'nato')).toBeNull();
  });

  it('dims the icon of a vehicle an EMP Strike holds, whoever\'s it is (#143)', () => {
    expect(iconDim(tank())).toBe(1);
    expect(iconDim(tank({ disabled: true }))).toBeLessThan(0.5);
    expect(iconDim(tank({ side: 'pact', kind: 'aa', disabled: true }))).toBe(iconDim(tank({ disabled: true })));
  });
});
