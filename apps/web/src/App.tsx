import { useEffect, useState } from 'react';
import { getMandate, runScenario, CHECK_LABELS, type Mandate, type ScenarioName, type ScenarioResult } from './api';
import { speak, stopSpeaking, speechSupported } from './speech';

interface Action {
  name: ScenarioName;
  label: string;
  hint: string;
}

const ACTIONS: Action[] = [
  { name: 'approved', label: '💊  Pay my prescription', hint: '$32 at Sunrise Pharmacy' },
  { name: 'scam-merchant', label: '📞  Pay the “CRA” $40 in gift cards', hint: 'A scam caller threatening arrest' },
  { name: 'over-limit', label: '🛒  Pay the pharmacy $200', hint: 'Above the limit you set' },
  { name: 'expired', label: '📅  Use last month’s approval', hint: 'An old, expired permission' },
  { name: 'impostor', label: '🕵️  A fake agent tries to pay', hint: 'A forged permission' },
];

export function App() {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [offline, setOffline] = useState(false);
  const [readAloud, setReadAloud] = useState(speechSupported);
  const [busy, setBusy] = useState<ScenarioName | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMandate().then(setMandate).catch(() => setError('Could not reach Sage. Is the verifier running?'));
  }, []);

  async function handle(name: ScenarioName) {
    setBusy(name);
    setError(null);
    stopSpeaking();
    try {
      const r = await runScenario(name, offline);
      setResult(r);
      if (readAloud) speak(r.sageSays);
    } catch {
      setError('Something didn’t work — let’s try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">🌿</span>
          <div>
            <h1>EasyPace</h1>
            <p className="tagline">Meet <strong>Sage</strong> — your helper that pays and books, safely.</p>
          </div>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={readAloud}
            disabled={!speechSupported}
            onChange={(e) => { setReadAloud(e.target.checked); if (!e.target.checked) stopSpeaking(); }}
          />
          <span>🔊 Read aloud</span>
        </label>
      </header>

      {mandate && (
        <section className="mandate" aria-label="Your standing permission">
          <h2>What you’ve allowed Sage to do</h2>
          <p className="mandate-plain">{mandate.plain}</p>
          <ul className="merchants">
            {mandate.approvedMerchants.map((m) => (
              <li key={m.id}>✅ {m.label}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="issuer-bar" aria-label="Issuer server status">
        <span className={`dot ${offline ? 'dot-off' : 'dot-on'}`} aria-hidden="true" />
        <span className="issuer-text">
          Authorization server is <strong>{offline ? 'OFFLINE' : 'online'}</strong>
          {offline && ' — Sage is verifying from its cached copy'}
        </span>
        <button className="ghost" onClick={() => setOffline((v) => !v)}>
          {offline ? 'Bring server back online' : 'Simulate server outage'}
        </button>
      </section>

      <main>
        <h2 className="ask">What do you need, Margaret?</h2>
        <div className="actions">
          {ACTIONS.map((a) => (
            <button
              key={a.name}
              className="action"
              onClick={() => handle(a.name)}
              disabled={busy !== null}
              aria-busy={busy === a.name}
            >
              <span className="action-label">{a.label}</span>
              <span className="action-hint">{a.hint}</span>
              {busy === a.name && <span className="action-working">Sage is checking…</span>}
            </button>
          ))}
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div aria-live="polite">
          {result && <ResultCard result={result} />}
        </div>
      </main>

      <footer className="footer">
        <p>Sage checks every payment against limits you signed — and keeps protecting you even when servers go down.</p>
      </footer>
    </div>
  );
}

function ResultCard({ result }: { result: ScenarioResult }) {
  const approved = result.outcome === 'approved';
  const { result: v } = result;
  return (
    <article className={`card ${approved ? 'card-ok' : 'card-block'}`}>
      <div className="card-top">
        <span className="card-icon" aria-hidden="true">{approved ? '✅' : '🛑'}</span>
        <div>
          <p className="card-status">{approved ? 'Approved' : 'Blocked'}</p>
          <p className="card-said">“{result.sageSays}”</p>
        </div>
      </div>

      <details className="why">
        <summary>Why? (for the curious)</summary>
        <p className="why-reason"><strong>{v.reasonText}</strong></p>
        <ul className="checks">
          {(Object.keys(CHECK_LABELS) as (keyof typeof CHECK_LABELS)[]).map((k) => (
            <li key={k} className={v.checks[k] ? 'pass' : 'fail'}>
              {v.checks[k] ? '✓' : '✕'} {CHECK_LABELS[k]}
            </li>
          ))}
        </ul>
        <p className="meta">
          Verified {v.offline ? 'OFFLINE (issuer not contacted)' : 'online'} · code: <code>{v.reasonCode}</code>
        </p>
      </details>
    </article>
  );
}
