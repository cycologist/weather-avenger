import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angularDistance,
  cardinal,
  cardinalName,
  compassToDegrees,
  directionSpread,
  meanDirection,
  normalizeDegrees,
} from '../public/lib/wind.js';

test('normalizeDegrees wraps bearings into [0, 360)', () => {
  assert.equal(normalizeDegrees(-10), 350);
  assert.equal(normalizeDegrees(370), 10);
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(Number.NaN), null);
});

test('meanDirection averages across the north gap', () => {
  const mean = meanDirection([350, 10]);
  assert.ok(Math.abs(mean) < 1e-9 || Math.abs(mean - 360) < 1e-9);

  assert.equal(meanDirection([90, 90, 90]), 90);
  assert.equal(meanDirection([]), null);
  assert.equal(meanDirection([Number.NaN]), null);
});

test('meanDirection returns null when the bearings cancel out', () => {
  assert.equal(meanDirection([0, 180]), null);
  assert.equal(meanDirection([90, 270]), null);
});

test('directionSpread measures the widest deviation from the circular mean', () => {
  assert.equal(directionSpread([350, 10]), 10);
  assert.equal(directionSpread([300, 330]), 15);
  assert.equal(directionSpread([90]), null);
  assert.equal(directionSpread([]), null);
});

test('angularDistance takes the short way around', () => {
  assert.equal(angularDistance(350, 10), 20);
  assert.equal(angularDistance(10, 350), 20);
  assert.equal(angularDistance(0, 180), 180);
  assert.equal(angularDistance(0, 90), 90);
});

test('cardinal maps bearings to 16-point compass labels', () => {
  assert.equal(cardinal(0), 'N');
  assert.equal(cardinal(359), 'N');
  assert.equal(cardinal(22.5), 'NNE');
  assert.equal(cardinal(292.5), 'WNW');
  assert.equal(cardinal(225), 'SW');
  assert.equal(cardinal(null), null);
});

test('cardinalName spells out the compass point', () => {
  assert.equal(cardinalName(315), 'northwest');
  assert.equal(cardinalName(0), 'north');
  assert.equal(cardinalName(null), null);
});

test('compassToDegrees converts 8- and 16-point compass strings', () => {
  assert.equal(compassToDegrees('N'), 0);
  assert.equal(compassToDegrees('ne'), 45);
  assert.equal(compassToDegrees(' NNE '), 22.5);
  assert.equal(compassToDegrees('nope'), null);
  assert.equal(compassToDegrees(null), null);
});
