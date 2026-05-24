import { useEffect, useState } from 'react';
import {
  getMandate, runScenario, askSage, getModels, CHECK_LABELS,
  authMe, signInUrl, logout, captureSession,
  type ScenarioName, type VerifyOutcome, type Me, type Scope, type ModelOption,
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

const PROVIDERS = [
  { id: 'sunrise-pharmacy', label: 'Sunrise Pharmacy', category: 'pharmacy' },
  { id: 'fresh-grocer', label: 'Fresh Grocer', category: 'grocery' },
  { id: 'city-hydro', label: 'City Hydro (utility bill)', category: 'utility' },
];
const labelFor = (id: string) => PROVIDERS.find((p) => p.id === id)?.label ?? id;
const categoriesFor = (whitelist: string[]) =>
  [...new Set(whitelist.map((id) => PROVIDERS.find((p) => p.id === id)?.category).filter(Boolean) as string[])];

interface Display {
  sageSays: string;
  outcome?: 'approved' | 'blocked';
  verify?: VerifyOutcome;
  transcript?: string;
}

export function App() {
  const [scope, setScope] = useState<Scope | null>(null);
  const [offline, setOffline] = useState(false);
  const [readAloud, setReadAloud] = useState(speechSupported);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [display, setDisplay] = useState<Display | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string>('');

  useEffect(() => {
    getMandate().then((m) => setScope(m.scope)).catch(() => setError('Could not reach Sage. Is the verifier running?'));
    getModels().then((d) => { setModels(d.models); setModel(d.default); }).catch(() => {});
    captureSession();
    authMe().then(setMe).catch(() => setMe({ signedIn: false }));
    const authErr = new URLSearchParams(location.search).get('auth_error');
    if (authErr) setError('Sign-in isn’t available yet (the Agnic app is pending approval).');
  }, []);

  async function handleSignOut() {
    await logout();
    setMe({ signedIn: false });
  }

  function show(d: Display) {
    setDisplay(d);
    if (readAloud) speak(d.sageSays);
  }

  async function handleScenario(name: ScenarioName) {
    setBusy(true); setError(null); stopSpeaking();
    try {
      const r = await runScenario(name, offline, scope ?? undefined);
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
      const r = await askSage(transcript, offline, scope ?? undefined, model || undefined);
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
        <div className="header-right">
          <label className="toggle">
            <input type="checkbox" checked={readAloud} disabled={!speechSupported}
              onChange={(e) => { setReadAloud(e.target.checked); if (!e.target.checked) stopSpeaking(); }} />
            <span>🔊 Read aloud</span>
          </label>
          {me?.signedIn ? (
            <div className="account">
              <span className="balance" title="Your Agnic wallet">💳 ${me.balance?.totalBalance ?? me.balance?.usdcBalance ?? '—'}</span>
              <button className="ghost small" onClick={handleSignOut}>Sign out</button>
            </div>
          ) : (
            <a className="signin" href={signInUrl()}>Sign in with Agnic</a>
          )}
        </div>
      </header>

      {scope && (
        <section className="mandate" aria-label="Your standing permission">
          <h2>What you’ve allowed Sage to do</h2>
          <p className="mandate-plain">
            Sage may spend up to <strong>${scope.max_per_tx.value} {scope.max_per_tx.currency}</strong> per purchase, only at your approved places.
          </p>
          <ul className="merchants">
            {scope.merchant_whitelist.length === 0 && <li>⚠️ No approved places yet</li>}
            {scope.merchant_whitelist.map((id) => <li key={id}>✅ {labelFor(id)}</li>)}
          </ul>

          <details className="setup">
            <summary>⚙️ Change permissions (family controls)</summary>
            <div className="setup-body">
              <label className="field">
                <span>Spend up to, per purchase</span>
                <span className="money">$
                  <input type="number" min="0" step="1" value={scope.max_per_tx.value}
                    onChange={(e) => setScope({ ...scope, max_per_tx: { ...scope.max_per_tx, value: e.target.value || '0' } })} /> CAD
                </span>
              </label>
              <fieldset className="field">
                <legend>Approved places</legend>
                {PROVIDERS.map((p) => (
                  <label key={p.id} className="provider">
                    <input type="checkbox" checked={scope.merchant_whitelist.includes(p.id)}
                      onChange={(e) => {
                        const wl = e.target.checked
                          ? [...scope.merchant_whitelist, p.id]
                          : scope.merchant_whitelist.filter((m) => m !== p.id);
                        setScope({ ...scope, merchant_whitelist: wl, categories: categoriesFor(wl) });
                      }} />
                    <span>{p.label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="setup-note">Change these, then try a request — Sage obeys instantly.</p>
            </div>
          </details>
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

        <button className="mic" onClick={handleTalk} disabled={busy || listening} aria-busy={listening || busy}>
          <span className="mic-icon" aria-hidden="true">{busy && !listening ? '⏳' : '🎤'}</span>
          <span>{listening ? 'Listening… say what you need' : busy ? 'Sage is thinking…' : 'Talk to Sage'}</span>
        </button>
        {!sttSupported && <p className="note">Tip: voice works best in Chrome. You can also tap an example below.</p>}

        {models.length > 1 && (
          <details className="advanced">
            <summary>⚙️ Advanced: choose Sage’s AI model</summary>
            <label className="model-row">
              <span>AI model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <p className="setup-note">The recommended model is safest for everyday help. Powered by Agnic’s gateway.</p>
          </details>
        )}

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
