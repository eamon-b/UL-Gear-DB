import { useStore } from '../lib/store';
import { href } from '../lib/router';
import { groupCategories } from './BrowsePage';

export function AboutPage() {
  const { db } = useStore();
  const conf = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const it of db.items) conf[it.confidence]++;
  const brands = new Set(db.items.map((i) => i.brand)).size;
  return (
    <div className="page about">
      <h1>About UL Gear DB</h1>
      <p>
        An open, static database of ultralight backpacking gear with tools to compare it and build pack lists. Everything runs in your
        browser: there is no account and no server, and your lists stay in localStorage unless you share them.
      </p>
      {db.sample && (
        <p className="warn">
          You are looking at the built-in sample fixture (<code>data/raw/_sample.json</code>). Real data files have not been added yet.
        </p>
      )}

      <div className="about-stats">
        <div>
          <div className="stat-v">{db.items.length.toLocaleString()}</div>
          <div className="stat-l">items</div>
        </div>
        <div>
          <div className="stat-v">{brands}</div>
          <div className="stat-l">brands</div>
        </div>
        <div>
          <div className="stat-v">{db.categories.filter((c) => c.count).length}</div>
          <div className="stat-l">categories</div>
        </div>
        <div>
          <div className="stat-v small">{new Date(db.generated_at).toLocaleDateString()}</div>
          <div className="stat-l">data built</div>
        </div>
      </div>

      <h2>Disclaimer</h2>
      <p className="warn-box">
        Weights are <strong>manufacturer claims</strong> unless marked otherwise (<sup>m</sup> measured, <sup>e</sup> estimate) and often
        differ from what lands on your scale. Prices are list/MSRP in USD and change often. Always check the linked source before buying.
        Nothing here is affiliated with any brand.
      </p>

      <h2>Data sources</h2>
      <p>
        Each entry links to its source, usually the manufacturer product page. Data was compiled from manufacturer spec sheets and product
        pages, with some values recalled from widely published specs. Each item records what its weight includes (<em>weight note</em>) when
        known.
      </p>

      <h2>Confidence levels</h2>
      <table className="kv">
        <tbody>
          <tr>
            <th>
              <span className="conf conf-high">H</span> High
            </th>
            <td>Checked against a source when the entry was written ({conf.high} items).</td>
          </tr>
          <tr>
            <th>
              <span className="conf conf-medium">M</span> Medium
            </th>
            <td>Recalled from published specs and believed current, but not re-checked ({conf.medium} items).</td>
          </tr>
          <tr>
            <th>
              <span className="conf conf-low">L</span> Low
            </th>
            <td>Uncertain: may be outdated, approximate, or for a different variant ({conf.low} items).</td>
          </tr>
        </tbody>
      </table>

      <h2>Items per category</h2>
      <div className="about-counts">
        {groupCategories(db.categories).map((g) => (
          <div key={g.group}>
            <h3>{g.group}</h3>
            <table className="kv">
              <tbody>
                {g.cats.map((c) => (
                  <tr key={c.id}>
                    <th>
                      <a href={href(`/c/${c.id}`)}>{c.name}</a>
                    </th>
                    <td className="num">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <h2>How to contribute</h2>
      <ol>
        <li>
          Fork the repository and edit or add items in <code>data/raw/&lt;category&gt;.json</code> (one JSON array per category).
        </li>
        <li>
          Follow <code>data/SCHEMA.md</code>: kebab-case unique <code>id</code>, a valid <code>category</code>/<code>subcategory</code> from{' '}
          <code>data/categories.json</code>, integer <code>weight_g</code>, <code>price_usd</code> or <code>null</code>, a source{' '}
          <code>url</code>, and an honest <code>confidence</code>.
        </li>
        <li>
          Run <code>npm run data</code>. It validates every file, fixes small problems, and prints dropped items and duplicate ids. Check{' '}
          <code>data/report.json</code>.
        </li>
        <li>
          Open a pull request with a link to your source. Measured weights are very welcome: set <code>weight_basis</code> to{' '}
          <code>"measured"</code> and describe what was weighed in <code>weight_note</code>.
        </li>
      </ol>

      <h2>Tips</h2>
      <ul>
        <li>
          <strong>★ Pareto frontier</strong>: items where nothing in the current filter is both lighter and cheaper.
        </li>
        <li>
          <strong>g/$</strong> in Browse: grams saved per extra dollar versus the cheapest item in view. In Alternatives it becomes{' '}
          <strong>$/oz saved</strong> versus your current item.
        </li>
        <li>
          Press <kbd>/</kbd> to search everything. Lists import from and export to LighterPack CSV.
        </li>
      </ul>
    </div>
  );
}
