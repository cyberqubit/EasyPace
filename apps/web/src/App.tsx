import { useEffect, useState } from 'react';
import {
  getMandate, runScenario, askSage, CHECK_LABELS,
  type Mandate, type ScenarioName, type VerifyOutcome,
} from './api';
import { speak, stopSpeaking, speechSupported, listen, sttSupported } from './speech';

interface Action { name: ScenarioName; label: string; hint: string }

const ACTIONS: Action[] = [
  { name: 'approved', label: '💊  Pay my prescription', hint: '$32 at Sunrise Pharmacy' },
  { name: 'scam-merchant', label: '📞  Pay the “CRA” $40 in gift cards', hint: 'A scam caller threatening arrest' },
  { name: 'over-limit', label: '🛒  Pay the pharmacy $200', hint: 'Above the limit you set' },
  { name: 'expired', label: '📅  Use last month’s approval', hint: 'An old, expired permission' },
  { name: 'impostor', label: '🕵️  A fake agent tries to pay', hint: 'A forged permission' },
];

interface Display {
  sageSays: string;
  outcome?: 'approved' | 'blocked';
  verify?: VerifyOutcome;
  transcript?: string;
}

export function App() {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [offline, setOffline] = useState(false);
  const [readAloud, setReadAloud] = useState(speechSupported);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [display, setDisplay] = useState<Display | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMandate().then(setMandate).catch(() => setError('Could not reach Sage. Is the verifier running?'));
  }, []);

  function show(d: Display) {
    setDisplay(d);
    if (readAloud) speak(d.sageSays);
  }

  async function handleScenario(name: ScenarioName) {
    setBusy(true); setError(null); stopSpeaking();
    try {
      const r = await runScenario(name, offline);
      show({ sageSays: r.sageSays, outcome: r.outcome, verify: r.result });
    } catch { setError('Something didn’t work — let’s try again.'); }
    finally { setBusy(false); }
  }

  async function handleTalk() {
    setError(null); stopSpeaking(); setDisplay(null); setListening(true);
    let transcript = '';
    try {
      transcript = await listen();
    } catch (e) {
      setListening(false);
      const code = e instanceof Error ? e.message : '';
      setError(code === 'not-supported'
        ? 'Voice input isn’t available in this browser — try Chrome, or tap an example below.'
        : 'I didn’t hear anything — please tap “Talk to Sage” and speak.');
      return;
    }
    setListening(false); setBusy(true);
    try {
      const r = await askSage(transcript, offline);
      show({ sageSays: r.sageSays, outcome: r.outcome, verify: r.result, transcript });
    } catch { setError('Something didn’t work — let’s try again.'); }
    finally { setBusy(false); }
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
          <input type="checkbox" checked={readAloud} disabled={!speechSupported}
            onChange={(e) => { setReadAloud(e.target.checked); if (!e.target.checked) stopSpeaking(); }} />
          <span>🔊 Read aloud</span>
        </label>
      </header>

      {mandate && (
        <section className="mandate" aria-label="Your standing permission">
          <h2>What you’ve allowed Sage to do</h2>
          <p className="mandate-plain">{mandate.plain}</p>
          <ul className="merchants">
            {mandate.approvedMerchants.map((m) => <li key={m.id}>✅ {m.label}</li>)}
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

        <button className="mic" onClick={handleTalk} disabled={busy || listening} aria-busy={listening}>
          <span className="mic-icon" aria-hidden="true">🎤</span>
          <span>{listening ? 'Listening… say what you need' : 'Talk to Sage'}</span>
        </button>
        {!sttSupported && <p className="note">Tip: voice works best in Chrome. You can also tap an example below.</p>}

        <div aria-live="polite">
          {display?.transcript && <p className="said">You said: “{display.transcript}”</p>}
          {display && <ResultCard d={display} />}
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <p className="examples-label">…or tap an example</p>
        <div className="actions">
          {ACTIONS.map((a) => (
            <button key={a.name} className="action" onClick={() => handleScenario(a.name)} disabled={busy || listening}>
              <span className="action-label">{a.label}</span>
              <span className="action-hint">{a.hint}</span>
            </button>
          ))}
        </div>
      </main>

      <footer className="footer">
        <p>Sage checks every payment against limits you signed — and keeps protecting you even when servers go down.</p>
        <p className="powered">
          <a href="https://www.agnic.ai" target="_blank" rel="noopener noreferrer">⚡ Powered by Agnic</a>
        </p>
      </footer>
    </div>
  );
}

function ResultCard({ d }: { d: Display }) {
  const approved = d.outcome === 'approved';
  const klass = d.outcome ? (approved ? 'card-ok' : 'card-block') : 'card-info';
  return (
    <article className={`card ${klass}`}>
      <div className="card-top">
        <span className="card-icon" aria-hidden="true">{d.outcome ? (approved ? '✅' : '🛑') : '💬'}</span>
        <div>
          {d.outcome && <p className="card-status">{approved ? 'Approved' : 'Blocked'}</p>}
          <p className="card-said">“{d.sageSays}”</p>
        </div>
      </div>

      {d.verify && (
        <details className="why">
          <summary>Why? (for the curious)</summary>
          <p className="why-reason"><strong>{d.verify.reasonText}</strong></p>
          <ul className="checks">
            {(Object.keys(CHECK_LABELS) as (keyof typeof CHECK_LABELS)[]).map((k) => (
              <li key={k} className={d.verify!.checks[k] ? 'pass' : 'fail'}>
                {d.verify!.checks[k] ? '✓' : '✕'} {CHECK_LABELS[k]}
              </li>
            ))}
          </ul>
          <p className="meta">
            Verified {d.verify.offline ? 'OFFLINE (issuer not contacted)' : 'online'} · code: <code>{d.verify.reasonCode}</code>
          </p>
        </details>
      )}
    </article>
  );
}
