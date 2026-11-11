import { describe, expect, it } from 'vitest';
import { href, isPlainClick, legacyHashTarget, parseLocation, parsePath, stripBase } from '../src/lib/router';

const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('stripBase', () => {
  it('removes the base and normalises slashes', () => {
    expect(stripBase('/UL-Gear-DB/c/shelter', '/UL-Gear-DB/')).toBe('/c/shelter');
    expect(stripBase('/UL-Gear-DB/c/shelter/', '/UL-Gear-DB/')).toBe('/c/shelter');
    expect(stripBase('/UL-Gear-DB/', '/UL-Gear-DB/')).toBe('/');
    expect(stripBase('/UL-Gear-DB', '/UL-Gear-DB/')).toBe('/');
    expect(stripBase('/c/shelter', '/')).toBe('/c/shelter');
    expect(stripBase('/', '/')).toBe('/');
  });

  it('only strips a whole leading segment', () => {
    expect(stripBase('/UL-Gear-DBx/about', '/UL-Gear-DB/')).toBe('/UL-Gear-DBx/about');
  });

  it('accepts the .html files static hosts also serve', () => {
    expect(stripBase('/UL-Gear-DB/about.html', '/UL-Gear-DB/')).toBe('/about');
    expect(stripBase('/item/zpacks-duplex.html', '/')).toBe('/item/zpacks-duplex');
    expect(stripBase('/index.html', '/')).toBe('/');
  });
});

describe('parseLocation', () => {
  it('splits the path, query and fragment under a base', () => {
    const r = parseLocation(loc('/UL-Gear-DB/search', '?q=dcf%20tarp', ''), '/UL-Gear-DB/');
    expect(r.path).toEqual(['search']);
    expect(r.query.get('q')).toBe('dcf tarp');
    expect(r.pathname).toBe('/search');
    const s = parseLocation(loc('/UL-Gear-DB/share', '', '#N4IgbiBc+-$'), '/UL-Gear-DB/');
    expect(s.path).toEqual(['share']);
    expect(s.hash).toBe('N4IgbiBc+-$');
  });

  it('decodes segments and survives malformed escapes', () => {
    expect(parseLocation(loc('/item/a%20b'), '/').path).toEqual(['item', 'a b']);
    expect(parseLocation(loc('/item/bad%E0%A4'), '/').path).toEqual(['item', 'bad%E0%A4']);
  });

  it('parsePath reads app paths with query and fragment', () => {
    const r = parsePath('/compare?ids=a,b');
    expect(r.path).toEqual(['compare']);
    expect(r.query.get('ids')).toBe('a,b');
    expect(parsePath('/share#xyz').hash).toBe('xyz');
    expect(parsePath('/').path).toEqual([]);
  });
});

describe('href', () => {
  it('prepends the base', () => {
    expect(href('/c/shelter', '/UL-Gear-DB/')).toBe('/UL-Gear-DB/c/shelter');
    expect(href('/', '/UL-Gear-DB/')).toBe('/UL-Gear-DB/');
    expect(href('/c/shelter', '/')).toBe('/c/shelter');
    expect(href('/', '/')).toBe('/');
    expect(href('lists', '/')).toBe('/lists');
  });

  it('round-trips through parseLocation', () => {
    for (const base of ['/', '/UL-Gear-DB/'])
      for (const p of ['/', '/c/shelter', '/item/zpacks-duplex', '/lists/abc'])
        expect(parseLocation(loc(href(p, base)), base).pathname).toBe(p);
  });
});

describe('legacyHashTarget', () => {
  it('maps old hash routes to paths', () => {
    expect(legacyHashTarget('#/c/shelter')).toBe('/c/shelter');
    expect(legacyHashTarget('#/lists/abc')).toBe('/lists/abc');
    expect(legacyHashTarget('#/compare?ids=a,b')).toBe('/compare?ids=a,b');
    expect(legacyHashTarget('#/search?q=x%20mid')).toBe('/search?q=x%20mid');
    expect(legacyHashTarget('#/')).toBe('/');
  });

  it('moves a share payload into the fragment unchanged', () => {
    const data = 'N4IgbiBcCMA0IDsogLIE8AEAzAlgJwGc+$-';
    expect(legacyHashTarget(`#/share/${data}`)).toBe(`/share#${data}`);
    expect(parsePath(legacyHashTarget(`#/share/${data}`)!).hash).toBe(data);
  });

  it('leaves new-style fragments alone', () => {
    expect(legacyHashTarget('')).toBeNull();
    expect(legacyHashTarget('#')).toBeNull();
    expect(legacyHashTarget('#N4IgbiBcCMA0IDsogLIE8')).toBeNull();
    expect(legacyHashTarget('#coverage')).toBeNull();
  });
});

describe('isPlainClick', () => {
  const e = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  it('is a left click without modifiers', () => {
    expect(isPlainClick(e)).toBe(true);
    expect(isPlainClick({ ...e, button: 1 })).toBe(false);
    expect(isPlainClick({ ...e, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...e, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...e, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...e, altKey: true })).toBe(false);
  });
});
