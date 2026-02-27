// @ts-nocheck
import { useState } from "react";

const GOOGLE_CLIENT_ID = '465534058429-asiprc469vca1kccb77bv8nst0okd0uo.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'openid email profile https://www.googleapis.com/auth/gmail.send';

async function sendGmail(accessToken, toEmail, subject, body) {
  const raw = [`To: ${toEmail}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '', body].join('\r\n');
  const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Gmail send failed'); }
}

async function callClaude(messages, systemPrompt) {
  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: systemPrompt, messages }),
  });
  const data = await response.json();
  if (!data.content) throw new Error(JSON.stringify(data));
  const raw = data.content.map(b => b.text || '').join('').replace(/```json\n?|```/g, '').trim();
  // Fix newlines inside JSON strings
  const fixed = raw.replace(/\n/g, '\\n').replace(/\r/g, '');
  try { JSON.parse(fixed); return fixed; } catch(e) { return raw; }
}

const stageConfig = {
  initial:   { label: 'Cold Email',   color: '#7c3aed', bg: '#ede9fe', icon: '✦' },
  followup1: { label: 'Follow-up #1', color: '#a855f7', bg: '#f3e8ff', icon: '◆' },
  followup2: { label: 'Follow-up #2', color: '#ec4899', bg: '#fce7f3', icon: '◎' },
};

const MOCK_CAMPAIGNS = [
  { name: 'SaaS Founders Q1', leads: 48, replied: 12, meetings: 4,  rate: 25, status: 'Active' },
  { name: 'E-comm Directors', leads: 32, replied: 8,  meetings: 2,  rate: 25, status: 'Active' },
  { name: 'HR Tech Outreach', leads: 61, replied: 19, meetings: 7,  rate: 31, status: 'Done'   },
];

export default function App() {
  const [view, setView]       = useState('landing');
  const [appPage, setAppPage] = useState('dashboard');
  const [user, setUser]       = useState(null);
  const [offer, setOffer]     = useState('');
  const [icp, setIcp]         = useState('');
  const [emails, setEmails]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage]     = useState(0);
  const [copied, setCopied]   = useState(null);
  const [sent, setSent]       = useState({});
  const [error, setError]     = useState(null);
  const [leads, setLeads]       = useState([]); // [{ name, email, company }]
  const [sendingAll, setSendingAll] = useState(false);
  const [sentLeads, setSentLeads] = useState({});
  const [sentPhase, setSentPhase] = useState(0);
  const [editingIdx, setEditingIdx] = useState(null); // 0=none, 1=cold sent, 2=fu1 sent, 3=fu2 sent

  function signIn() {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: 'https://closr-pdop.vercel.app',
      response_type: 'token',
      scope: GOOGLE_SCOPES,
      prompt: 'select_account',
    });
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
    const popup = window.open(url, 'google-auth', 'width=500,height=600,left=200,top=100');
    if (!popup) { alert('Please allow popups for this site'); return; }
    const timer = setInterval(async () => {
      try {
        if (popup.closed) { clearInterval(timer); return; }
        const hash = new URLSearchParams(popup.location.hash.slice(1));
        const token = hash.get('access_token');
        if (token) {
          clearInterval(timer);
          popup.close();
          const profile = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.json());
          setUser({ name: profile.name, email: profile.email, picture: profile.picture, accessToken: token });
          setView('app');
          setAppPage('dashboard');
        }
      } catch (e) {
        if (popup.closed) clearInterval(timer);
      }
    }, 500);
  }

  function signOut() { setUser(null); setView('landing'); setEmails([]); setSent({}); setLeads([]); setSentLeads({}); setSentPhase(0); }

  function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return {
        name: obj.name || obj['first name'] || obj.firstname || '',
        email: obj.email || obj['email address'] || '',
        company: obj.company || obj.organization || obj.account || '',
      };
    }).filter(l => l.email.includes('@'));
  }

  function handleCSVUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      setLeads(parsed);
      setSentLeads({});
    };
    reader.readAsText(file);
  }

  function personalize(text, lead) {
    let t = text;
    if (lead.name) {
      t = t.replace(/\[First Name\]|\[Name\]|\[Founder'?s? Name\]/gi, lead.name);
      t = t.replace(/^Hey,/m, 'Hey ' + lead.name + ',');
      t = t.replace(/^Hi,/m, 'Hi ' + lead.name + ',');
    }
    if (lead.company) {
      t = t.replace(/\[Company\]|\[company name\]|\[Organization\]/gi, lead.company);
    }
    return t;
  }

  async function handleSendPhase(phaseIdx) {
    if (!user?.accessToken || !emails.length || !leads.length) return;
    const email = emails[phaseIdx];
    if (!email) return;
    setSendingAll(true);
    const results = { ...sentLeads };
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      try {
        await sendGmail(
          user.accessToken,
          lead.email,
          personalize(email.subject, lead),
          personalize(email.body, lead)
        );
        results[`${phaseIdx}-${i}`] = 'sent';
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        results[`${phaseIdx}-${i}`] = 'error';
      }
      setSentLeads({ ...results });
    }
    setSentPhase(phaseIdx + 1);
    setSendingAll(false);
  }

  async function handleSendAll() {
    await handleSendPhase(0);
  }

  const sp = () => `You are writing cold outbound emails for B2B founders.
Your goal is to start a simple, natural conversation that gets a reply.

Context about the sender: "${offer}"
Who they are reaching: "${icp}"

CORE PRINCIPLE: Feel like a real person asking a quick question, not a sales email.

EMAIL 1: 2-3 lines max. One question about how they currently handle something relevant. No pitch, no product mention, no benefits, no "we help", no "we built".
FOLLOW-UP 1: Reference a pattern from talking to similar founders. Short, casual, different angle. No guilt.
FOLLOW-UP 2: Name the problem plainly. Hint you have something related. End casually like "happy to share if useful".

NEVER use dashes. Return ONLY raw JSON: {"subject":"...","body":"..."}`;

  async function runOutreach() {
    setEmails([]); setStage(0); setLoading(true); setError(null); setSent({});
    const all = [];
    try {
      const cold = JSON.parse(await callClaude([{ role: 'user', content: `Write a cold outbound email to someone matching: ${icp}` }], sp()));
      all.push({ stage: 'initial', from: 'you', ...cold }); setEmails([...all]); setStage(1);

      const fu1 = JSON.parse(await callClaude([
        { role: 'user',      content: `Write cold email to: ${icp}` },
        { role: 'assistant', content: JSON.stringify(cold) },
        { role: 'user',      content: `3 days, no reply. Follow-up #1. Different angle. Casual.` },
      ], sp()));
      all.push({ stage: 'followup1', from: 'you', ...fu1 }); setEmails([...all]); setStage(2);

      const fu2 = JSON.parse(await callClaude([{ role: 'user', content: `Final follow-up day 7. Direct, friendly, different hook.` }], sp()));
      all.push({ stage: 'followup2', from: 'you', ...fu2 }); setEmails([...all]); setStage(3);
    } catch (e) { setError('Something went wrong: ' + e.message); }
    setLoading(false);
  }

  async function handleSendGmail(email, idx) {
    // kept for compatibility but sending is now done via handleSendAll
  }

  function copy(body, idx) {
    navigator.clipboard.writeText(body);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  }

  if (view === 'landing') return <Landing onStart={signIn} />;

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f9fafb', fontFamily: "'Inter',sans-serif", overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .fu{animation:fadeUp .3s ease forwards;}
        textarea:focus{outline:none;border-color:#7c3aed!important;box-shadow:0 0 0 3px rgba(124,58,237,.1);}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:#e5e7eb;border-radius:4px;}
        button:hover{opacity:.85;} button:active{transform:scale(.98);}
      `}</style>

      <aside style={{ width: 220, background: '#fff', borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', padding: '20px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 20px 28px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14 }}>C</div>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px' }}>
            <span style={{ color: '#111827' }}>Clos</span><span style={{ color: '#7c3aed' }}>r</span>
          </span>
        </div>
        <div style={{ padding: '0 12px 8px' }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 8px 8px' }}>Workspace</p>
          {[
            { id: 'dashboard', label: 'Dashboard',       icon: '▦' },
            { id: 'campaign',  label: 'Launch Outbound', icon: '✦' },
            { id: 'sequences', label: 'Sequences',       icon: '◆' },
            { id: 'leads',     label: 'Leads',           icon: '◎' },
          ].map(item => (
            <button key={item.id} onClick={() => setAppPage(item.id)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
              borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500, marginBottom: 2,
              background: appPage === item.id ? '#f5f3ff' : 'transparent',
              color:      appPage === item.id ? '#7c3aed' : '#6b7280',
              transition: 'all .15s',
            }}>
              <span style={{ fontSize: 12, opacity: .8 }}>{item.icon}</span> {item.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid #f3f4f6' }}>
          {user ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                {user.picture
                  ? <img src={user.picture} alt="" referrerPolicy="no-referrer" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{user.name?.[0]}</div>
                }
                <div style={{ overflow: 'hidden', minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</p>
                  <p style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</p>
                </div>
              </div>
              <button onClick={signOut} style={{ width: '100%', padding: '7px 0', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', fontSize: 11, color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Sign out</button>
            </div>
          ) : (
            <button onClick={signIn} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '9px 0', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}>
              <GoogleIcon size={14} /> Sign in with Google
            </button>
          )}
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ height: 56, background: '#fff', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', flexShrink: 0 }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
            {{ dashboard: 'Dashboard', campaign: 'Launch Outbound', sequences: 'Sequences', leads: 'Leads' }[appPage]}
          </h1>
          <button onClick={() => setView('landing')} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 13, fontWeight: 500, color: '#374151', cursor: 'pointer' }}>Home</button>
        </header>
        <main style={{ flex: 1, overflow: 'auto', padding: 32 }}>
          {appPage === 'dashboard' && <Dashboard onLaunch={() => setAppPage('campaign')} />}
          {appPage === 'campaign'  && <Campaign offer={offer} setOffer={setOffer} icp={icp} setIcp={setIcp} emails={emails} loading={loading} stage={stage} error={error} copied={copied} sent={sent} sending={null} user={user} onSignIn={signIn} onRun={runOutreach} onCopy={copy} onSendGmail={handleSendGmail} leads={leads} onCSVUpload={handleCSVUpload} onSendAll={handleSendAll} sendingAll={sendingAll} sentLeads={sentLeads} sentPhase={sentPhase} onSendPhase={handleSendPhase} editingIdx={editingIdx} setEditingIdx={setEditingIdx} onEditEmail={(idx, field, val) => { const updated = [...emails]; updated[idx] = { ...updated[idx], [field]: val }; setEmails(updated); }} />}
          {appPage === 'sequences' && <Placeholder icon="◆" title="Active Sequences" desc="Your running outreach sequences will appear here." />}
          {appPage === 'leads'     && <Placeholder icon="◎" title="Your Leads"       desc="Everyone we're reaching out to on your behalf lives here." />}
        </main>
      </div>
    </div>
  );
}

function GoogleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function Dashboard({ onLaunch }) {
  const stats = [
    { label: 'Interested Leads',      value: '141', icon: '◎', color: '#7c3aed', bg: '#ede9fe' },
    { label: 'Conversations Started', value: '423', icon: '◆', color: '#a855f7', bg: '#f3e8ff' },
    { label: 'Replies',               value: '39',  icon: '◎', color: '#10b981', bg: '#d1fae5' },
    { label: 'Meetings Booked',       value: '13',  icon: '★', color: '#f59e0b', bg: '#fef3c7' },
  ];
  return (
    <div className="fu">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', border: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 14, color: '#6b7280', fontWeight: 500 }}>{s.label}</span>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, fontSize: 16 }}>{s.icon}</div>
            </div>
            <p style={{ fontSize: 32, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{s.value}</p>
            <p style={{ fontSize: 12, color: '#10b981', marginTop: 6, fontWeight: 500 }}>+ 12% this week</p>
          </div>
        ))}
      </div>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #f9fafb' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Active Campaigns</h2>
          <button onClick={onLaunch} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Launch</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
              {['Campaign', 'Leads', 'Replied', 'Meetings', 'Reply Rate', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 24px', textAlign: h === 'Campaign' ? 'left' : 'center', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_CAMPAIGNS.map((c, i) => (
              <tr key={i} style={{ borderBottom: i < 2 ? '1px solid #f9fafb' : 'none' }}>
                <td style={{ padding: '16px 24px', fontSize: 14, fontWeight: 500, color: '#111827' }}>{c.name}</td>
                <td style={{ padding: '16px 24px', textAlign: 'center', fontSize: 14, color: '#374151' }}>{c.leads}</td>
                <td style={{ padding: '16px 24px', textAlign: 'center', fontSize: 14, color: '#374151' }}>{c.replied}</td>
                <td style={{ padding: '16px 24px', textAlign: 'center', fontSize: 14, color: '#374151' }}>{c.meetings}</td>
                <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <div style={{ width: 80, height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${c.rate}%`, height: '100%', background: '#7c3aed', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>{c.rate}%</span>
                  </div>
                </td>
                <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                  <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: c.status === 'Active' ? '#d1fae5' : '#f3f4f6', color: c.status === 'Active' ? '#059669' : '#6b7280' }}>
                    {c.status === 'Active' ? '• ' : ''}{c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', borderRadius: 12, padding: '28px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Ready to get more replies?</h3>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.75)' }}>Tell us who to reach. We handle everything from first touch to booked meeting.</p>
        </div>
        <button onClick={onLaunch} style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid rgba(255,255,255,.3)', background: 'rgba(255,255,255,.15)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Launch Outbound →</button>
      </div>
    </div>
  );
}

