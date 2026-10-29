import type { NightDigest } from '../digest/types.js';
import type { Lane } from '../lane.js';
import { Layout } from './layout.js';

export function DigestPage(props: { digest: NightDigest; lane: Lane }) {
  const { digest } = props;
  return (
    <Layout title={`digest · ${digest.night}`} lane={props.lane}>
      <h1>Night digest · {digest.night}</h1>
      <p>{digest.badLines} malformed {digest.badLines === 1 ? 'line' : 'lines'} skipped.</p>
      {digest.rows.length === 0 ? (
        <p>nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th><th>owner</th><th>runs</th><th>retries</th>
              <th>last status</th><th>last error</th><th>first timestamp</th><th>last timestamp</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => {
              const warn = row.retries >= 3 || row.lastStatus === 'fail';
              return (
                <tr>
                  <td>{row.job}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td class={row.retries >= 3 ? 'warn' : undefined}>{row.retries}</td>
                  <td class={row.lastStatus === 'fail' ? 'warn' : undefined}>{row.lastStatus}</td>
                  <td class={warn ? 'warn' : undefined}>{row.lastError ?? '—'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
