import {describe, expect, it} from 'vitest';

import {
  DEFAULT_GROUP_COLOR,
  DEFAULT_TEXT_STYLE,
  defaultStyle,
  fillColor,
  groupStyle,
  groupStyleReset,
  groupStyleUpdate,
  newShapeStyle,
  shapeStyle,
  shapeStyleUpdate,
  textStyle,
} from '@sb/lib/graph/annotation-style';

describe('groupStyle', () => {
  it('uses the default style for legacy groups', () => {
    expect(groupStyle(null)).toEqual({
      fillColor: DEFAULT_GROUP_COLOR,
      fillOpacity: 5,
      borderColor: `${DEFAULT_GROUP_COLOR}66`,
      borderWidth: 1,
      borderStyle: 'solid',
      cornerRadius: 12,
      lineStartArrow: false,
      lineEndArrow: false,
    });
  });

  it('reads the style from the group fields', () => {
    expect(
      groupStyle({
        id: 'g',
        name: 'g',
        level: '1',
        position: {x: 0, y: 0},
        width: 10,
        height: 10,
        backgroundColor: '#ff0000',
        backgroundOpacity: 50,
        borderColor: '#00ff00',
        borderWidth: 3,
        borderStyle: 'dashed',
        borderRadius: 0,
      }),
    ).toMatchObject({
      fillColor: '#ff0000',
      fillOpacity: 50,
      borderColor: '#00ff00',
      borderWidth: 3,
      borderStyle: 'dashed',
      cornerRadius: 0,
    });
  });
});

describe('shapeStyle', () => {
  it('scales the fill opacity to percent', () => {
    expect(
      shapeStyle({
        id: 's',
        shapeType: 'rectangle',
        position: {x: 0, y: 0},
        fillOpacity: 0.123,
      }).fillOpacity,
    ).toBe(12);
  });

  it('fills in defaults for missing fields', () => {
    expect(
      shapeStyle({id: 's', shapeType: 'circle', position: {x: 0, y: 0}}),
    ).toEqual({
      fillColor: 'transparent',
      fillOpacity: 100,
      borderColor: '#c7c8cc',
      borderWidth: 1,
      borderStyle: 'solid',
      cornerRadius: 0,
      lineStartArrow: false,
      lineEndArrow: false,
    });
  });
});

describe('newShapeStyle', () => {
  it('gives lines an end arrow and no fill', () => {
    const style = newShapeStyle('line');
    expect(style.lineEndArrow).toBe(true);
    expect(style.fillColor).toBeUndefined();
  });

  it('rounds the corners of rectangles only', () => {
    expect(newShapeStyle('rectangle').cornerRadius).toBe(8);
    expect(newShapeStyle('circle')).not.toHaveProperty('cornerRadius');
  });
});

describe('defaultStyle', () => {
  it('returns the group style without a shape type', () => {
    expect(defaultStyle()).toEqual(groupStyle(null));
  });

  it('returns the style shapes are drawn with', () => {
    expect(defaultStyle('rectangle')).toMatchObject({
      fillColor: '#5b8def',
      fillOpacity: 12,
      borderWidth: 1.5,
      cornerRadius: 8,
    });
    expect(defaultStyle('line')).toMatchObject({
      fillColor: 'transparent',
      lineEndArrow: true,
    });
  });
});

describe('style updates', () => {
  it('maps the style to the group fields and leaves out unknown ones', () => {
    expect(
      groupStyleUpdate({
        fillColor: '#ff0000',
        fillOpacity: 20,
        cornerRadius: 4,
        lineEndArrow: true,
        borderWidth: undefined,
      }),
    ).toEqual({
      backgroundColor: '#ff0000',
      backgroundOpacity: 20,
      borderRadius: 4,
    });
  });

  it('resets the group fields of the given style fields', () => {
    const reset = groupStyleReset([
      'fillColor',
      'cornerRadius',
      'lineEndArrow',
    ]);
    expect(reset).toEqual({
      backgroundColor: undefined,
      borderRadius: undefined,
    });
    expect(Object.keys(reset)).toEqual(['backgroundColor', 'borderRadius']);
  });

  it('maps the style to the shape fields without undefined fields', () => {
    expect(shapeStyleUpdate({fillOpacity: 50, borderStyle: 'dotted'})).toEqual({
      fillOpacity: 0.5,
      borderStyle: 'dotted',
    });
  });

  it('draws a double border of a shape as a solid one', () => {
    expect(shapeStyleUpdate({borderStyle: 'double'})).toEqual({
      borderStyle: 'solid',
    });
  });
});

describe('fillColor', () => {
  it('mixes the color with transparency', () => {
    expect(fillColor('#ff0000', 40)).toBe(
      'color-mix(in srgb, #ff0000 40%, transparent)',
    );
  });
});

describe('textStyle', () => {
  it('fills in defaults for missing fields', () => {
    expect(textStyle({id: 't', text: '', position: {x: 0, y: 0}})).toEqual(
      DEFAULT_TEXT_STYLE,
    );
  });

  it('keeps the fields a text sets', () => {
    expect(
      textStyle({
        id: 't',
        text: '',
        position: {x: 0, y: 0},
        fontSize: 20,
        textAlign: 'center',
      }),
    ).toMatchObject({fontSize: 20, textAlign: 'center'});
  });
});