function Campaign({ offer, setOffer, icp, setIcp, emails, loading, stage, error, copied, sent, sending, user, onSignIn, onRun, onCopy, onSendGmail, leads, onCSVUpload, onSendAll, sendingAll, sentLeads, sentPhase, onSendPhase, editingIdx, setEditingIdx, onEditEmail }) {
  const stageList = ['initial', 'followup1', 'followup2'];
  const canRun = offer.trim() && icp.trim() && !loading;
  return (
    <div className="fu" style={{ maxWidth: 900 }}>
      <div style={{ background: 'linear-gradient(135deg,#f5f3ff,#fdf4ff)', border: '1px solid #ede9fe', borderRadius: 16, padding: '32px 40px', textAlign: 'center', marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', marginBottom: 6 }}>Launch your outbound ✦</h2>
        <p style={{ fontSize: 14, color: '#6b7280' }}>Tell us who to reach and what you offer. We run the outreach, follow up automatically, and bring you replies.</p>
      </div>

      {user && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>✓</span>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#15803d' }}>Gmail connected — emails will send from <strong>{user.email}</strong></p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', padding: 24 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 12 }}>What do you sell?</label>
          <textarea value={offer} onChange={e => setOffer(e.target.value)} rows={5} placeholder="e.g. A B2B SaaS tool that automates payroll for startups under 50 people..." style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#374151', fontFamily: 'inherit', resize: 'vertical', background: '#fafafa' }} />
        </div>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', padding: 24 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 12 }}>Who should we reach?</label>
          <textarea value={icp} onChange={e => setIcp(e.target.value)} rows={5} placeholder="e.g. HR managers or founders at Series A startups in the US, 10–50 employees..." style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#374151', fontFamily: 'inherit', resize: 'vertical', background: '#fafafa' }} />
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', padding: '24px 32px', marginBottom: 24 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'center', marginBottom: 24 }}>Outreach Sequence</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {stageList.map((s, i) => {
            const cfg = stageConfig[s];
            const done = stage > i + 1;
            const active = stage === i + 1;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: done || active ? cfg.bg : '#f9fafb', border: `2px solid ${done || active ? cfg.color + '44' : '#e5e7eb'}`, boxShadow: active ? `0 0 0 4px ${cfg.color}18` : 'none', transition: 'all .4s' }}>{cfg.icon}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: done || active ? cfg.color : '#9ca3af', letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center', maxWidth: 80 }}>{cfg.label}</span>
                </div>
                {i < stageList.length - 1 && <div style={{ width: 48, height: 2, background: stage > i + 1 ? '#7c3aed' : '#e5e7eb', margin: '0 6px', marginBottom: 28, transition: 'all .4s' }} />}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <button onClick={onRun} disabled={!canRun} style={{ padding: '14px 36px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: canRun ? 'pointer' : 'not-allowed', opacity: canRun ? 1 : 0.5, boxShadow: canRun ? '0 4px 14px rgba(124,58,237,.35)' : 'none', transition: 'all .2s' }}>
          {loading ? 'Running outreach…' : 'Start Outreach →'}
        </button>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 18px', fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{error}</div>}

      {emails.map((email, idx) => {
        const cfg = stageConfig[email.stage];
        return (
          <div key={idx} className="fu" style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: cfg.color, background: cfg.bg, padding: '4px 10px', borderRadius: 20 }}>{cfg.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setEditingIdx(editingIdx === idx ? null : idx)} style={{ fontSize: 11, fontWeight: 500, color: editingIdx === idx ? '#7c3aed' : '#6b7280', background: editingIdx === idx ? '#f5f3ff' : '#f9fafb', border: `1px solid ${editingIdx === idx ? '#7c3aed' : '#e5e7eb'}`, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {editingIdx === idx ? '✓ Done' : '✏ Edit'}
                </button>
                <button onClick={() => onCopy(email.body, idx)} style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {copied === idx ? '✓ Copied' : 'Copy'}
                </button>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>Upload CSV below to send</span>
              </div>
            </div>
            {email.subject && (
              editingIdx === idx ? (
                <div style={{ padding: '10px 20px 4px' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Subject:</span>
                  <input
                    value={email.subject}
                    onChange={e => onEditEmail(idx, 'subject', e.target.value)}
                    style={{ width: '100%', marginTop: 4, border: '1px solid #7c3aed', borderRadius: 6, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', color: '#374151' }}
                  />
                </div>
              ) : (
                <div style={{ padding: '10px 20px 4px', fontSize: 12, color: '#9ca3af' }}>Subject: <span style={{ color: '#374151', fontWeight: 500 }}>{email.subject}</span></div>
              )
            )}
            {editingIdx === idx ? (
              <textarea
                value={email.body}
                onChange={e => onEditEmail(idx, 'body', e.target.value)}
                rows={6}
                style={{ width: '100%', padding: '10px 20px', fontSize: 14, lineHeight: 1.8, color: '#374151', border: 'none', borderTop: '1px solid #f3f4f6', resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
              />
            ) : (
              <div style={{ padding: '8px 20px 18px', fontSize: 14, lineHeight: 1.8, color: '#374151', whiteSpace: 'pre-wrap', cursor: 'text' }} onClick={() => setEditingIdx(idx)}>{email.body}</div>
            )}
          </div>
        );
      })}

      {loading && (
        <div style={{ background: '#f9fafb', border: '1px dashed #e5e7eb', borderRadius: 12, padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          {stage === 0 && '→ Writing cold email…'}
          {stage === 1 && '→ Writing follow-up #1…'}
          {stage === 2 && '→ Writing follow-up #2…'}
        </div>
      )}

      {emails.length > 0 && !loading && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', padding: 24, marginTop: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 4 }}>📎 Upload your leads CSV</p>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>CSV should have columns: <strong>name, email, company</strong></p>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 8, border: '2px dashed #e5e7eb', background: '#fafafa', cursor: 'pointer', fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 16 }}>
            📂 Choose CSV file
            <input type="file" accept=".csv" onChange={onCSVUpload} style={{ display: 'none' }} />
          </label>

          {leads.length > 0 && (
            <div>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: 13, color: '#15803d', fontWeight: 500 }}>✓ {leads.length} leads loaded</p>
                <p style={{ fontSize: 12, color: '#6b7280' }}>{Object.values(sentLeads || {}).filter(s => s === 'sent').length} sent</p>
              </div>

              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #f3f4f6', borderRadius: 8, marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      {['Name', 'Email', 'Company', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 12px', fontSize: 13, color: '#374151' }}>{lead.name || '—'}</td>
                        <td style={{ padding: '8px 12px', fontSize: 13, color: '#374151' }}>{lead.email}</td>
                        <td style={{ padding: '8px 12px', fontSize: 13, color: '#374151' }}>{lead.company || '—'}</td>
                        <td style={{ padding: '8px 12px', fontSize: 12 }}>
                          {sentLeads?.[i] === 'sent' ? <span style={{ color: '#059669', fontWeight: 600 }}>✓ Sent</span>
                          : sentLeads?.[i] === 'error' ? <span style={{ color: '#dc2626' }}>✗ Failed</span>
                          : <span style={{ color: '#9ca3af' }}>Pending</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {user ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { idx: 0, label: 'Cold Email',   icon: '✦', color: '#7c3aed' },
                    { idx: 1, label: 'Follow-up #1', icon: '◆', color: '#a855f7' },
                    { idx: 2, label: 'Follow-up #2', icon: '◎', color: '#ec4899' },
                  ].map(({ idx, label, icon, color }) => {
                    const phaseSent = sentPhase > idx;
                    const isNext = sentPhase === idx;
                    const countSent = Object.keys(sentLeads || {}).filter(k => k.startsWith(idx + '-') && sentLeads[k] === 'sent').length;
                    return (
                      <button
                        key={idx}
                        onClick={() => onSendPhase(idx)}
                        disabled={sendingAll || phaseSent || !isNext}
                        style={{
                          width: '100%', padding: '13px 20px', borderRadius: 10, border: 'none',
                          background: phaseSent ? '#f0fdf4' : isNext ? `linear-gradient(135deg,${color},${color}cc)` : '#f9fafb',
                          color: phaseSent ? '#059669' : isNext ? '#fff' : '#9ca3af',
                          fontSize: 14, fontWeight: 700,
                          cursor: (!sendingAll && isNext) ? 'pointer' : 'not-allowed',
                          opacity: sendingAll && isNext ? 0.7 : 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          transition: 'all .2s',
                        }}
                      >
                        <span>{icon} {phaseSent ? `✓ ${label} sent to ${countSent} leads` : isNext ? `Send ${label} to all ${leads.length} leads` : `${label} — send cold email first`}</span>
                        {sendingAll && isNext && <span style={{ fontSize: 12, opacity: 0.8 }}>Sending {countSent + 1} of {leads.length}…</span>}
                        {!phaseSent && isNext && !sendingAll && <span style={{ fontSize: 18 }}>→</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <button onClick={onSignIn} style={{ width: '100%', padding: '14px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', fontSize: 14, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <GoogleIcon size={15} /> Connect Gmail to send
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && emails.length === 3 && (
        <div style={{ background: 'linear-gradient(135deg,#f0fdf4,#eff6ff)', border: '1px solid #bbf7d0', borderRadius: 12, padding: '20px 28px', textAlign: 'center', marginTop: 8 }}>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#059669' }}>Outbound launched. Replies incoming. 🎯</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Your full outreach sequence is live and running.</p>
        </div>
      )}
    </div>
  );
}

function Placeholder({ icon, title, desc }) {
  return (
    <div className="fu" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#7c3aed' }}>{icon}</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{title}</h2>
      <p style={{ fontSize: 14, color: '#9ca3af' }}>{desc}</p>
    </div>
  );
}

function Landing({ onStart }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f8f8fb', fontFamily: "'Inter',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .f0{animation:fadeUp .6s ease forwards;}
        .f1{animation:fadeUp .6s ease .15s forwards;opacity:0;}
        a:hover,button:hover{opacity:.85;}
      `}</style>
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 60px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#7c3aed,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14 }}>C</div>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.5px' }}><span style={{ color: '#111827' }}>Clos</span><span style={{ color: '#7c3aed' }}>r</span></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {['Features', 'Pricing', 'About'].map(item => (
            <a key={item} href="#" style={{ fontSize: 14, fontWeight: 500, color: '#374151', textDecoration: 'none' }}>{item}</a>
          ))}
          <button onClick={onStart} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            <GoogleIcon size={15} /> Continue with Google
          </button>
        </div>
      </nav>
      <section style={{ padding: '80px 60px 60px', display: 'flex', alignItems: 'center', gap: 60, maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ flex: 1 }} className="f0">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '6px 14px', fontSize: 13, color: '#7c3aed', fontWeight: 500, marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} /> Your Outbound, Running 24/7
          </div>
          <h1 style={{ fontSize: 52, fontWeight: 900, lineHeight: 1.1, color: '#111827', marginBottom: 12 }}>
            We run your<br />outbound.<br /><span style={{ color: '#7c3aed' }}>You close the deals.</span>
          </h1>
          <p style={{ fontSize: 16, color: '#6b7280', lineHeight: 1.7, marginBottom: 36, maxWidth: 420 }}>
            Tell us who you want to reach. We handle the outreach, the follow-ups, and the replies. You just show up to the meetings.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button onClick={onStart} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 28px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(124,58,237,.3)' }}>
              <GoogleIcon size={18} /> Get Started with Google
            </button>
            <span style={{ fontSize: 13, color: '#9ca3af' }}>No credit card needed</span>
          </div>
          <div style={{ display: 'flex', gap: 32, marginTop: 36 }}>
            {[['5-step', 'Runs for you'], ['< 60s', 'To go live'], ['3x', 'More replies']].map(([val, lbl]) => (
              <div key={lbl}>
                <p style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{val}</p>
                <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 2 }}>{lbl}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="f1" style={{ flex: 1, background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.08)', overflow: 'hidden', border: '1px solid #f0f0f0' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f9fafb', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginLeft: 'auto' }}>Closr · Live Outbound</span>
          </div>
          {[
            { label: 'Cold Email',        msg: 'Hey Sarah, noticed Acme is scaling fast...',            color: '#7c3aed', bg: '#ede9fe' },
            { label: 'Follow-up #1',      msg: 'Would love to show you the ROI other founders see...',  color: '#a855f7', bg: '#f3e8ff' },
            { label: 'Follow-up #2',      msg: 'Last one from me. If timing is off, totally get it...', color: '#ec4899', bg: '#fce7f3' },
            { label: 'They Replied ✓',    msg: 'Hey, actually looks interesting. Tell me more...',      color: '#10b981', bg: '#d1fae5' },
            { label: 'Meeting Booked 🎉', msg: 'Great! Free Tuesday at 2pm for 20 min?',               color: '#f59e0b', bg: '#fef3c7' },
          ].map((item, i) => (
            <div key={i} style={{ padding: '16px 20px', borderBottom: i < 4 ? '1px solid #f9fafb' : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: item.color, background: item.bg, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{item.label}</span>
              <span style={{ fontSize: 13, color: '#6b7280' }}>{item.msg}</span>
            </div>
          ))}
        </div>
      </section>
      <section style={{ padding: '60px 60px 80px', maxWidth: 1200, margin: '0 auto' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', letterSpacing: '0.15em', textTransform: 'uppercase', textAlign: 'center', marginBottom: 12 }}>What we do for you</p>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: '#111827', textAlign: 'center', marginBottom: 48 }}>Your outbound runs. You just close.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
          {[
            { icon: '✦', color: '#7c3aed', bg: '#ede9fe', title: 'We run your outreach',            desc: 'First touch, follow-up #1, follow-up #2 — sent automatically. Nothing to manage.' },
            { icon: '◎', color: '#10b981', bg: '#d1fae5', title: 'See replies before they happen',  desc: 'We simulate how prospects respond so you know exactly what conversations to expect.' },
            { icon: '◆', color: '#f59e0b', bg: '#fef3c7', title: 'Every message is personal',       desc: 'Each lead gets outreach written specifically for them. Not a template. Not a blast.' },
            { icon: '▦', color: '#a855f7', bg: '#f3e8ff', title: 'Replies and meetings, one place', desc: 'Track who responded, who is interested, and how many meetings are on the calendar.' },
            { icon: '✉', color: '#ec4899', bg: '#fce7f3', title: 'Sends from your Gmail',           desc: 'Emails go out directly from your own inbox. It looks and feels like you wrote every one.' },
            { icon: '★', color: '#f97316', bg: '#fff7ed', title: 'Every thread ends with an ask',   desc: 'We do not just get replies. Every conversation is designed to land on a booked meeting.' },
          ].map(f => (
            <div key={f.title} style={{ background: '#fff', borderRadius: 16, padding: 28, border: '1px solid #f3f4f6' }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: f.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: f.color, marginBottom: 18 }}>{f.icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.65 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
