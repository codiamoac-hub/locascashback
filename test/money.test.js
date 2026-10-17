import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cents, drop } from '../src/money.js';

test('amounts print exactly as the database sends them, to the cent', () => {
  assert.equal(cents('190.20'), '190.20');
  assert.equal(cents('38.04'), '38.04');
  assert.equal(cents('150'), '150.00');
  assert.equal(cents('0.5'), '0.50');
  assert.equal(cents('1234567.89'), '1,234,567.89');
  assert.equal(cents('105.300000'), '105.30', 'trailing zeros are fine');
  assert.throws(() => cents('105.305'), /More precise than a cent/, 'never rounded a second time');
  assert.throws(() => cents('12,50'), /Not an amount/);
  assert.throws(() => cents(null), /Not an amount/);
});

test('the floor\'s drop from the mint price', () => {
  assert.equal(drop('42.31'), '−42.31%');
  assert.equal(drop('12.25'), '−12.25%');
  assert.equal(drop('-3.5'), '+3.50%', 'a floor above the price reads as a rise');
  assert.equal(drop(null), null);
});
