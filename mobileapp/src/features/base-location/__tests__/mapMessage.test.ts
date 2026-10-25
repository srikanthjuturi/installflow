import { parseMapMessage } from '@/features/base-location/map/mapMessage';

describe('parseMapMessage', () => {
  it('reads ready', () => {
    expect(parseMapMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
  });

  it('reads moved and rounds to 5 decimal places', () => {
    expect(parseMapMessage('{"type":"moved","lat":17.4401234,"lng":78.35631987}')).toEqual({
      type: 'moved',
      lat: 17.44012,
      lng: 78.35632,
    });
  });

  it.each([
    ['strings', '{"type":"moved","lat":"17.4","lng":"78.3"}'],
    ['a missing coordinate', '{"type":"moved","lat":17.4}'],
    ['null coordinates', '{"type":"moved","lat":null,"lng":null}'],
    ['latitude 91', '{"type":"moved","lat":91,"lng":78}'],
    ['longitude -181', '{"type":"moved","lat":17,"lng":-181}'],
  ])('refuses moved with %s', (_label, raw) => {
    expect(parseMapMessage(raw)).toBeNull();
  });

  it('refuses NaN and Infinity, however they arrive', () => {
    expect(parseMapMessage('{"type":"moved","lat":NaN,"lng":78}')).toBeNull();
    expect(parseMapMessage('{"type":"moved","lat":Infinity,"lng":78}')).toBeNull();
    // JSON.stringify turns both into null.
    expect(parseMapMessage(JSON.stringify({ type: 'moved', lat: NaN, lng: Infinity }))).toBeNull();
  });

  it('reads failed for the two known reasons only', () => {
    expect(parseMapMessage('{"type":"failed","reason":"leaflet"}')).toEqual({
      type: 'failed',
      reason: 'leaflet',
    });
    expect(parseMapMessage('{"type":"failed","reason":"tiles"}')).toEqual({
      type: 'failed',
      reason: 'tiles',
    });
    expect(parseMapMessage('{"type":"failed","reason":"other"}')).toBeNull();
    expect(parseMapMessage('{"type":"failed"}')).toBeNull();
  });

  it.each([
    ['an unknown type', '{"type":"hello"}'],
    ['no type', '{"lat":1,"lng":2}'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '42'],
    ['plain text', 'not json'],
    ['an empty string', ''],
    ['a prototype key', '{"type":"__proto__"}'],
  ])('ignores %s', (_label, raw) => {
    expect(parseMapMessage(raw)).toBeNull();
  });

  it('parses a point outside India but on the globe: India is the screen check, not this one', () => {
    expect(parseMapMessage('{"type":"moved","lat":51.5,"lng":-0.12}')).toEqual({
      type: 'moved',
      lat: 51.5,
      lng: -0.12,
    });
  });
});
